import { describe, expect, it, vi } from 'vitest';
import { enrollmentRequestFromSelection, pendingOnboardingSelection, replayPendingOnboarding, type PendingOnboardingSelection } from './replay';

const darijaFromFrench: PendingOnboardingSelection = { trackId: 'arabic-moroccan', sourceLanguageCode: 'fr', scriptMode: 'both', regionalOption: 'casablanca', idempotencyKey: null };

describe('pendingOnboardingSelection', () => {
  it('is null until onboarding picked both a track and an instruction language', () => {
    expect(pendingOnboardingSelection({ pendingTrackId: null, pendingDefaultSourceLanguage: 'fr', pendingScriptMode: null, pendingRegionalOption: null, pendingEnrollmentKey: null })).toBeNull();
    expect(pendingOnboardingSelection({ pendingTrackId: 'arabic-moroccan', pendingDefaultSourceLanguage: null, pendingScriptMode: null, pendingRegionalOption: null, pendingEnrollmentKey: null })).toBeNull();
    expect(pendingOnboardingSelection({ pendingTrackId: 'arabic-moroccan', pendingDefaultSourceLanguage: 'fr', pendingScriptMode: 'both', pendingRegionalOption: 'casablanca', pendingEnrollmentKey: 'k1' })).toEqual({ ...darijaFromFrench, idempotencyKey: 'k1' });
  });
});

describe('enrollmentRequestFromSelection', () => {
  it('replays track, instruction language, script mode and regional option', () => {
    expect(enrollmentRequestFromSelection(darijaFromFrench)).toEqual({ courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'fr', scriptMode: 'both', regionalPreference: 'casablanca', learnerLevel: 'beginner' });
  });

  it('drops a script mode or regional option the track does not offer instead of substituting one', () => {
    expect(enrollmentRequestFromSelection({ ...darijaFromFrench, scriptMode: 'klingon', regionalOption: 'nowhere' })).toEqual({ courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'fr', learnerLevel: 'beginner' });
    expect(enrollmentRequestFromSelection({ trackId: 'german', sourceLanguageCode: 'en', scriptMode: 'latin', regionalOption: null, idempotencyKey: null })).toEqual({ courseTrackId: 'german', sourceLanguageCode: 'en', learnerLevel: 'beginner' });
  });

  it('rejects an unknown track, an unknown instruction language and learning a language from itself', () => {
    expect(enrollmentRequestFromSelection({ ...darijaFromFrench, trackId: 'klingon' })).toBeNull();
    expect(enrollmentRequestFromSelection({ ...darijaFromFrench, sourceLanguageCode: 'xx' })).toBeNull();
    expect(enrollmentRequestFromSelection({ trackId: 'french', sourceLanguageCode: 'fr', scriptMode: null, regionalOption: null, idempotencyKey: null })).toBeNull();
  });
});

describe('replayPendingOnboarding', () => {
  const base = { existingEnrollments: [], newIdempotencyKey: () => 'fresh-key', isRetryable: () => false };

  it('does nothing without a pending selection', async () => {
    const createEnrollment = vi.fn();
    expect(await replayPendingOnboarding({ ...base, selection: null, createEnrollment })).toEqual({ kind: 'nothing_pending' });
    expect(createEnrollment).not.toHaveBeenCalled();
  });

  it('creates the enrollment with the stored idempotency key (minting one only when absent)', async () => {
    const createEnrollment = vi.fn(async () => ({ id: 'enr-1' }));
    expect(await replayPendingOnboarding({ ...base, selection: { ...darijaFromFrench, idempotencyKey: 'stored-key' }, createEnrollment })).toEqual({ kind: 'created', enrollmentId: 'enr-1', idempotencyKey: 'stored-key' });
    expect(createEnrollment).toHaveBeenCalledWith({ courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'fr', scriptMode: 'both', regionalPreference: 'casablanca', learnerLevel: 'beginner' }, 'stored-key');
    expect(await replayPendingOnboarding({ ...base, selection: darijaFromFrench, createEnrollment })).toMatchObject({ kind: 'created', idempotencyKey: 'fresh-key' });
  });

  it('reuses a matching non-archived enrollment instead of creating a duplicate', async () => {
    const createEnrollment = vi.fn();
    const existingEnrollments = [
      { id: 'old', courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'fr', status: 'archived' },
      { id: 'enr-2', courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'fr', status: 'active' },
      { id: 'other', courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'en', status: 'active' },
    ];
    expect(await replayPendingOnboarding({ ...base, existingEnrollments, selection: darijaFromFrench, createEnrollment })).toEqual({ kind: 'existing', enrollmentId: 'enr-2' });
    expect(createEnrollment).not.toHaveBeenCalled();
  });

  it('drops a selection that cannot be honoured', async () => {
    expect(await replayPendingOnboarding({ ...base, selection: { ...darijaFromFrench, trackId: 'klingon' }, createEnrollment: vi.fn() })).toEqual({ kind: 'invalid' });
  });

  it('reports failures with the key to retry under, flagging connectivity errors as retryable', async () => {
    const offline = new Error('offline');
    const createEnrollment = vi.fn(async () => {
      throw offline;
    });
    const res = await replayPendingOnboarding({ ...base, selection: { ...darijaFromFrench, idempotencyKey: 'k' }, createEnrollment, isRetryable: (e) => e === offline });
    expect(res).toEqual({ kind: 'failed', error: offline, retryable: true, idempotencyKey: 'k' });
    const res2 = await replayPendingOnboarding({ ...base, selection: darijaFromFrench, createEnrollment });
    expect(res2).toMatchObject({ kind: 'failed', retryable: false, idempotencyKey: 'fresh-key' });
  });
});
