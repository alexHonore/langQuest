/**
 * Hands-free voice activity detection from recorder metering (§8.3).
 *
 * The recorder reports a level in dBFS at a fixed interval. Speech starts once
 * the level stays above `thresholdDb` for `minSpeechMs`; it ends after
 * `silenceMs` of levels below the threshold. The detector is pure: feed it
 * `(levelDb, atMs)` samples and act on the returned transition. It never
 * fabricates a waveform — the UI shows the real level it is given.
 */
export interface VadOptions {
  /** dBFS above which audio counts as speech (default −35). */
  thresholdDb?: number;
  /** Trailing silence before a turn ends (default 900 ms). */
  silenceMs?: number;
  /** Minimum sustained sound before speech is declared (default 250 ms). */
  minSpeechMs?: number;
  /** Hard cap on a single turn (default 30 s). */
  maxTurnMs?: number;
}

export type VadTransition = 'speech_start' | 'speech_end' | null;

export class VadDetector {
  private readonly thresholdDb: number;
  private readonly silenceMs: number;
  private readonly minSpeechMs: number;
  private readonly maxTurnMs: number;
  private speaking = false;
  private aboveSince: number | null = null;
  private belowSince: number | null = null;
  private speechStartedAt: number | null = null;

  constructor(options: VadOptions = {}) {
    this.thresholdDb = options.thresholdDb ?? -35;
    this.silenceMs = options.silenceMs ?? 900;
    this.minSpeechMs = options.minSpeechMs ?? 250;
    this.maxTurnMs = options.maxTurnMs ?? 30_000;
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  reset(): void {
    this.speaking = false;
    this.aboveSince = null;
    this.belowSince = null;
    this.speechStartedAt = null;
  }

  /** Feed one metering sample. `levelDb` may be undefined when metering is unavailable (treated as silence). */
  sample(levelDb: number | undefined, atMs: number): VadTransition {
    const above = typeof levelDb === 'number' && Number.isFinite(levelDb) && levelDb >= this.thresholdDb;
    if (!this.speaking) {
      if (above) {
        this.aboveSince ??= atMs;
        if (atMs - this.aboveSince >= this.minSpeechMs) {
          this.speaking = true;
          this.speechStartedAt = this.aboveSince;
          this.belowSince = null;
          return 'speech_start';
        }
      } else {
        this.aboveSince = null;
      }
      return null;
    }
    if (this.speechStartedAt !== null && atMs - this.speechStartedAt >= this.maxTurnMs) {
      this.reset();
      return 'speech_end';
    }
    if (above) {
      this.belowSince = null;
      return null;
    }
    this.belowSince ??= atMs;
    if (atMs - this.belowSince >= this.silenceMs) {
      this.reset();
      return 'speech_end';
    }
    return null;
  }
}

/** Map a dBFS level to 0..1 for an honest level meter (−60 dB → 0, 0 dB → 1). */
export function levelToUnit(levelDb: number | undefined): number {
  if (typeof levelDb !== 'number' || !Number.isFinite(levelDb)) return 0;
  return Math.max(0, Math.min(1, (levelDb + 60) / 60));
}
