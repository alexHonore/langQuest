/**
 * Sync engine: flushes the outbox when the device is online, on app
 * foreground and after each enqueue (debounced), with exponential backoff
 * between failed attempts. Pure logic — connectivity and timers are injected.
 */
import type { ProgressSyncRequest, ProgressSyncResponse } from '@langquest/contracts';
import type { FlushResult, Outbox } from './outbox';

export interface SyncEngineOptions {
  outbox: Outbox;
  send: (request: ProgressSyncRequest) => Promise<ProgressSyncResponse>;
  /** Initial connectivity; keep it current with `setOnline`. */
  isOnline: () => boolean;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Base delay between retries (default 2 s, doubles up to 5 min). */
  baseDelayMs?: number;
  debounceMs?: number;
  onResult?: (result: FlushResult) => void;
}

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

export class SyncEngine {
  private failures = 0;
  private online: boolean | null = null;
  private timer: unknown = null;
  private status: SyncStatus = 'idle';
  private listeners = new Set<(status: SyncStatus, pending: number) => void>();
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly options: SyncEngineOptions) {
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** Update connectivity (replaces the initial `isOnline` probe once called). */
  setOnline(online: boolean): void {
    this.online = online;
  }

  private isOnline(): boolean {
    return this.online ?? this.options.isOnline();
  }

  subscribe(listener: (status: SyncStatus, pending: number) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async notify(status: SyncStatus): Promise<void> {
    this.status = status;
    const pending = await this.options.outbox.pendingCount();
    for (const l of this.listeners) l(status, pending);
  }

  get currentStatus(): SyncStatus {
    return this.status;
  }

  /** Schedule a flush soon (after an enqueue). */
  requestSync(): void {
    if (this.timer) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => void this.syncNow(), this.options.debounceMs ?? 500);
  }

  /** Called when connectivity returns or the app comes to the foreground. */
  onReconnect(): void {
    this.failures = 0;
    this.requestSync();
  }

  async syncNow(): Promise<FlushResult | null> {
    if (this.timer) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    if (!this.isOnline()) {
      await this.notify('offline');
      return null;
    }
    if ((await this.options.outbox.pendingCount()) === 0) {
      await this.notify('idle');
      return null;
    }
    await this.notify('syncing');
    const result = await this.options.outbox.flush(this.options.send);
    this.options.onResult?.(result);
    if (result.failed) {
      this.failures += 1;
      const delay = Math.min(5 * 60_000, (this.options.baseDelayMs ?? 2_000) * 2 ** (this.failures - 1));
      this.timer = this.setTimer(() => void this.syncNow(), delay);
      await this.notify('error');
    } else {
      this.failures = 0;
      await this.notify('idle');
    }
    return result;
  }

  dispose(): void {
    if (this.timer) this.clearTimer(this.timer);
    this.listeners.clear();
  }
}
