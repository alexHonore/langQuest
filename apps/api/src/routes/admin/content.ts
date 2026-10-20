/**
 * §6.4 content lifecycle (§7.6, §9.8, A20): content-factory draft jobs, review requests, the rights-gated
 * publish checklist (`@langquest/media` `canPublish`), unpublish/takedown propagation and licence attributions.
 * Publishing records `publication_events` + `content_revisions`, emits `lesson.published` and
 * `manifest.invalidated` (edge cache purge), and is audit-logged. Before the checklist, a mission / expression the
 * content factory's diversity gate marked `diversity_needs_regeneration` is refused (412) until a regeneration clears
 * the flag or an editor overrides it by name with a reason (`PublishReviewFlagOverrideSchema`; audited, and recorded on
 * the row, which clears it).
 *
 * This module also holds the editorial integrity helpers every admin edit route shares (assets, structure,
 * editorial), so each rule has one implementation:
 * - `takeDownContent` is THE takedown (§7.6): every move out of `published` — the unpublish route, bulk labelling,
 *   the lesson PATCH — runs it, so manifests are invalidated and rebuilt, dependent offline packs revoked, media
 *   playback revoked for rights-driven reasons, and the move recorded as revision + publication event + audit row.
 *   A field edit sent with the takedown is folded into the same revision claim and conditional row write
 *   (`TakedownEdit`), and the manifests listing the row before and after the edit are both invalidated.
 * - `recordRestorableRevision` writes `content_revisions` WITH the restorable snapshot of the row after the edit
 *   (exactly `ROLLBACK_RESTORABLE_COLUMNS`, the shape `adminContentRollback` restores; R-7.3-04).
 * - `guardedEdit` makes the `expectedRevision` guard atomic: the revision number is CLAIMED under the unique key
 *   (entity_table, entity_id, revision) before anything is written — of two editors who loaded the same revision,
 *   exactly one gets it and the other is answered 412 with the current revision — and row updates are conditional
 *   on the `updated_at` that was read (`updateIfUnchanged`), so a change made in between is a 412, never a lost update.
 * - `invalidatePublishedContent` refreshes the learner manifests after an edit of published content.
 */
import {
  ContentGenerateRequestSchema,
  ContentGenerateResponseSchema,
  ContentPublishRequestSchema,
  ContentPublishResponseSchema,
  ContentRequestReviewRequestSchema,
  ContentRequestReviewResponseSchema,
  ContentUnpublishRequestSchema,
  ContentUnpublishResponseSchema,
  LicensesAttributionsQuerySchema,
  LicensesAttributionsResponseSchema,
  ROLLBACK_ENTITY_TABLES,
  UuidSchema,
  getCourseTrack,
  isCourseTrackId,
  rollbackPatch,
  tracksForVariety,
  type ContentState,
  type ContentUnpublishRequest,
  type CourseTrackId,
  type ReviewStatus,
  type RollbackEntityTable,
} from '@langquest/contracts';
import type { Row } from '@langquest/db/types';
import type { InvalidationInput } from '@langquest/media/manifests';
import { canPublish, canTransitionContent, propagateTakedown, type PublishGateInput } from '@langquest/media/rights';
import { z } from 'zod';
import type { DefineRoute } from '../../app';
import { problem, respondOk, type ApiProblem } from '../../http/envelope';
import { parseBody, parseParams, parseQuery } from '../../http/validate';
import { currentRevision, loadContent, locateContent, recordPublicationEvent, stateOf, titleOf, transitionContent, type ContentRow, type RevisionTable } from '../../lib/content';
import { goalsOf } from '../../lib/goals';
import { refreshAudioCollectionManifest, refreshCourseManifests } from '../../lib/manifests';
import { rightsFor, rightsRecord } from '../../lib/rights';
import type { RequestServices } from '../../services/context';

const IdParams = z.object({ id: UuidSchema });

const trackIdsForVariety = (varietyId: string | null): CourseTrackId[] => (varietyId ? tracksForVariety(varietyId as never).map((t) => t.id) : []);

// --- revisions with restorable snapshots (R-7.3-04) + the atomic revision guard ---------------------------------

/** Postgres unique_violation: another writer already holds this (entity_table, entity_id, revision). */
const UNIQUE_VIOLATION = '23505';
/** Attempts at the next free revision number while concurrent writers keep taking it. */
const REVISION_ATTEMPTS = 5;

type Snapshot = Record<string, unknown>;
const isRollbackTable = (table: string): table is RollbackEntityTable => (ROLLBACK_ENTITY_TABLES as readonly string[]).includes(table);

/**
 * The restorable snapshot of a row: exactly the `ROLLBACK_RESTORABLE_COLUMNS` of its table that the row carries (the
 * shape `adminContentRollback` restores through `rollbackPatch`), or null for tables rollback does not cover.
 * Lifecycle state, review flags and publish columns are never part of it.
 */
export function restorableSnapshot(table: string, row: Record<string, unknown> | null | undefined): Snapshot | null {
  if (!row || !isRollbackTable(table)) return null;
  const snapshot = rollbackPatch(table, row);
  return Object.keys(snapshot).length ? snapshot : null;
}

async function loadSnapshot(s: RequestServices, table: RevisionTable, id: string): Promise<Snapshot | null> {
  if (!isRollbackTable(table)) return null;
  const res = await s.service.from(table).select('*').eq('id', id).maybeSingle();
  if (res.error) throw problem.internal(`Could not read ${table}: ${res.error.message}`);
  return restorableSnapshot(table, res.data as Record<string, unknown> | null);
}

