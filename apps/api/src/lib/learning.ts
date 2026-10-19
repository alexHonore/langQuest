/**
 * Server-side learning engine glue (§3.4, §3.5, §3.8): persists evaluator/deterministic observations, recomputes
 * mastery with `@langquest/curriculum`, awards server-validated XP through `award_xp`, and schedules review cards
 * with the FSRS-like scheduler. Every write goes through the service client AFTER the request has been validated
 * against the learner's own enrollment (RLS-bound read), never from a bare client claim.
 */
import { masteryRank, xpAmountForReason, type AutonomyLevel, type MasteryState, type ObservationOutcome, type ObservationType, type ReviewCard, type ReviewRating, type ScorerKind, type SkillObservationInput, type XpReason } from '@langquest/contracts';
import { deriveMasteryForAll, type MasteryObservation } from '@langquest/curriculum/mastery/mastery';
import { createScheduler, newCard, type Scheduler } from '@langquest/curriculum/scheduler/scheduler';
import { DbError } from '@langquest/db/errors';
import type { Insert, Row } from '@langquest/db/types';
import { problem } from '../http/envelope';
import { cardToReviewPatch, reviewRowToCard } from './dto';
import type { EnrollmentRow } from './enrollment';
import type { RequestServices } from '../services/context';

export interface MasteryChange {
  skillKey: string;
  from: MasteryState;
  to: MasteryState;
}

export const scheduler: Scheduler = createScheduler();

export function observationToRow(o: SkillObservationInput, userId: string, now: string): Insert<'learning_observations'> {
  return {
    user_id: userId,
    enrollment_id: o.enrollmentId,
    skill_key: o.skillKey,
    observation_type: o.observationType,
    scenario_id: o.scenarioId,
    mission_id: o.missionId,
    mission_attempt_id: o.missionAttemptId,
    conversation_session_id: o.conversationSessionId,
    expression_id: o.expressionId,
    autonomy: o.autonomy,
    hints_used: o.hintsUsed,
    outcome: o.outcome,
    utterance_confidence: o.utteranceConfidence,
    scorer_kind: o.scorerKind,
    scorer_version: o.scorerVersion,
    uncertainty: o.uncertainty,
    feedback_evidence: o.note ? { note: o.note } : null,
    observed_at: o.observedAt ?? now,
  };
}

export const rowToMasteryObservation = (r: Row<'learning_observations'>): MasteryObservation => ({
  skillKey: r.skill_key,
  observationType: r.observation_type as ObservationType,
  scenarioId: r.scenario_id,
  autonomy: r.autonomy as AutonomyLevel,
  hintsUsed: r.hints_used,
  outcome: r.outcome as ObservationOutcome,
  utteranceConfidence: r.utterance_confidence,
  scorerKind: r.scorer_kind as ScorerKind,
  uncertainty: r.uncertainty,
  observedAt: r.observed_at,
});

/**
 * Insert observations and recompute mastery for every touched skill (full-history derivation, one rank max
 * regression per recompute). Returns the inserted rows and the mastery transitions (for XP + events).
 */
