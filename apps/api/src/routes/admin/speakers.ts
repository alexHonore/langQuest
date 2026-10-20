/**
 * §7.3 speakers (`adminSpeakers*`): the people/voices behind recordings. Consent + rights live on the row;
 * `targetVarietyId: null` means "unknown", never an inferred neighbour variety; synthetic voices are flagged as such.
 * Creates are idempotent on `idempotencyKey` (audit-logged key → id); every mutation records a `content_revisions`
 * row (the DTO's `revision`) and an audit entry. Deleting a speaker still linked to lessons needs `reassignToSpeakerId`.
 *
 * Revisions and rollback (R-7.3-04), the same rule as `content_rights` (`rights.ts`):
 * - A speaker row is a consent record (`consent_state`, the `content_rights_id` behind the voice, `synthetic`), so
 *   `speakers` is intentionally NOT restorable: it is not one of the contracts' `ROLLBACK_ENTITY_TABLES`,
 *   `POST /v1/admin/content/:id/rollback` refuses it (422), and its revisions carry no snapshot (`snapshot: null`,
 *   written explicitly through `recordRestorableRevision`: an audit trail only). Restoring an old revision could
 *   silently bring back a withdrawn consent or a rights grant that was replaced; a speaker changes through PATCH.
 *   `SPEAKERS_TABLE` stops type-checking if `speakers` is ever added to the rollback tables without revisiting this.
 * - The PATCH `expectedRevision` guard is atomic (`guardedEdit` claims `expectedRevision + 1` before writing): of two
 *   editors who loaded the same revision exactly one saves, the other gets 412 with the current revision.
 * - Concurrent creates and patches without `expectedRevision` take the next free revision number (the unique key
 *   decides), never a 500.
 */
import { SpeakerCreateRequestSchema, SpeakerDeleteRequestSchema, SpeakerDeleteResponseSchema, SpeakerPatchRequestSchema, SpeakerResponseSchema, SpeakersListQuerySchema, SpeakersListResponseSchema, UuidSchema, type RollbackEntityTable, type SpeakerDto, type SpeakerResponse } from '@langquest/contracts';
import type { Insert, Row, Update } from '@langquest/db/types';
import { z } from 'zod';
import type { DefineRoute } from '../../app';
import { problem, respondOk } from '../../http/envelope';
import { parseBody, parseParams, parseQuery } from '../../http/validate';
import { currentRevision, type RevisionTable } from '../../lib/content';
import { createDiff, findIdempotentCreate } from '../../lib/idempotent-create';
import type { RequestServices } from '../../services/context';
import { guardedEdit, recordRestorableRevision, staleRevision } from './content';

const IdParams = z.object({ id: UuidSchema });

/** A revision table that is never a rollback table: this stops type-checking if `speakers` ever becomes one. */
const SPEAKERS_TABLE = 'speakers' as const satisfies Exclude<RevisionTable, RollbackEntityTable>;
/** A `speakers` revision: an audit trail entry, never a restorable snapshot (see the module comment). */
const recordSpeakerRevision = (s: RequestServices, id: string, diff: Record<string, unknown>): Promise<number> => recordRestorableRevision(s, SPEAKERS_TABLE, id, diff, { snapshot: null });