/** Insert revision `revision`; false when another writer already holds that number (the unique key decides). */
async function insertRevision(s: RequestServices, table: RevisionTable, id: string, revision: number, diff: Record<string, unknown>, snapshot: Snapshot | null, note: string | null): Promise<boolean> {
  const { principal } = s.requireUser();
  const res = await s.service.from('content_revisions').insert({ entity_table: table, entity_id: id, revision, diff: diff as never, snapshot: snapshot as never, editor_id: principal.userId, note });
  if (!res.error) return true;
  if (res.error.code === UNIQUE_VIOLATION) return false;
  throw problem.internal(`Could not record the content revision: ${res.error.message}`);
}

export interface RevisionOptions {
  /** The row AFTER the edit; its restorable columns become the snapshot. */
  row?: Record<string, unknown> | null;
  /** A precomputed snapshot (wins over `row`). Neither given: the row is read. */
  snapshot?: Snapshot | null;
  note?: string | null;
}

/**
 * Record the next revision of an entity WITH its restorable snapshot. The number is latest + 1; when a concurrent
 * writer took it, the next free number is used (the unique key decides, not the earlier read).
 */
export async function recordRestorableRevision(s: RequestServices, table: RevisionTable, id: string, diff: Record<string, unknown>, options: RevisionOptions = {}): Promise<number> {
  const snapshot = options.snapshot !== undefined ? options.snapshot : options.row !== undefined ? restorableSnapshot(table, options.row) : await loadSnapshot(s, table, id);
  for (let attempt = 0; attempt < REVISION_ATTEMPTS; attempt += 1) {
    const next = (await currentRevision(s, table, id)) + 1;
    if (await insertRevision(s, table, id, next, diff, snapshot, options.note ?? null)) return next;
  }
  throw problem.conflict('Other edits of this item kept arriving at the same moment; reload it and try again.');
}

/** 412 for a stale `expectedRevision`, with the revision the client should reload. */
export const staleRevision = (what: string, current: number, expected: number): ApiProblem => problem.precondition(`${what} revision is ${current}, expected ${expected}`, { currentRevision: current });

/** Thrown by `updateIfUnchanged` when the row's `updated_at` moved after it was read; `guardedEdit` answers 412. */
export class RowChangedError extends Error {
  constructor(readonly what: string) {
    super(`${what} changed after it was read`);
    this.name = 'RowChangedError';
  }
}

/** Tables whose rows carry `updated_at` (kept current by the `set_updated_at` trigger) and are edited through PATCH. */
export type VersionedTable = 'audio_lessons' | 'audio_course_collections' | 'audio_chapters';

/**
 * `UPDATE … WHERE id = $id AND updated_at = $readValue`: the row version is the `updated_at` the caller read, so a
 * change made by anyone in between (another editor, a job, a suggestion) updates zero rows → `RowChangedError`.
 */
export async function updateIfUnchanged(s: RequestServices, table: VersionedTable, before: { id: string; updated_at: string }, patch: Record<string, unknown>, what: string): Promise<Record<string, unknown>> {
  const res = await s.service.from(table).update(patch as never).eq('id', before.id).eq('updated_at', before.updated_at).select('*');
  if (res.error) throw problem.internal(`Could not update the ${what.toLowerCase()}: ${res.error.message}`);
  const row = (res.data as unknown as Record<string, unknown>[] | null)?.[0];
  if (!row) throw new RowChangedError(what);
  return row;
}

async function rethrowAsConflict(s: RequestServices, table: RevisionTable, id: string, error: unknown): Promise<never> {
  if (error instanceof RowChangedError) {
    const now = await currentRevision(s, table, id);
    throw problem.precondition(`${error.what} changed while you were saving (now at revision ${now}); reload it and apply your edit again.`, { currentRevision: now });
  }
  throw error;
}

/** A claimed revision whose write did not complete: a follow-up revision records the row exactly as it is now. */
async function voidRevision(s: RequestServices, table: RevisionTable, id: string, claimed: number, reason: string): Promise<void> {
  try {
    await recordRestorableRevision(s, table, id, { voidsRevision: claimed, reason }, { note: `revision ${claimed} did not complete (${reason}); this revision records the row as it is` });
  } catch (error) {
    s.log.error('content_revision.void_failed', { table, id, claimed, error: error instanceof Error ? error.message : String(error) });
  }
}

export interface GuardedEditInput {
  table: RevisionTable;
  id: string;
  /** Subject of the 412 message: "Lesson revision is 3, expected 2". */
  what: string;
  /** The client's `expectedRevision`; undefined = the caller asked for no concurrency control. */
  expected: number | undefined;
  /** The current revision when the caller already read it. */
  current?: number;
  diff: Record<string, unknown>;
  /** Restorable snapshot of the row AFTER the edit, computed before writing (`{ ...before, ...patch }`). */
  snapshot: Snapshot | null;
  note?: string | null;
}

/**
 * Run `write` under the optimistic-concurrency guard of `content_revisions` and record its revision:
 * - with `expected`: a stale value is a 412 before anything is written; then revision `expected + 1` is CLAIMED
 *   (insert under the unique key) BEFORE `write` runs, so of two concurrent editors at the same revision exactly one
 *   proceeds and the other gets 412 with the winner's revision. If `write` fails — a `RowChangedError` from
 *   `updateIfUnchanged` (412) or any error — the claim is voided by a follow-up revision that records the real row.
 * - without `expected`: `write` runs first and the revision takes the next free number afterwards.
 */
