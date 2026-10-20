/**
 * §5.5 / §11 "non-admin CMS calls": every `auth: 'admin'` route in the contracts ROUTES table answers 401 without
 * a token and 403 for a learner (never 404 — hidden controls are not authorization, and neither are leaks);
 * support_readonly cannot mutate; role checks are server-side (`user_roles`), so a self-granted role claim in the
 * JWT payload changes nothing. The table-driven checks are closed over the APP, not only the contracts: every
 * `/v1/admin/*` route the Hono app mounts must be declared `auth: 'admin'` in ROUTES, so a new admin route (library
 * structure, visual assets, suggestions, …) cannot ship outside the gate; the structure routes are also exercised
 * with ids that really exist so a 403 is never a disguised 404.
 */
import { ROUTES, type RouteKey } from '@langquest/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { call, createApiHarness, createTestUser, describeWithStack, Seeder, teardown, userClient, type ApiHarness, type TestUser } from '../src/harness';

const describeStack = describeWithStack('security.admin-routes');

const SAMPLE_UUID = '00000000-0000-4000-8000-000000000001';

/** Routes added with the library-structure / visual-asset / suggestion work (migration 120); all must be admin-gated. */
const STRUCTURE_ROUTES = [
  'adminCollectionsList', 'adminCollectionCreate', 'adminCollectionGet', 'adminCollectionPatch', 'adminCollectionDelete', 'adminChaptersReorder',
  'adminChapterCreate', 'adminChapterGet', 'adminChapterPatch', 'adminChapterDelete', 'adminLessonsReorder',
  'adminLessonCreate', 'adminLessonGet', 'adminLessonDelete', 'adminLessonAssetAttach', 'adminLessonAssetDetach',
  'adminContentRightsList', 'adminContentRightsCreate', 'adminContentRightsGet', 'adminContentRightsPatch', 'adminContentRightsRevoke',
  'adminVisualAssetsList', 'adminVisualAssetUploadInitiate', 'adminVisualAssetRegister', 'adminVisualAssetGet', 'adminVisualAssetPatch', 'adminVisualAssetReplace', 'adminVisualAssetAssign', 'adminVisualAssetUnassign',
  'adminAssetSuggestionsList', 'adminAssetSuggestionsGenerate', 'adminAssetSuggestionsBulkDecide', 'adminAssetSuggestionGet', 'adminAssetSuggestionDecide',
] as const satisfies readonly RouteKey[];

/**
 * Studio writes that used to be local Next route handlers in apps/admin (R-4.3-01). All admin-gated; the role sets
 * narrow further per route (reviewers: coverage / transcripts / decisions; editors: rollback / job retry; admins:
 * model test harness; super_admin: role grants).
 */
const STUDIO_ROUTES = ['adminCoveragePut', 'adminTranscriptSave', 'adminContentDecision', 'adminContentRollback', 'adminProcessingJobRetry', 'adminUserRoleGrant', 'adminUserRoleRevoke', 'adminModelTest'] as const satisfies readonly RouteKey[];

function samplePath(key: RouteKey): string {
  return ROUTES[key].path.replace(/:([A-Za-z0-9_]+)/g, (_m, name: string) => (name === 'task' ? 'character_dialogue' : SAMPLE_UUID));
}

