import { describe, expect, it } from 'vitest';
import { deriveSetup, isLocalSupabase, type SetupSignals, type TrackCapabilityInput } from './derive';

const usable: TrackCapabilityInput = { speechRecognition: true, speechSynthesis: true, realtimeConversation: true, pronunciationScoring: 'limited' };
const none: TrackCapabilityInput = { speechRecognition: false, speechSynthesis: false, realtimeConversation: false, pronunciationScoring: 'none' };

const base: SetupSignals = {
  supabaseUrl: 'http://127.0.0.1:54321',
  apiBaseUrl: 'http://127.0.0.1:8787',
  health: { mediaMode: 'none' },
  tracks: [usable, usable, none],
};

describe('deriveSetup', () => {
  it('local stack without R2 or Azure: media + speech missing, AI ok, Setup is incomplete', () => {
    const s = deriveSetup(base, new Date('2026-10-19T12:00:00Z'));
    const by = Object.fromEntries(s.items.map((i) => [i.key, i]));
    expect(by.supabase?.state).toBe('ok');
    expect(by.supabase?.nextStepKey).toBe('admin.ui.setup.supabase.step.local');
    expect(by.api?.state).toBe('ok');
    expect(by.media?.state).toBe('missing');
    expect(by.ai?.state).toBe('ok');
    expect(by.ai?.detail).toBe('2/3');
    expect(by.speech?.state).toBe('missing');
    expect(by.email?.state).toBe('manual');
    // The Studio host holds no provider key: the AI test harness runs on the API, so there is no admin-host item.
    expect(s.items.map((i) => i.key)).toEqual(['supabase', 'api', 'media', 'ai', 'speech', 'email']);
    expect(s.capabilities).toEqual({ apiReachable: true, mediaMode: 'none', mediaAvailable: false, aiAvailable: true, acousticScoring: false, supabaseMode: 'local' });
    expect(s.incomplete).toBe(true);
    expect(s.checkedAt).toBe('2026-10-19T12:00:00.000Z');
  });

  it('unreachable API: everything downstream is unknown (never pretend-missing), Supabase still reported', () => {
    const s = deriveSetup({ ...base, health: null, tracks: null });
    const by = Object.fromEntries(s.items.map((i) => [i.key, i]));
    expect(by.api?.state).toBe('missing');
    expect(by.media?.state).toBe('unknown');
    expect(by.ai?.state).toBe('unknown');
    expect(by.speech?.state).toBe('unknown');
    expect(s.capabilities.apiReachable).toBe(false);
    expect(s.capabilities.mediaAvailable).toBe(false);
    expect(s.capabilities.aiAvailable).toBe(false);
    expect(s.incomplete).toBe(true);
  });

  it('fully configured hosted deployment: nothing blocking (e-mail is verified by hand and never blocks)', () => {
    const s = deriveSetup({
      supabaseUrl: 'https://abc.supabase.co',
      apiBaseUrl: 'https://api.langquest.app',
      health: { mediaMode: 's3+binding' },
      tracks: [{ ...usable, pronunciationScoring: 'full' }, usable],
    });
    const by = Object.fromEntries(s.items.map((i) => [i.key, i]));
    expect(by.media?.state).toBe('ok');
    expect(by.media?.detail).toBe('s3+binding');
    expect(by.speech?.state).toBe('ok');
    expect(by.speech?.detail).toBe('1/2');
    expect(s.capabilities.supabaseMode).toBe('hosted');
    expect(s.capabilities.acousticScoring).toBe(true);
    expect(s.incomplete).toBe(false);
  });

  it('no AI key on the API: AI missing and acoustic scoring cannot be checked (depends on the AI route)', () => {
    const s = deriveSetup({ ...base, tracks: [none, none] });
    const by = Object.fromEntries(s.items.map((i) => [i.key, i]));
    expect(by.ai?.state).toBe('missing');
    expect(by.speech?.state).toBe('unknown');
    expect(s.capabilities.aiAvailable).toBe(false);
  });

  it('media storage needs a reachable API: a cached healthz mode never survives an outage', () => {
    const s = deriveSetup({ ...base, health: null });
    expect(s.capabilities.mediaAvailable).toBe(false);
    expect(s.capabilities.mediaMode).toBe('none');
  });
});

describe('isLocalSupabase', () => {
  it('recognises loopback and .localhost hosts only', () => {
    expect(isLocalSupabase('http://127.0.0.1:54321')).toBe(true);
    expect(isLocalSupabase('http://localhost:54321')).toBe(true);
    expect(isLocalSupabase('http://db.localhost')).toBe(true);
    expect(isLocalSupabase('https://abc.supabase.co')).toBe(false);
    expect(isLocalSupabase('not a url')).toBe(false);
  });
});
