/**
 * XP rules with server-side validation (§3.8, §14.1 A27).
 *
 *  - Fixed XP per outcome; clients only *claim*, the server computes.
 *  - Anti-farming: the same award key (reason + reference, e.g. one mission attempt)
 *    pays once; identical repeated responses (fingerprint) never re-award; client
 *    event ids are idempotent.
 *  - XP is never proof of proficiency: mastery lives in observations, not here.
 */
import { XP_REASON_VALUES, type MasteryState, type ObservationOutcome, type XpReason } from '@langquest/contracts';
import { masteryRank } from '@langquest/contracts';
import { fnv1a32 } from '../planner/random';

/** Fixed XP per unit for each reason. */
export const XP_RULES: Readonly<Record<XpReason, number>> = {
  mission_completed: 50,
  step_completed: 5,
  review_completed: 8,
  conversation_turns: 2,
  skill_state_advanced: 15,
  audio_lesson_completed: 20,
  daily_goal: 10,
  achievement: 25,
};

/** Max units a single claim may carry (e.g. conversation turns per session). */
export const XP_MAX_UNITS: Readonly<Record<XpReason, number>> = {
  mission_completed: 1,
  step_completed: 1,
  review_completed: 1,
  conversation_turns: 10,
  skill_state_advanced: 1,
  audio_lesson_completed: 1,
  daily_goal: 1,
  achievement: 1,
};

/** Mission XP by outcome: partial completion earns half, failure earns nothing (steps still pay effort XP). */
export function missionCompletionXp(outcome: ObservationOutcome): number {
  if (outcome === 'success') return XP_RULES.mission_completed;
  if (outcome === 'partial') return Math.round(XP_RULES.mission_completed / 2);
  return 0;
}

/** XP for a mastery advance: only upward moves pay, and only once per (skill, state). */
export const masteryAdvanceXp = (from: MasteryState, to: MasteryState): number => (masteryRank(to) > masteryRank(from) ? XP_RULES.skill_state_advanced : 0);

export interface XpClaim {
  /** Client-generated UUID (idempotency key). */
  clientEventId: string;
  enrollmentId: string;
  reason: XpReason;
  /** Attempt id, review log id, lesson id, skill key… whatever the reason references. */
  referenceId: string | null;
  /** Amount the client expects (must equal the server computation or the claim is rejected). */
  amount: number;
  units?: number;
  /** For step/turn/review claims: fingerprint of the learner's response (see `responseFingerprint`). */
  responseFingerprint?: string | null;
  /** For mission_completed: the evaluated outcome (server-side), so partial credit is computed here. */
  outcome?: ObservationOutcome;
}

export interface XpDecision {
  clientEventId: string;
  resolution: 'applied' | 'duplicate' | 'rejected';
  amount: number;
  reason: 'ok' | 'duplicate_event' | 'already_awarded' | 'identical_response' | 'amount_mismatch' | 'units_exceeded' | 'missing_reference' | 'unknown_reason';
  awardKey: string | null;
}

/** Read side of the ledger the validator consults (DB-backed in production). */
export interface XpLedgerView {
  hasEvent(clientEventId: string): boolean;
  hasAward(awardKey: string): boolean;
  hasFingerprint(enrollmentId: string, fingerprint: string): boolean;
}

/** Stable fingerprint of a learner response for anti-farming (case/whitespace-insensitive). */
export function responseFingerprint(attemptOrSessionId: string, stepOrTurnId: string, response: string): string {
  const normalised = response.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();
  return fnv1a32(`${attemptOrSessionId}|${stepOrTurnId}|${normalised}`).toString(16).padStart(8, '0');
}

const REFERENCE_REQUIRED: ReadonlySet<XpReason> = new Set(['mission_completed', 'step_completed', 'review_completed', 'conversation_turns', 'skill_state_advanced', 'audio_lesson_completed', 'achievement']);

/** The key under which an award is remembered so it pays at most once. */
export function awardKey(claim: Pick<XpClaim, 'enrollmentId' | 'reason' | 'referenceId'>): string {
  return `${claim.enrollmentId}:${claim.reason}:${claim.referenceId ?? '-'}`;
}

/** Server-side amount for a claim (ignores the client amount). */
export function expectedXp(claim: Pick<XpClaim, 'reason' | 'units' | 'outcome'>): number {
  const units = Math.max(1, Math.floor(claim.units ?? 1));
  if (claim.reason === 'mission_completed') return missionCompletionXp(claim.outcome ?? 'success');
  return XP_RULES[claim.reason] * units;
}