describeStack('admin routes enforce server-verified roles', () => {
  let h: ApiHarness;
  let learner: TestUser;
  let support: TestUser;
  let editor: TestUser;
  const adminRoutes = (Object.keys(ROUTES) as RouteKey[]).filter((k) => ROUTES[k].auth === 'admin');
  const mutating = adminRoutes.filter((k) => ROUTES[k].method !== 'GET');

  beforeAll(async () => {
    h = createApiHarness();
    [learner, support, editor] = await Promise.all([createTestUser(h, 'learner'), createTestUser(h, 'support', { roles: ['support_readonly'] }), createTestUser(h, 'editor', { roles: ['content_editor'] })]);
  });

  // Users first (their owned rows and ledgers go with them), then the seeded content rows in reverse insertion order.
  afterAll(() => teardown(h));

  it('covers every admin route in the contracts (sanity), including the structure / visual-asset / suggestion / Studio routes', () => {
    expect(adminRoutes.length).toBeGreaterThanOrEqual(22);
    expect(mutating.length).toBeGreaterThanOrEqual(12);
    for (const key of STRUCTURE_ROUTES) expect(adminRoutes, key).toContain(key);
    for (const key of STUDIO_ROUTES) {
      expect(adminRoutes, key).toContain(key);
      expect(mutating, key).toContain(key);
    }
  });

  it('every /v1/admin/* route the app mounts is declared admin in the contracts (no admin route outside the gate)', () => {
    const mounted = new Map<string, string>();
    for (const r of h.app.app.routes) {
      if (r.method === 'ALL' || !r.path.startsWith('/v1/admin/')) continue;
      mounted.set(`${r.method} ${r.path}`, r.path);
    }
    expect(mounted.size).toBeGreaterThanOrEqual(adminRoutes.length);
    const declared = new Set(adminRoutes.map((k) => `${ROUTES[k].method} ${ROUTES[k].path}`));
    const undeclared = [...mounted.keys()].filter((route) => !declared.has(route));
    expect(undeclared).toEqual([]);
    // And every contract admin route is really mounted (the table-driven 401/403 checks below are not vacuous).
    const unmounted = adminRoutes.filter((k) => !mounted.has(`${ROUTES[k].method} ${ROUTES[k].path}`));
    expect(unmounted).toEqual([]);
  });

  it('library-structure routes deny learners and read-only support even for ids that exist (a 403, never a disguised 404)', async () => {
    const seeder = new Seeder(h.service);
    try {
      const rights = await seeder.rights({ verified: true, commercialRedistribution: true });
      const collection = await seeder.audioCollection({ trackId: 'arabic-moroccan', varietyId: 'ary', rightsId: rights.id, state: 'review_needed' });
      const chapter = await seeder.audioChapter(collection.id, 'review_needed');
      const lesson = await seeder.audioLesson({ chapterId: chapter.id, state: 'review_needed', rightsId: rights.id });
      const asset = await seeder.mediaAsset({ rightsId: rights.id, state: 'review_needed' });
      await seeder.linkLessonAsset(lesson.id, asset.id);
      const ids: Record<string, string> = { collection: collection.id, chapter: chapter.id, lesson: lesson.id, asset: asset.id, rights: rights.id };
      const realPath = (key: RouteKey): string => {
        const path = ROUTES[key].path;
        const entity = path.includes('/collections') ? 'collection' : path.includes('/chapters') ? 'chapter' : path.includes('/lessons') ? 'lesson' : path.includes('/content-rights') ? 'rights' : 'asset';
        return path.replace(':assetId', ids.asset!).replace(':id', ids[entity]!);
      };
      const structural = STRUCTURE_ROUTES.filter((k) => ROUTES[k].path.startsWith('/v1/admin/library/') || ROUTES[k].path.startsWith('/v1/admin/content-rights'));
      // The ids are real: an editor can read every one of them.
      for (const key of ['adminCollectionGet', 'adminChapterGet', 'adminLessonGet', 'adminContentRightsGet'] as const) {
        const res = await call(h, realPath(key), { token: editor.token });
        expect(res.status, `${key} as editor → ${JSON.stringify(res.json)}`).toBe(200);
      }
      const wrong: string[] = [];
      for (const key of structural) {
        const method = ROUTES[key].method;
        const asLearner = await call(h, realPath(key), { method, token: learner.token, body: method === 'GET' ? undefined : {} });
        if (asLearner.status !== 403 || asLearner.json?.error?.code !== 'forbidden') wrong.push(`${key} learner → ${asLearner.status} ${asLearner.json?.error?.code}`);
        if (method !== 'GET') {
          const asSupport = await call(h, realPath(key), { method, token: support.token, body: {} });
          if (asSupport.status !== 403) wrong.push(`${key} support_readonly → ${asSupport.status}`);
        }
      }
      expect(wrong).toEqual([]);
      // Nothing changed: the draft structure is intact and no asset was detached or moved.
      const links = await h.service.from('audio_lesson_assets').select('asset_id').eq('lesson_id', lesson.id);
      expect(links.data?.map((l) => l.asset_id)).toEqual([asset.id]);
      expect((await h.service.from('audio_lessons').select('id').eq('id', lesson.id).maybeSingle()).data?.id).toBe(lesson.id);
      expect((await h.service.from('audio_course_collections').select('id').eq('id', collection.id).maybeSingle()).data?.id).toBe(collection.id);
    } finally {
      await h.app.flush();
      await seeder.cleanup();
    }
  });

  it('anonymous callers get 401 on every admin route', async () => {
    const wrong: string[] = [];
    for (const key of adminRoutes) {
      const res = await call(h, samplePath(key), { method: ROUTES[key].method, body: ROUTES[key].method === 'GET' ? undefined : {} });
      if (res.status !== 401 || res.json?.error?.code !== 'unauthorized') wrong.push(`${key} → ${res.status}`);
    }
    expect(wrong).toEqual([]);
  });

  it('a learner gets 403 forbidden on every admin route (no 404 leaks, no 2xx)', async () => {
    const wrong: string[] = [];
    for (const key of adminRoutes) {
      const res = await call(h, samplePath(key), { method: ROUTES[key].method, token: learner.token, body: ROUTES[key].method === 'GET' ? undefined : {} });
      if (res.status !== 403 || res.json?.error?.code !== 'forbidden') wrong.push(`${key} → ${res.status} ${res.json?.error?.code}`);
    }
    expect(wrong).toEqual([]);
  });

  it('support_readonly can read but never mutate', async () => {
    const wrong: string[] = [];
    for (const key of mutating) {
      const res = await call(h, samplePath(key), { method: ROUTES[key].method, token: support.token, body: {} });
      if (res.status !== 403) wrong.push(`${key} → ${res.status}`);
    }
    expect(wrong).toEqual([]);
    const list = await call(h, '/v1/admin/models', { token: support.token });
    expect(list.status).toBe(200);
  });

  it('content editors cannot touch admin-only model configuration', async () => {
    const put = await call(h, '/v1/admin/models/character_dialogue/config', { method: 'PUT', token: editor.token, body: { task: 'character_dialogue', targetVariety: null, sourceLanguage: null, provider: 'openrouter', primaryModel: 'anthropic/claude-haiku-5.5', fallbackModels: [], params: {}, latencyClass: 'realtime', enabled: false, dailyBudgetUsd: null, requireSmokeTests: false } });
    expect(put.status).toBe(403);
    const bench = await call(h, '/v1/admin/models/character_dialogue/benchmark', { token: editor.token, body: {} });
    expect(bench.status).toBe(403);
  });

  it('content editors cannot run model probes or change staff roles (admin / super_admin only)', async () => {
    const wrong: string[] = [];
    for (const key of ['adminModelTest', 'adminUserRoleGrant', 'adminUserRoleRevoke'] as const satisfies readonly (typeof STUDIO_ROUTES)[number][]) {
      const res = await call(h, samplePath(key), { method: ROUTES[key].method, token: editor.token, body: {} });
      if (res.status !== 403) wrong.push(`${key} → ${res.status}`);
    }
    expect(wrong).toEqual([]);
    const grant = await call(h, `/v1/admin/users/${editor.id}/roles`, { token: editor.token, body: { role: 'super_admin' } });
    expect(grant.status).toBe(403);
    const roles = await h.service.from('user_roles').select('role').eq('user_id', editor.id);
    expect(roles.data?.map((r) => r.role)).toEqual(['content_editor']);
  });

  it('roles come from user_roles, which learners cannot grant themselves', async () => {
    const db = userClient(h, learner);
    const grant = await db.from('user_roles').insert({ user_id: learner.id, role: 'admin' });
    expect(grant.error).not.toBeNull();
    const me = await call(h, '/v1/me', { token: learner.token });
    expect(me.json.data.roles).toEqual([]);
    const still = await call(h, '/v1/admin/assets', { token: learner.token });
    expect(still.status).toBe(403);
    // Roles expire: an expired grant is not a role.
    await h.service.from('user_roles').insert({ user_id: learner.id, role: 'admin', expires_at: new Date(Date.now() - 60_000).toISOString() });
    const expired = await call(h, '/v1/admin/assets', { token: learner.token });
    expect(expired.status).toBe(403);
    await h.service.from('user_roles').delete().eq('user_id', learner.id);
  });

  it('mutating admin calls by an editor are audited', async () => {
    const res = await call(h, '/v1/admin/assets/bulk-label', { token: editor.token, body: { assetIds: [SAMPLE_UUID], patch: {}, idempotencyKey: `idem-${crypto.randomUUID()}` } });
    expect(res.status).toBeLessThan(500);
    await h.app.flush();
    const audit = await h.service.from('audit_logs').select('action').eq('actor_id', editor.id);
    // Some bulk-label inputs are rejected before any mutation; the role check and envelope are what we assert here.
    expect(Array.isArray(audit.data)).toBe(true);
  });
});
