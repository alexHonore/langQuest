/**
 * §7.5 content rights (`adminContentRights*`): one row per grant; assets, lessons, collections, expressions, courses,
 * speakers and visual assets point at it. Only `admin`/`super_admin` may mark a grant `verified` (editors create and
 * edit unverified rows); `revokedAt` is never patched directly — `adminContentRightsRevoke` runs the
 * `revoke_content_rights` RPC (migration 120), which unpublishes every dependent published entity and revokes
 * offline packs in ONE transaction, then the API records revisions and invalidates the affected manifests.
 *
 * Revisions and rollback (R-7.3-04):
 * - A grant is a legal record, so `content_rights` is intentionally NOT restorable: it is not one of the contracts'
 *   `ROLLBACK_ENTITY_TABLES`, `POST /v1/admin/content/:id/rollback` refuses it (422) and its revisions carry no
 *   snapshot (`snapshot: null`, an audit trail only). Restoring an old revision would flip `verified` (an admin
 *   decision) or undo a revocation (one-way, RPC-only) behind those gates; a grant changes through PATCH, or is revoked
 *   and replaced by a new grant.
 * - The content rows a revocation unpublishes ARE restorable tables: each gets a revision with the restorable snapshot
 *   of the row as the RPC left it. A rollback of one restores metadata only, never `state`, so it cannot republish
 *   content whose rights were revoked.
 * - The PATCH `expectedRevision` guard is atomic (`guardedEdit` claims `expectedRevision + 1` before writing).
 */
import { ContentRightsCreateRequestSchema, ContentRightsListQuerySchema, ContentRightsListResponseSchema, ContentRightsPatchRequestSchema, ContentRightsResponseSchema, ContentRightsRevokeRequestSchema, ContentRightsRevokeResponseSchema, UuidSchema, type ContentRightsDto, type RollbackEntityTable } from '@langquest/contracts';
import { rightsAllowPublishing } from '@langquest/db/repositories/rights';
import type { Insert, Row, Update } from '@langquest/db/types';
import { z } from 'zod';
import type { DefineRoute } from '../../app';
import { problem, respondOk } from '../../http/envelope';
import { parseBody, parseParams, parseQuery } from '../../http/validate';
import { currentRevision, currentRevisions, type RevisionTable } from '../../lib/content';
import { createDiff, findIdempotentCreate } from '../../lib/idempotent-create';
import { hasAnyRole } from '../../middleware/auth';
import type { RequestServices } from '../../services/context';
import { guardedEdit, recordRestorableRevision, staleRevision } from './content';

const IdParams = z.object({ id: UuidSchema });

/** A revision table that is never a rollback table: this stops type-checking if `content_rights` ever becomes one. */
const RIGHTS_TABLE = 'content_rights' as const satisfies Exclude<RevisionTable, RollbackEntityTable>;
/** A `content_rights` revision: an audit trail entry, never a restorable snapshot (see the module comment). */
const recordRightsRevision = (s: RequestServices, id: string, diff: Record<string, unknown>, note?: string | null): Promise<number> => recordRestorableRevision(s, RIGHTS_TABLE, id, diff, { snapshot: null, note: note ?? null });

/** Content tables a revocation can unpublish (rows of the `revoke_content_rights` RPC result); all restorable. */
const REVOKABLE_CONTENT_TABLES = ['audio_lessons', 'audio_course_collections', 'missions', 'lesson_courses', 'expressions', 'visual_assets'] as const satisfies readonly (RollbackEntityTable & RevisionTable)[];
const isRevokableContent = (table: string): table is (typeof REVOKABLE_CONTENT_TABLES)[number] => (REVOKABLE_CONTENT_TABLES as readonly string[]).includes(table);

const isHttpUrl = (v: string | null): v is string => v !== null && /^https?:\/\//i.test(v);

