/**
 * Full-duplex realtime provider placeholder (§8.6). It NEVER pretends: `supports()` is false unless a real
 * duplex adapter is injected, and `createSession()` throws so the API shows the supported turn-based pipeline
 * instead of a broken spinner (§15).
 */
import { unsupportedCapability, type Capability, type RealtimeConversationProvider, type ShortLivedSession, type VoiceSessionConfig } from '@langquest/contracts';
import { AiCapabilityError } from '../errors';

export class DuplexProviderStub implements RealtimeConversationProvider {
  readonly provider: string;
  private readonly delegate: RealtimeConversationProvider | null;

  constructor(options: { delegate?: RealtimeConversationProvider | null } = {}) {
    this.delegate = options.delegate ?? null;
    this.provider = this.delegate ? this.delegate.provider : 'duplex_unconfigured';
  }

  get configured(): boolean {
    return this.delegate !== null;
  }

  async supports(locale: string, interruptible: boolean): Promise<Capability> {
    if (this.delegate) return this.delegate.supports(locale, interruptible);
    return unsupportedCapability(this.provider, ['provider_disabled'], ['No full-duplex realtime provider is configured. Use the STT→LLM→TTS pipeline.']);
  }

  async createSession(config: VoiceSessionConfig): Promise<ShortLivedSession> {
    if (this.delegate) return this.delegate.createSession(config);
    throw new AiCapabilityError('Full-duplex realtime voice is not configured', await this.supports(config.locale, config.interruptible), config.locale);
  }
}
