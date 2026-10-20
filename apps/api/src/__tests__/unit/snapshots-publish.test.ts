/**
 * Restorable snapshots for the admin edit routes round 2 left without them, and the §9.8 review-flag publish gate,
 * through the REAL app against the offline PostgREST double (`route-fixtures`: unique keys on `content_revisions`,
 * `updated_at` bumped on every write; no network, no provider, no spend):
 *
 * 1. Visual assets (patch, assign, unassign, replace) write `content_revisions` WITH the restorable snapshot of the row
 *    as the edit leaves it, the `expectedRevision` guard is atomic, and `POST /v1/admin/content/:id/rollback` restores
 *    a visual-asset edit as a new revision (R-7.3-04).
 * 2. An approved asset suggestion is a lesson edit: written only over the row it was computed from (a concurrent write
 *    makes it re-read and re-apply on the current row), snapshotted, and undone by a rollback.
 * 3. Content rights are intentionally NOT restorable: their revisions carry no snapshot and a rollback of the table is
 *    refused (422) with nothing written. The content a revocation unpublishes gets restorable revisions, and restoring
 *    one never republishes it.
 * 4. Publishing a mission / expression the content factory's diversity gate marked `diversity_needs_regeneration` is a
 *    412 naming the flag and the gate's reasons, until a regeneration clears it (a regenerated draft carries none) or an
 *    editor overrides it by name with a reason. The override is recorded in the revision diff, the publication event,
 *    the audit log and on the row, which clears the flag for later publishes.
 */
import { ROLLBACK_RESTORABLE_COLUMNS, type RollbackEntityTable } from '@langquest/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DIVERSITY_REVIEW_FLAG } from '../../routes/admin/content';
import { audioLessonRow, routeHarness, type DbRow, type RouteHarness } from './route-fixtures';

const EDITOR = '33333333-3333-4333-8333-333333333333';
const EDITOR2 = '44444444-4444-4444-8444-444444444444';
const REVIEWER = '55555555-5555-4555-8555-555555555555';
const ADMIN = '66666666-6666-4666-8666-666666666666';
const ROLES = { [EDITOR]: ['content_editor' as const], [EDITOR2]: ['content_editor' as const], [REVIEWER]: ['language_reviewer' as const], [ADMIN]: ['admin' as const] };
const NOW = () => new Date().toISOString();
/** A row version no request can produce (the double stamps `updated_at` with the current time). */
const FOREIGN_WRITE_AT = '2031-01-01T00:00:00.000Z';

const visualRow = (over: DbRow = {}): DbRow => {
  const id = (over.id as string | undefined) ?? crypto.randomUUID();
  return {
    id,
    type: 'course_cover',
    storage_key: `visual/${id}.svg`,
    style_version: 'v1',
    content_hash: 'c'.repeat(64),
    license_id: null,
    alt_text_key: `visual.uploaded.${id.replace(/-/g, '')}`,
    alt_text_translations: { en: 'A spice stall in the souk' },
    focal_point: { x: 0.5, y: 0.5 },
    dimensions: { width: 1200, height: 800 },
    locale_neutral: true,
    review_status: 'draft',
    origin: 'original_upload',
    dominant_colors: [],
    variants: [],
    generation_brief: null,
    mime_type: 'image/svg+xml',
    byte_length: 120,
    moderation_status: 'unchecked',
    source_file_asset_id: null,
    replaced_by_asset_id: null,
    prompt_template_id: null,
    ...over,
  };
};

const rightsRow = (over: DbRow = {}): DbRow => ({
  id: crypto.randomUUID(),
  origin_url: null,
  authors: ['LangQuest'],
  speakers: [],
  permission_grant: 'Original material written for LangQuest',
  license_id: 'original',
  license_version: null,
  commercial_redistribution: true,
  attribution_required: false,
  attribution_text: null,
  alterations_permitted: true,
  ai_processing_permitted: true,
  voice_rights: 'none',
  expires_at: null,
  revoked_at: null,
  evidence_asset_id: null,
  verified: true,
  reviewer_id: ADMIN,
  reviewed_at: NOW(),
  ...over,
});

const collectionRow = (over: DbRow = {}): DbRow => ({
  id: crypto.randomUUID(),
  title_translations: { en: 'Souk dialogues' },
  description_translations: {},
  course_track_id: 'arabic-moroccan',
  target_variety_id: 'ary',
  instruction_language_code: 'fr',
  region: null,
  instructor_speaker_id: null,
  cover_visual_asset_id: null,
  content_rights_id: null,
  state: 'imported_draft',
  sort_order: 0,
  published_version: null,
  ...over,
});

/** What `apps/jobs` `generate-content.ts` writes for a mission its diversity gate failed (`scoring_rubric`). */
const flaggedRubric = (over: DbRow = {}): DbRow => ({
  objectives: ['g1'],
  provenance: { generator: 'content_factory:v2' },
  reviewStatus: 'review_needed',
  diversity: { verdict: 'needs_regeneration', score: 0.2, reasons: ['low_alternative_coverage:0', 'quiz_shaped_dialogues:1'], batch: null, regenerated: false },
  reviewFlags: [DIVERSITY_REVIEW_FLAG],
  ...over,
});

