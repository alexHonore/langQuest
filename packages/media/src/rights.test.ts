import { describe, expect, it } from 'vitest';
import { assertContentTransition, buildAttributionText, canPublish, canTransitionContent, CONTENT_TRANSITIONS, isRightsActive, offlineEligible, propagateTakedown, type PublishGateInput, type RightsRecord } from './rights';

const NOW = new Date('2026-10-14T12:00:00Z');
const goodRights: RightsRecord = { licenseId: 'CC-BY-4.0', verified: true, commercialRedistribution: true, attributionRequired: true, authors: ['Salma B.'], originUrl: 'https://example.org/darija', expiresAt: null, revokedAt: null };

const lesson: PublishGateInput = {
  entityKind: 'audio_lesson',
  currentState: 'approved',
  title: 'Au café',
  languageCode: 'ary',
  asset: { checksumVerified: true, disposition: 'active', accessible: true, byteLength: 1234 },
  speakers: { known: true, entries: [{ name: 'Salma B.', consentState: 'granted' }] },
  chapterId: 'chapter-1',
  rights: goodRights,
  nativeReviewed: true,
};

describe('content state machine', () => {
  it('covers every state and forbids skipping review', () => {
    for (const state of Object.keys(CONTENT_TRANSITIONS)) expect(Array.isArray(CONTENT_TRANSITIONS[state as keyof typeof CONTENT_TRANSITIONS])).toBe(true);
    expect(canTransitionContent('imported_draft', 'published')).toBe(false);
    expect(canTransitionContent('review_needed', 'published')).toBe(false);
    expect(canTransitionContent('approved', 'published')).toBe(true);
    expect(canTransitionContent('published', 'unpublished')).toBe(true);
    expect(canTransitionContent('published', 'approved')).toBe(false);
    expect(() => assertContentTransition('rejected', 'published')).toThrow(/Illegal/);
  });
});

describe('publishing gate', () => {
  it('allows a complete, rights-verified lesson', () => {
    const r = canPublish(lesson, NOW);
    expect(r.allowed).toBe(true);
    expect(r.blockedBy).toEqual([]);
    expect(r.checklist).toEqual({ titlePresent: true, languagePresent: true, fileIntegrityVerified: true, audioAccessible: true, speakerMetadataPresent: true, chapterLinked: true, rightsVerified: true, nativeReviewed: true, altTextPresent: true });
  });

  it('blocks unclear-rights commercial audio and explains why (A20)', () => {
    const r = canPublish({ ...lesson, rights: { licenseId: 'proprietary', verified: false, commercialRedistribution: false, attributionRequired: false, permissionGrant: 'purchased MP3' } }, NOW);
    expect(r.allowed).toBe(false);
    expect(r.blockedBy).toEqual(expect.arrayContaining(['rights_unverified', 'no_redistribution_right']));
    expect(r.reasons.find((x) => x.code === 'no_redistribution_right')?.message).toMatch(/owner-only staging/);
    expect(r.checklist.rightsVerified).toBe(false);
    const none = canPublish({ ...lesson, rights: null }, NOW);
    expect(none.blockedBy).toEqual(['rights_missing']);
    expect(none.reasons[0]?.message).toMatch(/does not grant redistribution/);
  });

  it('reports every missing mandatory field', () => {
    const r = canPublish({ ...lesson, currentState: 'review_needed', title: '  ', languageCode: null, asset: { checksumVerified: false, disposition: 'active', accessible: false, byteLength: 0 }, speakers: { known: true, entries: [{ name: null, consentState: 'unknown' }] }, chapterId: null, nativeReviewed: false }, NOW);
    expect(r.allowed).toBe(false);
    expect(r.blockedBy).toEqual(expect.arrayContaining(['invalid_state', 'missing_title', 'missing_language', 'integrity_unverified', 'audio_inaccessible', 'speaker_metadata_missing', 'chapter_missing']));
    expect(r.blockedBy).not.toContain('native_review_missing');
    expect(r.reasons.find((x) => x.code === 'native_review_missing')?.severity).toBe('warning');
    expect(canPublish({ ...lesson, nativeReviewed: false, requireNativeReview: true }, NOW).blockedBy).toEqual(['native_review_missing']);
  });

  it('blocks expired, revoked and revoked-asset content', () => {
    expect(canPublish({ ...lesson, rights: { ...goodRights, expiresAt: '2026-01-01T00:00:00Z' } }, NOW).blockedBy).toEqual(['rights_expired']);
    expect(canPublish({ ...lesson, rights: { ...goodRights, revokedAt: '2026-10-01T00:00:00Z' } }, NOW).blockedBy).toEqual(['rights_revoked']);
    expect(canPublish({ ...lesson, rights: { ...goodRights, expiresAt: '2027-01-01T00:00:00Z' } }, NOW).allowed).toBe(true);
    expect(canPublish({ ...lesson, asset: { ...lesson.asset!, disposition: 'revoked' } }, NOW).blockedBy).toEqual(['asset_revoked']);
    expect(canPublish({ ...lesson, rights: { ...goodRights, authors: [], attributionText: null } }, NOW).blockedBy).toEqual(['rights_unverified']);
  });

  it('requires alt text for visuals and tolerates unknown speakers', () => {
    const visual = canPublish({ entityKind: 'visual_asset', currentState: 'approved', title: 'Café scene', languageCode: 'ary', asset: { checksumVerified: true, disposition: 'active', accessible: true, byteLength: 10 }, rights: goodRights, nativeReviewed: true, altTextPresent: false }, NOW);
    expect(visual.blockedBy).toEqual(['alt_text_missing']);
    expect(canPublish({ ...lesson, speakers: { known: false, entries: [] } }, NOW).allowed).toBe(true);
    expect(canPublish({ ...lesson, speakers: null }, NOW).allowed).toBe(true);
  });
});