export async function guardedEdit<T>(s: RequestServices, input: GuardedEditInput, write: () => Promise<T>): Promise<{ result: T; revision: number }> {
  const { table, id, what, expected } = input;
  const note = input.note ?? null;
  if (expected === undefined) {
    let result: T;
    try {
      result = await write();
    } catch (error) {
      return rethrowAsConflict(s, table, id, error);
    }
    return { result, revision: await recordRestorableRevision(s, table, id, input.diff, { snapshot: input.snapshot, note }) };
  }
  const current = input.current ?? (await currentRevision(s, table, id));
  if (expected !== current) throw staleRevision(what, current, expected);
  const revision = expected + 1;
  if (!(await insertRevision(s, table, id, revision, input.diff, input.snapshot, note))) throw staleRevision(what, await currentRevision(s, table, id), expected);
  try {
    return { result: await write(), revision };
  } catch (error) {
    await voidRevision(s, table, id, revision, error instanceof RowChangedError ? 'the row changed concurrently' : 'the write failed');
    return rethrowAsConflict(s, table, id, error);
  }
}

// --- manifests ---------------------------------------------------------------------------------------------------

async function manifestsFor(s: RequestServices, content: ContentRow): Promise<InvalidationInput[]> {
  switch (content.table) {
    case 'missions':
    case 'characters':
    case 'expressions':
      return trackIdsForVariety(content.row.target_variety_id).map((courseTrackId) => ({ kind: 'course', courseTrackId, collectionId: null, sourceLanguageCode: null }));
    case 'lesson_courses':
      return isCourseTrackId(content.row.course_track_id) ? [{ kind: 'course', courseTrackId: content.row.course_track_id, collectionId: null, sourceLanguageCode: null }] : [];
    case 'audio_course_collections':
      return [{ kind: 'audio_collection', courseTrackId: null, collectionId: content.row.id, sourceLanguageCode: null }];
    case 'audio_lessons': {
      const ch = (await s.service.from('audio_chapters').select('collection_id').eq('id', content.row.chapter_id).maybeSingle()).data;
      return ch ? [{ kind: 'audio_collection', courseTrackId: null, collectionId: ch.collection_id, sourceLanguageCode: null }] : [];
    }
    default:
      return [];
  }
}

/** After `manifest.invalidated`: rebuild + store the affected manifests (background; the response never waits on it). */
function storeManifests(s: RequestServices, manifests: readonly InvalidationInput[]): void {
  for (const m of manifests) {
    if (m.kind === 'course' && m.courseTrackId) s.waitUntil(refreshCourseManifests(s, m.courseTrackId, m.sourceLanguageCode));
    if (m.kind === 'audio_collection' && m.collectionId) s.waitUntil(refreshAudioCollectionManifest(s, m.collectionId));
  }
}

/** Content whose learner manifests an edit can change (chapters are listed in their collection's manifest). */
export type ManifestSubject = ContentRow | { table: 'audio_chapters'; row: Row<'audio_chapters'> };

const manifestKey = (m: InvalidationInput): string => `${m.kind}:${m.courseTrackId ?? ''}:${m.collectionId ?? ''}:${m.sourceLanguageCode ?? ''}`;

/**
 * Every manifest listing any of `subjects`, once each. Passing the row before AND after an edit covers a move: a
 * lesson moved to a chapter of another collection is in the new collection's manifest and still in the old one's
 * until that one is rebuilt.
 */
async function manifestsListing(s: RequestServices, subjects: readonly ManifestSubject[]): Promise<InvalidationInput[]> {
  const found = new Map<string, InvalidationInput>();
  for (const subject of subjects) {
    const manifests: InvalidationInput[] = subject.table === 'audio_chapters' ? [{ kind: 'audio_collection', courseTrackId: null, collectionId: subject.row.collection_id, sourceLanguageCode: null }] : await manifestsFor(s, subject);
    for (const m of manifests) if (!found.has(manifestKey(m))) found.set(manifestKey(m), m);
  }
  return [...found.values()];
}

const isPublished = (subject: ManifestSubject): boolean => (subject.table === 'audio_chapters' ? subject.row.state === 'published' : stateOf(subject) === 'published');

/**
 * After an edit of PUBLISHED content (titles, order, visibility, a move, a rollback…): purge the edge-cached manifests
 * that list it and rebuild the stored copies (`localization_updated`). Unpublished content is not in any manifest.
 * `previous` is the row before the edit: when the edit moved the content (a lesson to a chapter of another
 * collection), the manifest that listed it there is refreshed too.
 */
export async function invalidatePublishedContent(s: RequestServices, subject: ManifestSubject, revision: number, previous?: ManifestSubject): Promise<boolean> {
  if (!isPublished(subject)) return false;
  const manifests = await manifestsListing(s, previous ? [subject, previous] : [subject]);
  for (const m of manifests) await s.events.emit('manifest.invalidated', { ...m, newVersion: revision, reason: 'localization_updated' }, { idempotencyKey: `manifest.invalidated:${subject.table}:${subject.row.id}:${revision}:${m.courseTrackId ?? m.collectionId}`, traceId: s.requestId });
  storeManifests(s, manifests);
  return manifests.length > 0;
}

// --- the takedown -------------------------------------------------------------------------------------------------

export type TakedownReason = ContentUnpublishRequest['reason'];

export interface TakedownResult {
  from: ContentState;
  state: ContentState;
  revision: number;
  offlineEligibilityRevoked: boolean;
  manifestInvalidated: boolean;
  revokedAssets: number;
  revokedPacks: number;
}