function toDto(row: Row<'speakers'>, lessonCount: number): SpeakerDto {
  return {
    id: row.id,
    displayName: row.display_name,
    pseudonymous: row.pseudonymous,
    targetVarietyId: row.target_variety_id as SpeakerDto['targetVarietyId'],
    region: row.region,
    consentState: row.consent_state as SpeakerDto['consentState'],
    contentRightsId: row.content_rights_id,
    voiceDescription: row.voice_description,
    synthetic: row.synthetic,
    lessonCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function speakerResponse(s: RequestServices, row: Row<'speakers'>, knownRevision?: number): Promise<SpeakerResponse> {
  const [counts, revision] = await Promise.all([s.repos.speakers.lessonCounts([row.id]), knownRevision === undefined ? currentRevision(s, SPEAKERS_TABLE, row.id) : Promise.resolve(knownRevision)]);
  return SpeakerResponseSchema.parse({ ...toDto(row, counts.get(row.id) ?? 0), revision });
}

async function assertRightsExist(s: RequestServices, id: string | null | undefined): Promise<void> {
  if (!id) return;
  if (!(await s.repos.rights.getById(id))) throw problem.validation(`content_rights ${id} does not exist`, { contentRightsId: id });
}

export function registerSpeakerRoutes(define: DefineRoute): void {
  define('adminSpeakersList', {}, async (c) => {
    const q = parseQuery(c, SpeakersListQuerySchema);
    const s = c.get('services')!;
    const page = await s.repos.speakers.list({ q: q.q, targetVarietyId: q.targetVarietyId, consentState: q.consentState, synthetic: q.synthetic, cursor: q.cursor, limit: q.limit });
    const counts = await s.repos.speakers.lessonCounts(page.items.map((r) => r.id));
    return respondOk(c, SpeakersListResponseSchema.parse({ items: page.items.map((r) => toDto(r, counts.get(r.id) ?? 0)), nextCursor: page.nextCursor, total: null }));
  });

  define('adminSpeakerCreate', { role: 'contentEditor' }, async (c) => {
    const body = await parseBody(c, SpeakerCreateRequestSchema);
    const s = c.get('services')!;
    const replay = await findIdempotentCreate(s, 'speaker.create', body.idempotencyKey);
    if (replay) {
      const existing = await s.repos.speakers.getById(replay);
      if (existing) return respondOk(c, await speakerResponse(s, existing), 200);
    }
    await assertRightsExist(s, body.contentRightsId);
    const row: Insert<'speakers'> = { display_name: body.displayName, pseudonymous: body.pseudonymous, target_variety_id: body.targetVarietyId, region: body.region, consent_state: body.consentState, content_rights_id: body.contentRightsId, voice_description: body.voiceDescription, synthetic: body.synthetic };
    const created = await s.repos.speakers.create(row);
    const revision = await recordSpeakerRevision(s, created.id, createDiff('speaker.create', body.idempotencyKey));
    s.audit({ action: 'speaker.create', entityTable: 'speakers', entityId: created.id, after: { idempotencyKey: body.idempotencyKey, displayName: created.display_name, synthetic: created.synthetic, consentState: created.consent_state } });
    return respondOk(c, await speakerResponse(s, created, revision), 201);
  });

  define('adminSpeakerGet', {}, async (c) => {
    const { id } = parseParams(c, IdParams);
    const s = c.get('services')!;
    const row = await s.repos.speakers.getById(id);
    if (!row) throw problem.notFound('Speaker');
    return respondOk(c, await speakerResponse(s, row));
  });

  define('adminSpeakerPatch', { role: 'contentEditor' }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, SpeakerPatchRequestSchema);
    const s = c.get('services')!;
    const before = await s.repos.speakers.getById(id);
    if (!before) throw problem.notFound('Speaker');
    const revision = await currentRevision(s, SPEAKERS_TABLE, id);
    if (body.expectedRevision !== undefined && body.expectedRevision !== revision) throw staleRevision('Speaker', revision, body.expectedRevision);
    await assertRightsExist(s, body.contentRightsId);
    const patch: Update<'speakers'> = {};
    if (body.displayName !== undefined) patch.display_name = body.displayName;
    if (body.pseudonymous !== undefined) patch.pseudonymous = body.pseudonymous;
    if (body.targetVarietyId !== undefined) patch.target_variety_id = body.targetVarietyId;
    if (body.region !== undefined) patch.region = body.region;
    if (body.consentState !== undefined) patch.consent_state = body.consentState;
    if (body.contentRightsId !== undefined) patch.content_rights_id = body.contentRightsId;
    if (body.voiceDescription !== undefined) patch.voice_description = body.voiceDescription;
    if (body.synthetic !== undefined) patch.synthetic = body.synthetic;
    const { expectedRevision: _expected, ...diff } = body;
    // Not restorable (module comment): the revision is an audit trail entry; the guard still claims it atomically.
    const { result: updated, revision: next } = await guardedEdit(s, { table: SPEAKERS_TABLE, id, what: 'Speaker', expected: body.expectedRevision, current: revision, diff: diff as Record<string, unknown>, snapshot: null }, async () => (Object.keys(patch).length ? await s.repos.speakers.update(id, patch) : before));
    s.audit({ action: 'speaker.patch', entityTable: 'speakers', entityId: id, before: { consentState: before.consent_state, synthetic: before.synthetic }, after: { fields: Object.keys(patch), consentState: updated.consent_state, synthetic: updated.synthetic, revision: next } });
    return respondOk(c, await speakerResponse(s, updated, next));
  });

  define('adminSpeakerDelete', { role: 'contentEditor' }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, SpeakerDeleteRequestSchema);
    const s = c.get('services')!;
    const row = await s.repos.speakers.getById(id);
    if (!row) throw problem.notFound('Speaker');
    const linked = (await s.repos.speakers.lessonCounts([id])).get(id) ?? 0;
    let reassignedLessons = 0;
    if (linked > 0) {
      if (!body.reassignToSpeakerId) throw problem.conflict(`Speaker is linked to ${linked} lesson(s); pass reassignToSpeakerId to move them first`, { lessonCount: linked });
      if (body.reassignToSpeakerId === id) throw problem.validation('reassignToSpeakerId must be a different speaker');
      const target = await s.repos.speakers.getById(body.reassignToSpeakerId);
      if (!target) throw problem.validation('reassignToSpeakerId does not exist', { reassignToSpeakerId: body.reassignToSpeakerId });
      reassignedLessons = await s.repos.speakers.reassignLessons(id, body.reassignToSpeakerId);
    }
    await s.repos.speakers.delete(id);
    s.audit({ action: 'speaker.delete', entityTable: 'speakers', entityId: id, before: { displayName: row.display_name, consentState: row.consent_state }, after: { reassignedLessons, reassignToSpeakerId: body.reassignToSpeakerId ?? null, reason: body.reason ?? null } });
    return respondOk(c, SpeakerDeleteResponseSchema.parse({ id, deleted: true, reassignedLessons }));
  });
}