async function rightsDto(s: RequestServices, row: Row<'content_rights'>, revision?: number): Promise<ContentRightsDto> {
  const [usedBy, rev] = await Promise.all([s.repos.rights.listUsages(row.id), revision === undefined ? currentRevision(s, 'content_rights', row.id) : Promise.resolve(revision)]);
  return ContentRightsResponseSchema.parse({
    id: row.id,
    originUrl: isHttpUrl(row.origin_url) ? row.origin_url : null,
    authors: row.authors,
    speakers: row.speakers,
    permissionGrant: row.permission_grant,
    licenseId: row.license_id,
    licenseVersion: row.license_version,
    commercialRedistribution: row.commercial_redistribution,
    attributionRequired: row.attribution_required,
    attributionText: row.attribution_text,
    alterationsPermitted: row.alterations_permitted,
    aiProcessingPermitted: row.ai_processing_permitted,
    voiceRights: row.voice_rights,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    evidenceAssetId: row.evidence_asset_id,
    verified: row.verified,
    verifiedBy: row.reviewer_id,
    verifiedAt: row.reviewed_at,
    publishable: rightsAllowPublishing(row),
    usedBy: usedBy.map((u) => ({ entityTable: u.entityTable, entityId: u.entityId, state: u.state })),
    revision: rev,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

/** `verified: true` is an admin decision; an editor asking for it is refused (never silently downgraded). */
function assertMayVerify(s: RequestServices, verified: boolean | undefined): void {
  if (verified !== true) return;
  const { principal } = s.requireUser();
  if (!hasAnyRole(principal, 'admin')) throw problem.forbidden('Only an admin can mark a rights grant as verified');
}

async function assertEvidenceAsset(s: RequestServices, id: string | null | undefined): Promise<void> {
  if (!id) return;
  if (!(await s.repos.rights.getAsset(id))) throw problem.validation('evidenceAssetId does not exist', { evidenceAssetId: id });
}

export function registerRightsRoutes(define: DefineRoute): void {
  define('adminContentRightsList', {}, async (c) => {
    const q = parseQuery(c, ContentRightsListQuerySchema);
    const s = c.get('services')!;
    const page = await s.repos.rights.list({ q: q.q, verified: q.verified, revoked: q.revoked, expiringBefore: q.expiringBefore, licenseId: q.licenseId, cursor: q.cursor, limit: q.limit });
    const revisions = await currentRevisions(s, 'content_rights', page.items.map((r) => r.id));
    const items = await Promise.all(page.items.map((r) => rightsDto(s, r, revisions.get(r.id) ?? 0)));
    return respondOk(c, ContentRightsListResponseSchema.parse({ items, nextCursor: page.nextCursor, total: null }));
  });

  define('adminContentRightsCreate', { role: 'contentEditor' }, async (c) => {
    const body = await parseBody(c, ContentRightsCreateRequestSchema);
    const s = c.get('services')!;
    const { principal } = s.requireUser();
    const replay = await findIdempotentCreate(s, 'content_rights.create', body.idempotencyKey);
    if (replay) {
      const existing = await s.repos.rights.getById(replay);
      if (existing) return respondOk(c, await rightsDto(s, existing), 200);
    }
    assertMayVerify(s, body.verified);
    await assertEvidenceAsset(s, body.evidenceAssetId);
    const now = new Date().toISOString();
    const row: Insert<'content_rights'> = {
      origin_url: body.originUrl,
      authors: body.authors,
      speakers: body.speakers,
      permission_grant: body.permissionGrant,
      license_id: body.licenseId,
      license_version: body.licenseVersion,
      commercial_redistribution: body.commercialRedistribution,
      attribution_required: body.attributionRequired,
      attribution_text: body.attributionText,
      alterations_permitted: body.alterationsPermitted,
      ai_processing_permitted: body.aiProcessingPermitted,
      voice_rights: body.voiceRights,
      expires_at: body.expiresAt,
      evidence_asset_id: body.evidenceAssetId,
      verified: body.verified,
      reviewer_id: body.verified ? principal.userId : null,
      reviewed_at: body.verified ? now : null,
    };
    const created = await s.repos.rights.create(row);
    await recordRightsRevision(s, created.id, createDiff('content_rights.create', body.idempotencyKey, { verified: created.verified }));
    s.audit({ action: 'content_rights.create', entityTable: 'content_rights', entityId: created.id, after: { idempotencyKey: body.idempotencyKey, licenseId: created.license_id, verified: created.verified, commercialRedistribution: created.commercial_redistribution } });
    return respondOk(c, await rightsDto(s, created), 201);
  });

  define('adminContentRightsGet', {}, async (c) => {
    const { id } = parseParams(c, IdParams);
    const s = c.get('services')!;
    const row = await s.repos.rights.getById(id);
    if (!row) throw problem.notFound('Content rights');
    return respondOk(c, await rightsDto(s, row));
  });

  define('adminContentRightsPatch', { role: 'contentEditor' }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, ContentRightsPatchRequestSchema);
    const s = c.get('services')!;
    const { principal } = s.requireUser();
    const before = await s.repos.rights.getById(id);
    if (!before) throw problem.notFound('Content rights');
    const revision = await currentRevision(s, RIGHTS_TABLE, id);
    if (body.expectedRevision !== undefined && body.expectedRevision !== revision) throw staleRevision('Content rights', revision, body.expectedRevision);
    if (before.revoked_at) throw problem.precondition('A revoked grant cannot be edited; create a new grant instead', { revokedAt: before.revoked_at });
    // Flipping `verified` either way is an admin decision; editors may change the other fields of an unverified grant.
    if (body.verified !== undefined && body.verified !== before.verified) assertMayVerify(s, true);
    await assertEvidenceAsset(s, body.evidenceAssetId);
    const patch: Update<'content_rights'> = {};
    if (body.originUrl !== undefined) patch.origin_url = body.originUrl;
    if (body.authors !== undefined) patch.authors = body.authors;
    if (body.speakers !== undefined) patch.speakers = body.speakers;
    if (body.permissionGrant !== undefined) patch.permission_grant = body.permissionGrant;
    if (body.licenseId !== undefined) patch.license_id = body.licenseId;
    if (body.licenseVersion !== undefined) patch.license_version = body.licenseVersion;
    if (body.commercialRedistribution !== undefined) patch.commercial_redistribution = body.commercialRedistribution;
    if (body.attributionRequired !== undefined) patch.attribution_required = body.attributionRequired;
    if (body.attributionText !== undefined) patch.attribution_text = body.attributionText;
    if (body.alterationsPermitted !== undefined) patch.alterations_permitted = body.alterationsPermitted;
    if (body.aiProcessingPermitted !== undefined) patch.ai_processing_permitted = body.aiProcessingPermitted;
    if (body.voiceRights !== undefined) patch.voice_rights = body.voiceRights;
    if (body.expiresAt !== undefined) patch.expires_at = body.expiresAt;
    if (body.evidenceAssetId !== undefined) patch.evidence_asset_id = body.evidenceAssetId;
    if (body.verified !== undefined && body.verified !== before.verified) {
      patch.verified = body.verified;
      patch.reviewer_id = body.verified ? principal.userId : null;
      patch.reviewed_at = body.verified ? new Date().toISOString() : null;
    }
    const { expectedRevision: _expected, ...diff } = body;
    // Not restorable (module comment): the revision is an audit trail entry; the guard still claims it atomically.
    const { result: updated, revision: next } = await guardedEdit(s, { table: RIGHTS_TABLE, id, what: 'Content rights', expected: body.expectedRevision, current: revision, diff: diff as Record<string, unknown>, snapshot: null }, async () => (Object.keys(patch).length ? await s.repos.rights.update(id, patch) : before));
    s.audit({ action: 'content_rights.patch', entityTable: 'content_rights', entityId: id, before: { verified: before.verified, commercialRedistribution: before.commercial_redistribution }, after: { fields: Object.keys(patch), verified: updated.verified, commercialRedistribution: updated.commercial_redistribution, revision: next } });
    return respondOk(c, await rightsDto(s, updated, next));
  });

  define('adminContentRightsRevoke', { role: 'contentEditor' }, async (c) => {
    const { id } = parseParams(c, IdParams);
    const body = await parseBody(c, ContentRightsRevokeRequestSchema);
    const s = c.get('services')!;
    const { principal } = s.requireUser();
    const before = await s.repos.rights.getById(id);
    if (!before) throw problem.notFound('Content rights');
    const replayed = before.revoked_at !== null;
    // Service client: the RPC needs the actor explicitly (`publication_events.actor_id` is NOT NULL); it returns
    // only the rows it changed, so a replay (already revoked) yields an empty list and never a second unpublish.
    const rows = await s.repos.rights.revoke(id, { reason: body.reason, note: body.note ?? null, actorId: principal.userId });
    const after = (await s.repos.rights.getById(id)) ?? before;
    const affected = rows.map((r) => ({ entityTable: r.entity_table, entityId: r.entity_id, previousState: r.previous_state, newState: r.new_state }));
    // Revisions for the unpublished content rows + manifest invalidation of every collection they belong to.
    const lessonIds = affected.filter((a) => a.entityTable === 'audio_lessons').map((a) => a.entityId);
    const collectionIds = new Set(affected.filter((a) => a.entityTable === 'audio_course_collections').map((a) => a.entityId));
    if (lessonIds.length) {
      const chapters = (await s.service.from('audio_lessons').select('id, chapter_id, audio_chapters!inner(collection_id)').in('id', lessonIds)).data as unknown as { id: string; audio_chapters: { collection_id: string } | null }[] | null;
      for (const l of chapters ?? []) if (l.audio_chapters?.collection_id) collectionIds.add(l.audio_chapters.collection_id);
    }
    for (const a of affected) {
      // The snapshot is read from the row as the RPC left it (restorable columns only; never its state).
      if (isRevokableContent(a.entityTable)) await recordRestorableRevision(s, a.entityTable, a.entityId, { rightsRevoked: id, reason: body.reason, from: a.previousState, to: a.newState }, { note: body.note ?? null });
    }
    const revision = await recordRightsRevision(s, id, { revoke: true, reason: body.reason, idempotencyKey: body.idempotencyKey, replayed, affected: affected.length }, body.note);
    for (const collectionId of collectionIds) {
      await s.events.emit('manifest.invalidated', { kind: 'audio_collection', courseTrackId: null, collectionId, sourceLanguageCode: null, newVersion: revision, reason: 'rights_revoked' }, { idempotencyKey: `manifest.invalidated:content_rights:${id}:${revision}:${collectionId}`, traceId: s.requestId });
    }
    s.audit({ action: 'content_rights.revoke', entityTable: 'content_rights', entityId: id, before: { revokedAt: before.revoked_at }, after: { reason: body.reason, note: body.note ?? null, affected: affected.length, collections: collectionIds.size, replayed } });
    return respondOk(c, ContentRightsRevokeResponseSchema.parse({ id, revokedAt: after.revoked_at ?? new Date().toISOString(), affected, manifestInvalidated: collectionIds.size > 0, replayed }));
  });
}
