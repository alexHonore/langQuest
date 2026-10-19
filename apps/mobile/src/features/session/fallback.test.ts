import { describe, expect, it } from 'vitest';
import { resolveFallbackOptIn } from './fallback';

const enrollment = (fallback: 'en' | 'fr' | null) => ({ id: 'e1', coverage: { status: 'planned' as const, nativeReviewed: false, editorialNoteKey: null, fallbackSourceLanguageCode: fallback } });

describe('fallback opt-in (§2.1)', () => {
  it('serves nothing in the fallback language until the learner opted in', () => {
    expect(resolveFallbackOptIn(enrollment('en'), {})).toEqual({ offered: 'en', active: null });
    expect(resolveFallbackOptIn(enrollment('en'), { e1: 'en' })).toEqual({ offered: 'en', active: 'en' });
  });
  it('withdraws a stale acceptance when the offered fallback changes or disappears', () => {
    expect(resolveFallbackOptIn(enrollment('fr'), { e1: 'en' }).active).toBeNull();
    expect(resolveFallbackOptIn(enrollment(null), { e1: 'en' })).toEqual({ offered: null, active: null });
  });
});
