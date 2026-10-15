/**
 * Meaning-equivalence scoring (§3.4, §8.1 task 4, acceptance A11): accept paraphrases, reject wrong
 * meanings. A deterministic lexical scorer runs first (cheap, offline, testable); an optional LLM judge
 * (`meaning_assessment` task) decides the uncertain band and genuine paraphrases.
 */
import { z } from 'zod';
import { UnitIntervalSchema, type LanguageContext, type TextReasoner, type VarietyId } from '@langquest/contracts';
import { findVariety } from '@langquest/contracts';
import { clamp } from '../util';

export interface MeaningReference {
  text: string;
  /** Intent / skill key this phrasing satisfies (returned in `matchedIntentIds`). */
  intentId?: string;
}

export interface DeterministicSignals {
  tokenJaccard: number;
  bigramDice: number;
  levenshteinRatio: number;
  negationMismatch: boolean;
}

export interface DeterministicMeaningResult {
  score: number;
  matched: boolean;
  /** Score fell into the band where lexical overlap cannot decide (paraphrase or near-miss). */
  uncertain: boolean;
  bestReference: MeaningReference | null;
  signals: DeterministicSignals;
}

export const MEANING_THRESHOLDS = { match: 0.72, uncertainLow: 0.3 } as const;

const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
const HAN = /[㐀-鿿豈-﫿]/;
const KANA = /[぀-ヿ]/;

/** Normalise text for lexical comparison in a script-aware way. */
export function normalizeForMeaning(text: string, variety: VarietyId): string {
  let t = text.normalize('NFKC').toLowerCase().trim();
  const lang = findVariety(variety)?.languageCode;
  if (lang === 'ar') {
    t = t.replace(ARABIC_DIACRITICS, '').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');
  }
  if (lang === 'he') t = t.replace(/[֑-ׇ]/g, '');
  // Strip punctuation (keep letters/numbers/marks/spaces).
  t = t.replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return t;
}

export function tokenize(normalized: string): string[] {
  if (HAN.test(normalized) || KANA.test(normalized)) {
    return [...normalized.replace(/\s+/g, '')];
  }
  return normalized.split(' ').filter(Boolean);
}

const bigrams = (s: string): Map<string, number> => {
  const compact = s.replace(/\s+/g, ' ');
  const map = new Map<string, number>();
  for (let i = 0; i < compact.length - 1; i += 1) {
    const g = compact.slice(i, i + 2);
    map.set(g, (map.get(g) ?? 0) + 1);
  }
  return map;
};

const diceBigrams = (a: string, b: string): number => {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size && !B.size) return 1;
  let overlap = 0;
  for (const [g, n] of A) overlap += Math.min(n, B.get(g) ?? 0);
  const total = [...A.values()].reduce((x, y) => x + y, 0) + [...B.values()].reduce((x, y) => x + y, 0);
  return total ? (2 * overlap) / total : 0;
};

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

/** Negation markers by language code (token-level, after normalisation). */
export const NEGATION_TOKENS: Readonly<Record<string, readonly string[]>> = {
  en: ['not', 'no', 'never', "don't", 'dont', "doesn't", "didn't", "can't", 'cannot', "won't", "isn't", "aren't"],
  fr: ['ne', 'pas', 'jamais', 'non', 'aucun', 'aucune', 'rien', 'personne'],
  es: ['no', 'nunca', 'jamás', 'jamas', 'nada', 'nadie', 'ninguno', 'ninguna'],
  pt: ['não', 'nao', 'nunca', 'jamais', 'nada', 'ninguém', 'ninguem'],
  de: ['nicht', 'kein', 'keine', 'keinen', 'nie', 'niemals', 'nein'],
  it: ['non', 'mai', 'niente', 'nessuno', 'no'],
  ar: ['لا', 'ما', 'مش', 'مو', 'ماشي', 'ليس', 'لن', 'لم', 'لسه', 'ماكاينش', 'ماكاين', 'معنديش', 'مابغيتش', 'ماعنديش', 'مابديش', 'مبحبش'],
  ht: ['pa', 'pat', 'janm'],
  sw: ['si', 'sio', 'hapana', 'hakuna', 'sitaki', 'hapendi', 'hatuna', 'sina'],
  ru: ['не', 'нет', 'никогда', 'ничего', 'никто'],
  uk: ['не', 'ні', 'ніколи', 'нічого', 'ніхто'],
  zh: ['不', '唔', '没', '沒', '冇', '别', '別', '不是', '唔係', '唔要'],
  ja: ['ない', 'ません', 'いいえ', 'なく', 'じゃない'],
  ko: ['안', '않', '못', '아니', '아니요', '없'],
  hi: ['नहीं', 'मत', 'ना', 'कभी'],
  el: ['δεν', 'μη', 'μην', 'όχι', 'ποτέ'],
  da: ['ikke', 'nej', 'aldrig', 'ingen'],
  sv: ['inte', 'nej', 'aldrig', 'ingen'],
  ro: ['nu', 'niciodată', 'nimic', 'nimeni'],
  he: ['לא', 'אין', 'אף', 'פעם'],
  vi: ['không', 'chưa', 'đừng', 'chẳng'],
  rw: ['oya', 'nta', 'ntabwo', 'simba', 'ntibi'],
  ln: ['te', 'tɛ', 'ata'],
};