/**
 * A field edit that lands together with a takedown (`PATCH … { topic, state: 'unpublished' }`, a bulk label that also
 * unpublishes): ONE revision claim, ONE conditional row write, so the edit and the move out of `published` land
 * together or not at all — never an applied edit answered with 412, never an edit left live.
 */
export interface TakedownEdit {
  /** The edit's own diff; it is recorded in the takedown's revision. */
  diff: Record<string, unknown>;
  /**
   * The row as the edit leaves it (`{ ...before, ...patch }`), computed before writing: its restorable columns are the
   * revision's snapshot, and the manifests listing it are invalidated along with those that listed the row before.
   */
  after: Record<string, unknown>;
  /**
   * The edit's write, run under the takedown's revision claim. It must write `newState` in the SAME update as the edit,
   * conditional on the row version it read (`updateIfUnchanged`): a concurrent change voids the claim and is a 412
   * with nothing applied.
   */
  write: (newState: ContentState) => Promise<void>;
}

/**
 * THE takedown (§7.6, `propagateTakedown`): published → unpublished (rights-driven reasons send approved content to
 * `rights_unverified`), media playback revoked for rights-driven reasons, dependent offline packs revoked, a revision
 * (with snapshot) + publication event, `manifest.invalidated` for every manifest listing the content (edge cache
 * purge + stored copy rebuilt) and a `content.unpublish` audit row naming the route it came through (`via`).
 * `expected` makes the takedown's revision claim part of a caller's `expectedRevision` guard; `edit` folds a field
 * edit into the same claim and row write (`TakedownEdit`). `content` is the row as it was read, before any edit.
 */
export async function takeDownContent(s: RequestServices, content: ContentRow, input: { reason: TakedownReason; note?: string | null; via: 'unpublish' | 'bulk_label' | 'lesson_patch'; expected?: number; current?: number; edit?: TakedownEdit }): Promise<TakedownResult> {
  const id = content.row.id;
  const from = stateOf(content);
  const note = input.note ?? null;
  const edit = input.edit;
  // Before the edit AND after it: a takedown that also moves the content purges the manifest that listed it.
  const manifests = await manifestsListing(s, edit ? [content, { table: content.table, row: edit.after } as ContentRow] : [content]);
  const assetIds = content.table === 'audio_lessons' ? ((await s.service.from('audio_lesson_assets').select('asset_id').eq('lesson_id', id)).data ?? []).map((l) => l.asset_id) : [];
  const packs = content.table === 'audio_lessons' ? ((await s.service.from('user_download_manifests').select('id').eq('lesson_id', id).is('revoked_at', null)).data ?? []).map((p) => p.id) : [];
  // `lesson_courses` are course-level content; the takedown planner treats them like missions.
  const plan = propagateTakedown({ entity: { table: content.table === 'lesson_courses' ? 'missions' : content.table, id, state: from }, reason: input.reason, manifests, assetIds, dependentPackIds: packs });
  // Refused before the revision is claimed (the edit path writes the state itself, without `transitionContent`).
  if (plan.newState !== from && !canTransitionContent(from, plan.newState)) throw problem.precondition(`Content in state "${from}" cannot move to "${plan.newState}"`, { from, to: plan.newState });
  const diff: Record<string, unknown> = { ...(edit?.diff ?? {}), unpublish: true, reason: input.reason, note, ...(input.via === 'unpublish' ? {} : { via: input.via }) };
  const { revision } = await guardedEdit(s, { table: content.table, id, what: 'Content', expected: input.expected, current: input.current, diff, snapshot: restorableSnapshot(content.table, edit?.after ?? content.row), note }, async () => {
    if (edit) await edit.write(plan.newState);
    else if (plan.newState !== from) await transitionContent(s, content, plan.newState);
    if (plan.revokePlaybackForAssetIds.length) await s.service.from('media_assets').update({ disposition: 'revoked' }).in('id', plan.revokePlaybackForAssetIds);
    if (plan.dependentPackIds.length) await s.service.from('user_download_manifests').update({ revoked_at: new Date().toISOString() }).in('id', plan.dependentPackIds);
  });
  await recordPublicationEvent(s, content.table, id, revision, from, plan.newState, `${input.reason}${note ? `: ${note}` : ''}`);
  for (const m of plan.manifestInvalidations) await s.events.emit('manifest.invalidated', { kind: m.kind, courseTrackId: m.courseTrackId, collectionId: m.collectionId, sourceLanguageCode: m.sourceLanguageCode, newVersion: revision, reason: m.reason }, { idempotencyKey: `manifest.invalidated:${content.table}:${id}:${revision}:${m.courseTrackId ?? m.collectionId}`, traceId: s.requestId });
  storeManifests(s, plan.manifestInvalidations);
  s.audit({ action: 'content.unpublish', entityTable: content.table, entityId: id, before: { state: from }, after: { state: plan.newState, reason: input.reason, via: input.via, revision, revokedAssets: plan.revokePlaybackForAssetIds.length, revokedPacks: plan.dependentPackIds.length } });
  return { from, state: plan.newState, revision, offlineEligibilityRevoked: plan.offlineEligibilityRevoked, manifestInvalidated: plan.manifestInvalidations.length > 0, revokedAssets: plan.revokePlaybackForAssetIds.length, revokedPacks: plan.dependentPackIds.length };
}

// --- publish gate ------------------------------------------------------------------------------------------------

