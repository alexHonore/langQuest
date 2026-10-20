/**
 * Dialogue-set diversity metric (spec §9.8 "generate diverse dialogues, not a rigid
 * one-correct-answer quiz", traceability R-9.8-02).
 *
 * `scoreDialogueDiversity()` is pure and deterministic. It measures, for a generated set of
 * dialogues plus the acceptable learner phrasings per intent:
 *  - **phrasing**: distinct acceptable learner phrasings per intent (exact and near duplicates
 *    collapse into one); an intent with a single acceptable phrasing is a one-correct-answer item;
 *  - **lexical**: token overlap between the alternatives (mean pairwise Jaccard, distinct-1/2),
 *    with script-aware tokens (`diversityTokens`: words for spaced scripts, bigrams for CJK/Thai);
 *  - **dialogueLexical**: token overlap between whole dialogues (the same script repeated with new
 *    labels or one noun swapped is still the same dialogue);
 *  - **structure**: turn-structure variety across dialogues (speaker × question signature, read from
 *    the text only);
 *  - **repair**: share of dialogues with a misunderstanding → repair sequence;
 *  - **quiz**: dialogues shaped as drills (the character asks, the learner answers, nothing else),
 *    read from the text.
 *
 * Turn `act` / `intentKey` labels are self-reported by the generator and unverified. They never
 * change a signature, the quiz shape or the overlap measures; they count only for the repair check,
 * and only as a sequence (a trouble turn answered by the other speaker), never as a lone label.
 *
 * The verdict is `needs_regeneration` when a blocking flag fires or the weighted score is below
 * `minScore`. The metric never approves content: a `diverse` set still goes to native review.
 */
import { INTENTS } from '../intents';
import { diversityTokens, distinctN, isQuestionText, normalizeForDiversity, tokenJaccard } from './tokenize';

export const DIALOGUE_TURN_ACTS = ['normal', 'unexpected', 'misunderstanding', 'repair', 'refusal'] as const;
export type DialogueTurnAct = (typeof DIALOGUE_TURN_ACTS)[number];

export interface DiversityTurn {
  speaker: 'learner' | 'character';
  text: string;
  /** Communicative intent of the turn when known (self-reported; a repair intent opens a repair sequence). */
  intentKey?: string | null;
  /** Conversational function label (self-reported by the generator, unverified; used only for the repair sequence). */
  act?: DialogueTurnAct | null;
}

export interface DiversityDialogue {
  id: string;
  turns: readonly DiversityTurn[];
}

export interface IntentPhrasings {
  intentKey: string;
  /** Acceptable learner phrasings for the intent (target-language text). */
  phrasings: readonly string[];
}

export interface DialogueSetInput {
  dialogues: readonly DiversityDialogue[];
  intents: readonly IntentPhrasings[];
}

export interface DiversityThresholds {
  /** Fewer distinct acceptable phrasings than this makes an intent a one-correct-answer item. */
  minPhrasingsPerIntent: number;
  /** Share of intents that must reach `minPhrasingsPerIntent` (1 = every intent). */
  minAlternativeCoverage: number;
  /** Two phrasings at or above this token Jaccard count as one (near duplicate). */
  nearDuplicateJaccard: number;
  /** Mean pairwise Jaccard above this means the alternatives mostly share words (one frame, swapped nouns). */
  maxMeanPairwiseJaccard: number;
  /** Whether high overlap between alternatives blocks (free sets) or only warns (blueprint missions). */
  blockHighOverlap: boolean;
  /** Distinct turn-structure signatures / dialogues (checked from `minDialoguesForStructure` dialogues). */
  minStructureVariety: number;
  minDialoguesForStructure: number;
  /** Mean pairwise token Jaccard between whole dialogues above this means the set repeats one script. */
  maxMeanDialogueJaccard: number;
  /** Share of dialogues that near-duplicate an earlier one (token Jaccard ≥ `nearDuplicateJaccard`) above which the set blocks. */
  maxRepeatedDialogueShare: number;
  /** Share of dialogues that must contain a misunderstanding → repair sequence (checked from `minDialoguesForStructure`). */
  minRepairShare: number;
  /** Share of quiz-shaped dialogues above which the set is a quiz. */
  maxQuizShapedShare: number;
  /** Weighted score below which the set is sent back for regeneration. */
  minScore: number;
}

