/**
 * Transcript segment utilities (§7.5): merge/split/retime, speaker and language labels,
 * mixed-language detection, SRT/VTT/JSON import-export, karaoke windows, A/B loop bounds and
 * sentence anchors. Pure functions over plain segment objects; ids are preserved where possible.
 */
import { z } from 'zod';

export const TranscriptWordSchema = z.object({
  word: z.string(),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
  confidence: z.number().min(0).max(1).nullable().optional(),
});
export type TranscriptWord = z.infer<typeof TranscriptWordSchema>;

export const SegmentSchema = z.object({
  id: z.string().optional(),
  index: z.number().int().min(0),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
  text: z.string(),
  speakerLabel: z.string().nullable().default(null),
  /** BCP-47 / ISO language code of the segment's speech (`null` = unknown). */
  languageCode: z.string().nullable().default(null),
  /** Variety id when known (e.g. `ary`); never inferred from a broader language code. */
  varietyId: z.string().nullable().default(null),
  transliteration: z.string().nullable().default(null),
  confidence: z.number().min(0).max(1).nullable().default(null),
  words: z.array(TranscriptWordSchema).default([]),
  reviewed: z.boolean().default(false),
});
export type Segment = z.infer<typeof SegmentSchema>;
export type SegmentInput = z.input<typeof SegmentSchema>;

/** Normalise a loosely-typed segment list: validate, sort by start, reindex and clamp overlaps. */
export function normalizeSegments(input: readonly SegmentInput[]): Segment[] {
  const parsed = input.map((s) => SegmentSchema.parse(s));
  parsed.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const out: Segment[] = [];
  for (const seg of parsed) {
    const prev = out[out.length - 1];
    let startMs = seg.startMs;
    if (prev && startMs < prev.endMs) startMs = prev.endMs;
    const endMs = Math.max(seg.endMs, startMs);
    out.push({ ...seg, startMs, endMs, index: out.length });
  }
  return out;
}

function reindex(segments: Segment[]): Segment[] {
  return segments.map((s, i) => ({ ...s, index: i }));
}