export async function recordObservations(s: RequestServices, enrollment: EnrollmentRow, observations: SkillObservationInput[], now: string): Promise<{ rows: Row<'learning_observations'>[]; changes: MasteryChange[]; masteryRows: Row<'user_skill_mastery'>[] }> {
  if (observations.length === 0) return { rows: [], changes: [], masteryRows: [] };
  for (const o of observations) if (o.enrollmentId !== enrollment.id) throw problem.forbidden('Observation enrollment mismatch');
  const rows = await s.repos.progress.insertObservations(observations.map((o) => observationToRow(o, enrollment.user_id, now)));
  const skillKeys = [...new Set(observations.map((o) => o.skillKey))];
  const previous = await s.repos.progress.listMastery(enrollment.id);
  const prevByKey = new Map(previous.map((m) => [m.skill_key, m]));
  const history = await s.service.from('learning_observations').select('*').eq('enrollment_id', enrollment.id).in('skill_key', skillKeys).order('observed_at', { ascending: true }).limit(2000);
  if (history.error) throw new DbError(history.error, 'learning.history');
  const derived = deriveMasteryForAll((history.data ?? []).map(rowToMasteryObservation), { now, previousStates: new Map(previous.map((m) => [m.skill_key, m.mastery_state as MasteryState])) });
  const upserts: Insert<'user_skill_mastery'>[] = [];
  const changes: MasteryChange[] = [];
  for (const key of skillKeys) {
    const d = derived.get(key);
    if (!d) continue;
    const prevState = (prevByKey.get(key)?.mastery_state ?? 'not_attempted') as MasteryState;
    upserts.push({
      user_id: enrollment.user_id,
      enrollment_id: enrollment.id,
      skill_key: key,
      mastery_state: d.snapshot.masteryState,
      internal_score: d.snapshot.internalScore,
      last_practiced_at: d.snapshot.lastPracticedAt,
      due_at: d.snapshot.dueAt,
      evidence_count: d.snapshot.evidenceCount,
      uncertainty: d.snapshot.uncertainty,
    });
    if (d.snapshot.masteryState !== prevState) changes.push({ skillKey: key, from: prevState, to: d.snapshot.masteryState });
  }
  const masteryRows = await s.repos.progress.upsertMastery(upserts);
  for (const row of rows) {
    const change = changes.find((ch) => ch.skillKey === row.skill_key);
    void s.events.emit('skill.observed', { observationId: row.id, userId: enrollment.user_id, enrollmentId: enrollment.id, skillKey: row.skill_key, observationType: row.observation_type as ObservationType, masteryBefore: change?.from ?? null, masteryAfter: change?.to ?? null }, { idempotencyKey: `skill.observed:${row.id}`, traceId: s.requestId });
  }
  return { rows, changes, masteryRows };
}

export interface XpAwardResult {
  applied: boolean;
  amount: number;
  totalXp: number;
  rejectedReason: string | null;
}

/**
 * Award XP with the canonical amount for the reason (`XP_AMOUNTS` in `@langquest/contracts`, the table that mirrors
 * `public.xp_amount_for_reason` exactly), idempotent on `idempotencyKey`, and only when the referenced row is an
 * owned, completed row (`award_xp` re-checks via `xp_reference_owned`). `amount` is what was actually written to
 * `xp_ledger` by THIS call (0 on replay or rejection), so callers can sum it honestly into `xpAwarded`.
 */
export async function awardXp(s: RequestServices, input: { idempotencyKey: string; userId: string; enrollmentId: string | null; reason: XpReason; referenceTable: string; referenceId: string; units?: number; occurredAt?: string }): Promise<XpAwardResult> {
  const unit = xpAmountForReason(input.reason);
  const units = Math.max(1, Math.min(10, Math.floor(input.units ?? 1)));
  const amount = unit * units;
  if (amount <= 0) return { applied: false, amount: 0, totalXp: 0, rejectedReason: 'unknown_xp_reason' };
  try {
    const res = await s.repos.progress.awardXp({ idempotencyKey: input.idempotencyKey, userId: input.userId, amount, reason: input.reason, enrollmentId: input.enrollmentId, referenceTable: input.referenceTable, referenceId: input.referenceId, occurredAt: input.occurredAt });
    return { applied: res.applied, amount: res.applied ? res.amount : 0, totalXp: Number(res.total_xp), rejectedReason: null };
  } catch (error) {
    if (error instanceof DbError && (error.code === '23503' || error.code === '22023' || error.isForbidden)) {
      s.log.warn('xp.rejected', { reason: input.reason, referenceTable: input.referenceTable, code: error.code });
      return { applied: false, amount: 0, totalXp: 0, rejectedReason: 'reference_not_owned_or_incomplete' };
    }
    throw error;
  }
}

/** Mastery advances pay once per (skill, state) — the mastery row id is the reference. */
export async function awardMasteryAdvances(s: RequestServices, enrollment: EnrollmentRow, changes: MasteryChange[], masteryRows: Row<'user_skill_mastery'>[], baseKey: string): Promise<number> {
  let total = 0;
  for (const ch of changes) {
    if (masteryRank(ch.to) <= masteryRank(ch.from)) continue;
    const row = masteryRows.find((m) => m.skill_key === ch.skillKey);
    if (!row) continue;
    const res = await awardXp(s, { idempotencyKey: uuidFrom(`${baseKey}:${ch.skillKey}:${ch.to}`), userId: enrollment.user_id, enrollmentId: enrollment.id, reason: 'skill_state_advanced', referenceTable: 'user_skill_mastery', referenceId: row.id });
    total += res.amount;
  }
  return total;
}