/** Defaults for a free dialogue set (the §14.2 fixture suite asks for 3–5 phrasings per intent). */
export const DEFAULT_DIVERSITY_THRESHOLDS: DiversityThresholds = {
  minPhrasingsPerIntent: 2,
  minAlternativeCoverage: 1,
  nearDuplicateJaccard: 0.8,
  maxMeanPairwiseJaccard: 0.5,
  blockHighOverlap: true,
  minStructureVariety: 0.5,
  minDialoguesForStructure: 3,
  maxMeanDialogueJaccard: 0.5,
  maxRepeatedDialogueShare: 0,
  minRepairShare: 0.2,
  maxQuizShapedShare: 0.3,
  minScore: 0.6,
};

/**
 * Blueprint missions fix the turn structure and ask for alternatives only "where it matters most",
 * so the mission gate only requires that some learner intent has real alternatives and that the
 * alternatives are not near copies.
 */
export const MISSION_DIVERSITY_THRESHOLDS: DiversityThresholds = { ...DEFAULT_DIVERSITY_THRESHOLDS, minAlternativeCoverage: 0.2, blockHighOverlap: false, minScore: 0 };

/** Intents whose concept is a repair move (`repair.*`: ask to repeat, not understood, clarify…). */
export const REPAIR_INTENT_KEYS: readonly string[] = INTENTS.filter((i) => i.conceptId.startsWith('repair.')).map((i) => i.intentKey);

export type DiversityFlagCode =
  | 'empty_set'
  | 'single_phrasing'
  | 'low_alternative_coverage'
  | 'near_duplicate_phrasings'
  | 'high_overlap_alternatives'
  | 'uniform_turn_structure'
  | 'near_duplicate_dialogue'
  | 'repeated_dialogues'
  | 'high_overlap_dialogues'
  | 'no_repair_turns'
  | 'few_repair_turns'
  | 'quiz_shaped_dialogue'
  | 'quiz_shaped_set'
  | 'score_below_threshold';

export interface DiversityFlag {
  code: DiversityFlagCode;
  severity: 'block' | 'warn';
  /** Which part of the set to regenerate. */
  scope: 'intents' | 'dialogues' | 'set';
  /** Intent key, dialogue id or measured value. */
  subject: string | null;
  detail: string;
}

export interface IntentDiversity {
  intentKey: string;
  phrasings: number;
  distinctPhrasings: number;
  meanPairwiseJaccard: number | null;
  maxPairwiseJaccard: number | null;
  distinct1: number | null;
  distinct2: number | null;
  nearDuplicatePairs: Array<[number, number]>;
}

export interface DialogueDiversity {
  id: string;
  turns: number;
  /** e.g. `C? L. C. L?` — speaker, then `?` when the turn asks something, `.` otherwise (text only; labels never change it). */
  signature: string;
  /**
   * A misunderstanding → repair sequence: a trouble turn (act `misunderstanding`, or a `repair.*`
   * intent such as ask_repeat) answered later by the other speaker with different text (act `repair`,
   * or any reply to a repair-intent request). Built on self-reported labels, so a lone label never counts.
   */
  hasRepair: boolean;
  quizShaped: boolean;
  /** Id of an earlier dialogue this one near-duplicates (token Jaccard ≥ `nearDuplicateJaccard`), else null. */
  nearDuplicateOf: string | null;
}

export interface DialogueOverlap {
  meanPairwiseJaccard: number;
  maxPairwiseJaccard: number;
  distinctDialogues: number;
  nearDuplicatePairs: Array<[string, string]>;
}

