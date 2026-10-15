import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PRIVACY_REDACTIONS, type TelemetryEvent } from '@langquest/contracts';
import { applyPrivacyLevel, hashFreeText, hmacSha256Hex, isExpired, isHashRef, isPseudonymousLearnerId, privacyAtMost, Pseudonymizer, pseudonymizeLearnerId, redactDeep, redactText, RETENTION_POLICY, retentionCutoff, sha256Hex } from './privacy';

describe('sha256 / hmac', () => {
  it('matches node:crypto for known vectors and multi-block inputs', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    for (const len of [55, 56, 63, 64, 65, 119, 120, 1000]) {
      const s = 'é'.repeat(len);
      expect(sha256Hex(s)).toBe(createHash('sha256').update(s).digest('hex'));
    }
  });
  it('hmac matches node:crypto, including long keys', () => {
    for (const key of ['k', 'x'.repeat(70)]) {
      expect(hmacSha256Hex(key, 'message')).toBe(createHmac('sha256', key).update('message').digest('hex'));
    }
  });
});

describe('redactText', () => {
  it('strips emails, phone numbers and bearer tokens', () => {
    expect(redactText('contact me at jane.doe+x@example.org')).toBe('contact me at [email]');
    expect(redactText('call +1 (514) 555-0199 now')).toBe('call [phone] now');
    expect(redactText('call 0612345678')).toBe('call [phone]');
    expect(redactText('Authorization: Bearer abcdefghijklmnop1234')).toBe('Authorization: [secret]');
    expect(redactText('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlX3h4eHg')).toBe('jwt [secret]');
  });
  it('keeps short identifiers and years intact', () => {
    expect(redactText('mission_42')).toBe('mission_42');
    expect(redactText('seen in 2026')).toBe('seen in 2026');
    expect(redactText('arabic-moroccan')).toBe('arabic-moroccan');
  });
  it('hashes long free text deterministically and idempotently', () => {
    const text = 'Bonjour, je voudrais réserver une table pour deux personnes ce soir vers vingt heures, merci.';
    const r = redactText(text);
    expect(isHashRef(r)).toBe(true);
    expect(r).toBe(hashFreeText(text));
    expect(redactText(r)).toBe(r);
    expect(redactText(text, { maxFreeTextLength: 500 })).toBe(text);
  });
  it('redactDeep copies structures without mutating', () => {
    const input = { a: 'x@y.io', nested: { list: ['ok', '+33 6 12 34 56 78'] }, n: 3, b: null };
    const out = redactDeep(input);
    expect(out).toEqual({ a: '[email]', nested: { list: ['ok', '[phone]'] }, n: 3, b: null });
    expect(input.a).toBe('x@y.io');
  });
});

describe('pseudonymisation', () => {
  it('is stable per salt and differs across salts', () => {
    const a = pseudonymizeLearnerId('8C4C1A5E-4C77-4E5E-9D4B-2F6B5C1F0A11', 'salt-1');
    expect(a).toBe(pseudonymizeLearnerId('8c4c1a5e-4c77-4e5e-9d4b-2f6b5c1f0a11', 'salt-1'));
    expect(a).not.toBe(pseudonymizeLearnerId('8c4c1a5e-4c77-4e5e-9d4b-2f6b5c1f0a11', 'salt-2'));
    expect(isPseudonymousLearnerId(a)).toBe(true);
    expect(() => pseudonymizeLearnerId('x', '')).toThrow();
    const p = new Pseudonymizer('salt-1');
    expect(p.learner('8c4c1a5e-4c77-4e5e-9d4b-2f6b5c1f0a11')).toBe(a);
    expect(p.other('device', 'abc')).toMatch(/^device_[0-9a-f]{32}$/);
  });
});

describe('retention', () => {
  it('computes cutoffs and expiry', () => {
    const now = new Date('2026-10-14T00:00:00Z');
    expect(retentionCutoff('telemetryEventsDays', now).toISOString()).toBe(new Date(now.getTime() - RETENTION_POLICY.telemetryEventsDays * 86_400_000).toISOString());
    expect(isExpired('learnerAudioDays', '2026-09-01T00:00:00Z', now)).toBe(true);
    expect(isExpired('learnerAudioDays', '2026-10-01T00:00:00Z', now)).toBe(false);
  });
});

describe('applyPrivacyLevel', () => {
  const event: TelemetryEvent = {
    eventId: '0d8c1b48-5c7e-4d7a-9c2a-0f6a1e3b4c5d',
    occurredAt: '2026-10-14T10:00:00.000Z',
    platform: 'ios',
    appVersion: '1.0.0',
    sessionId: 'sess',
    userHash: 'u_abc',
    enrollmentId: '1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b',
    trackId: 'arabic-moroccan',
    targetVarietyId: 'ary',
    sourceLanguageCode: 'fr',
    privacyLevel: 'personal',
    name: 'client_crash',
    category: 'error',
    props: { fingerprint: 'crash at mail jane@x.io', fatal: true, screen: null },
  };
  it('projects to the ceiling and strips base fields per PRIVACY_REDACTIONS', () => {
    const anon = applyPrivacyLevel(event, 'anonymous');
    expect(anon.privacyLevel).toBe('anonymous');
    for (const f of PRIVACY_REDACTIONS.anonymous) expect(anon[f]).toBeNull();
    expect(anon.trackId).toBe('arabic-moroccan');
    expect(anon.props.fingerprint).toBe('crash at mail [email]');
    const pseudo = applyPrivacyLevel(event, 'pseudonymous');
    expect(pseudo.userHash).toBe('u_abc');
    expect(pseudo.enrollmentId).toBeNull();
    expect(event.enrollmentId).not.toBeNull();
  });
  it('never raises an event above its own level', () => {
    const anonEvent = { ...event, privacyLevel: 'anonymous' as const };
    expect(applyPrivacyLevel(anonEvent, 'personal').privacyLevel).toBe('anonymous');
    expect(privacyAtMost('pseudonymous', 'personal')).toBe(true);
    expect(privacyAtMost('personal', 'anonymous')).toBe(false);
  });
});