/**
 * Set by the content factory's diversity gate (§9.8, R-9.8-02) on drafts whose dialogue or learner phrasings are too
 * uniform to teach from: `apps/jobs` `generate-content.ts` (`DIVERSITY_REVIEW_FLAG`, written to
 * `missions.scoring_rubric.reviewFlags` and `expressions.script_annotations.reviewFlags`) and the scripts content
 * factory `--apply` (`expressions.script_annotations.curation.flags`). A regenerated draft that passes carries none.
 */
export const DIVERSITY_REVIEW_FLAG = 'diversity_needs_regeneration';
/** Review flags that refuse a publish (412) until a regeneration clears them or an editor overrides them (audited). */
export const PUBLISH_BLOCKING_REVIEW_FLAGS = [DIVERSITY_REVIEW_FLAG] as const;
export type PublishBlockingReviewFlag = (typeof PUBLISH_BLOCKING_REVIEW_FLAGS)[number];

/**
 * The editor override of a blocking review flag, sent in the publish body next to the `ContentPublishRequestSchema`
 * fields (that schema strips unknown keys, so these optional fields are read here until the contract carries them).
 * Each overridden flag is named explicitly and the reason is required. A publish that goes through records the
 * override in its revision diff, its publication event and the audit log, and on the row itself
 * (`reviewFlagOverrides`, the flag removed from the lists), which is what clears the flag for later publishes.
 */
export const PublishReviewFlagOverrideSchema = z
  .object({
    overrideReviewFlags: z.array(z.enum(PUBLISH_BLOCKING_REVIEW_FLAGS)).min(1).max(PUBLISH_BLOCKING_REVIEW_FLAGS.length).optional(),
    overrideReason: z.string().trim().min(10).max(1000).optional(),
  })
  .refine((b) => b.overrideReviewFlags === undefined || b.overrideReason !== undefined, { message: 'overrideReason (at least 10 characters) is required with overrideReviewFlags', path: ['overrideReason'] })
  .refine((b) => b.overrideReason === undefined || b.overrideReviewFlags !== undefined, { message: 'overrideReason is only accepted together with overrideReviewFlags', path: ['overrideReviewFlags'] });

type JsonRecord = Record<string, unknown>;
const jsonRecord = (value: unknown): JsonRecord => (value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {});
const stringList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
const isBlockingFlag = (flag: string): flag is PublishBlockingReviewFlag => (PUBLISH_BLOCKING_REVIEW_FLAGS as readonly string[]).includes(flag);

interface ReviewFlagState {
  /** The JSON column the flags live in, as read. */
  column: 'scoring_rubric' | 'script_annotations';
  value: JsonRecord;
  flags: PublishBlockingReviewFlag[];
  /** The diversity gate's reasons when the draft records them (`scoring_rubric.diversity.reasons`). */
  reasons: string[];
}

/** Blocking review flags a mission / expression carries (null for tables that have none). */
export function blockingReviewFlags(content: ContentRow): ReviewFlagState | null {
  if (content.table === 'missions') {
    const value = jsonRecord(content.row.scoring_rubric);
    return { column: 'scoring_rubric', value, flags: [...new Set(stringList(value.reviewFlags).filter(isBlockingFlag))], reasons: stringList(jsonRecord(value.diversity).reasons) };
  }
  if (content.table === 'expressions') {
    const value = jsonRecord(content.row.script_annotations);
    return { column: 'script_annotations', value, flags: [...new Set([...stringList(value.reviewFlags), ...stringList(jsonRecord(value.curation).flags)].filter(isBlockingFlag))], reasons: [] };
  }
  return null;
}

/** The flag column with the overridden flags taken out of its flag lists and the override appended to `reviewFlagOverrides`. */
function withReviewFlagsOverridden(state: ReviewFlagState, overridden: readonly PublishBlockingReviewFlag[], entry: { overriddenBy: string; overriddenAt: string; reason: string; revision: number }): JsonRecord {
  const drop = (list: unknown): unknown => (Array.isArray(list) ? list.filter((f) => !(overridden as readonly unknown[]).includes(f)) : list);
  const next: JsonRecord = { ...state.value };
  if ('reviewFlags' in next) next.reviewFlags = drop(next.reviewFlags);
  const curation = next.curation;
  if (state.column === 'script_annotations' && curation && typeof curation === 'object' && !Array.isArray(curation) && 'flags' in curation) next.curation = { ...(curation as JsonRecord), flags: drop((curation as JsonRecord).flags) };
  next.reviewFlagOverrides = [...(Array.isArray(next.reviewFlagOverrides) ? next.reviewFlagOverrides : []), ...overridden.map((flag) => ({ flag, ...entry }))];
  return next;
}