export interface DiversityComponents {
  phrasing: number | null;
  lexical: number | null;
  /** 1 − mean pairwise token Jaccard between whole dialogues (null below 2 dialogues). */
  dialogueLexical: number | null;
  structure: number | null;
  repair: number | null;
  quiz: number | null;
}

export interface DiversityReport {
  verdict: 'diverse' | 'needs_regeneration';
  /** Weighted mean of the available components, 0–1 (3 decimals). */
  score: number;
  components: DiversityComponents;
  /** Stable reason codes for every blocking flag (plus the score), for logs and regeneration feedback. */
  reasons: string[];
  flags: DiversityFlag[];
  intents: IntentDiversity[];
  dialogues: DialogueDiversity[];
  /** Cross-dialogue text overlap (null below 2 dialogues). */
  dialogueOverlap: DialogueOverlap | null;
  thresholds: DiversityThresholds;
}

const WEIGHTS: Record<keyof DiversityComponents, number> = { phrasing: 0.3, lexical: 0.15, dialogueLexical: 0.1, structure: 0.15, repair: 0.15, quiz: 0.15 };
const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const mean = (xs: readonly number[]): number | null => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const REPAIR_KEYS = new Set(REPAIR_INTENT_KEYS);

function scoreIntent(entry: IntentPhrasings, th: DiversityThresholds): IntentDiversity {
  const texts = entry.phrasings.map((p) => normalizeForDiversity(p)).filter(Boolean);
  const tokenLists = texts.map((p) => diversityTokens(p));
  // Collapse exact duplicates (same token sequence) and near duplicates, greedily in input order.
  const representatives: number[] = [];
  const nearDuplicatePairs: Array<[number, number]> = [];
  tokenLists.forEach((tokens, i) => {
    const twin = representatives.find((r) => tokenLists[r]!.join(' ') === tokens.join(' ') || tokenJaccard(tokenLists[r]!, tokens) >= th.nearDuplicateJaccard);
    if (twin === undefined) representatives.push(i);
    else nearDuplicatePairs.push([twin, i]);
  });
  const pairs: number[] = [];
  for (let i = 0; i < representatives.length; i += 1) for (let j = i + 1; j < representatives.length; j += 1) pairs.push(tokenJaccard(tokenLists[representatives[i]!]!, tokenLists[representatives[j]!]!));
  const d1 = distinctN(tokenLists, 1).ratio;
  const d2 = distinctN(tokenLists, 2).ratio;
  return {
    intentKey: entry.intentKey,
    phrasings: texts.length,
    distinctPhrasings: representatives.length,
    meanPairwiseJaccard: pairs.length ? round3(mean(pairs)!) : null,
    maxPairwiseJaccard: pairs.length ? round3(Math.max(...pairs)) : null,
    distinct1: d1 === null ? null : round3(d1),
    distinct2: d2 === null ? null : round3(d2),
    nearDuplicatePairs,
  };
}

const isRepairIntent = (key: string | null | undefined): boolean => (key ? REPAIR_KEYS.has(key) : false);
/** A turn that asks anything ("شنو؟ ما فهمتكش", "What? I don't follow."), not only one that ends with a question mark. */
const containsQuestion = (text: string): boolean => isQuestionText(text) || /[?؟⸮¿]/u.test(text.normalize('NFKC'));

/** Misunderstanding → repair sequence (see `DialogueDiversity.hasRepair`); a lone label never counts. */
function hasRepairSequence(turns: readonly DiversityTurn[]): boolean {
  return turns.some((trouble, i) => {
    const repairRequest = isRepairIntent(trouble.intentKey);
    if (trouble.act !== 'misunderstanding' && !repairRequest) return false;
    const troubleText = normalizeForDiversity(trouble.text);
    return turns.slice(i + 1).some((reply) => reply.speaker !== trouble.speaker && (reply.act === 'repair' || repairRequest) && normalizeForDiversity(reply.text) !== troubleText);
  });
}