const missionRow = (over: DbRow = {}): DbRow => ({
  id: crypto.randomUUID(),
  chapter_id: null,
  template_key: `cf.request_drink.${crypto.randomUUID().slice(0, 8)}`,
  mission_type: 'standard',
  title_translations: { fr: 'Commander au café' },
  title_key: null,
  goals: [{ id: 'g1', skill_keys: ['ordering.drink'], description: { fr: 'Commander une boisson' } }],
  target_variety_id: 'ary',
  level: 'beginner',
  recommended_minutes: 8,
  prerequisite_skill_keys: [],
  difficulty: 0.2,
  narrative_segment: {},
  scoring_rubric: flaggedRubric(),
  sort_order: 0,
  state: 'approved',
  published_revision: null,
  ...over,
});

const expressionRow = (rightsId: string, over: DbRow = {}): DbRow => ({
  id: crypto.randomUUID(),
  intent_id: crypto.randomUUID(),
  target_variety_id: 'ary',
  canonical_text: 'بغيت قهوة عافاك',
  register: 'polite',
  difficulty: 0.2,
  scenario_tags: ['cafe'],
  script_annotations: { variants: ['عطيني قهوة عافاك'], missionId: null, provenance: { generator: 'content_factory:v2' }, reviewFlags: [DIVERSITY_REVIEW_FLAG] },
  phonetic_annotations: {},
  reviewed: true,
  reviewer_id: REVIEWER,
  content_rights_id: rightsId,
  origin: 'ai_generated',
  state: 'approved',
  ...over,
});

const suggestionRow = (lessonId: string, over: DbRow = {}): DbRow => ({
  id: crypto.randomUUID(),
  media_asset_id: crypto.randomUUID(),
  lesson_id: lessonId,
  job_id: null,
  kind: 'level',
  suggestion: { value: 'beginner' },
  confidence: 0.8,
  provenance: { task: 'infer_metadata', model: 'fake/model' },
  review_status: 'review_needed',
  reviewer_id: null,
  decided_at: null,
  decision_note: null,
  ...over,
});

/** Serve `interleave` once, right before the first database request matching `when` (a deterministic race window). */
function interleaveBefore(h: RouteHarness, when: (method: string, target: string) => boolean, interleave: () => Promise<void> | void): void {
  const serve = h.db.handle.bind(h.db);
  let fired = false;
  h.db.handle = async (request: Request) => {
    const target = new URL(request.url).pathname.replace(/^\/rest\/v1\//, '');
    if (!fired && when(request.method.toUpperCase(), target)) {
      fired = true;
      await interleave();
    }
    return serve(request);
  };
}

/** The column defaults of `visual_assets` the routes rely on and the double does not emulate (it stores only what is sent). */
function withVisualColumnDefaults(h: RouteHarness): void {
  const serve = h.db.handle.bind(h.db);
  h.db.handle = async (request: Request) => {
    if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/visual_assets')) {
      const body = JSON.parse(await request.text()) as DbRow | DbRow[];
      const withDefaults = (r: DbRow): DbRow => ({ replaced_by_asset_id: null, prompt_template_id: null, ...r });
      return serve(new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(Array.isArray(body) ? body.map(withDefaults) : withDefaults(body)) }));
    }
    return serve(request);
  };
}

const revisionsOf = (h: RouteHarness, table: string, id: unknown): DbRow[] =>
  h.db
    .rows('content_revisions')
    .filter((r) => r.entity_table === table && r.entity_id === id)
    .sort((a, b) => Number(a.revision) - Number(b.revision));
const latestRevision = (h: RouteHarness, table: string, id: unknown): DbRow => revisionsOf(h, table, id).at(-1)!;
const restorable = (table: RollbackEntityTable, row: DbRow): DbRow => Object.fromEntries(ROLLBACK_RESTORABLE_COLUMNS[table].filter((c) => c in row).map((c) => [c, row[c]]));
const auditsOf = (h: RouteHarness, action: string, id?: unknown): DbRow[] => h.db.rows('audit_logs').filter((a) => a.action === action && (id === undefined || a.entity_id === id));

