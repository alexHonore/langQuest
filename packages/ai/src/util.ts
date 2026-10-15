/**
 * Small runtime-neutral helpers (Cloudflare Workers + Node ≥ 22): base64, hashing, timing.
 * Nothing here may depend on `node:*` modules.
 */

const te = new TextEncoder();

/** Encode bytes as standard base64 (no data-URI prefix), chunked to avoid call-stack limits. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Decode standard base64 (data-URI prefix tolerated) into bytes. */
export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.includes(',') && base64.startsWith('data:') ? base64.slice(base64.indexOf(',') + 1) : base64;
  const binary = atob(clean.replace(/\s+/g, ''));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export const base64UrlEncode = (bytes: Uint8Array): string => bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const base64UrlDecode = (text: string): Uint8Array => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  return base64ToBytes(padded);
};

/** Synchronous, non-cryptographic 64-bit FNV-1a fingerprint (hex) — used only for log correlation, never for security. */
export function fnv1a64Hex(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const bytes = te.encode(input);
  for (const b of bytes) {
    hash ^= BigInt(b);
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

/** SHA-256 hex digest via Web Crypto (available in Workers and Node ≥ 19). */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === 'string' ? te.encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** HMAC-SHA256 over `message` with `secret`, returned as raw bytes. */
export async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, te.encode(message));
  return new Uint8Array(sig);
}

export const timingSafeEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
};

export const newId = (): string => crypto.randomUUID();
export const nowIso = (): string => new Date().toISOString();

export const sleepMs = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Clamp a number into [min, max]. */
export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Wrap raw 16-bit PCM (mono, little-endian) in a RIFF/WAVE header. */
export function pcm16ToWav(pcm: Uint8Array, sampleRateHz: number, channels = 1): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, sampleRateHz * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

/** Duration of raw PCM16 audio in milliseconds. */
export const pcm16DurationMs = (byteLength: number, sampleRateHz: number, channels = 1): number =>
  Math.round((byteLength / (sampleRateHz * channels * 2)) * 1000);

const MP3_BITRATES: Record<number, readonly number[]> = {
  // [MPEG1 L3, MPEG2/2.5 L3] indexed by bitrate index
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MP3_SAMPLE_RATES: Record<number, readonly number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/**
 * Parse MPEG Layer III frame headers to compute the real duration (ms) of an MP3 byte stream.
 * Returns `null` when no valid frames are found. Skips an ID3v2 tag if present.
 */
export function mp3DurationMs(bytes: Uint8Array): number | null {
  let offset = 0;
  if (bytes.length > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size = ((bytes[6] ?? 0) << 21) | ((bytes[7] ?? 0) << 14) | ((bytes[8] ?? 0) << 7) | (bytes[9] ?? 0);
    offset = 10 + size;
  }
  let samples = 0;
  let sampleRate: number | null = null;
  let frames = 0;
  while (offset + 4 <= bytes.length) {
    const b1 = bytes[offset] ?? 0;
    const b2 = bytes[offset + 1] ?? 0;
    if (b1 !== 0xff || (b2 & 0xe0) !== 0xe0) {
      offset += 1;
      continue;
    }
    const versionBits = (b2 >> 3) & 0x03; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layerBits = (b2 >> 1) & 0x03; // 1 = Layer III
    const b3 = bytes[offset + 2] ?? 0;
    const bitrateIndex = (b3 >> 4) & 0x0f;
    const sampleIndex = (b3 >> 2) & 0x03;
    const padding = (b3 >> 1) & 0x01;
    if (layerBits !== 1 || versionBits === 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleIndex === 3) {
      offset += 1;
      continue;
    }
    const isMpeg1 = versionBits === 3;
    const bitrate = (MP3_BITRATES[isMpeg1 ? 1 : 2]?.[bitrateIndex] ?? 0) * 1000;
    const rate = MP3_SAMPLE_RATES[versionBits]?.[sampleIndex] ?? 0;
    if (!bitrate || !rate) {
      offset += 1;
      continue;
    }
    const samplesPerFrame = isMpeg1 ? 1152 : 576;
    const frameLength = Math.floor((samplesPerFrame / 8) * (bitrate / rate)) + padding;
    if (frameLength <= 0) {
      offset += 1;
      continue;
    }
    samples += samplesPerFrame;
    sampleRate = rate;
    frames += 1;
    offset += frameLength;
  }
  if (!frames || !sampleRate) return null;
  return Math.round((samples / sampleRate) * 1000);
}

/** Remove e-mail addresses, phone-like digit runs and URLs from free text (learner-safety for persisted summaries). */
export function redactPii(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/(?:\+?\d[\d\s().-]{6,}\d)/g, '[number]');
}
