/**
 * Turn an `AudioInput` (asset / url / inline) into bytes + a provider format string. Asset resolution is
 * injected by the API (it owns R2 access); this package never touches storage directly.
 */
import type { AudioEncoding, AudioInput } from '@langquest/contracts';
import { base64ToBytes, pcm16ToWav } from '../util';

export interface ResolvedAudio {
  bytes: Uint8Array;
  /** Provider-facing format token (`wav`, `mp3`, `flac`, `webm`, `m4a`, `ogg`). */
  format: string;
  mimeType: string;
  encoding: AudioEncoding;
  sampleRateHz: number | null;
}

export interface AudioAssetResolver {
  /** Return the bytes (or a short-lived URL) for an R2 media asset the learner is allowed to use. */
  resolve(assetId: string): Promise<{ bytes: Uint8Array; encoding?: AudioEncoding; sampleRateHz?: number | null } | { url: string; encoding?: AudioEncoding; sampleRateHz?: number | null }>;
}

export const DEFAULT_PCM_SAMPLE_RATE = 16_000;

export function providerFormatFor(encoding: AudioEncoding): { format: string; mimeType: string } {
  switch (encoding) {
    case 'pcm16':
    case 'wav':
      return { format: 'wav', mimeType: 'audio/wav' };
    case 'mp3':
      return { format: 'mp3', mimeType: 'audio/mpeg' };
    case 'flac':
      return { format: 'flac', mimeType: 'audio/flac' };
    case 'opus':
      return { format: 'ogg', mimeType: 'audio/ogg' };
    case 'webm_opus':
      return { format: 'webm', mimeType: 'audio/webm' };
    case 'aac':
    case 'm4a':
      return { format: 'm4a', mimeType: 'audio/mp4' };
    default:
      return { format: 'wav', mimeType: 'audio/wav' };
  }
}

export interface ResolveAudioOptions {
  assetResolver?: AudioAssetResolver;
  fetch?: typeof fetch;
  /** Hard ceiling for downloaded/decoded audio (default 25 MB — OpenRouter multipart cap). */
  maxBytes?: number;
}

export async function resolveAudioBytes(input: AudioInput, options: ResolveAudioOptions = {}): Promise<ResolvedAudio> {
  const maxBytes = options.maxBytes ?? 25 * 1024 * 1024;
  let bytes: Uint8Array;
  let encoding = input.encoding;
  let sampleRateHz = input.sampleRateHz;

  if (input.source === 'inline') {
    bytes = base64ToBytes(input.base64);
  } else if (input.source === 'url') {
    bytes = await download(input.url, options.fetch, maxBytes);
  } else {
    if (!options.assetResolver) throw new Error('AudioInput.source="asset" requires an AudioAssetResolver');
    const resolved = await options.assetResolver.resolve(input.assetId);
    encoding = resolved.encoding ?? encoding;
    sampleRateHz = resolved.sampleRateHz ?? sampleRateHz;
    bytes = 'bytes' in resolved ? resolved.bytes : await download(resolved.url, options.fetch, maxBytes);
  }
  if (bytes.byteLength > maxBytes) throw new Error(`Audio exceeds ${maxBytes} bytes`);
  if (bytes.byteLength === 0) throw new Error('Audio input is empty');

  if (encoding === 'pcm16') {
    const rate = sampleRateHz ?? DEFAULT_PCM_SAMPLE_RATE;
    return { bytes: pcm16ToWav(bytes, rate), format: 'wav', mimeType: 'audio/wav', encoding: 'wav', sampleRateHz: rate };
  }
  const { format, mimeType } = providerFormatFor(encoding);
  return { bytes, format, mimeType, encoding, sampleRateHz };
}

async function download(url: string, fetchImpl: typeof fetch | undefined, maxBytes: number): Promise<Uint8Array> {
  const f = fetchImpl ?? globalThis.fetch.bind(globalThis);
  const res = await f(url);
  if (!res.ok) throw new Error(`Failed to download audio (${res.status})`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw new Error(`Audio exceeds ${maxBytes} bytes`);
  return new Uint8Array(await res.arrayBuffer());
}
