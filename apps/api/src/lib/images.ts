/**
 * Image header sniffing for `adminVisualAssetRegister` (§10.2A): pixel dimensions and the real container type of a
 * verified upload, read from the first bytes in the Worker (no decoder). PNG, JPEG, GIF, WebP (VP8 / VP8L / VP8X)
 * and SVG (`width`/`height` or `viewBox`) are supported; anything else (AVIF, truncated headers) returns `null`
 * so the route can refuse honestly instead of inventing a size.
 */
export interface SniffedImage {
  mimeType: string;
  width: number;
  height: number;
}

const ascii = (bytes: Uint8Array, start: number, length: number): string => String.fromCharCode(...bytes.subarray(start, start + length));
const be16 = (b: Uint8Array, o: number): number => (b[o]! << 8) | b[o + 1]!;
const be32 = (b: Uint8Array, o: number): number => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const le16 = (b: Uint8Array, o: number): number => b[o]! | (b[o + 1]! << 8);
const le24 = (b: Uint8Array, o: number): number => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);

const valid = (w: number, h: number, mimeType: string): SniffedImage | null => (Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && w <= 65_535 * 4 && h <= 65_535 * 4 ? { mimeType, width: w, height: h } : null);

function sniffPng(b: Uint8Array): SniffedImage | null {
  if (b.length < 24 || ascii(b, 1, 3) !== 'PNG' || b[0] !== 0x89) return null;
  if (ascii(b, 12, 4) !== 'IHDR') return null;
  return valid(be32(b, 16), be32(b, 20), 'image/png');
}

function sniffGif(b: Uint8Array): SniffedImage | null {
  if (b.length < 10 || ascii(b, 0, 3) !== 'GIF') return null;
  return valid(le16(b, 6), le16(b, 8), 'image/gif');
}

function sniffJpeg(b: Uint8Array): SniffedImage | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < b.length) {
    if (b[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = b[offset + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = be16(b, offset + 2);
    // SOF0..SOF15 except DHT (0xc4), JPG (0xc8), DAC (0xcc) carry the frame header.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return valid(be16(b, offset + 7), be16(b, offset + 5), 'image/jpeg');
    }
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

function sniffWebp(b: Uint8Array): SniffedImage | null {
  if (b.length < 30 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null;
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8 ') return valid(le16(b, 26) & 0x3fff, le16(b, 28) & 0x3fff, 'image/webp');
  if (chunk === 'VP8L') {
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return valid((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1, 'image/webp');
  }
  if (chunk === 'VP8X') return valid(le24(b, 24) + 1, le24(b, 27) + 1, 'image/webp');
  return null;
}

const SVG_LENGTH = /^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$/i;
function sniffSvg(b: Uint8Array): SniffedImage | null {
  const head = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, Math.min(b.length, 4096)));
  const open = head.match(/<svg\b[^>]*>/i);
  if (!open) return null;
  const tag = open[0];
  const attr = (name: string): string | null => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1] ?? null;
  const w = attr('width');
  const h = attr('height');
  const mw = w ? SVG_LENGTH.exec(w) : null;
  const mh = h ? SVG_LENGTH.exec(h) : null;
  if (mw && mh) return valid(Math.round(Number(mw[1])), Math.round(Number(mh[1])), 'image/svg+xml');
  const viewBox = attr('viewBox');
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) return valid(Math.round(parts[2]!), Math.round(parts[3]!), 'image/svg+xml');
  }
  return null;
}

/** Dimensions + container type from the leading bytes, or null when the format is not understood. */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  return sniffPng(bytes) ?? sniffJpeg(bytes) ?? sniffGif(bytes) ?? sniffWebp(bytes) ?? sniffSvg(bytes);
}

/** True when the sniffed container matches the declared MIME (JPEG aliases and `image/svg+xml` tolerated). */
export function imageMimeMatches(declared: string, sniffed: string): boolean {
  const norm = (m: string) => (m === 'image/jpg' ? 'image/jpeg' : m.toLowerCase());
  return norm(declared) === norm(sniffed);
}