function scoreDialogue(d: DiversityDialogue): Omit<DialogueDiversity, 'nearDuplicateOf'> {
  const symbols = d.turns.map((t) => `${t.speaker === 'learner' ? 'L' : 'C'}${containsQuestion(t.text) ? '?' : '.'}`);
  const hasRepair = hasRepairSequence(d.turns);
  // Quiz/drill shape, from the text: strictly alternating character question → learner answer, the
  // learner never opens or asks, and no misunderstanding is repaired.
  const learnerTurns = d.turns.filter((t) => t.speaker === 'learner').length;
  let quizShaped = learnerTurns >= 2 && !hasRepair;
  for (let i = 0; quizShaped && i < d.turns.length; i += 1) {
    const turn = d.turns[i]!;
    const sym = symbols[i]!;
    if (turn.speaker === 'learner') quizShaped = i > 0 && d.turns[i - 1]!.speaker === 'character' && symbols[i - 1] === 'C?' && sym === 'L.';
    else quizShaped = sym === 'C?' || i === d.turns.length - 1;
  }
  return { id: d.id, turns: d.turns.length, signature: symbols.join(' '), hasRepair, quizShaped };
}

/** Token overlap between whole dialogues (tokens per turn, so CJK bigrams never cross turns). */
function scoreDialogueOverlap(input: readonly DiversityDialogue[], th: DiversityThresholds): { overlap: DialogueOverlap | null; nearDuplicateOf: Array<string | null> } {
  const tokenLists = input.map((d) => d.turns.flatMap((t) => diversityTokens(t.text)));
  const nearDuplicateOf: Array<string | null> = input.map(() => null);
  if (input.length < 2) return { overlap: null, nearDuplicateOf };
  const representatives: number[] = [];
  const nearDuplicatePairs: Array<[string, string]> = [];
  tokenLists.forEach((tokens, i) => {
    const twin = representatives.find((r) => tokenJaccard(tokenLists[r]!, tokens) >= th.nearDuplicateJaccard);
    if (twin === undefined) representatives.push(i);
    else {
      nearDuplicateOf[i] = input[twin]!.id;
      nearDuplicatePairs.push([input[twin]!.id, input[i]!.id]);
    }
  });
  const pairs: number[] = [];
  for (let i = 0; i < tokenLists.length; i += 1) for (let j = i + 1; j < tokenLists.length; j += 1) pairs.push(tokenJaccard(tokenLists[i]!, tokenLists[j]!));
  return { overlap: { meanPairwiseJaccard: round3(mean(pairs)!), maxPairwiseJaccard: round3(Math.max(...pairs)), distinctDialogues: representatives.length, nearDuplicatePairs }, nearDuplicateOf };
}