const hasNegation = (tokens: string[], lang: string): boolean => {
  const list = NEGATION_TOKENS[lang] ?? [];
  if (!list.length) return false;
  const joined = tokens.join(' ');
  return tokens.some((t) => list.includes(t)) || (lang === 'zh' && list.some((n) => joined.includes(n))) || (lang === 'ja' && list.some((n) => joined.includes(n))) || (lang === 'ko' && list.some((n) => tokens.some((t) => t.startsWith(n))));
};

/**
 * Politeness / filler phrases that do not change the communicative meaning (stripped before scoring), by language.
 * Multi-word phrases are matched on the normalised string before tokenisation.
 */
export const POLITENESS_PHRASES: Readonly<Record<string, readonly string[]>> = {
  en: ['please', 'thank you', 'thanks'],
  fr: ["s'il vous plaît", "s'il te plaît", 's il vous plaît', 's il te plaît', 'svp', 'stp', 'merci'],
  es: ['por favor', 'porfa', 'porfis', 'gracias'],
  pt: ['por favor', 'se faz favor', 'faz favor', 'obrigado', 'obrigada'],
  de: ['bitte', 'danke'],
  it: ['per favore', 'per piacere', 'grazie'],
  ar: ['لو سمحت', 'لو سمحتي', 'من فضلك', 'عافاك', 'الله يخليك', 'شكرا', 'تكرم', 'بعد اذنك'],
  ht: ['tanpri', 'souple', 'mèsi', 'mesi'],
  sw: ['tafadhali', 'asante'],
  ru: ['пожалуйста', 'спасибо'],
  uk: ['будь ласка', 'дякую'],
  zh: ['请', '請', '唔該', '麻煩', '谢谢', '謝謝', '多謝'],
  hi: ['कृपया', 'धन्यवाद', 'प्लीज'],
  el: ['παρακαλώ', 'ευχαριστώ'],
  da: ['tak', 'venligst'],
  sv: ['tack', 'snälla'],
  ro: ['te rog', 'vă rog', 'va rog', 'mulțumesc', 'multumesc'],
  he: ['בבקשה', 'תודה'],
  vi: ['làm ơn', 'xin', 'nhé', 'ạ', 'cảm ơn'],
  rw: ['nyabuneka', 'murakoze'],
  ln: ['nabondeli', 'melesi'],
  ja: [],
  ko: [],
};

/** Subject pronouns and counters/quantifiers that carry little meaning for intent matching. */
export const FILLER_TOKENS: Readonly<Record<string, readonly string[]>> = {
  en: ['i'],
  fr: ['je', "j'"],
  es: ['yo'],
  pt: ['eu'],
  de: ['ich'],
  it: ['io'],
  ar: ['أنا', 'انا', 'يا'],
  ht: [],
  sw: ['mimi'],
  ru: ['я'],
  uk: ['я'],
  zh: ['我', '一', '杯', '个', '個'],
  ja: ['私', 'は', 'を'],
  ko: ['저', '저는', '나', '한', '잔', '개', '좀'],
  hi: ['मैं', 'मुझे', 'एक'],
  el: ['εγώ'],
  da: ['jeg'],
  sv: ['jag'],
  ro: ['eu'],
  he: ['אני'],
  vi: ['tôi', 'một'],
  rw: [],
  ln: ['ngai'],
};

const ARABIC_CLITICS = ['ب', 'و', 'ف', 'ل', 'ك', 'ال'];

/** Fuzzy token equality: exact, small edit distance for longer tokens, or an Arabic clitic prefix. */
export function tokensMatch(a: string, b: string, lang: string): boolean {
  if (a === b) return true;
  const min = Math.min(a.length, b.length);
  if (min >= 4 && levenshtein(a, b) <= 1) return true;
  if (lang === 'ar') {
    for (const c of ARABIC_CLITICS) {
      if (a === c + b || b === c + a) return true;
    }
  }
  return false;
}