describe('restorable snapshots and the review-flag publish gate', () => {
  let h: RouteHarness;
  let editor: string;
  beforeEach(async () => {
    h = routeHarness({ roles: ROLES, media: true });
    editor = await h.token(EDITOR);
  });
  afterEach(() => h.restore());

  const rollback = (id: unknown, entityTable: string, revision: number, token = editor) => h.call(`/v1/admin/content/${String(id)}/rollback`, { token, body: { entityTable, revision } });

  // --- 1. visual assets -----------------------------------------------------------------------------------------------
  describe('visual assets', () => {
    it('every patch revision carries the snapshot of the row as patched, and rollback restores an earlier one as a new revision', async () => {
      const [asset] = h.db.seed('visual_assets', [visualRow()]) as [DbRow];
      const patch = (body: DbRow) => h.call(`/v1/admin/visual-assets/${String(asset.id)}`, { method: 'PATCH', token: editor, body });
      const first = await patch({ expectedRevision: 0, focalPoint: { x: 0.25, y: 0.75 }, altTextTranslations: { fr: 'Un étal d’épices au souk' } });
      expect(first.status, JSON.stringify(first.json)).toBe(200);
      expect(first.json.data.revision).toBe(1);
      expect(latestRevision(h, 'visual_assets', asset.id).snapshot).toEqual(restorable('visual_assets', asset));
      expect(latestRevision(h, 'visual_assets', asset.id).snapshot).toMatchObject({ focal_point: { x: 0.25, y: 0.75 } });
      expect((await patch({ expectedRevision: 1, focalPoint: { x: 0.9, y: 0.1 } })).json.data.revision).toBe(2);
      // A stale editor is refused before anything moves.
      const stale = await patch({ expectedRevision: 1, focalPoint: { x: 0, y: 0 } });
      expect(stale.status).toBe(412);
      expect(stale.json.error.details).toEqual({ currentRevision: 2 });
      expect(asset.focal_point).toEqual({ x: 0.9, y: 0.1 });

      const res = await rollback(asset.id, 'visual_assets', 1);
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      expect(res.json.data).toEqual({ entityId: asset.id, revision: 3, restoredColumns: ['alt_text_key', 'focal_point'] });
      expect(asset).toMatchObject({ focal_point: { x: 0.25, y: 0.75 }, review_status: 'draft' });
      expect(latestRevision(h, 'visual_assets', asset.id).snapshot).toEqual(restorable('visual_assets', asset));
      // Rolled back once, restorable again: revision 2 brings the later focal point back.
      expect((await rollback(asset.id, 'visual_assets', 2)).status).toBe(200);
      expect(asset.focal_point).toEqual({ x: 0.9, y: 0.1 });
      expect(revisionsOf(h, 'visual_assets', asset.id).map((r) => r.revision)).toEqual([1, 2, 3, 4]);
      expect(revisionsOf(h, 'visual_assets', asset.id).every((r) => r.snapshot !== null)).toBe(true);
    });

    it('the patch guard is atomic: a revision claimed by another writer after the read is a 412 and the row is not written', async () => {
      const [asset] = h.db.seed('visual_assets', [visualRow()]) as [DbRow];
      interleaveBefore(h, (method, target) => method === 'POST' && target === 'content_revisions', () => {
        h.db.rows('content_revisions').push({ id: crypto.randomUUID(), entity_table: 'visual_assets', entity_id: asset.id, revision: 1, diff: { by: 'another editor' }, snapshot: null, editor_id: EDITOR2, note: null, created_at: NOW() });
      });
      const res = await h.call(`/v1/admin/visual-assets/${String(asset.id)}`, { method: 'PATCH', token: editor, body: { expectedRevision: 0, focalPoint: { x: 0.1, y: 0.1 } } });
      expect(res.status, JSON.stringify(res.json)).toBe(412);
      expect(res.json.error.details).toEqual({ currentRevision: 1 });
      expect(asset.focal_point).toEqual({ x: 0.5, y: 0.5 });
      expect(h.db.writes('visual_assets')).toHaveLength(0);
    });

    it('assign and unassign record a revision with the snapshot of the asset', async () => {
      const [asset] = h.db.seed('visual_assets', [visualRow({ review_status: 'approved' })]) as [DbRow];
      const [collection] = h.db.seed('audio_course_collections', [collectionRow()]) as [DbRow];
      const target = { entityTable: 'audio_course_collections', entityId: collection.id, slot: 'cover' };
      const assigned = await h.call(`/v1/admin/visual-assets/${String(asset.id)}/assign`, { token: editor, body: { ...target, expectedRevision: 0, idempotencyKey: 'assign-key-0001' } });
      expect(assigned.status, JSON.stringify(assigned.json)).toBe(201);
      expect(collection.cover_visual_asset_id).toBe(asset.id);
      expect(latestRevision(h, 'visual_assets', asset.id)).toMatchObject({ revision: 1, diff: { assign: target }, snapshot: restorable('visual_assets', asset) });
      // A stale unassign is refused; the current one is recorded with its snapshot too.
      expect((await h.call(`/v1/admin/visual-assets/${String(asset.id)}/unassign`, { token: editor, body: { ...target, expectedRevision: 0 } })).status).toBe(412);
      expect(collection.cover_visual_asset_id).toBe(asset.id);
      const unassigned = await h.call(`/v1/admin/visual-assets/${String(asset.id)}/unassign`, { token: editor, body: { ...target, expectedRevision: 1 } });
      expect(unassigned.status, JSON.stringify(unassigned.json)).toBe(200);
      expect(unassigned.json.data.removed).toBe(true);
      expect(collection.cover_visual_asset_id).toBeNull();
      expect(latestRevision(h, 'visual_assets', asset.id)).toMatchObject({ revision: 2, diff: { unassign: target }, snapshot: restorable('visual_assets', asset) });
    });

    it('replace records restorable revisions on the replacement and on the replaced asset', async () => {
      const [asset] = h.db.seed('visual_assets', [visualRow({ focal_point: { x: 0.3, y: 0.6 } })]) as [DbRow];
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480"/></svg>';
      const storageKey = `uploads/${crypto.randomUUID()}.svg`;
      h.bucket!.putText(storageKey, svg, 'image/svg+xml');
      const [upload] = h.db.seed('uploads', [{ user_id: EDITOR, storage_key: storageKey, declared_mime_type: 'image/svg+xml', declared_byte_length: svg.length, status: 'verified', verified_checksum_sha256: 'd'.repeat(64), draft_asset_id: null }]) as [DbRow];
      withVisualColumnDefaults(h);
      const res = await h.call(`/v1/admin/visual-assets/${String(asset.id)}/replace`, { token: editor, body: { uploadId: upload.id, expectedRevision: 0, keepFocalPoint: true, idempotencyKey: 'replace-key-0001' } });
      expect(res.status, JSON.stringify(res.json)).toBe(201);
      const replacement = h.db.rows('visual_assets').find((r) => r.id === res.json.data.asset.id)!;
      expect(replacement).toMatchObject({ focal_point: { x: 0.3, y: 0.6 }, review_status: 'draft', dimensions: { width: 640, height: 480 } });
      expect(latestRevision(h, 'visual_assets', replacement.id)).toMatchObject({ revision: 1, diff: { create: true, replaces: asset.id }, snapshot: restorable('visual_assets', replacement) });
      expect(asset.replaced_by_asset_id).toBe(replacement.id);
      expect(latestRevision(h, 'visual_assets', asset.id)).toMatchObject({ revision: 1, diff: { replacedBy: replacement.id }, snapshot: restorable('visual_assets', asset) });
    });
  });

  // --- 2. asset suggestions -----------------------------------------------------------------------------------------
  describe('asset suggestions', () => {
    it('an approved suggestion writes a restorable lesson revision, and rollback undoes it', async () => {
      const [lesson] = h.db.seed('audio_lessons', [audioLessonRow({ state: 'review_needed', level: null, tags: ['keep'] })]) as [DbRow];
      expect((await h.call(`/v1/admin/audio/lessons/${String(lesson.id)}`, { method: 'PATCH', token: editor, body: { expectedRevision: 0, topic: 'market' } })).json.data.revision).toBe(1);
      const [suggestion] = h.db.seed('asset_suggestions', [suggestionRow(lesson.id as string)]) as [DbRow];
      const decided = await h.call(`/v1/admin/asset-suggestions/${String(suggestion.id)}/decide`, { token: editor, body: { decision: 'approve', expectedRevision: 1, idempotencyKey: 'decide-key-0001' } });
      expect(decided.status, JSON.stringify(decided.json)).toBe(200);
      expect(decided.json.data).toMatchObject({ applied: true, revision: { entityTable: 'audio_lessons', entityId: lesson.id, revision: 2 } });
      expect(lesson).toMatchObject({ level: 'beginner', topic: 'market' });
      expect(latestRevision(h, 'audio_lessons', lesson.id)).toMatchObject({ revision: 2, diff: { suggestionApplied: suggestion.id, kind: 'level' }, note: `asset suggestion ${String(suggestion.id)}`, snapshot: restorable('audio_lessons', lesson) });

      const undone = await rollback(lesson.id, 'audio_lessons', 1);
      expect(undone.status, JSON.stringify(undone.json)).toBe(200);
      expect(lesson).toMatchObject({ level: null, topic: 'market', state: 'review_needed' });
      expect((await rollback(lesson.id, 'audio_lessons', 2)).status).toBe(200);
      expect(lesson.level).toBe('beginner');
    });

    it('a lesson written after the suggestion read it is re-read: the suggestion lands on the current row, never over it', async () => {
      const [lesson] = h.db.seed('audio_lessons', [audioLessonRow({ state: 'metadata_needed', tags: ['keep'] })]) as [DbRow];
      const [suggestion] = h.db.seed('asset_suggestions', [suggestionRow(lesson.id as string, { kind: 'tags', suggestion: { tags: ['souk'] } })]) as [DbRow];
      interleaveBefore(h, (method, target) => method === 'PATCH' && target === 'audio_lessons', () => {
        Object.assign(lesson, { tags: ['keep', 'editor-tag'], updated_at: FOREIGN_WRITE_AT });
      });
      const decided = await h.call(`/v1/admin/asset-suggestions/${String(suggestion.id)}/decide`, { token: editor, body: { decision: 'approve', idempotencyKey: 'decide-key-0002' } });
      expect(decided.status, JSON.stringify(decided.json)).toBe(200);
      expect(decided.json.data.applied).toBe(true);
      expect(lesson.tags).toEqual(['keep', 'editor-tag', 'souk']);
      expect(h.db.writes('audio_lessons')).toHaveLength(2); // the refused conditional write, then the re-applied one
      expect(latestRevision(h, 'audio_lessons', lesson.id)).toMatchObject({ revision: 1, diff: { patch: { tags: ['keep', 'editor-tag', 'souk'] } }, snapshot: restorable('audio_lessons', lesson) });
    });

    it('with expectedRevision, a lesson written after the check is a 412: no re-read, nothing decided, no override stored', async () => {
      const [lesson] = h.db.seed('audio_lessons', [audioLessonRow({ state: 'metadata_needed', tags: ['keep'] })]) as [DbRow];
      expect((await h.call(`/v1/admin/audio/lessons/${String(lesson.id)}`, { method: 'PATCH', token: editor, body: { expectedRevision: 0, topic: 'market' } })).json.data.revision).toBe(1);
      const [suggestion] = h.db.seed('asset_suggestions', [suggestionRow(lesson.id as string, { kind: 'tags', suggestion: { tags: ['souk'] } })]) as [DbRow];
      interleaveBefore(h, (method, target) => method === 'PATCH' && target === 'audio_lessons', () => {
        Object.assign(lesson, { tags: ['keep', 'editor-tag'], updated_at: FOREIGN_WRITE_AT });
      });
      const body = { decision: 'approve', expectedRevision: 1, overrideSuggestion: { tags: ['souk', 'cafe'] }, idempotencyKey: 'decide-key-0003' };
      const refused = await h.call(`/v1/admin/asset-suggestions/${String(suggestion.id)}/decide`, { token: editor, body });
      expect(refused.status, JSON.stringify(refused.json)).toBe(412);
      // Revision 2 was claimed for the apply, then voided by revision 3 when the conditional write found a changed row.
      expect(refused.json.error).toMatchObject({ code: 'precondition_failed', details: { currentRevision: 3 } });
      expect(lesson.tags).toEqual(['keep', 'editor-tag']);
      expect(h.db.writes('audio_lessons')).toHaveLength(2); // the setup PATCH, then the one refused conditional write
      expect(h.db.writes('asset_suggestions')).toHaveLength(0);
      expect(suggestion).toMatchObject({ review_status: 'review_needed', suggestion: { tags: ['souk'] } });
      expect(latestRevision(h, 'audio_lessons', lesson.id)).toMatchObject({ revision: 3, diff: { voidsRevision: 2 }, snapshot: restorable('audio_lessons', lesson) });

      const retried = await h.call(`/v1/admin/asset-suggestions/${String(suggestion.id)}/decide`, { token: editor, body: { ...body, expectedRevision: 3, idempotencyKey: 'decide-key-0004' } });
      expect(retried.status, JSON.stringify(retried.json)).toBe(200);
      expect(retried.json.data).toMatchObject({ applied: true, revision: { entityTable: 'audio_lessons', entityId: lesson.id, revision: 4 } });
      expect(lesson.tags).toEqual(['keep', 'editor-tag', 'souk', 'cafe']);
      expect(suggestion).toMatchObject({ review_status: 'approved', suggestion: { tags: ['souk', 'cafe'] } });
      expect(latestRevision(h, 'audio_lessons', lesson.id)).toMatchObject({ revision: 4, diff: { suggestionApplied: suggestion.id }, snapshot: restorable('audio_lessons', lesson) });
    });

    it('with expectedRevision, a revision another editor recorded after the check is a 412 and the lesson is not written', async () => {
      const [lesson] = h.db.seed('audio_lessons', [audioLessonRow({ state: 'metadata_needed', level: null })]) as [DbRow];
      const [suggestion] = h.db.seed('asset_suggestions', [suggestionRow(lesson.id as string)]) as [DbRow];
      interleaveBefore(h, (method, target) => method === 'POST' && target === 'content_revisions', () => {
        h.db.rows('content_revisions').push({ id: crypto.randomUUID(), entity_table: 'audio_lessons', entity_id: lesson.id, revision: 1, diff: { by: 'another editor' }, snapshot: null, editor_id: EDITOR2, note: null, created_at: NOW() });
      });
      const res = await h.call(`/v1/admin/asset-suggestions/${String(suggestion.id)}/decide`, { token: editor, body: { decision: 'approve', expectedRevision: 0, idempotencyKey: 'decide-key-0005' } });
      expect(res.status, JSON.stringify(res.json)).toBe(412);
      expect(res.json.error.details).toEqual({ currentRevision: 1 });
      expect(lesson.level).toBeNull();
      expect(h.db.writes('audio_lessons')).toHaveLength(0);
      expect(suggestion.review_status).toBe('review_needed');
    });

    it('bulk approval applies each suggestion with its own restorable revision', async () => {
      const [lesson] = h.db.seed('audio_lessons', [audioLessonRow({ state: 'metadata_needed', tags: [] })]) as [DbRow];
      const rows = h.db.seed('asset_suggestions', [suggestionRow(lesson.id as string), suggestionRow(lesson.id as string, { kind: 'topics', suggestion: { topics: ['cafe', 'ordering'] } })]);
      const res = await h.call('/v1/admin/asset-suggestions/bulk-decide', { token: editor, body: { suggestionIds: rows.map((r) => r.id), decision: 'approve', idempotencyKey: 'bulk-decide-0001' } });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      expect(res.json.data.revisions.map((r: DbRow) => r.revision)).toEqual([1, 2]);
      expect(lesson).toMatchObject({ level: 'beginner', topic: 'cafe', tags: ['ordering'] });
      const revs = revisionsOf(h, 'audio_lessons', lesson.id);
      expect(revs[0]!.snapshot).toMatchObject({ level: 'beginner', topic: null });
      expect(revs[1]!.snapshot).toEqual(restorable('audio_lessons', lesson));
      expect((await rollback(lesson.id, 'audio_lessons', 1)).status).toBe(200);
      expect(lesson).toMatchObject({ level: 'beginner', topic: null, tags: [] });
    });
  });

  // --- 3. content rights --------------------------------------------------------------------------------------------
  describe('content rights', () => {
    it('are intentionally not restorable: revisions carry no snapshot and a rollback is refused with nothing written', async () => {
      const [rights] = h.db.seed('content_rights', [rightsRow({ verified: false, reviewer_id: null, reviewed_at: null })]) as [DbRow];
      const patch = (body: DbRow) => h.call(`/v1/admin/content-rights/${String(rights.id)}`, { method: 'PATCH', token: editor, body });
      const first = await patch({ expectedRevision: 0, attributionText: 'Recorded for LangQuest, Casablanca 2026' });
      expect(first.status, JSON.stringify(first.json)).toBe(200);
      expect(first.json.data.revision).toBe(1);
      expect((await patch({ expectedRevision: 0, attributionText: 'stale' })).status).toBe(412);
      expect(revisionsOf(h, 'content_rights', rights.id)).toEqual([expect.objectContaining({ revision: 1, snapshot: null, diff: { attributionText: 'Recorded for LangQuest, Casablanca 2026' } })]);

      const before = { ...rights };
      const revisionsBefore = h.db.rows('content_revisions').length;
      const refused = await rollback(rights.id, 'content_rights', 1);
      expect(refused.status).toBe(422);
      expect(refused.json.error.code).toBe('validation_failed');
      expect(JSON.stringify(refused.json.error.details)).toContain('entityTable');
      expect(h.db.rows('content_revisions')).toHaveLength(revisionsBefore);
      expect(rights).toEqual(before);
      expect(h.db.writes('content_rights')).toHaveLength(1); // the PATCH only
    });

    it('a revocation records restorable revisions for the content it unpublished; restoring one never republishes it', async () => {
      const [rights] = h.db.seed('content_rights', [rightsRow()]) as [DbRow];
      const [lesson] = h.db.seed('audio_lessons', [audioLessonRow({ state: 'published', content_rights_id: rights.id, title_translations: { en: 'Greetings' }, published_revision: 1 })]) as [DbRow];
      h.db.seed('content_revisions', [{ entity_table: 'audio_lessons', entity_id: lesson.id, revision: 1, diff: { publish: true }, snapshot: restorable('audio_lessons', lesson), editor_id: EDITOR, note: null }]);
      lesson.title_translations = { en: 'Renamed outside the ledger' };
      h.db.rpcs.revoke_content_rights = (args, { db }) => {
        const grant = db.rows('content_rights').find((r) => r.id === args.p_rights_id)!;
        if (grant.revoked_at) return [];
        grant.revoked_at = NOW();
        const hits = db.rows('audio_lessons').filter((l) => l.content_rights_id === grant.id && l.state === 'published');
        for (const l of hits) l.state = 'unpublished';
        return hits.map((l) => ({ entity_table: 'audio_lessons', entity_id: l.id, previous_state: 'published', new_state: 'unpublished' }));
      };
      const res = await h.call(`/v1/admin/content-rights/${String(rights.id)}/revoke`, { token: editor, body: { reason: 'rights_revoked', note: 'licence withdrawn', idempotencyKey: 'revoke-key-0001' } });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      expect(res.json.data.affected).toEqual([{ entityTable: 'audio_lessons', entityId: lesson.id, previousState: 'published', newState: 'unpublished' }]);
      expect(latestRevision(h, 'audio_lessons', lesson.id)).toMatchObject({ revision: 2, diff: { rightsRevoked: rights.id, from: 'published', to: 'unpublished' }, note: 'licence withdrawn', snapshot: restorable('audio_lessons', lesson) });
      expect(latestRevision(h, 'content_rights', rights.id)).toMatchObject({ diff: { revoke: true, affected: 1 }, snapshot: null });

      const restored = await rollback(lesson.id, 'audio_lessons', 1);
      expect(restored.status, JSON.stringify(restored.json)).toBe(200);
      expect(lesson).toMatchObject({ title_translations: { en: 'Greetings' }, state: 'unpublished' });
    });
  });

  // --- 4. the review-flag publish gate --------------------------------------------------------------------------------
  describe('publish gate: diversity_needs_regeneration', () => {
    const publish = (id: unknown, body: DbRow, token = editor) => h.call(`/v1/admin/content/${String(id)}/publish`, { token, body });
    const REASON = 'Native reviewer confirmed the variety of this set by hand';

    it('refuses a mission the diversity gate marked: 412 with the flag and the reasons, nothing written', async () => {
      const [mission] = h.db.seed('missions', [missionRow()]) as [DbRow];
      const res = await publish(mission.id, { entityTable: 'missions', expectedRevision: 0 });
      expect(res.status, JSON.stringify(res.json)).toBe(412);
      expect(res.json.error.code).toBe('precondition_failed');
      expect(res.json.error.message).toMatch(/"diversity_needs_regeneration" by the content factory's diversity gate \(low_alternative_coverage:0, quiz_shaped_dialogues:1\)\. Regenerate it, or override/);
      expect(res.json.error.details).toEqual({ reviewFlags: [DIVERSITY_REVIEW_FLAG], reasons: ['low_alternative_coverage:0', 'quiz_shaped_dialogues:1'], override: { flagsField: 'overrideReviewFlags', reasonField: 'overrideReason' } });
      expect(mission.state).toBe('approved');
      expect(revisionsOf(h, 'missions', mission.id)).toHaveLength(0);
      expect(h.db.rows('publication_events')).toHaveLength(0);
      await h.flush();
      expect(auditsOf(h, 'content.publish_blocked', mission.id)).toEqual([expect.objectContaining({ after: { blockedBy: [DIVERSITY_REVIEW_FLAG], reviewFlags: [DIVERSITY_REVIEW_FLAG] } })]);
    });

    it('refuses an expression flagged by the jobs gate or by the scripts --apply curation flags the same way', async () => {
      const [rights] = h.db.seed('content_rights', [rightsRow()]) as [DbRow];
      const [fromJobs, fromScripts] = h.db.seed('expressions', [
        expressionRow(rights.id as string),
        expressionRow(rights.id as string, { script_annotations: { provenance: { draftId: 'factory:x:m:e' }, curation: { intentConfidence: 1, alternativeIntentKeys: [], flags: ['character_line', DIVERSITY_REVIEW_FLAG], varietyAssignment: 'corpus' }, audioRefs: [] } }),
      ]) as [DbRow, DbRow];
      for (const row of [fromJobs, fromScripts]) {
        const res = await publish(row.id, { entityTable: 'expressions', expectedRevision: 0 });
        expect(res.status, JSON.stringify(res.json)).toBe(412);
        expect(res.json.error.details.reviewFlags).toEqual([DIVERSITY_REVIEW_FLAG]);
        expect(row.state).toBe('approved');
      }
      expect(h.db.writes('expressions')).toHaveLength(0);
    });

    it('a regenerated draft that passed the gate carries no flag and goes on to the rest of the checklist', async () => {
      const [rights] = h.db.seed('content_rights', [rightsRow()]) as [DbRow];
      const [mission] = h.db.seed('missions', [missionRow({ scoring_rubric: flaggedRubric({ diversity: { verdict: 'diverse', score: 0.8, reasons: [], batch: null, regenerated: true }, reviewFlags: [] }) })]) as [DbRow];
      const missionRes = await publish(mission.id, { entityTable: 'missions', expectedRevision: 0 });
      expect(missionRes.status, JSON.stringify(missionRes.json)).toBe(200);
      // Past the flag gate: the §7.6 checklist decides (missions have no native-review record yet, so it blocks).
      expect(missionRes.json.data.blockedBy).toEqual(expect.arrayContaining(['native_review_missing']));
      expect(missionRes.json.data.blockedBy).not.toContain(DIVERSITY_REVIEW_FLAG);
      const [expression] = h.db.seed('expressions', [expressionRow(rights.id as string, { script_annotations: { variants: [], provenance: {}, reviewFlags: [] } })]) as [DbRow];
      const expressionRes = await publish(expression.id, { entityTable: 'expressions', expectedRevision: 0 });
      expect(expressionRes.status, JSON.stringify(expressionRes.json)).toBe(200);
      expect(expressionRes.json.data).toMatchObject({ state: 'published', revision: 1, blockedBy: [] });
      expect(latestRevision(h, 'expressions', expression.id).diff).toEqual({ publish: true, note: null });
    });

    it('an override names the flag and gives a reason (422 otherwise); nothing is written by a refused request', async () => {
      const [rights] = h.db.seed('content_rights', [rightsRow()]) as [DbRow];
      const [expression] = h.db.seed('expressions', [expressionRow(rights.id as string)]) as [DbRow];
      for (const extra of [{ overrideReviewFlags: [DIVERSITY_REVIEW_FLAG] }, { overrideReason: REASON }, { overrideReviewFlags: ['any_flag'], overrideReason: REASON }, { overrideReviewFlags: [DIVERSITY_REVIEW_FLAG], overrideReason: 'too short' }, { overrideReviewFlags: [], overrideReason: REASON }]) {
        const res = await publish(expression.id, { entityTable: 'expressions', expectedRevision: 0, ...extra });
        expect(res.status, JSON.stringify(extra)).toBe(422);
        expect(res.json.error.code).toBe('validation_failed');
      }
      expect(expression.state).toBe('approved');
      expect(h.db.writes('expressions')).toHaveLength(0);
      expect(revisionsOf(h, 'expressions', expression.id)).toHaveLength(0);
    });

    it('an editor override publishes, clears the flag on the row and records who and why; a later publish needs no override', async () => {
      const [rights] = h.db.seed('content_rights', [rightsRow()]) as [DbRow];
      const [expression] = h.db.seed('expressions', [
        expressionRow(rights.id as string, { script_annotations: { variants: ['عطيني قهوة'], provenance: { generator: 'content_factory:v2' }, reviewFlags: [DIVERSITY_REVIEW_FLAG], curation: { flags: ['character_line', DIVERSITY_REVIEW_FLAG] } } }),
      ]) as [DbRow];
      const res = await publish(expression.id, { entityTable: 'expressions', expectedRevision: 0, note: 'chapter 1 launch', overrideReviewFlags: [DIVERSITY_REVIEW_FLAG], overrideReason: REASON });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      expect(res.json.data).toMatchObject({ state: 'published', revision: 1, blockedBy: [] });
      expect(expression.state).toBe('published');
      expect(expression.script_annotations).toEqual({
        variants: ['عطيني قهوة'],
        provenance: { generator: 'content_factory:v2' },
        reviewFlags: [],
        curation: { flags: ['character_line'] },
        reviewFlagOverrides: [{ flag: DIVERSITY_REVIEW_FLAG, overriddenBy: EDITOR, overriddenAt: expect.any(String), reason: REASON, revision: 1 }],
      });
      expect(latestRevision(h, 'expressions', expression.id)).toMatchObject({ revision: 1, diff: { publish: true, note: 'chapter 1 launch', reviewFlagOverride: { flags: [DIVERSITY_REVIEW_FLAG], reason: REASON } } });
      expect(h.db.rows('publication_events').find((e) => e.entity_id === expression.id)).toMatchObject({ from_state: 'approved', to_state: 'published', revision: 1, actor_id: EDITOR, reason: `chapter 1 launch · review flag override (${DIVERSITY_REVIEW_FLAG}): ${REASON}` });
      await h.flush();
      expect(auditsOf(h, 'content.review_flag_override', expression.id)).toEqual([expect.objectContaining({ before: { reviewFlags: [DIVERSITY_REVIEW_FLAG] }, after: { overridden: [DIVERSITY_REVIEW_FLAG], reason: REASON, revision: 1 } })]);
      expect(auditsOf(h, 'content.publish', expression.id)[0]!.after).toMatchObject({ state: 'published', reviewFlagsOverridden: [DIVERSITY_REVIEW_FLAG] });

      // The flag is cleared: unpublished for an edit and published again, the expression needs no second override.
      const down = await h.call(`/v1/admin/content/${String(expression.id)}/unpublish`, { token: editor, body: { entityTable: 'expressions', reason: 'editorial' } });
      expect(down.status, JSON.stringify(down.json)).toBe(200);
      expect(expression.state).toBe('unpublished');
      const again = await publish(expression.id, { entityTable: 'expressions', expectedRevision: 2 });
      expect(again.status, JSON.stringify(again.json)).toBe(200);
      expect(again.json.data).toMatchObject({ state: 'published', revision: 3 });
    });

    it('with an override, a mission still faces the rest of the checklist: blocked, and its flag is kept', async () => {
      const [mission] = h.db.seed('missions', [missionRow()]) as [DbRow];
      const res = await publish(mission.id, { entityTable: 'missions', expectedRevision: 0, overrideReviewFlags: [DIVERSITY_REVIEW_FLAG], overrideReason: REASON });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      expect(res.json.data).toMatchObject({ state: 'approved', revision: 0, manifestInvalidated: false });
      expect(res.json.data.blockedBy).toEqual(expect.arrayContaining(['native_review_missing', 'rights_missing']));
      expect(mission.state).toBe('approved');
      expect((mission.scoring_rubric as DbRow).reviewFlags).toEqual([DIVERSITY_REVIEW_FLAG]);
      expect((mission.scoring_rubric as DbRow).reviewFlagOverrides).toBeUndefined();
      expect(revisionsOf(h, 'missions', mission.id)).toHaveLength(0);
      await h.flush();
      expect(auditsOf(h, 'content.review_flag_override', mission.id)).toHaveLength(0);
    });

    it('content that carries no review flags (an audio collection) is unaffected, and override fields change nothing there', async () => {
      const [rights] = h.db.seed('content_rights', [rightsRow()]) as [DbRow];
      const [collection] = h.db.seed('audio_course_collections', [collectionRow({ state: 'approved', content_rights_id: rights.id })]) as [DbRow];
      const res = await publish(collection.id, { entityTable: 'audio_course_collections', expectedRevision: 0, overrideReviewFlags: [DIVERSITY_REVIEW_FLAG], overrideReason: REASON });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      expect(res.json.data).toMatchObject({ state: 'published', revision: 1, blockedBy: [] });
      expect(latestRevision(h, 'audio_course_collections', collection.id).diff).toEqual({ publish: true, note: null });
      expect(h.db.rows('publication_events').find((e) => e.entity_id === collection.id)!.reason).toBeNull();
      await h.flush();
      expect(auditsOf(h, 'content.review_flag_override')).toHaveLength(0);
    });
  });
});