/** Validate a claim against the ledger; the caller records `applied` decisions. */
export function validateXpClaim(claim: XpClaim, ledger: XpLedgerView): XpDecision {
  const base = { clientEventId: claim.clientEventId, awardKey: null as string | null };
  if (!(XP_REASON_VALUES as readonly string[]).includes(claim.reason)) return { ...base, resolution: 'rejected', amount: 0, reason: 'unknown_reason' };
  if (ledger.hasEvent(claim.clientEventId)) return { ...base, resolution: 'duplicate', amount: 0, reason: 'duplicate_event' };
  if (REFERENCE_REQUIRED.has(claim.reason) && !claim.referenceId) return { ...base, resolution: 'rejected', amount: 0, reason: 'missing_reference' };
  const units = Math.max(1, Math.floor(claim.units ?? 1));
  if (units > XP_MAX_UNITS[claim.reason]) return { ...base, resolution: 'rejected', amount: 0, reason: 'units_exceeded' };
  const key = awardKey(claim);
  if (ledger.hasAward(key)) return { ...base, awardKey: key, resolution: 'duplicate', amount: 0, reason: 'already_awarded' };
  if (claim.responseFingerprint && ledger.hasFingerprint(claim.enrollmentId, claim.responseFingerprint)) return { ...base, awardKey: key, resolution: 'rejected', amount: 0, reason: 'identical_response' };
  const amount = expectedXp(claim);
  if (claim.amount !== amount) return { ...base, awardKey: key, resolution: 'rejected', amount: 0, reason: 'amount_mismatch' };
  return { ...base, awardKey: key, resolution: 'applied', amount, reason: 'ok' };
}

/** In-memory ledger for tests, offline queues and the sync endpoint's per-batch dedupe. */
export class InMemoryXpLedger implements XpLedgerView {
  private readonly events = new Set<string>();
  private readonly awards = new Set<string>();
  private readonly fingerprints = new Set<string>();
  private total = 0;

  hasEvent(clientEventId: string): boolean {
    return this.events.has(clientEventId);
  }
  hasAward(key: string): boolean {
    return this.awards.has(key);
  }
  hasFingerprint(enrollmentId: string, fingerprint: string): boolean {
    return this.fingerprints.has(`${enrollmentId}:${fingerprint}`);
  }
  /** Validate and, when applied, record the award. Returns the decision. */
  apply(claim: XpClaim): XpDecision {
    const decision = validateXpClaim(claim, this);
    this.events.add(claim.clientEventId);
    if (decision.resolution === 'applied' && decision.awardKey) {
      this.awards.add(decision.awardKey);
      if (claim.responseFingerprint) this.fingerprints.add(`${claim.enrollmentId}:${claim.responseFingerprint}`);
      this.total += decision.amount;
    }
    return decision;
  }
  get totalXp(): number {
    return this.total;
  }
}

/** Level from total XP: level n needs 100·n·(n+1)/2 XP (gentle quadratic curve). */
export function levelForXp(totalXp: number): number {
  let level = 0;
  while (100 * ((level + 1) * (level + 2)) / 2 <= Math.max(0, totalXp)) level += 1;
  return level;
}

// ---------------------------------------------------------------------------
// Achievements (can-do based, never farmable: derived from mastery and attempts)
// ---------------------------------------------------------------------------

export interface AchievementContext {
  masteryBySkill: ReadonlyMap<string, MasteryState>;
  missionsCompleted: number;
  missionsCompletedWithoutHints: number;
  distinctMissionsCompleted: number;
}

/** Achievement keys currently earned (idempotent; the ledger decides which are new). */
export function earnedAchievements(ctx: AchievementContext): string[] {
  const keys: string[] = [];
  if (ctx.distinctMissionsCompleted >= 1) keys.push('first_mission');
  if (ctx.distinctMissionsCompleted >= 6) keys.push('chapter_one_explored');
  if (ctx.missionsCompletedWithoutHints >= 5) keys.push('five_missions_unaided');
  for (const [skill, state] of ctx.masteryBySkill) {
    if (masteryRank(state) >= masteryRank('independent')) keys.push(`can_do.${skill}`);
  }
  const durable = [...ctx.masteryBySkill.values()].filter((s) => s === 'durable').length;
  if (durable >= 5) keys.push('five_durable_skills');
  if (durable >= 20) keys.push('twenty_durable_skills');
  return keys.sort();
}