/** Remove politeness phrases and filler tokens; returns content tokens for intent comparison. */
export function contentTokens(normalized: string, lang: string): string[] {
  let text = ` ${normalized} `;
  for (const phrase of POLITENESS_PHRASES[lang] ?? []) {
    const p = normalizeForMeaning(phrase, lang === 'ar' ? 'arb' : 'en');
    if (!p) continue;
    text = HAN.test(p) || KANA.test(p) ? text.split(p).join(' ') : text.split(` ${p} `).join(' ');
  }
  const fillers = new Set(FILLER_TOKENS[lang] ?? []);
  return tokenize(text.replace(/\s+/g, ' ').trim()).filter((t) => !fillers.has(t));
}

/** Score an utterance against one reference phrasing. */
export function scoreAgainstReference(utterance: string, reference: string, variety: VarietyId): { score: number; signals: DeterministicSignals } {
  const lang = findVariety(variety)?.languageCode ?? 'en';
  const uRaw = normalizeForMeaning(utterance, variety);
  const rRaw = normalizeForMeaning(reference, variety);
  const uAll = tokenize(uRaw);
  const rAll = tokenize(rRaw);
  const negationMismatch = hasNegation(uAll, lang) !== hasNegation(rAll, lang);
  const ut = contentTokens(uRaw, lang);
  const rt = contentTokens(rRaw, lang);
  const u = ut.join(HAN.test(uRaw) || KANA.test(uRaw) ? '' : ' ');
  const r = rt.join(HAN.test(rRaw) || KANA.test(rRaw) ? '' : ' ');

  // Fuzzy content overlap.
  const matchedRef = rt.filter((t) => ut.some((x) => tokensMatch(x, t, lang)));
  const matchedUtt = ut.filter((t) => rt.some((x) => tokensMatch(x, t, lang)));
  const union = rt.length + ut.length - matchedRef.length;
  const tokenJaccard = union > 0 ? matchedRef.length / union : u === r ? 1 : 0;
  const bigramDice = diceBigrams(u, r);
  const maxLen = Math.max(u.length, r.length) || 1;
  const levenshteinRatio = 1 - levenshtein(u, r) / maxLen;

  let score = 0.45 * tokenJaccard + 0.3 * bigramDice + 0.25 * levenshteinRatio;
  const refMissing = rt.length - matchedRef.length;
  const uttExtra = ut.length - matchedUtt.length;
  // Subset: the learner said a shorter but fully contained version ("Un café, por favor").
  const coverage = rt.length ? matchedRef.length / rt.length : 0;
  if (ut.length > 0 && uttExtra === 0 && (coverage >= 0.6 || (coverage >= 0.5 && ut.length >= 2))) score = Math.max(score, 0.75);
  // Substitution: a reference content word was replaced by an unknown one (té ↔ café). Lexical evidence cannot accept this.
  if (refMissing > 0 && uttExtra > 0) score = matchedRef.length > 0 ? clamp(score, MEANING_THRESHOLDS.uncertainLow, 0.45) : Math.min(score, 0.45);
  if (negationMismatch) score = Math.min(score, 0.25);
  if (!uAll.length) score = 0;
  return { score: clamp(Math.round(score * 1000) / 1000, 0, 1), signals: { tokenJaccard, bigramDice, levenshteinRatio, negationMismatch } };
}

/** Deterministic lexical matcher: best score across accepted phrasings. */
export function scoreMeaningDeterministic(utterance: string, references: readonly MeaningReference[], variety: VarietyId): DeterministicMeaningResult {
  let best: DeterministicMeaningResult = { score: 0, matched: false, uncertain: false, bestReference: null, signals: { tokenJaccard: 0, bigramDice: 0, levenshteinRatio: 0, negationMismatch: false } };
  for (const ref of references) {
    const { score, signals } = scoreAgainstReference(utterance, ref.text, variety);
    if (score > best.score || best.bestReference === null) best = { score, matched: false, uncertain: false, bestReference: ref, signals };
  }
  best.matched = best.score >= MEANING_THRESHOLDS.match;
  best.uncertain = !best.matched && best.score >= MEANING_THRESHOLDS.uncertainLow && !best.signals.negationMismatch;
  return best;
}

export const MeaningJudgementSchema = z.object({
  matched: z.boolean(),
  confidence: UnitIntervalSchema,
  matchedIntentIds: z.array(z.string()),
  /** True when the learner conveyed the meaning with different words (accepted, A11). */
  paraphrase: z.boolean(),
  /** Short reason in the source language (never a correction lecture). */
  reason: z.string().max(300),
});
export type MeaningJudgement = z.infer<typeof MeaningJudgementSchema>;

export interface MeaningScoreInput {
  utterance: string;
  references: readonly MeaningReference[];
  /** What the learner was trying to do (in the source language), when known. */
  intentDescription?: string | null;
  language: LanguageContext;
  /** ASR confidence for the utterance; low values widen the uncertain band (§15: never penalise on low-confidence STT). */
  utteranceConfidence?: number | null;
}

