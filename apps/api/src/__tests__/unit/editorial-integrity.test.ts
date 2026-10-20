/**
 * Editorial integrity of the admin edit routes, through the REAL app against the offline PostgREST double
 * (`route-fixtures`: unique keys on `content_revisions`, `updated_at` bumped on every PATCH; no network):
 *
 * 1. One takedown (§7.6): unpublishing through `POST /v1/admin/assets/bulk-label` or `PATCH /v1/admin/audio/lessons/:id`
 *    has exactly the effects of `POST /v1/admin/content/:id/unpublish` — state, revoked offline packs, publication
 *    event, revision with snapshot, edge-cache invalidation of the collection manifest, `content.unpublish` audit row.
 *    A field edit sent with the unpublish is one revision and one conditional row write with it (both land or neither),
 *    and a `chapterId` move to another collection invalidates the manifest the lesson left as well as the new one.
 *    The audio of a published lesson cannot be moved off it by attaching it elsewhere (409, like the detach).
 * 2. The `expectedRevision` guard is atomic: deterministic interleavings injected between the guard's read and its
 *    write (a second editor's full save, a writer outside the revision ledger) end in 412 with the current revision —
 *    never a lost update — for the lesson, collection and chapter PATCH routes.
 * 3. Every revision the edit routes write carries the restorable snapshot of its row, and
 *    `POST /v1/admin/content/:id/rollback` restores edits made through the API (R-7.3-04).
 * 4. Quality review: a language reviewer decides a lesson in review (state + `quality_review_status` in one write)
 *    through `adminContentDecision`, while the lesson PATCH stays editor-only; a decision on content that moved
 *    meanwhile (a concurrent publish) is a 412, never a write over live content.
 */
import { ROLLBACK_RESTORABLE_COLUMNS, type RollbackEntityTable } from '@langquest/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioLessonRow, mediaAssetRow, routeHarness, type DbRow, type RouteHarness } from './route-fixtures';

const EDITOR = '33333333-3333-4333-8333-333333333333';
const REVIEWER = '55555555-5555-4555-8555-555555555555';
const ADMIN = '66666666-6666-4666-8666-666666666666';
const LEARNER = '11111111-1111-4111-8111-111111111111';
const LEARNER2 = '22222222-2222-4222-8222-222222222222';
const ROLES = { [EDITOR]: ['content_editor' as const], [REVIEWER]: ['language_reviewer' as const], [ADMIN]: ['admin' as const] };
const KEY = 'integrity-key-0001';
/** A row version no request can produce (the double stamps `updated_at` with the current time). */
const FOREIGN_WRITE_AT = '2031-01-01T00:00:00.000Z';

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
const chapterRow = (collectionId: string, over: DbRow = {}): DbRow => ({ id: crypto.randomUUID(), collection_id: collectionId, title_translations: { en: 'Greetings' }, summary_translations: {}, sort_order: 0, cover_visual_asset_id: null, state: 'imported_draft', ...over });

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