describe('attribution and rights helpers', () => {
  it('builds attribution text', () => {
    expect(buildAttributionText({ ...goodRights, title: 'Au café', speakers: ['Salma B.', 'Youssef'] })).toBe('"Au café" by Salma B., Youssef — CC BY 4.0 (https://example.org/darija)');
    expect(buildAttributionText({ ...goodRights, attributionText: '  Custom text  ' })).toBe('Custom text');
    expect(buildAttributionText({ ...goodRights, attributionRequired: false, attributionText: null })).toBeNull();
    expect(buildAttributionText({ licenseId: 'unknown-license', licenseVersion: '2', verified: true, commercialRedistribution: true, attributionRequired: true })).toBe('unknown-license 2');
  });

  it('isRightsActive and offlineEligible', () => {
    expect(isRightsActive(goodRights, NOW)).toBe(true);
    expect(isRightsActive({ ...goodRights, verified: false }, NOW)).toBe(false);
    expect(isRightsActive(null, NOW)).toBe(false);
    expect(offlineEligible({ state: 'published', rights: goodRights, assetDisposition: 'active' }, NOW)).toBe(true);
    expect(offlineEligible({ state: 'approved', rights: goodRights, assetDisposition: 'active' }, NOW)).toBe(false);
    expect(offlineEligible({ state: 'published', rights: { ...goodRights, commercialRedistribution: false }, assetDisposition: 'active' }, NOW)).toBe(false);
  });
});

describe('takedown propagation', () => {
  it('unpublishes, revokes offline eligibility and invalidates manifests on rights revocation', () => {
    const plan = propagateTakedown({
      entity: { table: 'audio_lessons', id: 'lesson-1', state: 'published' },
      reason: 'rights_revoked',
      manifests: [{ kind: 'audio_collection', courseTrackId: null, collectionId: 'col-1', sourceLanguageCode: null }, { kind: 'course', courseTrackId: 'arabic-moroccan', collectionId: null, sourceLanguageCode: 'fr' }],
      dependentPackIds: ['pack-1'],
      assetIds: ['asset-1'],
    });
    expect(plan.newState).toBe('unpublished');
    expect(plan.wasPublished).toBe(true);
    expect(plan.offlineEligibilityRevoked).toBe(true);
    expect(plan.purgeRequired).toBe(true);
    expect(plan.assetDisposition).toBe('revoked');
    expect(plan.revokePlaybackForAssetIds).toEqual(['asset-1']);
    expect(plan.cachePrefixesToPurge).toEqual(['manifest:audio:col-1:', 'manifest:course:arabic-moroccan:fr']);
    expect(plan.manifestInvalidations.every((m) => m.reason === 'rights_revoked')).toBe(true);
    expect(plan.dependentPackIds).toEqual(['pack-1']);
  });

  it('editorial unpublish keeps assets active and approved content falls back to rights_unverified on takedown', () => {
    const editorial = propagateTakedown({ entity: { table: 'missions', id: 'm', state: 'published' }, reason: 'editorial', manifests: [] });
    expect(editorial).toMatchObject({ newState: 'unpublished', assetDisposition: 'active', purgeRequired: false, revokePlaybackForAssetIds: [] });
    const staged = propagateTakedown({ entity: { table: 'audio_lessons', id: 'l', state: 'approved' }, reason: 'takedown', manifests: [], assetIds: ['a'] });
    expect(staged.newState).toBe('rights_unverified');
    expect(staged.wasPublished).toBe(false);
    expect(staged.revokePlaybackForAssetIds).toEqual(['a']);
  });
});