async function gateInputFor(s: RequestServices, content: ContentRow): Promise<PublishGateInput> {
  const state = stateOf(content);
  switch (content.table) {
    case 'audio_lessons': {
      const lesson = content.row;
      const [links, speakerLinks, chapter] = await Promise.all([
        s.service.from('audio_lesson_assets').select('asset_type, media_assets!inner(id, byte_length, disposition, state, derivation, etag)').eq('lesson_id', lesson.id).then((r) => (r.data ?? []) as unknown as { asset_type: string; media_assets: { id: string; byte_length: number; disposition: string; state: string; derivation: string | null; etag: string | null } }[]),
        s.service.from('lesson_speakers').select('speakers!inner(display_name, consent_state)').eq('lesson_id', lesson.id).then((r) => (r.data ?? []) as unknown as { speakers: { display_name: string; consent_state: Row<'speakers'>['consent_state'] } }[]),
        s.service.from('audio_chapters').select('collection_id, audio_course_collections!inner(content_rights_id)').eq('id', lesson.chapter_id).maybeSingle().then((r) => r.data as unknown as { collection_id: string; audio_course_collections: { content_rights_id: string | null } } | null),
      ]);
      const primary = links.find((l) => l.asset_type === 'mobile_encoded') ?? links.find((l) => l.asset_type === 'master') ?? null;
      const verifiedUpload = primary ? (await s.service.from('uploads').select('verified_checksum_sha256').eq('draft_asset_id', primary.media_assets.id).not('verified_checksum_sha256', 'is', null).limit(1).maybeSingle()).data : null;
      const rights = await rightsFor(s, lesson.content_rights_id ?? chapter?.audio_course_collections.content_rights_id);
      return {
        entityKind: 'audio_lesson',
        currentState: state,
        title: titleOf(lesson.title_translations),
        languageCode: lesson.target_variety_id ?? lesson.instruction_language_code,
        asset: primary ? { checksumVerified: Boolean(verifiedUpload) || primary.media_assets.derivation !== null, disposition: primary.media_assets.disposition as 'active', accessible: primary.media_assets.disposition === 'active', byteLength: primary.media_assets.byte_length } : null,
        speakers: { known: speakerLinks.length > 0, entries: speakerLinks.map((sl) => ({ name: sl.speakers.display_name, consentState: sl.speakers.consent_state as 'unknown' | 'pending' | 'granted' | 'revoked' })) },
        chapterId: lesson.chapter_id,
        rights: rightsRecord(rights),
        nativeReviewed: lesson.quality_review_status === 'approved',
      };
    }
    case 'audio_course_collections':
      return { entityKind: 'audio_collection', currentState: state, title: titleOf(content.row.title_translations), languageCode: content.row.target_variety_id ?? content.row.instruction_language_code, rights: rightsRecord(await rightsFor(s, content.row.content_rights_id)), speakers: null, nativeReviewed: false };
    case 'missions':
      return { entityKind: 'mission', currentState: state, title: titleOf(content.row.title_translations), languageCode: content.row.target_variety_id, rights: rightsRecord(await rightsFor(s, content.row.chapter_id ? (await s.service.from('chapters').select('lesson_courses!inner(content_rights_id)').eq('id', content.row.chapter_id).maybeSingle().then((r) => (r.data as unknown as { lesson_courses: { content_rights_id: string | null } } | null)?.lesson_courses.content_rights_id ?? null)) : null)), nativeReviewed: false, requireNativeReview: true };
    case 'lesson_courses':
      return { entityKind: 'mission', currentState: state, title: titleOf(content.row.title_translations), languageCode: content.row.course_track_id, rights: rightsRecord(await rightsFor(s, content.row.content_rights_id)), nativeReviewed: false };
    case 'expressions':
      return { entityKind: 'expression', currentState: state, title: content.row.canonical_text, languageCode: content.row.target_variety_id, rights: rightsRecord(await rightsFor(s, content.row.content_rights_id)), nativeReviewed: content.row.reviewed, requireNativeReview: true };
    case 'characters':
      return { entityKind: 'character', currentState: state, title: content.row.name, languageCode: content.row.target_variety_id, rights: null, nativeReviewed: false };
    case 'visual_assets':
      return { entityKind: 'visual_asset', currentState: state, title: content.row.alt_text_key, languageCode: 'und', asset: { checksumVerified: Boolean(content.row.content_hash), disposition: 'active', accessible: true, byteLength: content.row.byte_length }, rights: rightsRecord(await rightsFor(s, content.row.license_id)), altTextPresent: content.row.alt_text_key.length > 0, nativeReviewed: content.row.review_status === 'approved' };
  }
}