/** Serve `interleave` once, right after the first database request matching `when` and before the route goes on. */
function interleaveAfter(h: RouteHarness, when: (method: string, target: string) => boolean, interleave: () => Promise<void> | void): void {
  const serve = h.db.handle.bind(h.db);
  let fired = false;
  h.db.handle = async (request: Request) => {
    const target = new URL(request.url).pathname.replace(/^\/rest\/v1\//, '');
    const response = await serve(request);
    if (!fired && when(request.method.toUpperCase(), target)) {
      fired = true;
      await interleave();
    }
    return response;
  };
}

/**
 * Two database behaviours the create routes rely on and the double does not emulate: jsonb containment (`diff=cs.{…}`,
 * the idempotent-create lookup) and the column defaults of `audio_lessons` (the double stores only what is sent).
 */
function emulateCreateSupport(h: RouteHarness): void {
  const serve = h.db.handle.bind(h.db);
  const { id: _id, ...lessonDefaults } = audioLessonRow();
  h.db.handle = async (request: Request) => {
    const url = new URL(request.url);
    const target = url.pathname.replace(/^\/rest\/v1\//, '');
    const contains = url.searchParams.get('diff');
    if (request.method === 'GET' && target === 'content_revisions' && contains?.startsWith('cs.')) {
      const wanted = JSON.parse(contains.slice(3)) as DbRow;
      const editorId = url.searchParams.get('editor_id')?.replace(/^eq\./, '');
      const rows = h.db.rows('content_revisions').filter((r) => r.editor_id === editorId && r.revision === 1 && Object.entries(wanted).every(([k, v]) => (r.diff as DbRow)[k] === v));
      return new Response(JSON.stringify(rows.map((r) => ({ entity_id: r.entity_id }))), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (request.method === 'POST' && target === 'audio_lessons') {
      const body = JSON.parse(await request.text()) as DbRow | DbRow[];
      const withDefaults = Array.isArray(body) ? body.map((r) => ({ ...lessonDefaults, ...r })) : { ...lessonDefaults, ...body };
      return serve(new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(withDefaults) }));
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

describe('editorial integrity', () => {
  let h: RouteHarness;
  let editor: string;
  beforeEach(async () => {
    h = routeHarness({ roles: ROLES });
    editor = await h.token(EDITOR);
  });
  afterEach(() => h.restore());

  /** A published lesson in a published chapter / collection with a master asset and two learners' offline packs. */
  function seedPublishedLesson(over: DbRow = {}) {
    const [collection] = h.db.seed('audio_course_collections', [collectionRow({ state: 'published', published_version: 3 })]) as [DbRow];
    const [chapter] = h.db.seed('audio_chapters', [chapterRow(collection.id as string, { state: 'published' })]) as [DbRow];
    const [lesson] = h.db.seed('audio_lessons', [audioLessonRow({ chapter_id: chapter.id, state: 'published', visibility: 'authenticated', published_revision: 1, quality_review_status: 'approved', ...over })]) as [DbRow];
    const [asset] = h.db.seed('media_assets', [mediaAssetRow({ state: 'published' })]) as [DbRow];
    h.db.seed('audio_lesson_assets', [{ lesson_id: lesson.id, asset_id: asset.id, asset_type: 'master', sort_order: 0, audio_lessons: { id: lesson.id, title_translations: lesson.title_translations, chapter_id: chapter.id, target_variety_id: lesson.target_variety_id, instruction_language_code: lesson.instruction_language_code, transcript_status: 'none', audio_chapters: { collection_id: collection.id } } }]);
    h.db.seed('user_download_manifests', [{ user_id: LEARNER, lesson_id: lesson.id, revoked_at: null }, { user_id: LEARNER2, lesson_id: lesson.id, revoked_at: null }]);
    h.db.seed('content_revisions', [{ entity_table: 'audio_lessons', entity_id: lesson.id, revision: 1, diff: { publish: true }, snapshot: null, editor_id: EDITOR, note: null }]);
    return { collection, chapter, lesson, asset };
  }

  describe('one takedown for every route that unpublishes', () => {
    const paths = {
      'POST /v1/admin/content/:id/unpublish': (lessonId: string, token: string) => h.call(`/v1/admin/content/${lessonId}/unpublish`, { token, body: { entityTable: 'audio_lessons', reason: 'editorial' } }),
      'POST /v1/admin/assets/bulk-label': (lessonId: string, token: string) => h.call('/v1/admin/assets/bulk-label', { token, body: { lessonIds: [lessonId], patch: { state: 'unpublished' }, idempotencyKey: KEY } }),
      'PATCH /v1/admin/audio/lessons/:id': (lessonId: string, token: string) => h.call(`/v1/admin/audio/lessons/${lessonId}`, { method: 'PATCH', token, body: { state: 'unpublished', expectedRevision: 1 } }),
    } as const;

    it.each(Object.keys(paths) as (keyof typeof paths)[])('%s runs the same takedown', async (route) => {
      const { collection, lesson, asset } = seedPublishedLesson();
      const invalidated = vi.spyOn(h.ctx.shared.cache, 'invalidateAudioCollection');
      const res = await paths[route](lesson.id as string, editor);
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      await h.flush();
      const last = latestRevision(h, 'audio_lessons', lesson.id);
      expect({
        state: lesson.state,
        packsRevoked: h.db.rows('user_download_manifests').map((p) => p.revoked_at !== null),
        publicationEvents: h.db.rows('publication_events').filter((e) => e.entity_id === lesson.id).map((e) => [e.from_state, e.to_state, e.revision]),
        invalidatedCollections: invalidated.mock.calls.map((call) => call[0]),
        revisions: revisionsOf(h, 'audio_lessons', lesson.id).length,
        lastRevision: { unpublish: (last.diff as DbRow).unpublish, reason: (last.diff as DbRow).reason, snapshot: last.snapshot },
        audit: h.db.rows('audit_logs').filter((a) => a.action === 'content.unpublish' && a.entity_id === lesson.id).length,
        // `editorial` is not rights-driven: media playback stays, offline packs go.
        assetDisposition: asset.disposition,
      }).toEqual({
        state: 'unpublished',
        packsRevoked: [true, true],
        publicationEvents: [['published', 'unpublished', 2]],
        invalidatedCollections: [collection.id],
        revisions: 2,
        lastRevision: { unpublish: true, reason: 'editorial', snapshot: restorable('audio_lessons', lesson) },
        audit: 1,
        assetDisposition: 'active',
      });
      // Each route names itself in the audit trail; the dedicated route stays the reference shape.
      const audit = h.db.rows('audit_logs').find((a) => a.action === 'content.unpublish')!;
      expect((audit.after as DbRow).via).toBe(route.startsWith('POST /v1/admin/content') ? 'unpublish' : route.includes('bulk-label') ? 'bulk_label' : 'lesson_patch');
    });

    it('bulk-label by asset: the published asset is recorded as unpublished and its lesson is taken down', async () => {
      const { lesson, asset } = seedPublishedLesson();
      const res = await h.call('/v1/admin/assets/bulk-label', { token: editor, body: { assetIds: [asset.id], patch: { state: 'unpublished' }, idempotencyKey: KEY } });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      expect(res.json.data).toMatchObject({ affected: 2, revisionIds: [lesson.id], revisions: [{ entityTable: 'audio_lessons', entityId: lesson.id, revision: 2 }], skipped: [] });
      expect(asset.state).toBe('unpublished');
      expect(lesson.state).toBe('unpublished');
      expect(h.db.rows('publication_events').map((e) => [e.entity_table, e.from_state, e.to_state])).toEqual([
        ['media_assets', 'published', 'unpublished'],
        ['audio_lessons', 'published', 'unpublished'],
      ]);
      expect(h.db.rows('user_download_manifests').every((p) => p.revoked_at !== null)).toBe(true);
    });

    it('a lesson PATCH that edits and unpublishes is ONE revision and ONE conditional row write (edit + state)', async () => {
      const { lesson } = seedPublishedLesson();
      const res = await h.call(`/v1/admin/audio/lessons/${lesson.id}`, { method: 'PATCH', token: editor, body: { expectedRevision: 1, topic: 'withdrawn', state: 'unpublished' } });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      expect(res.json.data).toEqual({ lessonId: lesson.id, revision: 2, state: 'unpublished' });
      expect(lesson).toMatchObject({ topic: 'withdrawn', state: 'unpublished' });
      expect(revisionsOf(h, 'audio_lessons', lesson.id).map((r) => [r.revision, (r.diff as DbRow).unpublish ?? false, (r.diff as DbRow).topic ?? null, (r.snapshot as DbRow | null)?.topic ?? null])).toEqual([
        [1, false, null, null],
        [2, true, 'withdrawn', 'withdrawn'],
      ]);
      expect(h.db.writes('audio_lessons')).toHaveLength(1);
      expect(h.db.rows('publication_events').map((e) => [e.from_state, e.to_state, e.revision])).toEqual([['published', 'unpublished', 2]]);
      expect(h.db.rows('user_download_manifests').every((p) => p.revoked_at !== null)).toBe(true);
    });

    it('a revision that lands right after the row write cannot split edit + unpublish: both are already applied, 200', async () => {
      const { lesson } = seedPublishedLesson();
      // Formerly the edit and the takedown were two claims: a writer here made the takedown 412 after the edit was
      // applied, leaving the edited lesson live with its offline packs.
      interleaveAfter(h, (method, target) => method === 'PATCH' && target === 'audio_lessons', () => {
        h.db.seed('content_revisions', [{ entity_table: 'audio_lessons', entity_id: lesson.id, revision: 3, diff: { other: true }, snapshot: null, editor_id: ADMIN, note: null }]);
      });
      const res = await h.call(`/v1/admin/audio/lessons/${String(lesson.id)}`, { method: 'PATCH', token: editor, body: { expectedRevision: 1, topic: 'withdrawn', state: 'unpublished' } });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      expect(res.json.data).toEqual({ lessonId: lesson.id, revision: 2, state: 'unpublished' });
      expect(lesson).toMatchObject({ topic: 'withdrawn', state: 'unpublished' });
      expect(h.db.rows('user_download_manifests').every((p) => p.revoked_at !== null)).toBe(true);
      expect(h.db.rows('publication_events').map((e) => [e.from_state, e.to_state, e.revision])).toEqual([['published', 'unpublished', 2]]);
    });

    it('edit + unpublish under a lost revision race is a 412 with NOTHING applied: no edit, still published, packs intact', async () => {
      const { lesson } = seedPublishedLesson();
      const admin = await h.token(ADMIN);
      // Another editor's whole save lands between this request's guard check and its revision claim.
      interleaveBefore(h, (method, target) => method === 'POST' && target === 'content_revisions', async () => {
        expect((await h.call(`/v1/admin/audio/lessons/${String(lesson.id)}`, { method: 'PATCH', token: admin, body: { expectedRevision: 1, scene: 'souk' } })).status).toBe(200);
      });
      const res = await h.call(`/v1/admin/audio/lessons/${String(lesson.id)}`, { method: 'PATCH', token: editor, body: { expectedRevision: 1, topic: 'withdrawn', state: 'unpublished' } });
      expect(res.status, JSON.stringify(res.json)).toBe(412);
      expect(res.json.error.details).toEqual({ currentRevision: 2 });
      expect(lesson).toMatchObject({ topic: null, scene: 'souk', state: 'published' });
      expect(h.db.rows('user_download_manifests').every((p) => p.revoked_at === null)).toBe(true);
      expect(h.db.rows('publication_events')).toHaveLength(0);
      expect(revisionsOf(h, 'audio_lessons', lesson.id).map((r) => [r.revision, r.editor_id])).toEqual([
        [1, EDITOR],
        [2, ADMIN],
      ]);
    });

    it('edit + unpublish over a row changed outside the ledger is a 412 with NOTHING applied, and the claim is voided', async () => {
      const { lesson } = seedPublishedLesson();
      interleaveBefore(h, (method, target) => method === 'PATCH' && target === 'audio_lessons', () => {
        lesson.scene = 'set-by-a-job';
        lesson.updated_at = FOREIGN_WRITE_AT;
      });
      const res = await h.call(`/v1/admin/audio/lessons/${String(lesson.id)}`, { method: 'PATCH', token: editor, body: { expectedRevision: 1, topic: 'withdrawn', state: 'unpublished' } });
      expect(res.status, JSON.stringify(res.json)).toBe(412);
      expect(lesson).toMatchObject({ topic: null, scene: 'set-by-a-job', state: 'published' });
      expect(h.db.rows('user_download_manifests').every((p) => p.revoked_at === null)).toBe(true);
      expect(h.db.rows('publication_events')).toHaveLength(0);
      const [, claimed, voided] = revisionsOf(h, 'audio_lessons', lesson.id);
      expect(claimed).toMatchObject({ revision: 2, diff: { unpublish: true, topic: 'withdrawn' } });
      expect(voided).toMatchObject({ revision: 3, diff: { voidsRevision: 2 } });
      expect(voided!.snapshot).toEqual(restorable('audio_lessons', lesson));
      expect(res.json.error.details).toEqual({ currentRevision: 3 });
    });

    it('bulk labels + unpublish over a lesson changed after it was read: that lesson is skipped with nothing applied', async () => {
      const { lesson } = seedPublishedLesson();
      interleaveBefore(h, (method, target) => method === 'PATCH' && target === 'audio_lessons', () => {
        lesson.scene = 'set-by-a-job';
        lesson.updated_at = FOREIGN_WRITE_AT;
      });
      const res = await h.call('/v1/admin/assets/bulk-label', { token: editor, body: { lessonIds: [lesson.id], patch: { topic: 'withdrawn', state: 'unpublished' }, idempotencyKey: KEY } });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      expect(res.json.data).toMatchObject({ affected: 0, revisions: [], skipped: [{ id: lesson.id, reason: 'lesson changed during the bulk edit; run it again' }] });
      expect(lesson).toMatchObject({ topic: null, scene: 'set-by-a-job', state: 'published' });
      expect(h.db.rows('user_download_manifests').every((p) => p.revoked_at === null)).toBe(true);
      expect(h.db.rows('publication_events')).toHaveLength(0);
      expect(revisionsOf(h, 'audio_lessons', lesson.id).map((r) => r.revision)).toEqual([1]);
    });

    it('a stale unpublish through the lesson PATCH is refused before anything moves', async () => {
      const { lesson } = seedPublishedLesson();
      const res = await h.call(`/v1/admin/audio/lessons/${lesson.id}`, { method: 'PATCH', token: editor, body: { expectedRevision: 0, state: 'unpublished' } });
      expect(res.status).toBe(412);
      expect(res.json.error.details).toEqual({ currentRevision: 1 });
      expect(lesson.state).toBe('published');
      expect(h.db.rows('user_download_manifests').every((p) => p.revoked_at === null)).toBe(true);
      expect(h.db.writes('content_revisions')).toHaveLength(0);
    });

    it('an edit of a published lesson (PATCH or bulk label) keeps it published and refreshes the collection manifest', async () => {
      const { collection, lesson } = seedPublishedLesson();
      const invalidated = vi.spyOn(h.ctx.shared.cache, 'invalidateAudioCollection');
      expect((await h.call(`/v1/admin/audio/lessons/${lesson.id}`, { method: 'PATCH', token: editor, body: { expectedRevision: 1, titleTranslations: { fr: 'Salutations' } } })).status).toBe(200);
      expect((await h.call('/v1/admin/assets/bulk-label', { token: editor, body: { lessonIds: [lesson.id], patch: { addTags: ['souk'] }, idempotencyKey: KEY } })).status).toBe(200);
      await h.flush();
      expect(lesson).toMatchObject({ state: 'published', title_translations: { en: 'Greetings', fr: 'Salutations' }, tags: ['souk'] });
      expect(invalidated.mock.calls.map((call) => call[0])).toEqual([collection.id, collection.id]);
      expect(h.db.rows('publication_events')).toHaveLength(0);
      expect(h.db.rows('user_download_manifests').every((p) => p.revoked_at === null)).toBe(true);
    });
  });

  describe('a published lesson moved to another collection refreshes the manifest it left', () => {
    /** Collection A (from `seedPublishedLesson`) lists the lesson; collection B is another published collection. */
    function seedMove() {
      const seeded = seedPublishedLesson();
      const [other] = h.db.seed('audio_course_collections', [collectionRow({ title_translations: { en: 'Other' }, state: 'published', published_version: 2 })]) as [DbRow];
      const [otherChapter] = h.db.seed('audio_chapters', [chapterRow(other.id as string, { state: 'published' })]) as [DbRow];
      return { ...seeded, other, otherChapter };
    }
    const sorted = (ids: unknown[]): string[] => ids.map(String).sort();

    const moves = {
      'PATCH /v1/admin/audio/lessons/:id': (lessonId: string, chapterId: string, extra: DbRow) => h.call(`/v1/admin/audio/lessons/${lessonId}`, { method: 'PATCH', token: editor, body: { expectedRevision: 1, chapterId, ...extra } }),
      'POST /v1/admin/assets/bulk-label': (lessonId: string, chapterId: string, extra: DbRow) => h.call('/v1/admin/assets/bulk-label', { token: editor, body: { lessonIds: [lessonId], patch: { chapterId, ...extra }, idempotencyKey: KEY } }),
    } as const;

    it.each(Object.keys(moves) as (keyof typeof moves)[])('%s: a move keeps the lesson published and invalidates BOTH collections', async (route) => {
      const { collection, lesson, other, otherChapter } = seedMove();
      const invalidated = vi.spyOn(h.ctx.shared.cache, 'invalidateAudioCollection');
      const res = await moves[route](lesson.id as string, otherChapter.id as string, {});
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      await h.flush();
      expect(lesson).toMatchObject({ chapter_id: otherChapter.id, state: 'published' });
      expect(sorted(invalidated.mock.calls.map((call) => call[0]))).toEqual(sorted([collection.id, other.id]));
      expect(h.db.rows('user_download_manifests').every((p) => p.revoked_at === null)).toBe(true);
    });

    it.each(Object.keys(moves) as (keyof typeof moves)[])('%s: move + unpublish is one takedown that purges the manifest that listed the lesson', async (route) => {
      const { collection, lesson, other, otherChapter } = seedMove();
      const invalidated = vi.spyOn(h.ctx.shared.cache, 'invalidateAudioCollection');
      const res = await moves[route](lesson.id as string, otherChapter.id as string, { state: 'unpublished' });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      await h.flush();
      expect(lesson).toMatchObject({ chapter_id: otherChapter.id, state: 'unpublished' });
      // A listed the lesson until now: it must be purged (B is purged too; it never listed it, which is harmless).
      expect(sorted(invalidated.mock.calls.map((call) => call[0]))).toEqual(sorted([collection.id, other.id]));
      expect(h.db.rows('user_download_manifests').every((p) => p.revoked_at !== null)).toBe(true);
      expect(revisionsOf(h, 'audio_lessons', lesson.id).map((r) => [r.revision, (r.diff as DbRow).unpublish ?? false])).toEqual([
        [1, false],
        [2, true],
      ]);
      expect(h.db.rows('publication_events').map((e) => [e.from_state, e.to_state, e.revision])).toEqual([['published', 'unpublished', 2]]);
      expect(h.db.writes('audio_lessons')).toHaveLength(1);
    });
  });

  describe('the audio of a published lesson stays with it', () => {
    it('attaching it to another lesson is refused (409) like the direct detach, and nothing moves', async () => {
      const { lesson, asset } = seedPublishedLesson();
      const [draft] = h.db.seed('audio_lessons', [audioLessonRow({ chapter_id: lesson.chapter_id })]) as [DbRow];
      const invalidated = vi.spyOn(h.ctx.shared.cache, 'invalidateAudioCollection');
      const attach = await h.call(`/v1/admin/library/lessons/${String(draft.id)}/assets`, { token: editor, body: { assetId: asset.id } });
      expect(attach.status, JSON.stringify(attach.json)).toBe(409);
      expect(attach.json.error).toMatchObject({ code: 'conflict', details: { publishedLessonIds: [lesson.id] } });
      const detach = await h.call(`/v1/admin/library/lessons/${String(lesson.id)}/assets/${String(asset.id)}`, { method: 'DELETE', token: editor });
      expect(detach.status).toBe(409);
      expect(h.db.rows('audio_lesson_assets').map((l) => [l.lesson_id, l.asset_id])).toEqual([[lesson.id, asset.id]]);
      expect(h.db.writes('audio_lesson_assets')).toHaveLength(0);
      expect(h.db.writes('content_revisions')).toHaveLength(0);
      expect(invalidated).not.toHaveBeenCalled();
    });

    it('creating a lesson with it is refused (409) before the lesson exists', async () => {
      emulateCreateSupport(h);
      const { lesson, chapter, asset } = seedPublishedLesson();
      const res = await h.call('/v1/admin/library/lessons', { token: editor, body: { chapterId: chapter.id, titleTranslations: { en: 'Copy' }, assetId: asset.id, idempotencyKey: 'integrity-les-0409' } });
      expect(res.status, JSON.stringify(res.json)).toBe(409);
      expect(h.db.rows('audio_lessons').map((l) => l.id)).toEqual([lesson.id]);
      expect(h.db.rows('audio_lesson_assets').map((l) => l.lesson_id)).toEqual([lesson.id]);
      expect(h.db.writes('content_revisions')).toHaveLength(0);
    });
  });

  describe('the expectedRevision guard is atomic', () => {
    const lessonPatch = (id: unknown, token: string, body: DbRow) => h.call(`/v1/admin/audio/lessons/${String(id)}`, { method: 'PATCH', token, body });

    function seedLessonAtRevision2(): DbRow {
      const [lesson] = h.db.seed('audio_lessons', [audioLessonRow({ title_translations: { en: 'Greetings' }, state: 'metadata_needed' })]) as [DbRow];
      h.db.seed('content_revisions', [1, 2].map((revision) => ({ entity_table: 'audio_lessons', entity_id: lesson.id, revision, diff: {}, snapshot: null, editor_id: EDITOR, note: null })));
      return lesson;
    }

    it('two editors at revision 2: the one that claims revision 3 first wins; the other is 412 with revision 3 and writes nothing', async () => {
      const lesson = seedLessonAtRevision2();
      const admin = await h.token(ADMIN);
      let second: Awaited<ReturnType<typeof lessonPatch>> | null = null;
      // Editor A has read revision 2 (guard passed) and is about to claim revision 3 when editor B's whole save runs.
      interleaveBefore(h, (method, target) => method === 'POST' && target === 'content_revisions', async () => {
        second = await lessonPatch(lesson.id, admin, { expectedRevision: 2, topic: 'second', titleTranslations: { de: 'Grüße' } });
      });
      const first = await lessonPatch(lesson.id, editor, { expectedRevision: 2, topic: 'first', titleTranslations: { fr: 'Salutations' } });
      expect(second!.status, JSON.stringify(second!.json)).toBe(200);
      expect(second!.json.data.revision).toBe(3);
      expect(first.status, JSON.stringify(first.json)).toBe(412);
      expect(first.json.error).toMatchObject({ code: 'precondition_failed', details: { currentRevision: 3 } });
      // No lost update: B's save is intact and A wrote nothing (no row change, no revision, no void).
      expect(lesson.topic).toBe('second');
      expect(lesson.title_translations).toEqual({ en: 'Greetings', de: 'Grüße' });
      expect(revisionsOf(h, 'audio_lessons', lesson.id).map((r) => [r.revision, r.editor_id])).toEqual([
        [1, EDITOR],
        [2, EDITOR],
        [3, ADMIN],
      ]);
      expect(h.db.writes('audio_lessons')).toHaveLength(1);
    });

    it('a write outside the ledger between the read and the update (a job, a suggestion) is a 412, never overwritten', async () => {
      const lesson = seedLessonAtRevision2();
      interleaveBefore(h, (method, target) => method === 'PATCH' && target === 'audio_lessons', () => {
        lesson.topic = 'set-by-a-job';
        lesson.updated_at = FOREIGN_WRITE_AT;
      });
      const res = await lessonPatch(lesson.id, editor, { expectedRevision: 2, topic: 'editor', tags: ['x'] });
      expect(res.status, JSON.stringify(res.json)).toBe(412);
      expect(res.json.error.details).toEqual({ currentRevision: 4 });
      expect(lesson).toMatchObject({ topic: 'set-by-a-job', tags: [] });
      // The claimed revision 3 is voided by revision 4, whose snapshot is the row as it really is.
      const [, , claimed, voided] = revisionsOf(h, 'audio_lessons', lesson.id);
      expect(claimed).toMatchObject({ revision: 3, diff: { topic: 'editor' } });
      expect(voided).toMatchObject({ revision: 4, diff: { voidsRevision: 3 } });
      expect(voided!.snapshot).toEqual(restorable('audio_lessons', lesson));
      expect((voided!.snapshot as DbRow).topic).toBe('set-by-a-job');
    });

    it('a revision-only writer (asset attach, review request) that lands first makes a stale save a 412', async () => {
      const lesson = seedLessonAtRevision2();
      interleaveBefore(h, (method, target) => method === 'POST' && target === 'content_revisions', () => {
        h.db.seed('content_revisions', [{ entity_table: 'audio_lessons', entity_id: lesson.id, revision: 3, diff: { attachAsset: crypto.randomUUID() }, snapshot: null, editor_id: ADMIN, note: null }]);
      });
      const res = await lessonPatch(lesson.id, editor, { expectedRevision: 2, topic: 'late' });
      expect(res.status).toBe(412);
      expect(res.json.error.details).toEqual({ currentRevision: 3 });
      expect(lesson.topic).toBeNull();
      expect(h.db.writes('audio_lessons')).toHaveLength(0);
    });

    it('collection and chapter PATCH use the same guard: concurrent saves at one revision never both land', async () => {
      const [collection] = h.db.seed('audio_course_collections', [collectionRow()]) as [DbRow];
      const [chapter] = h.db.seed('audio_chapters', [chapterRow(collection.id as string)]) as [DbRow];
      h.db.seed('content_revisions', [
        { entity_table: 'audio_course_collections', entity_id: collection.id, revision: 1, diff: {}, snapshot: null, editor_id: EDITOR, note: null },
        { entity_table: 'audio_chapters', entity_id: chapter.id, revision: 1, diff: {}, snapshot: null, editor_id: EDITOR, note: null },
      ]);
      const admin = await h.token(ADMIN);
      for (const [path, table, row] of [
        [`/v1/admin/library/collections/${String(collection.id)}`, 'audio_course_collections', collection],
        [`/v1/admin/library/chapters/${String(chapter.id)}`, 'audio_chapters', chapter],
      ] as const) {
        let second: Awaited<ReturnType<RouteHarness['call']>> | null = null;
        interleaveBefore(h, (method, target) => method === 'POST' && target === 'content_revisions', async () => {
          second = await h.call(path, { method: 'PATCH', token: admin, body: { expectedRevision: 1, titleTranslations: { de: 'Zweite' } } });
        });
        const first = await h.call(path, { method: 'PATCH', token: editor, body: { expectedRevision: 1, titleTranslations: { fr: 'Première' } } });
        expect(second!.status, `${table} ${JSON.stringify(second!.json)}`).toBe(200);
        expect(first.status, table).toBe(412);
        expect(first.json.error.details.currentRevision, table).toBe(2);
        expect(row.title_translations, table).toEqual({ en: table === 'audio_chapters' ? 'Greetings' : 'Souk dialogues', de: 'Zweite' });
        expect(revisionsOf(h, table, row.id).map((r) => r.revision), table).toEqual([1, 2]);
      }
    });

    it('a malformed reorder is refused (422) before a revision is claimed', async () => {
      const [collection] = h.db.seed('audio_course_collections', [collectionRow()]) as [DbRow];
      const [chapter] = h.db.seed('audio_chapters', [chapterRow(collection.id as string)]) as [DbRow];
      const lessons = h.db.seed('audio_lessons', [audioLessonRow({ chapter_id: chapter.id }), audioLessonRow({ chapter_id: chapter.id, sort_order: 1 })]);
      const res = await h.call(`/v1/admin/library/chapters/${String(chapter.id)}/lessons/reorder`, { token: editor, body: { orderedIds: [lessons[1]!.id], expectedRevision: 0, idempotencyKey: KEY } });
      expect(res.status).toBe(422);
      expect(res.json.error.code).toBe('validation_failed');
      expect(h.db.writes('content_revisions')).toHaveLength(0);
      expect(h.db.writes('rpc:reorder_audio_lessons')).toHaveLength(0);
    });
  });

  describe('every edit revision is restorable (R-7.3-04)', () => {
    it('the structure, labelling, review and decision routes all write the restorable snapshot of the row', async () => {
      emulateCreateSupport(h);
      const [asset, asset2] = h.db.seed('media_assets', [mediaAssetRow(), mediaAssetRow()]) as [DbRow, DbRow];
      h.db.rpcs.reorder_audio_lessons = (args, ctx) => (args.p_ordered_ids as string[]).map((id, i) => {
        const row = ctx.db.rows('audio_lessons').find((l) => l.id === id)!;
        row.sort_order = i;
        return { id, sort_order: i };
      });
      const col = await h.call('/v1/admin/library/collections', { token: editor, body: { titleTranslations: { en: 'Souk dialogues' }, courseTrackId: 'arabic-moroccan', targetVarietyId: 'ary', instructionLanguageCode: 'fr', idempotencyKey: 'integrity-col-0001' } });
      expect(col.status, JSON.stringify(col.json)).toBe(201);
      const collectionId = col.json.data.id as string;
      expect((await h.call(`/v1/admin/library/collections/${collectionId}`, { method: 'PATCH', token: editor, body: { expectedRevision: 1, region: 'Casablanca' } })).status).toBe(200);
      const ch = await h.call('/v1/admin/library/chapters', { token: editor, body: { collectionId, titleTranslations: { en: 'Greetings' }, idempotencyKey: 'integrity-chp-0001' } });
      expect(ch.status, JSON.stringify(ch.json)).toBe(201);
      const chapterId = ch.json.data.id as string;
      expect((await h.call(`/v1/admin/library/chapters/${chapterId}`, { method: 'PATCH', token: editor, body: { expectedRevision: 1, summaryTranslations: { en: 'Say hello' } } })).status).toBe(200);
      const l1 = await h.call('/v1/admin/library/lessons', { token: editor, body: { chapterId, titleTranslations: { en: 'Salam' }, assetId: asset.id, idempotencyKey: 'integrity-les-0001' } });
      const l2 = await h.call('/v1/admin/library/lessons', { token: editor, body: { chapterId, titleTranslations: { en: 'Labas' }, sortOrder: 1, idempotencyKey: 'integrity-les-0002' } });
      expect([l1.status, l2.status], JSON.stringify([l1.json, l2.json])).toEqual([201, 201]);
      const [lessonA, lessonB] = [l1.json.data.id as string, l2.json.data.id as string];
      expect((await h.call(`/v1/admin/audio/lessons/${lessonA}`, { method: 'PATCH', token: editor, body: { expectedRevision: 1, topic: 'greetings', state: 'review_needed' } })).status).toBe(200);
      expect((await h.call('/v1/admin/assets/bulk-label', { token: editor, body: { lessonIds: [lessonA, lessonB], patch: { addTags: ['souk'] }, idempotencyKey: KEY } })).status).toBe(200);
      // Moving the asset from lesson A to lesson B writes a revision on both lessons.
      expect((await h.call(`/v1/admin/library/lessons/${lessonB}/assets`, { token: editor, body: { assetId: asset.id } })).status).toBe(200);
      expect((await h.call(`/v1/admin/library/lessons/${lessonB}/assets`, { token: editor, body: { assetId: asset2.id, assetType: 'slow' } })).status).toBe(201);
      expect((await h.call(`/v1/admin/library/lessons/${lessonB}/assets/${String(asset2.id)}`, { method: 'DELETE', token: editor })).status).toBe(200);
      expect((await h.call(`/v1/admin/library/chapters/${chapterId}/lessons/reorder`, { token: editor, body: { orderedIds: [lessonB, lessonA], expectedRevision: 2, idempotencyKey: 'integrity-ord-0001' } })).status).toBe(200);
      expect((await h.call(`/v1/admin/content/${lessonB}/request-review`, { token: editor, body: { note: 'please check' } })).status).toBe(200);
      expect((await h.call(`/v1/admin/content/${lessonA}/decision`, { token: await h.token(REVIEWER), body: { entityTable: 'audio_lessons', decision: 'approve' } })).status).toBe(200);

      const tables: RollbackEntityTable[] = ['audio_course_collections', 'audio_chapters', 'audio_lessons'];
      const written = h.db.rows('content_revisions').filter((r) => (tables as string[]).includes(r.entity_table as string));
      expect(written.length).toBeGreaterThanOrEqual(18);
      for (const r of written) expect(r.snapshot, `${String(r.entity_table)} r${String(r.revision)} ${JSON.stringify(r.diff)}`).not.toBeNull();
      // The latest snapshot of every entity is its current row (restorable columns), so rollback never restores a lie.
      const current: [RollbackEntityTable, string][] = [['audio_course_collections', collectionId], ['audio_chapters', chapterId], ['audio_lessons', lessonA], ['audio_lessons', lessonB]];
      for (const [table, id] of current) {
        const row = h.db.rows(table).find((x) => x.id === id)!;
        expect(latestRevision(h, table, id).snapshot, `${table} ${id}`).toEqual(restorable(table, row));
      }
    });

    it('rollback after API edits restores the lesson as it was at that revision, as a new restorable revision', async () => {
      const [lesson] = h.db.seed('audio_lessons', [audioLessonRow({ title_translations: { en: 'Greetings' }, state: 'review_needed' })]) as [DbRow];
      const patch = (body: DbRow) => h.call(`/v1/admin/audio/lessons/${String(lesson.id)}`, { method: 'PATCH', token: editor, body });
      const rollback = (revision: number) => h.call(`/v1/admin/content/${String(lesson.id)}/rollback`, { token: editor, body: { entityTable: 'audio_lessons', revision } });
      expect((await patch({ expectedRevision: 0, titleTranslations: { en: 'Greetings at the market' }, topic: 'market', tags: ['souk'] })).json.data.revision).toBe(1);
      expect((await patch({ expectedRevision: 1, titleTranslations: { en: 'Gretings (typo)' }, topic: 'oops', tags: [], level: 'advanced' })).json.data.revision).toBe(2);
      const r3 = await rollback(1);
      expect(r3.status, JSON.stringify(r3.json)).toBe(200);
      expect(r3.json.data.revision).toBe(3);
      expect(lesson).toMatchObject({ title_translations: { en: 'Greetings at the market' }, topic: 'market', tags: ['souk'], level: null, state: 'review_needed' });
      expect(latestRevision(h, 'audio_lessons', lesson.id).snapshot).toEqual(restorable('audio_lessons', lesson));
      // Rollbacks are revisions like any other: the typo is one rollback away, and so is the restored state.
      expect((await rollback(2)).status).toBe(200);
      expect(lesson).toMatchObject({ title_translations: { en: 'Gretings (typo)' }, topic: 'oops', level: 'advanced' });
      expect((await rollback(3)).status).toBe(200);
      expect(lesson).toMatchObject({ title_translations: { en: 'Greetings at the market' }, topic: 'market', tags: ['souk'], level: null });
      expect(revisionsOf(h, 'audio_lessons', lesson.id).map((r) => r.revision)).toEqual([1, 2, 3, 4, 5]);
      // The rolled-back lesson accepts the next guarded edit at the revision the rollback produced.
      expect((await patch({ expectedRevision: 5, topic: 'souk' })).json.data.revision).toBe(6);
    });

    it('rollback restores bulk labels and collection / chapter edits made through the API', async () => {
      const [collection] = h.db.seed('audio_course_collections', [collectionRow({ title_translations: { en: 'Souk dialogues' } })]) as [DbRow];
      const [chapter] = h.db.seed('audio_chapters', [chapterRow(collection.id as string)]) as [DbRow];
      const [lesson] = h.db.seed('audio_lessons', [audioLessonRow({ chapter_id: chapter.id, tags: ['keep'] })]) as [DbRow];
      expect((await h.call(`/v1/admin/library/collections/${String(collection.id)}`, { method: 'PATCH', token: editor, body: { titleTranslations: { en: 'Souk dialogues, season 1' } } })).status).toBe(200);
      expect((await h.call(`/v1/admin/library/collections/${String(collection.id)}`, { method: 'PATCH', token: editor, body: { titleTranslations: { en: 'Wrong title' } } })).status).toBe(200);
      expect((await h.call(`/v1/admin/library/chapters/${String(chapter.id)}`, { method: 'PATCH', token: editor, body: { titleTranslations: { en: 'Hello and goodbye' } } })).status).toBe(200);
      expect((await h.call(`/v1/admin/library/chapters/${String(chapter.id)}`, { method: 'PATCH', token: editor, body: { sortOrder: 9 } })).status).toBe(200);
      expect((await h.call('/v1/admin/assets/bulk-label', { token: editor, body: { lessonIds: [lesson.id], patch: { addTags: ['souk'] }, idempotencyKey: KEY } })).status).toBe(200);
      expect((await h.call('/v1/admin/assets/bulk-label', { token: editor, body: { lessonIds: [lesson.id], patch: { removeTags: ['keep', 'souk'], topic: 'mistake' }, idempotencyKey: 'integrity-key-0002' } })).status).toBe(200);
      for (const [table, id, revision] of [['audio_course_collections', collection.id, 1], ['audio_chapters', chapter.id, 1], ['audio_lessons', lesson.id, 1]] as const) {
        const res = await h.call(`/v1/admin/content/${String(id)}/rollback`, { token: editor, body: { entityTable: table, revision } });
        expect(res.status, `${table} ${JSON.stringify(res.json)}`).toBe(200);
      }
      expect(collection.title_translations).toEqual({ en: 'Souk dialogues, season 1' });
      expect(chapter).toMatchObject({ title_translations: { en: 'Hello and goodbye' }, sort_order: 0 });
      expect(lesson).toMatchObject({ tags: ['keep', 'souk'], topic: null });
    });

    it('rolling back a published lesson keeps it published and refreshes the manifest that lists it', async () => {
      const { collection, lesson } = seedPublishedLesson();
      expect((await h.call(`/v1/admin/audio/lessons/${String(lesson.id)}`, { method: 'PATCH', token: editor, body: { expectedRevision: 1, titleTranslations: { en: 'Renamed' } } })).status).toBe(200);
      const invalidated = vi.spyOn(h.ctx.shared.cache, 'invalidateAudioCollection');
      h.db.rows('content_revisions').push({ id: crypto.randomUUID(), entity_table: 'audio_lessons', entity_id: lesson.id, revision: 3, diff: {}, snapshot: { title_translations: { en: 'Greetings' } }, editor_id: EDITOR, note: null, created_at: new Date().toISOString() });
      const res = await h.call(`/v1/admin/content/${String(lesson.id)}/rollback`, { token: editor, body: { entityTable: 'audio_lessons', revision: 3 } });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      await h.flush();
      expect(lesson).toMatchObject({ state: 'published', title_translations: { en: 'Greetings' } });
      expect(invalidated.mock.calls.map((call) => call[0])).toEqual([collection.id]);
    });
  });

  describe('Quality review: reviewers decide lessons without the editor-only PATCH', () => {
    it('a language reviewer approves / rejects lessons in review: state and quality status in one write, with revision, event and audit', async () => {
      const reviewer = await h.token(REVIEWER);
      const [approve, reject] = h.db.seed('audio_lessons', [audioLessonRow({ state: 'review_needed' }), audioLessonRow({ state: 'review_needed' })]) as [DbRow, DbRow];
      // The call the old Quality review made first, and the reason reviewers got a 403 there: still editor-only.
      const patch = await h.call(`/v1/admin/audio/lessons/${String(approve.id)}`, { method: 'PATCH', token: reviewer, body: { qualityReviewStatus: 'approved' } });
      expect(patch.status).toBe(403);
      expect(approve.quality_review_status).toBe('unreviewed');

      const ok = await h.call(`/v1/admin/content/${String(approve.id)}/decision`, { token: reviewer, body: { entityTable: 'audio_lessons', decision: 'approve' } });
      expect(ok.status, JSON.stringify(ok.json)).toBe(200);
      expect(ok.json.data).toEqual({ contentId: approve.id, state: 'approved', revision: 1, noop: false, publicationEventRecorded: true });
      const no = await h.call(`/v1/admin/content/${String(reject.id)}/decision`, { token: reviewer, body: { entityTable: 'audio_lessons', decision: 'reject', note: 'wrong dialect' } });
      expect(no.status).toBe(200);
      expect([approve, reject].map((l) => [l.state, l.quality_review_status])).toEqual([
        ['approved', 'approved'],
        ['rejected', 'rejected'],
      ]);
      expect(h.db.writes('audio_lessons')).toHaveLength(2);
      expect(latestRevision(h, 'audio_lessons', approve.id)).toMatchObject({ editor_id: REVIEWER, diff: { state: { from: 'review_needed', to: 'approved' }, qualityReviewStatus: { from: 'unreviewed', to: 'approved' } } });
      expect(latestRevision(h, 'audio_lessons', reject.id).snapshot).toEqual(restorable('audio_lessons', reject));
      expect(h.db.rows('publication_events').map((e) => [e.entity_id, e.to_state, e.actor_id])).toEqual([
        [approve.id, 'approved', REVIEWER],
        [reject.id, 'rejected', REVIEWER],
      ]);
      await h.flush();
      expect(h.db.rows('audit_logs').filter((a) => a.action === 'content.decision').map((a) => (a.after as DbRow).qualityReviewStatus)).toEqual(['approved', 'rejected']);
    });

    it('a repeated approval moves nothing but still records the quality review; published lessons stay untouched', async () => {
      const reviewer = await h.token(REVIEWER);
      const [approved] = h.db.seed('audio_lessons', [audioLessonRow({ state: 'approved', quality_review_status: 'unreviewed' })]) as [DbRow];
      const res = await h.call(`/v1/admin/content/${String(approved.id)}/decision`, { token: reviewer, body: { entityTable: 'audio_lessons', decision: 'approve' } });
      expect(res.json.data).toMatchObject({ state: 'approved', noop: true, publicationEventRecorded: false });
      expect(approved.quality_review_status).toBe('approved');
      // Already approved and reviewed: nothing to write.
      const again = await h.call(`/v1/admin/content/${String(approved.id)}/decision`, { token: reviewer, body: { entityTable: 'audio_lessons', decision: 'approve' } });
      expect(again.json.data).toMatchObject({ noop: true });
      expect(h.db.writes('audio_lessons')).toHaveLength(1);
      const { lesson: published } = seedPublishedLesson({ quality_review_status: 'approved' });
      const refused = await h.call(`/v1/admin/content/${String(published.id)}/decision`, { token: reviewer, body: { entityTable: 'audio_lessons', decision: 'reject' } });
      expect(refused.status).toBe(412);
      expect(published).toMatchObject({ state: 'published', quality_review_status: 'approved' });
    });

    it('a reject that lands after a concurrent publish is a 412: the live lesson is never moved to rejected without a takedown', async () => {
      const reviewer = await h.token(REVIEWER);
      const [lesson] = h.db.seed('audio_lessons', [audioLessonRow({ state: 'approved', quality_review_status: 'approved' })]) as [DbRow];
      h.db.seed('user_download_manifests', [{ user_id: LEARNER, lesson_id: lesson.id, revoked_at: null }]);
      // The reviewer loaded the approved lesson; an editor publishes it before the decision is written.
      interleaveBefore(h, (method, target) => method === 'PATCH' && target === 'audio_lessons', () => {
        lesson.state = 'published';
      });
      const res = await h.call(`/v1/admin/content/${String(lesson.id)}/decision`, { token: reviewer, body: { entityTable: 'audio_lessons', decision: 'reject' } });
      expect(res.status, JSON.stringify(res.json)).toBe(412);
      expect(res.json.error).toMatchObject({ code: 'precondition_failed', details: { from: 'approved', state: 'published' } });
      expect(lesson).toMatchObject({ state: 'published', quality_review_status: 'approved' });
      expect(h.db.rows('user_download_manifests').every((p) => p.revoked_at === null)).toBe(true);
      expect(h.db.rows('publication_events')).toHaveLength(0);
      expect(h.db.writes('content_revisions')).toHaveLength(0);
    });
  });
});
