/**
 * A20 / §7.6 / §9.9: unclear-rights commercial audio can be stored privately but never published. The pure gate
 * (`canPublish`) and the admin publish route both block with explicit reasons; learners cannot call the route at
 * all; a revoked licence blocks too; verified redistributable rights pass the rights checks.
 */
import { canPublish } from '@langquest/media/rights';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, createApiHarness, createTestUser, describeWithStack, Seeder, teardown, type ApiHarness, type TestUser } from '../src/harness';

describe('rights gate (pure)', () => {
  const base = { entityKind: 'audio_lesson' as const, currentState: 'review_needed' as const, title: 'Episode 1', languageCode: 'ary', asset: { checksumVerified: true, disposition: 'active' as const, accessible: true, byteLength: 1000 }, speakers: { known: true, entries: [{ name: 'Narrator', consentState: 'granted' as const }] }, chapterId: 'c1' };

  it('blocks unverified, non-redistributable, expired and revoked rights with explanations', () => {
    const unverified = canPublish({ ...base, rights: { licenseId: 'proprietary', verified: false, commercialRedistribution: true, attributionRequired: true } });
    expect(unverified.allowed).toBe(false);
    expect(unverified.blockedBy).toContain('rights_unverified');
    expect(unverified.reasons.some((r) => r.severity === 'blocker' && /rights/i.test(r.message))).toBe(true);
    const noRedistribution = canPublish({ ...base, rights: { licenseId: 'proprietary', verified: true, commercialRedistribution: false, attributionRequired: true } });
    expect(noRedistribution.allowed).toBe(false);
    expect(noRedistribution.blockedBy).toContain('no_redistribution_right');
    const missing = canPublish({ ...base, rights: null });
    expect(missing.blockedBy).toContain('rights_missing');
    const revoked = canPublish({ ...base, rights: { licenseId: 'CC-BY-4.0', verified: true, commercialRedistribution: true, attributionRequired: true, revokedAt: new Date(Date.now() - 1000).toISOString() } });
    expect(revoked.blockedBy).toContain('rights_revoked');
    const expired = canPublish({ ...base, rights: { licenseId: 'CC-BY-4.0', verified: true, commercialRedistribution: true, attributionRequired: true, expiresAt: new Date(Date.now() - 1000).toISOString() } });
    expect(expired.blockedBy).toContain('rights_expired');
  });

  it('passes the rights checks when the licence is verified and redistributable', () => {
    const ok = canPublish({ ...base, rights: { licenseId: 'CC-BY-4.0', verified: true, commercialRedistribution: true, attributionRequired: true, attributionText: 'Narrator' } });
    expect(ok.checklist.rightsVerified).toBe(true);
    expect(ok.blockedBy.filter((b) => b.startsWith('rights') || b === 'no_redistribution_right')).toEqual([]);
  });
});

const describeStack = describeWithStack('security.rights-gate');

describeStack('admin publish route is rights-gated (A20)', () => {
  let h: ApiHarness;
  let seeder: Seeder;
  let editor: TestUser;
  let learner: TestUser;
  let unclearLessonId: string;
  let revokedLessonId: string;

  beforeAll(async () => {
    h = createApiHarness();
    seeder = new Seeder(h.service);
    [editor, learner] = await Promise.all([createTestUser(h, 'rights-editor', { roles: ['content_editor'] }), createTestUser(h, 'rights-learner')]);
    const unclear = await seeder.rights({ verified: false, commercialRedistribution: true, licenseId: 'proprietary' });
    const collection = await seeder.audioCollection({ trackId: 'arabic-moroccan', varietyId: 'ary', rightsId: unclear.id, state: 'review_needed' });
    const chapter = await seeder.audioChapter(collection.id, 'review_needed');
    const lesson = await seeder.audioLesson({ chapterId: chapter.id, state: 'review_needed', rightsId: unclear.id, varietyId: 'ary' });
    unclearLessonId = lesson.id;
    const asset = await seeder.mediaAsset({ rightsId: unclear.id, state: 'review_needed' });
    await seeder.linkLessonAsset(lesson.id, asset.id, 'master');
    const revoked = await seeder.rights({ verified: true, commercialRedistribution: true, licenseId: 'CC-BY-4.0', revokedAt: new Date(Date.now() - 1000).toISOString() });
    const revokedLesson = await seeder.audioLesson({ chapterId: chapter.id, state: 'review_needed', rightsId: revoked.id, varietyId: 'ary' });
    revokedLessonId = revokedLesson.id;
  });

  // Users first (their owned rows and ledgers go with them), then the seeded content rows in reverse insertion order.
  afterAll(() => teardown(h, seeder));

  it('learners cannot publish; editors are blocked with an explicit rights reason and the state does not change', async () => {
    const asLearner = await call(h, `/v1/admin/content/${unclearLessonId}/publish`, { token: learner.token, body: { entityTable: 'audio_lessons', expectedRevision: 0 } });
    expect(asLearner.status).toBe(403);
    const res = await call(h, `/v1/admin/content/${unclearLessonId}/publish`, { token: editor.token, body: { entityTable: 'audio_lessons', expectedRevision: 0 } });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.data.state).not.toBe('published');
    expect(res.json.data.blockedBy).toContain('rights_unverified');
    expect(res.json.data.checklist.rightsVerified).toBe(false);
    expect(res.json.data.manifestInvalidated).toBe(false);
    const row = await h.service.from('audio_lessons').select('state, published_revision').eq('id', unclearLessonId).single();
    expect(row.data).toMatchObject({ state: 'review_needed', published_revision: null });
    await h.app.flush();
    const audit = await h.service.from('audit_logs').select('action').eq('actor_id', editor.id).eq('entity_id', unclearLessonId);
    expect(audit.data?.some((a) => a.action === 'content.publish_blocked')).toBe(true);
    // Still invisible to learners (RLS) while it sits privately in the CMS.
    expect((await call(h, `/v1/audio/lessons/${unclearLessonId}`, { token: learner.token })).status).toBe(404);
  });

  it('a revoked licence blocks publication too, and stale revisions are refused before any gate work', async () => {
    const res = await call(h, `/v1/admin/content/${revokedLessonId}/publish`, { token: editor.token, body: { entityTable: 'audio_lessons', expectedRevision: 0 } });
    expect(res.status).toBe(200);
    expect(res.json.data.blockedBy).toContain('rights_revoked');
    const stale = await call(h, `/v1/admin/content/${revokedLessonId}/publish`, { token: editor.token, body: { entityTable: 'audio_lessons', expectedRevision: 7 } });
    expect(stale.status).toBe(412);
    expect(stale.json.error.code).toBe('precondition_failed');
  });

  it('the attributions report lists the unverified licence for operators to document', async () => {
    const res = await call(h, '/v1/admin/licenses/attributions?onlyUnverified=true&limit=100', { token: editor.token });
    expect(res.status).toBe(200);
    expect(res.json.data.items.some((i: { entities?: Array<{ entityId: string }>; usedBy?: Array<{ entityId: string }> }) => (i.entities ?? i.usedBy ?? []).some((e) => e.entityId === unclearLessonId))).toBe(true);
    expect((await call(h, '/v1/admin/licenses/attributions', { token: learner.token })).status).toBe(403);
  });
});