/** Merge segments `fromIndex..toIndex` (inclusive) into one; text joined with a space, words concatenated. */
export function mergeSegments(segments: readonly Segment[], fromIndex: number, toIndex: number): Segment[] {
  if (fromIndex < 0 || toIndex >= segments.length || fromIndex > toIndex) throw new Error('Invalid merge range');
  const slice = segments.slice(fromIndex, toIndex + 1);
  const first = slice[0]!;
  const languages = new Set(slice.map((s) => s.languageCode).filter(Boolean));
  const speakers = new Set(slice.map((s) => s.speakerLabel).filter(Boolean));
  const confidences = slice.map((s) => s.confidence).filter((c): c is number => c !== null);
  const merged: Segment = {
    ...first,
    endMs: slice[slice.length - 1]!.endMs,
    text: slice.map((s) => s.text.trim()).filter(Boolean).join(' '),
    transliteration: slice.every((s) => s.transliteration === null) ? null : slice.map((s) => s.transliteration ?? '').join(' ').trim(),
    languageCode: languages.size === 1 ? first.languageCode : languages.size > 1 ? 'mul' : null,
    speakerLabel: speakers.size === 1 ? first.speakerLabel : null,
    confidence: confidences.length ? Number((confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(3)) : null,
    words: slice.flatMap((s) => s.words),
    reviewed: false,
  };
  return reindex([...segments.slice(0, fromIndex), merged, ...segments.slice(toIndex + 1)]);
}

export type SplitPoint = { atMs: number } | { atChar: number };

/**
 * Split a segment at a time or character offset. With word timings the split snaps to the
 * nearest word boundary; otherwise the time is interpolated proportionally to characters.
 */
export function splitSegment(segments: readonly Segment[], index: number, at: SplitPoint): Segment[] {
  const seg = segments[index];
  if (!seg) throw new Error(`No segment at index ${index}`);
  const duration = seg.endMs - seg.startMs;
  const text = seg.text;
  let charIndex: number;
  let splitMs: number;
  if (seg.words.length > 0) {
    const targetMs = 'atMs' in at ? at.atMs : seg.startMs + Math.round((at.atChar / Math.max(1, text.length)) * duration);
    let wordIdx = seg.words.findIndex((w) => w.startMs >= targetMs);
    if (wordIdx <= 0) wordIdx = 1;
    if (wordIdx >= seg.words.length) wordIdx = seg.words.length - 1;
    const leftWords = seg.words.slice(0, wordIdx);
    const rightWords = seg.words.slice(wordIdx);
    splitMs = rightWords[0]!.startMs;
    const leftText = leftWords.map((w) => w.word).join(' ');
    const rightText = rightWords.map((w) => w.word).join(' ');
    return reindex([
      ...segments.slice(0, index),
      { ...seg, endMs: splitMs, text: leftText, words: leftWords, transliteration: null, reviewed: false },
      { ...seg, id: undefined, startMs: splitMs, text: rightText, words: rightWords, transliteration: null, reviewed: false },
      ...segments.slice(index + 1),
    ]);
  }
  if ('atChar' in at) {
    charIndex = Math.max(1, Math.min(text.length - 1, at.atChar));
    splitMs = seg.startMs + Math.round((charIndex / Math.max(1, text.length)) * duration);
  } else {
    splitMs = Math.max(seg.startMs + 1, Math.min(seg.endMs - 1, at.atMs));
    charIndex = Math.round(((splitMs - seg.startMs) / Math.max(1, duration)) * text.length);
    // snap to the nearest whitespace so words are not cut in half
    const left = text.lastIndexOf(' ', charIndex);
    const right = text.indexOf(' ', charIndex);
    if (left > 0 && (right === -1 || charIndex - left <= right - charIndex)) charIndex = left;
    else if (right > 0) charIndex = right;
  }
  const leftText = text.slice(0, charIndex).trim();
  const rightText = text.slice(charIndex).trim();
  if (!leftText || !rightText) throw new Error('Split would produce an empty segment');
  return reindex([
    ...segments.slice(0, index),
    { ...seg, endMs: splitMs, text: leftText, transliteration: null, reviewed: false },
    { ...seg, id: undefined, startMs: splitMs, text: rightText, transliteration: null, reviewed: false },
    ...segments.slice(index + 1),
  ]);
}

/** Change a segment's bounds; neighbours are clamped so the list stays non-overlapping. */
export function retimeSegment(segments: readonly Segment[], index: number, bounds: { startMs?: number; endMs?: number }): Segment[] {
  const seg = segments[index];
  if (!seg) throw new Error(`No segment at index ${index}`);
  const startMs = bounds.startMs ?? seg.startMs;
  const endMs = bounds.endMs ?? seg.endMs;
  if (startMs < 0 || endMs <= startMs) throw new Error('Invalid bounds');
  const out = segments.map((s) => ({ ...s }));
  out[index] = { ...seg, startMs, endMs, reviewed: false };
  const prev = out[index - 1];
  if (prev && prev.endMs > startMs) prev.endMs = Math.max(prev.startMs + 1, startMs);
  const next = out[index + 1];
  if (next && next.startMs < endMs) next.startMs = Math.min(next.endMs - 1, endMs);
  return out;
}

/** Set the speaker label on a range of segments (null clears it). */
export function labelSpeaker(segments: readonly Segment[], indices: readonly number[], speakerLabel: string | null): Segment[] {
  const set = new Set(indices);
  return segments.map((s) => (set.has(s.index) ? { ...s, speakerLabel } : s));
}

/** Set the language (and optionally variety) on a range of segments. */
export function labelLanguage(segments: readonly Segment[], indices: readonly number[], languageCode: string | null, varietyId: string | null = null): Segment[] {
  const set = new Set(indices);
  return segments.map((s) => (set.has(s.index) ? { ...s, languageCode, varietyId } : s));
}

export interface LanguageMix {
  mixed: boolean;
  /** Language codes present, most frequent first (by speech time). */
  languages: Array<{ code: string; durationMs: number; share: number }>;
  dominant: string | null;
  unknownShare: number;
}

/** Summarise the language mix of a transcript by speech time (code-switched content → `mixed`). */
export function detectLanguageMix(segments: readonly Segment[]): LanguageMix {
  const totals = new Map<string, number>();
  let unknown = 0;
  let total = 0;
  for (const s of segments) {
    const d = Math.max(0, s.endMs - s.startMs);
    total += d;
    if (s.languageCode) totals.set(s.languageCode, (totals.get(s.languageCode) ?? 0) + d);
    else unknown += d;
  }
  const languages = [...totals.entries()].map(([code, durationMs]) => ({ code, durationMs, share: total ? Number((durationMs / total).toFixed(3)) : 0 })).sort((a, b) => b.durationMs - a.durationMs);
  return { mixed: languages.filter((l) => l.share >= 0.05).length > 1, languages, dominant: languages[0]?.code ?? null, unknownShare: total ? Number((unknown / total).toFixed(3)) : 0 };
}

// --- export / import --------------------------------------------------------------------

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/** `HH:MM:SS,mmm` (SRT) or `HH:MM:SS.mmm` (VTT). */
export function formatTimestamp(ms: number, separator: ',' | '.' = ','): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${separator}${pad(r, 3)}`;
}

/** Parse `HH:MM:SS,mmm` / `MM:SS.mmm` into milliseconds. */
export function parseTimestamp(value: string): number {
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/.exec(value.trim());
  if (!m) throw new Error(`Invalid timestamp: ${value}`);
  const h = m[1] ? Number.parseInt(m[1], 10) : 0;
  return h * 3_600_000 + Number.parseInt(m[2]!, 10) * 60_000 + Number.parseInt(m[3]!, 10) * 1000 + Number.parseInt(m[4]!.padEnd(3, '0'), 10);
}

export interface ExportOptions {
  /** Prefix lines with `Speaker: ` when a label is known. */
  includeSpeaker?: boolean;
  /** Append the transliteration on a second line when present. */
  includeTransliteration?: boolean;
}

function cueText(s: Segment, options: ExportOptions): string {
  let text = s.text.replace(/\r?\n/g, ' ').trim();
  if (options.includeSpeaker && s.speakerLabel) text = `${s.speakerLabel}: ${text}`;
  if (options.includeTransliteration && s.transliteration) text += `\n${s.transliteration}`;
  return text;
}

export function toSrt(segments: readonly Segment[], options: ExportOptions = {}): string {
  return segments.map((s, i) => `${i + 1}\n${formatTimestamp(s.startMs, ',')} --> ${formatTimestamp(s.endMs, ',')}\n${cueText(s, options)}\n`).join('\n');
}

export function toVtt(segments: readonly Segment[], options: ExportOptions = {}): string {
  const cues = segments.map((s) => {
    const voice = options.includeSpeaker && s.speakerLabel ? `<v ${s.speakerLabel}>` : '';
    const text = voice ? `${voice}${cueText(s, { ...options, includeSpeaker: false })}` : cueText(s, options);
    const lang = s.languageCode ? ` lang:${s.languageCode}` : '';
    return `${s.id ?? s.index + 1}\n${formatTimestamp(s.startMs, '.')} --> ${formatTimestamp(s.endMs, '.')}${lang ? '' : ''}\n${text}\n`;
  });
  return `WEBVTT\n\n${cues.join('\n')}`;
}

export const TranscriptJsonSchema = z.object({ version: z.literal(1), languageMode: z.enum(['source', 'target', 'mixed']).optional(), segments: z.array(SegmentSchema) });
export type TranscriptJson = z.infer<typeof TranscriptJsonSchema>;

export function toTranscriptJson(segments: readonly Segment[]): TranscriptJson {
  const mix = detectLanguageMix(segments);
  return { version: 1, languageMode: mix.mixed ? 'mixed' : 'target', segments: [...segments] };
}

/** Parse SRT or WebVTT text (manually uploaded transcripts, §7.5). Speaker `<v Name>` tags and `Name: ` prefixes are extracted. */
export function parseSubtitles(text: string): Segment[] {
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const blocks = src.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const segments: SegmentInput[] = [];
  for (const block of blocks) {
    if (/^WEBVTT/.test(block) || /^NOTE\b/.test(block) || /^STYLE\b/.test(block) || /^REGION\b/.test(block)) continue;
    const lines = block.split('\n');
    let cueLine = lines.findIndex((l) => l.includes('-->'));
    if (cueLine === -1) continue;
    const idLine = cueLine > 0 ? lines[cueLine - 1]!.trim() : null;
    const [startRaw, endRaw] = lines[cueLine]!.split('-->').map((s) => s.trim().split(/\s+/)[0]!);
    const body = lines.slice(cueLine + 1).join('\n').trim();
    let speakerLabel: string | null = null;
    let content = body;
    const voice = /^<v(?:\.[^\s>]+)?\s+([^>]+)>/.exec(content);
    if (voice) {
      speakerLabel = voice[1]!.trim();
      content = content.replace(voice[0], '').replace(/<\/v>/g, '');
    } else {
      const prefixed = /^([A-Za-z][\w .'-]{0,40}):\s+(.*)$/s.exec(content);
      if (prefixed) {
        speakerLabel = prefixed[1]!.trim();
        content = prefixed[2]!;
      }
    }
    content = content.replace(/<[^>]+>/g, '').replace(/\s*\n\s*/g, ' ').trim();
    segments.push({ id: idLine && !/^\d+$/.test(idLine) ? idLine : undefined, index: segments.length, startMs: parseTimestamp(startRaw!), endMs: parseTimestamp(endRaw!), text: content, speakerLabel });
    cueLine = -1;
  }
  return normalizeSegments(segments);
}

// --- playback helpers ---------------------------------------------------------------------

export interface KaraokeWindow {
  startMs: number;
  endMs: number;
  /** Character range in the segment text highlighted during this window. */
  charStart: number;
  charEnd: number;
  text: string;
}

/**
 * Highlight windows for follow-along playback. Uses word timings when present; otherwise
 * distributes the segment duration across words proportionally to their length.
 */
export function karaokeWindows(segment: Segment): KaraokeWindow[] {
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
  const tokens: Array<{ start: number; end: number }> = [];
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

/** Binary search for the segment active at `positionMs` (`null` between segments / outside). */
export function activeSegmentAt(segments: readonly Segment[], positionMs: number): Segment | null {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = segments[mid]!;
    if (positionMs < s.startMs) hi = mid - 1;
    else if (positionMs >= s.endMs) lo = mid + 1;
    else return s;
  }
  return null;
}

/** A/B loop bounds for a segment with padding, clamped to the media duration and neighbours. */
export function loopBounds(segments: readonly Segment[], index: number, options: { paddingMs?: number; durationMs?: number | null; clampToNeighbours?: boolean } = {}): { startMs: number; endMs: number } {
  const seg = segments[index];
  if (!seg) throw new Error(`No segment at index ${index}`);
  const pad = options.paddingMs ?? 150;
  let startMs = Math.max(0, seg.startMs - pad);
  let endMs = seg.endMs + pad;
  if (options.clampToNeighbours !== false) {
    const prev = segments[index - 1];
    const next = segments[index + 1];
    if (prev) startMs = Math.max(startMs, prev.endMs);
    if (next) endMs = Math.min(endMs, next.startMs);
  }
  if (typeof options.durationMs === 'number') endMs = Math.min(endMs, options.durationMs);
  return { startMs, endMs: Math.max(endMs, startMs + 1) };
}

export interface SentenceAnchor {
  index: number;
  id: string | null;
  startMs: number;
  endMs: number;
  snippet: string;
  speakerLabel: string | null;
}

/** Jump-to-sentence anchors (short snippets for the transcript navigator). */
export function sentenceAnchors(segments: readonly Segment[], snippetLength = 48): SentenceAnchor[] {
  return segments.map((s) => ({ index: s.index, id: s.id ?? null, startMs: s.startMs, endMs: s.endMs, snippet: s.text.length > snippetLength ? `${s.text.slice(0, snippetLength - 1).trimEnd()}…` : s.text, speakerLabel: s.speakerLabel }));
}

/** Coverage percentage: share of the media duration covered by segments (0..100). */
export function transcriptCoveragePct(segments: readonly Segment[], durationMs: number): number {
  if (durationMs <= 0) return 0;
  const covered = segments.reduce((n, s) => n + Math.max(0, Math.min(s.endMs, durationMs) - s.startMs), 0);
  return Number(Math.min(100, (covered / durationMs) * 100).toFixed(1));
}