/** Score a generated dialogue set for diversity (pure, deterministic). */
export function scoreDialogueDiversity(input: DialogueSetInput, overrides: Partial<DiversityThresholds> = {}): DiversityReport {
  const th: DiversityThresholds = { ...DEFAULT_DIVERSITY_THRESHOLDS, ...overrides };
  const flags: DiversityFlag[] = [];
  const intents = input.intents.map((e) => scoreIntent(e, th));
  const { overlap: dialogueOverlap, nearDuplicateOf } = scoreDialogueOverlap(input.dialogues, th);
  const dialogues: DialogueDiversity[] = input.dialogues.map((d, i) => ({ ...scoreDialogue(d), nearDuplicateOf: nearDuplicateOf[i] ?? null }));

  // --- phrasing + lexical ------------------------------------------------------------------
  let phrasing: number | null = null;
  let lexical: number | null = null;
  if (intents.length) {
    const target = Math.max(th.minPhrasingsPerIntent, 3);
    phrasing = mean(intents.map((i) => Math.min(1, Math.max(0, i.distinctPhrasings - 1) / (target - 1))));
    lexical = mean(intents.map((i) => (i.distinctPhrasings < 2 || i.meanPairwiseJaccard === null ? 0 : 1 - i.meanPairwiseJaccard)));
    const single = intents.filter((i) => i.distinctPhrasings < th.minPhrasingsPerIntent);
    const coverage = (intents.length - single.length) / intents.length;
    const coverageBlocks = coverage < th.minAlternativeCoverage;
    for (const i of single) flags.push({ code: 'single_phrasing', severity: coverageBlocks && th.minAlternativeCoverage >= 1 ? 'block' : 'warn', scope: 'intents', subject: i.intentKey, detail: `${i.distinctPhrasings} distinct acceptable phrasing(s) of ${i.phrasings}: a one-correct-answer item` });
    if (coverageBlocks && th.minAlternativeCoverage < 1) flags.push({ code: 'low_alternative_coverage', severity: 'block', scope: 'intents', subject: round3(coverage).toString(), detail: `only ${intents.length - single.length}/${intents.length} intents have ≥ ${th.minPhrasingsPerIntent} distinct phrasings (need ${Math.round(th.minAlternativeCoverage * 100)} %)` });
    for (const i of intents) {
      if (i.nearDuplicatePairs.length) flags.push({ code: 'near_duplicate_phrasings', severity: 'warn', scope: 'intents', subject: i.intentKey, detail: `${i.nearDuplicatePairs.length} phrasing(s) repeat another (token Jaccard ≥ ${th.nearDuplicateJaccard})` });
      if (i.meanPairwiseJaccard !== null && i.meanPairwiseJaccard > th.maxMeanPairwiseJaccard) flags.push({ code: 'high_overlap_alternatives', severity: th.blockHighOverlap ? 'block' : 'warn', scope: 'intents', subject: i.intentKey, detail: `alternatives share most words (mean Jaccard ${i.meanPairwiseJaccard} > ${th.maxMeanPairwiseJaccard})` });
    }
  }

  // --- dialogue overlap, structure, repair, quiz ---------------------------------------------
  let dialogueLexical: number | null = null;
  let structure: number | null = null;
  let repair: number | null = null;
  let quiz: number | null = null;
  if (dialogueOverlap) {
    dialogueLexical = 1 - dialogueOverlap.meanPairwiseJaccard;
    for (const d of dialogues) if (d.nearDuplicateOf) flags.push({ code: 'near_duplicate_dialogue', severity: 'warn', scope: 'dialogues', subject: d.id, detail: `repeats ${d.nearDuplicateOf} (token Jaccard ≥ ${th.nearDuplicateJaccard})` });
    const repeatedShare = (dialogues.length - dialogueOverlap.distinctDialogues) / dialogues.length;
    if (repeatedShare > th.maxRepeatedDialogueShare) flags.push({ code: 'repeated_dialogues', severity: 'block', scope: 'dialogues', subject: round3(repeatedShare).toString(), detail: `${dialogues.length - dialogueOverlap.distinctDialogues}/${dialogues.length} dialogues repeat an earlier one's words (whatever their turn labels say)` });
    if (dialogueOverlap.meanPairwiseJaccard > th.maxMeanDialogueJaccard) flags.push({ code: 'high_overlap_dialogues', severity: 'block', scope: 'dialogues', subject: dialogueOverlap.meanPairwiseJaccard.toString(), detail: `dialogues share most of their words (mean Jaccard ${dialogueOverlap.meanPairwiseJaccard} > ${th.maxMeanDialogueJaccard})` });
  }
  if (dialogues.length) {
    const checked = dialogues.length >= th.minDialoguesForStructure;
    const variety = new Set(dialogues.map((d) => d.signature)).size / dialogues.length;
    structure = dialogues.length >= 2 ? Math.min(1, variety / th.minStructureVariety) : null;
    if (checked && variety < th.minStructureVariety) flags.push({ code: 'uniform_turn_structure', severity: 'block', scope: 'dialogues', subject: round3(variety).toString(), detail: `${new Set(dialogues.map((d) => d.signature)).size} distinct turn structures across ${dialogues.length} dialogues (need ${Math.round(th.minStructureVariety * 100)} %)` });
    const repairShare = dialogues.filter((d) => d.hasRepair).length / dialogues.length;
    repair = th.minRepairShare > 0 ? Math.min(1, repairShare / th.minRepairShare) : 1;
    if (checked && repairShare === 0) flags.push({ code: 'no_repair_turns', severity: 'block', scope: 'dialogues', subject: null, detail: 'no dialogue contains a misunderstanding that the other speaker then repairs' });
    else if (checked && repairShare < th.minRepairShare) flags.push({ code: 'few_repair_turns', severity: 'warn', scope: 'dialogues', subject: round3(repairShare).toString(), detail: `only ${Math.round(repairShare * 100)} % of dialogues contain a misunderstanding → repair sequence` });
    const quizShare = dialogues.filter((d) => d.quizShaped).length / dialogues.length;
    quiz = 1 - quizShare;
    for (const d of dialogues) if (d.quizShaped) flags.push({ code: 'quiz_shaped_dialogue', severity: 'warn', scope: 'dialogues', subject: d.id, detail: `question → answer drill (${d.signature})` });
    if (quizShare > th.maxQuizShapedShare) flags.push({ code: 'quiz_shaped_set', severity: 'block', scope: 'dialogues', subject: round3(quizShare).toString(), detail: `${Math.round(quizShare * 100)} % of dialogues are question → answer drills` });
  }

  const components: DiversityComponents = {
    phrasing: phrasing === null ? null : round3(phrasing),
    lexical: lexical === null ? null : round3(lexical),
    dialogueLexical: dialogueLexical === null ? null : round3(dialogueLexical),
    structure: structure === null ? null : round3(structure),
    repair: repair === null ? null : round3(repair),
    quiz: quiz === null ? null : round3(quiz),
  };
  let weight = 0;
  let total = 0;
  for (const key of Object.keys(WEIGHTS) as Array<keyof DiversityComponents>) {
    const v = components[key];
    if (v === null) continue;
    weight += WEIGHTS[key];
    total += WEIGHTS[key] * v;
  }
  const score = weight ? round3(total / weight) : 0;
  if (!intents.length && !dialogues.length) flags.push({ code: 'empty_set', severity: 'block', scope: 'set', subject: null, detail: 'no dialogues and no intent phrasings to score' });
  else if (score < th.minScore) flags.push({ code: 'score_below_threshold', severity: 'block', scope: 'set', subject: score.toString(), detail: `diversity score ${score} < ${th.minScore}` });
  const reasons = flags.filter((f) => f.severity === 'block').map((f) => `${f.code}${f.subject !== null ? `:${f.subject}` : ''}`);
  return { verdict: reasons.length ? 'needs_regeneration' : 'diverse', score, components, reasons, flags, intents, dialogues, dialogueOverlap, thresholds: th };
}

/** Which parts of a set to regenerate, from the report (block flags plus weak components). */
export function diversityRegenerationScopes(report: DiversityReport): Array<'intents' | 'dialogues'> {
  if (report.verdict === 'diverse') return [];
  const out = new Set<'intents' | 'dialogues'>();
  for (const f of report.flags) if (f.severity === 'block' && f.scope !== 'set') out.add(f.scope);
  if (report.flags.some((f) => f.severity === 'block' && f.scope === 'set')) {
    const { phrasing, lexical, dialogueLexical, structure, repair, quiz } = report.components;
    const side = (xs: Array<number | null>): number | null => mean(xs.filter((x): x is number => x !== null));
    const intentSide = side([phrasing, lexical]);
    const dialogueSide = side([dialogueLexical, structure, repair, quiz]);
    if (intentSide !== null && intentSide < report.thresholds.minScore) out.add('intents');
    if (dialogueSide !== null && dialogueSide < report.thresholds.minScore) out.add('dialogues');
    if (!out.size) {
      if (intentSide !== null) out.add('intents');
      if (dialogueSide !== null) out.add('dialogues');
    }
  }
  return [...out].sort();
}