export function registerContentRoutes(define: DefineRoute): void {
  define('adminContentGenerate', { role: 'contentEditor' }, async (c) => {
    const body = await parseBody(c, ContentGenerateRequestSchema);
    const s = c.get('services')!;
    const { principal } = s.requireUser();
    const key = `content_generate:${body.idempotencyKey}`;
    const before = (await s.service.from('processing_jobs').select('id').eq('idempotency_key', key).maybeSingle()).data;
    const job = await s.repos.processingJobs.enqueue({ jobType: 'content_generate', idempotencyKey: key, requestedBy: principal.userId, provider: 'openrouter', params: { targetTrack: body.targetTrack, targetVariety: getCourseTrack(body.targetTrack).targetVarietyId, sourceLanguage: body.sourceLanguage, intentKeys: body.intentKeys, level: body.level, scene: body.scene ?? null, characterId: body.characterId ?? null, count: body.count, publication: { status: 'draft', requiresVerifiedSourceRights: true, requiresNativeReview: true } } });
    const draftIds = ((job.output as { draftIds?: string[] } | null)?.draftIds ?? []).filter((v) => typeof v === 'string');
    s.audit({ action: 'content.generate', entityTable: 'processing_jobs', entityId: job.id, after: { targetTrack: body.targetTrack, sourceLanguage: body.sourceLanguage, intents: body.intentKeys.length, replayed: Boolean(before) } });
    return respondOk(c, ContentGenerateResponseSchema.parse({ jobId: job.id, draftIds, replayed: Boolean(before) }), before ? 200 : 202);
  });

  define('adminContentRequestReview', { role: 'languageReviewer' }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, ContentRequestReviewRequestSchema);
    const s = c.get('services')!;
    const { principal } = s.requireUser();
    const content = await locateContent(s, id);
    const from = stateOf(content);
    const variety = 'target_variety_id' in content.row ? content.row.target_variety_id : null;
    // Validate BEFORE any write: a variety mismatch must not leave a transition/revision/event behind.
    if (variety && body.targetVarietyId && body.targetVarietyId !== variety) throw problem.validation(`Content is ${variety}; review cannot target ${body.targetVarietyId}`);
    const target: ContentState = from === 'published' ? 'published' : 'review_needed';
    if (target !== from) await transitionContent(s, content, target);
    const revision = await recordRestorableRevision(s, content.table, id, { requestReview: true, note: body.note ?? null, reviewerId: body.reviewerId ?? null }, { row: content.row, note: body.note });
    await recordPublicationEvent(s, content.table, id, revision, from, target, body.note ?? 'review requested');
    if (variety) {
      const source = 'source_language_code' in content.row ? (content.row as { source_language_code?: string | null }).source_language_code : null;
      if (source) await s.events.emit('translation.review_requested', { entityTable: content.table, entityId: id, sourceLanguageCode: source as never, targetVarietyId: variety as never, requestedBy: principal.userId, reviewerId: body.reviewerId ?? null }, { idempotencyKey: `review:${content.table}:${id}:${revision}`, traceId: s.requestId });
    }
    // `ReviewStatus` (contracts): a named reviewer means the review is in progress, otherwise it is awaiting one.
    const reviewStatus: ReviewStatus = body.reviewerId ? 'in_review' : 'review_needed';
    s.audit({ action: 'content.request_review', entityTable: content.table, entityId: id, before: { state: from }, after: { state: target, reviewStatus, reviewerId: body.reviewerId ?? null } });
    return respondOk(c, ContentRequestReviewResponseSchema.parse({ contentId: id, state: target, reviewStatus }));
  });

  define('adminContentPublish', { role: 'contentEditor' }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, ContentPublishRequestSchema);
    const override = await parseBody(c, PublishReviewFlagOverrideSchema);
    const s = c.get('services')!;
    const { principal } = s.requireUser();
    const content = await loadContent(s, body.entityTable, id);
    const revision = await currentRevision(s, content.table, id);
    // Stale revisions are refused before any gate work; `guardedEdit` below claims the next number atomically.
    if (body.expectedRevision !== revision) throw staleRevision('Content', revision, body.expectedRevision);
    if (content.table === 'missions') {
      // §10.1: a published goal must be describable per source language (catalog key or per-source map); a bare
      // string has no language and would be shown to learners of every source as-is.
      const unlabelled = goalsOf(content.row).filter((g) => !g.description_key && (g.description === undefined || typeof g.description === 'string')).map((g) => g.id);
      if (unlabelled.length) throw problem.validation(`Mission goals need a description_key or a per-source description map before publishing: ${unlabelled.join(', ')}`, { goalIds: unlabelled });
    }
    // §9.8 review flags: a draft the diversity gate marked for regeneration is refused until a regeneration clears the
    // flag (a regenerated draft carries none) or an editor overrides it by name, with a reason (audited below).
    const flagState = blockingReviewFlags(content);
    const overridden = (flagState?.flags ?? []).filter((f) => override.overrideReviewFlags?.includes(f) === true);
    const remaining = (flagState?.flags ?? []).filter((f) => !overridden.includes(f));
    if (flagState && remaining.length) {
      s.audit({ action: 'content.publish_blocked', entityTable: content.table, entityId: id, after: { blockedBy: remaining, reviewFlags: flagState.flags } });
      const why = flagState.reasons.length ? ` (${flagState.reasons.join(', ')})` : '';
      throw problem.precondition(
        `Publishing refused: this ${content.table === 'missions' ? 'mission' : 'expression'} is marked ${remaining.map((f) => `"${f}"`).join(', ')} by the content factory's diversity gate${why}. Regenerate it, or override the flag explicitly by sending overrideReviewFlags ${JSON.stringify(remaining)} with an overrideReason; the override is recorded in the revision, the publication event and the audit log.`,
        { reviewFlags: remaining, reasons: flagState.reasons, override: { flagsField: 'overrideReviewFlags', reasonField: 'overrideReason' } },
      );
    }
    const gate = canPublish(await gateInputFor(s, content));
    if (!gate.allowed) {
      s.audit({ action: 'content.publish_blocked', entityTable: content.table, entityId: id, after: { blockedBy: gate.blockedBy } });
      return respondOk(c, ContentPublishResponseSchema.parse({ contentId: id, state: stateOf(content), revision, checklist: gate.checklist, blockedBy: gate.blockedBy, manifestInvalidated: false }));
    }
    const from = stateOf(content);
    const nextRevision = revision + 1;
    const extra: Record<string, unknown> = {};
    if (content.table === 'missions' || content.table === 'lesson_courses' || content.table === 'audio_lessons') extra.published_revision = nextRevision;
    if (content.table === 'audio_course_collections') extra.published_version = nextRevision;
    // An override clears the flag in the same write as the publish (`reviewFlagOverrides` keeps who, when and why).
    const flagOverride = flagState && overridden.length && override.overrideReason ? { flags: overridden, reason: override.overrideReason } : null;
    if (flagState && flagOverride) extra[flagState.column] = withReviewFlagsOverridden(flagState, overridden, { overriddenBy: principal.userId, overriddenAt: new Date().toISOString(), reason: flagOverride.reason, revision: nextRevision });
    await guardedEdit(s, { table: content.table, id, what: 'Content', expected: revision, current: revision, diff: { publish: true, note: body.note ?? null, ...(flagOverride ? { reviewFlagOverride: flagOverride } : {}) }, snapshot: restorableSnapshot(content.table, content.row), note: body.note }, () => transitionContent(s, content, 'published', extra));
    await recordPublicationEvent(s, content.table, id, nextRevision, from, 'published', flagOverride ? `${body.note ? `${body.note} · ` : ''}review flag override (${flagOverride.flags.join(', ')}): ${flagOverride.reason}` : body.note);
    if (flagState && flagOverride) s.audit({ action: 'content.review_flag_override', entityTable: content.table, entityId: id, before: { reviewFlags: flagState.flags }, after: { overridden: flagOverride.flags, reason: flagOverride.reason, revision: nextRevision } });
    const manifests = await manifestsFor(s, content);
    for (const m of manifests) await s.events.emit('manifest.invalidated', { ...m, newVersion: nextRevision, reason: 'published' }, { idempotencyKey: `manifest.invalidated:${content.table}:${id}:${nextRevision}:${m.courseTrackId ?? m.collectionId}`, traceId: s.requestId });
    storeManifests(s, manifests);
    if (content.table === 'audio_lessons' || content.table === 'missions' || content.table === 'lesson_courses' || content.table === 'audio_course_collections') {
      const trackId = content.table === 'lesson_courses' ? content.row.course_track_id : content.table === 'audio_course_collections' ? content.row.course_track_id : content.table === 'missions' ? (trackIdsForVariety(content.row.target_variety_id)[0] ?? null) : null;
      await s.events.emit('lesson.published', { entityTable: content.table, entityId: id, revision: nextRevision, courseTrackId: trackId && isCourseTrackId(trackId) ? trackId : null, publishedBy: principal.userId, state: 'published' }, { idempotencyKey: `lesson.published:${content.table}:${id}:${nextRevision}`, traceId: s.requestId });
    }
    s.audit({ action: 'content.publish', entityTable: content.table, entityId: id, before: { state: from, revision }, after: { state: 'published', revision: nextRevision, manifests: manifests.length, ...(flagOverride ? { reviewFlagsOverridden: flagOverride.flags } : {}) } });
    return respondOk(c, ContentPublishResponseSchema.parse({ contentId: id, state: 'published', revision: nextRevision, checklist: gate.checklist, blockedBy: [], manifestInvalidated: manifests.length > 0 }));
  });

  define('adminContentUnpublish', { role: 'contentEditor' }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, ContentUnpublishRequestSchema);
    const s = c.get('services')!;
    const content = await loadContent(s, body.entityTable, id);
    const result = await takeDownContent(s, content, { reason: body.reason, note: body.note ?? null, via: 'unpublish' });
    return respondOk(c, ContentUnpublishResponseSchema.parse({ contentId: id, state: result.state, offlineEligibilityRevoked: result.offlineEligibilityRevoked, manifestInvalidated: result.manifestInvalidated }));
  });

  define('adminLicensesAttributions', {}, async (c) => {
    const q = parseQuery(c, LicensesAttributionsQuerySchema);
    const s = c.get('services')!;
    let query = s.service.from('content_rights').select('*').order('created_at', { ascending: false }).limit(q.limit + 1);
    if (q.onlyUnverified) query = query.eq('verified', false);
    if (q.cursor) query = query.lt('created_at', q.cursor);
    const res = await query;
    if (res.error) throw problem.internal(res.error.message);
    const rows = (res.data ?? []).slice(0, q.limit);
    const ids = rows.map((r) => r.id);
    const [assets, lessons, collections, expressions] = ids.length
      ? await Promise.all([
          s.service.from('media_assets').select('id, content_rights_id, state').in('content_rights_id', ids).then((r) => r.data ?? []),
          s.service.from('audio_lessons').select('id, content_rights_id, state').in('content_rights_id', ids).then((r) => r.data ?? []),
          s.service.from('audio_course_collections').select('id, content_rights_id, state, course_track_id').in('content_rights_id', ids).then((r) => r.data ?? []),
          s.service.from('expressions').select('id, content_rights_id, state').in('content_rights_id', ids).then((r) => r.data ?? []),
        ])
      : [[], [], [], []];
    const items = rows
      .map((r) => ({
        contentRightsId: r.id,
        licenseId: r.license_id,
        licenseVersion: r.license_version,
        originUrl: r.origin_url && /^https?:\/\//.test(r.origin_url) ? r.origin_url : null,
        authors: r.authors,
        attributionRequired: r.attribution_required,
        attributionText: r.attribution_text,
        commercialRedistribution: r.commercial_redistribution,
        verified: r.verified,
        expiresAt: r.expires_at,
        revokedAt: r.revoked_at,
        usedBy: [
          ...assets.filter((a) => a.content_rights_id === r.id).map((a) => ({ entityTable: 'media_assets', entityId: a.id, state: a.state })),
          ...lessons.filter((a) => a.content_rights_id === r.id).map((a) => ({ entityTable: 'audio_lessons', entityId: a.id, state: a.state })),
          ...collections.filter((a) => a.content_rights_id === r.id).map((a) => ({ entityTable: 'audio_course_collections', entityId: a.id, state: a.state })),
          ...expressions.filter((a) => a.content_rights_id === r.id).map((a) => ({ entityTable: 'expressions', entityId: a.id, state: a.state })),
        ],
        _trackIds: collections.filter((a) => a.content_rights_id === r.id).map((a) => a.course_track_id),
      }))
      .filter((it) => !q.trackId || it._trackIds.includes(q.trackId))
      .map(({ _trackIds, ...it }) => it);
    return respondOk(c, LicensesAttributionsResponseSchema.parse({ items, nextCursor: (res.data ?? []).length > q.limit ? (rows[rows.length - 1]?.created_at ?? null) : null, total: null }));
  });
}