export interface MeaningScoreResult {
  matched: boolean;
  confidence: number;
  matchedIntentIds: string[];
  method: 'deterministic' | 'llm' | 'deterministic+llm';
  deterministicScore: number;
  paraphrase: boolean;
  reason: string | null;
  /** True when STT confidence was too low to judge; caller should ask a clarifying question instead. */
  needsClarification: boolean;
}

export interface MeaningScorer {
  score(input: MeaningScoreInput): Promise<MeaningScoreResult>;
}

export const MEANING_PROMPT_TEMPLATE = { id: 'semantic.meaning_match', version: '2026-10-14.1' } as const;

export interface MeaningMatcherOptions {
  reasoner?: TextReasoner | null;
  /** Always consult the LLM when available (default: only in the uncertain band or when no lexical match). */
  alwaysUseLlm?: boolean;
  lowSttConfidence?: number;
}

/** Deterministic-first matcher with an optional LLM judge for paraphrases and the uncertain band. */
export class MeaningMatcher implements MeaningScorer {
  private readonly reasoner: TextReasoner | null;
  private readonly alwaysUseLlm: boolean;
  private readonly lowSttConfidence: number;

  constructor(options: MeaningMatcherOptions = {}) {
    this.reasoner = options.reasoner ?? null;
    this.alwaysUseLlm = options.alwaysUseLlm ?? false;
    this.lowSttConfidence = options.lowSttConfidence ?? 0.35;
  }

  async score(input: MeaningScoreInput): Promise<MeaningScoreResult> {
    const variety = input.language.targetVariety;
    const det = scoreMeaningDeterministic(input.utterance, input.references, variety);
    const needsClarification = input.utteranceConfidence !== null && input.utteranceConfidence !== undefined && input.utteranceConfidence < this.lowSttConfidence && !det.matched;
    const detIntents = det.matched && det.bestReference?.intentId ? [det.bestReference.intentId] : [];

    if (needsClarification) {
      return { matched: false, confidence: 0.2, matchedIntentIds: [], method: 'deterministic', deterministicScore: det.score, paraphrase: false, reason: null, needsClarification: true };
    }
    const useLlm = this.reasoner && (this.alwaysUseLlm || !det.matched) && !det.signals.negationMismatch && input.utterance.trim().length > 0;
    if (!useLlm || !this.reasoner) {
      return { matched: det.matched, confidence: det.matched ? clamp(0.6 + det.score * 0.4, 0, 1) : clamp(1 - det.score, 0, 1), matchedIntentIds: detIntents, method: 'deterministic', deterministicScore: det.score, paraphrase: false, reason: null, needsClarification: false };
    }
    const judgement = await this.reasoner.generateStructured('meaning_assessment', input.language, buildMeaningPrompt(input), MeaningJudgementSchema);
    const matched = judgement.matched && judgement.confidence >= 0.5;
    const ids = matched ? [...new Set([...judgement.matchedIntentIds, ...detIntents])] : [];
    return { matched, confidence: judgement.confidence, matchedIntentIds: ids, method: det.matched ? 'deterministic+llm' : 'llm', deterministicScore: det.score, paraphrase: judgement.paraphrase, reason: judgement.reason, needsClarification: false };
  }
}

export function buildMeaningPrompt(input: MeaningScoreInput): { system: string; user: string; templateId: string; templateVersion: string } {
  const variety = findVariety(input.language.targetVariety);
  const refs = input.references.map((r, i) => `${i + 1}. ${r.text}${r.intentId ? ` [intent: ${r.intentId}]` : ''}`).join('\n');
  return {
    templateId: MEANING_PROMPT_TEMPLATE.id,
    templateVersion: MEANING_PROMPT_TEMPLATE.version,
    system: [
      `You judge whether a language learner's utterance in ${variety?.name ?? input.language.targetVariety} communicates the intended meaning.`,
      'Accept paraphrases, regional wording, minor grammar slips, missing politeness particles and transcription-level spelling noise when the communicative goal is clearly achieved.',
      'Reject utterances whose meaning differs (wrong object, negated, different request), empty or off-topic replies.',
      `Write "reason" in the learner's instruction language (${input.language.sourceLanguage}), in one short, kind sentence. Never lecture.`,
      'Return JSON only.',
    ].join('\n'),
    user: [
      input.intentDescription ? `Intended communicative goal: ${input.intentDescription}` : null,
      `Accepted phrasings:\n${refs || '(none provided; judge against the goal)'}`,
      `Learner said: """${input.utterance}"""`,
      `Known intent ids: ${[...new Set(input.references.map((r) => r.intentId).filter(Boolean))].join(', ') || '(none)'}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  };
}