export interface ScheduledReview {
  cardId: string;
  targetKind: 'expression' | 'skill';
  targetId: string;
  due: string;
}

/**
 * Create review cards for new targets (first review after a successful encounter is scheduled by the model,
 * not "due now") and leave existing cards untouched. Idempotent: existing (enrollment, target) rows are reused.
 */
export async function scheduleReviews(s: RequestServices, enrollment: EnrollmentRow, targets: ReadonlyArray<{ kind: 'expression' | 'skill'; id: string }>, now: string, initialRating: ReviewRating = 'good'): Promise<ScheduledReview[]> {
  if (!targets.length) return [];
  const existing = await s.service.from('user_expression_reviews').select('*').eq('enrollment_id', enrollment.id);
  if (existing.error) throw new DbError(existing.error, 'reviews.existing');
  const byTarget = new Map<string, Row<'user_expression_reviews'>>();
  for (const r of existing.data ?? []) byTarget.set(r.expression_id ? `expression:${r.expression_id}` : `skill:${r.skill_key ?? ''}`, r);
  const out: ScheduledReview[] = [];
  const inserts: Insert<'user_expression_reviews'>[] = [];
  for (const t of targets) {
    const found = byTarget.get(`${t.kind}:${t.id}`);
    if (found) {
      out.push({ cardId: found.id, targetKind: t.kind, targetId: t.id, due: found.next_due_at });
      continue;
    }
    const id = crypto.randomUUID();
    const card: ReviewCard = newCard({ id, enrollmentId: enrollment.id, targetKind: t.kind, targetId: t.id, now });
    const reviewed = scheduler.review(card, initialRating, { now, hintsUsed: 0 });
    inserts.push({ id, user_id: enrollment.user_id, enrollment_id: enrollment.id, expression_id: t.kind === 'expression' ? t.id : null, skill_key: t.kind === 'skill' ? t.id : null, ...cardToReviewPatch(reviewed.card, { lastRating: initialRating, lastHintCount: 0, schedulerVersion: scheduler.version }) });
    out.push({ cardId: id, targetKind: t.kind, targetId: t.id, due: reviewed.nextDue });
  }
  if (inserts.length) {
    const res = await s.service.from('user_expression_reviews').upsert(inserts, { onConflict: 'id' });
    if (res.error) throw new DbError(res.error, 'reviews.insert');
  }
  return out;
}

/** Apply one review result to a card the learner owns (RLS client) and return the updated contract card. */
export async function applyReviewResult(s: RequestServices, enrollment: EnrollmentRow, input: { cardId: string; rating: ReviewRating; hintsUsed: number; replays: number; responseTimeMs: number | null; scenarioId: string | null; occurredAt: string }): Promise<ReviewCard | null> {
  const { repos } = s.requireUser();
  const row = await repos.progress.getReviewCard(input.cardId);
  if (!row || row.enrollment_id !== enrollment.id) return null;
  const card = reviewRowToCard(row);
  const result = scheduler.review(card, input.rating, { now: input.occurredAt, hintsUsed: input.hintsUsed, replays: input.replays, responseTimeMs: input.responseTimeMs, scenarioId: input.scenarioId });
  const updated = await repos.progress.updateReviewCard(row.id, cardToReviewPatch(result.card, { lastRating: result.effectiveRating, lastHintCount: input.hintsUsed, schedulerVersion: scheduler.version }));
  return reviewRowToCard(updated);
}

/** Deterministic UUIDv5-like id from a string (for derived idempotency keys that must be uuids). */
export function uuidFrom(input: string): string {
  // FNV-1a 128-bit folding into a UUID shape (v8 custom); collision-safe enough for per-user derived keys.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  let h3 = 0xdeadbeef;
  let h4 = 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ch, 0x9e3779b1) >>> 0;
    h3 = Math.imul(h3 ^ (ch + i), 0x85ebca6b) >>> 0;
    h4 = Math.imul(h4 ^ (ch * 31), 0xc2b2ae35) >>> 0;
  }
  const hex = [h1, h2, h3, h4].map((n) => n.toString(16).padStart(8, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0')}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}
