/**
 * Transcript follow-along helpers (§7.5): active segment lookup, karaoke word
 * windows and A/B loop bounds over the API's `TranscriptSegmentDto`. Pure;
 * mirrors `@langquest/media/transcripts` for the segment shape the mobile app
 * receives (that package is not a mobile dependency).
 */
import type { TranscriptResponse } from '@langquest/contracts';

export type TranscriptSegment = TranscriptResponse['segments'][number];

/** Index of the segment containing `positionMs` (binary search; -1 between segments). */
export function activeSegmentIndex(segments: readonly TranscriptSegment[], positionMs: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = segments[mid]!;
    if (positionMs < s.startMs) hi = mid - 1;
    else if (positionMs >= s.endMs) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/** Nearest segment at or before `positionMs` (for "which sentence am I in" when between segments). */
export function nearestSegmentIndex(segments: readonly TranscriptSegment[], positionMs: number): number {
  const exact = activeSegmentIndex(segments, positionMs);
  if (exact >= 0) return exact;
  let idx = -1;
  for (let i = 0; i < segments.length; i += 1) {
    if (segments[i]!.startMs <= positionMs) idx = i;
    else break;
  }
  return idx;
}

export interface KaraokeWindow {
  startMs: number;
  endMs: number;
  charStart: number;
  charEnd: number;
  text: string;
}

/** Word highlight windows: real word alignment when present, otherwise proportional to word length. */
export function karaokeWindows(segment: Pick<TranscriptSegment, 'text' | 'startMs' | 'endMs' | 'words'>): KaraokeWindow[] {
  const text = segment.text;
  if (segment.words.length > 0) {
    const windows: KaraokeWindow[] = [];
    let cursor = 0;
    for (const w of segment.words) {
      const at = text.indexOf(w.word, cursor);
      const charStart = at >= 0 ? at : cursor;
      const charEnd = charStart + w.word.length;
      windows.push({ startMs: w.startMs, endMs: w.endMs, charStart, charEnd, text: w.word });
      cursor = charEnd;
    }
    return windows;
  }
  const tokens: { start: number; end: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) tokens.push({ start: m.index, end: m.index + m[0].length });
  if (tokens.length === 0) return [];
  const totalChars = tokens.reduce((n, t) => n + (t.end - t.start), 0);
  const duration = Math.max(1, segment.endMs - segment.startMs);
  let t = segment.startMs;
  return tokens.map((tok, i) => {
    const share = (tok.end - tok.start) / totalChars;
    const start = t;
    const end = i === tokens.length - 1 ? segment.endMs : Math.min(segment.endMs, start + Math.round(share * duration));
    t = end;
    return { startMs: start, endMs: end, charStart: tok.start, charEnd: tok.end, text: text.slice(tok.start, tok.end) };
  });
}

/** Index of the karaoke window active at `positionMs` (-1 when none / before the first word). */
export function activeWindowIndex(windows: readonly KaraokeWindow[], positionMs: number): number {
  let idx = -1;
  for (let i = 0; i < windows.length; i += 1) {
    const w = windows[i]!;
    if (positionMs >= w.startMs && positionMs < w.endMs) return i;
    if (w.startMs <= positionMs) idx = i;
  }
  return idx;
}

/** A/B loop bounds for one segment with padding, clamped to neighbours and the media duration. */
export function loopBoundsFor(segments: readonly TranscriptSegment[], index: number, options: { paddingMs?: number; durationMs?: number | null } = {}): { startMs: number; endMs: number } | null {
  const seg = segments[index];
  if (!seg) return null;
  const pad = options.paddingMs ?? 150;
  let startMs = Math.max(0, seg.startMs - pad);
  let endMs = seg.endMs + pad;
  const prev = segments[index - 1];
  const next = segments[index + 1];
  if (prev) startMs = Math.max(startMs, prev.endMs);
  if (next) endMs = Math.min(endMs, next.startMs);
  if (typeof options.durationMs === 'number' && options.durationMs > 0) endMs = Math.min(endMs, options.durationMs);
  return { startMs, endMs: Math.max(endMs, startMs + 1) };
}

/** Loop bounds spanning a range of segments (A = first, B = last). */
export function loopBoundsForRange(segments: readonly TranscriptSegment[], from: number, to: number, options: { paddingMs?: number; durationMs?: number | null } = {}): { startMs: number; endMs: number } | null {
  const a = loopBoundsFor(segments, Math.min(from, to), options);
  const b = loopBoundsFor(segments, Math.max(from, to), options);
  if (!a || !b) return null;
  return { startMs: a.startMs, endMs: Math.max(b.endMs, a.startMs + 1) };
}
