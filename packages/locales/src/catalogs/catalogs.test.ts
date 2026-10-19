import {
  CONVERSATION_MODE_VALUES,
  COURSE_TRACKS,
  LEARNER_LEVEL_VALUES,
  CONVERSATION_STATE_VALUES,
  MASCOT_STATE_VALUES,
  MASTERY_STATE_VALUES,
  MISSION_STEP_TYPE_VALUES,
  OBSERVATION_OUTCOME_VALUES,
  PronunciationFeatureSchema,
  ROLE_VALUES,
  SCORING_SUPPORT_VALUES,
  SPEAKER_CONSENT_STATE_VALUES,
  SPEECH_RETENTION_VALUES,
  SPEECH_STATE_VALUES,
  TRANSCRIPT_STATUS_VALUES,
  WordScoreSchema,
} from '@langquest/contracts';
import { describe, expect, it } from 'vitest';
import { findInvalidIcuMessages } from '../i18n';
import {
  ADMIN_UI_NAMESPACE,
  AUDIO_LISTEN_NAMESPACE,
  CATALOGS,
  CATALOG_NAMESPACES,
  CATALOG_SECTIONS,
  COVER_ALT_TEXT_PREFIX,
  REQUIRED_PARTIAL_NAMESPACES,
  SUPPORTED_UI_LOCALES,
  coverAltTextKey,
  flattenCatalog,
  getFlatCatalog,
  type MessageCatalog,
} from './index';

const en = getFlatCatalog('en');
const fr = getFlatCatalog('fr');

/** Nested object at a dotted path of a catalog (throws when the path is not an object). */
function nestedAt(catalog: MessageCatalog, path: string): Record<string, string | MessageCatalog> {
  let cur: string | MessageCatalog = catalog;
  for (const part of path.split('.')) {
    if (typeof cur === 'string' || !(part in cur)) throw new Error(`${path} is not a nested namespace`);
    cur = cur[part]!;
  }
  if (typeof cur === 'string') throw new Error(`${path} is a leaf, not a namespace`);
  return cur;
}

/** Word-score error types from the contract (`WordScoreSchema.errorType`, nullable enum). */
const WORD_SCORE_ERROR_TYPES = WordScoreSchema.shape.errorType.unwrap().options;
const PRONUNCIATION_FEATURES = PronunciationFeatureSchema.options;

describe('catalog structure', () => {
  it('en has every namespace from the fixed list and nothing else', () => {
    expect(Object.keys(CATALOGS.en).sort()).toEqual([...CATALOG_NAMESPACES].sort());
  });

  it('en and fr have identical key sets', () => {
    const enKeys = Object.keys(en).sort();
    const frKeys = Object.keys(fr).sort();
    expect(frKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
    expect(enKeys.filter((k) => !frKeys.includes(k))).toEqual([]);
    expect(enKeys.length).toBeGreaterThan(500);
  });

  it('es and ru carry exactly the required partial namespaces, with the full key set of each', () => {
    for (const locale of ['es', 'ru'] as const) {
      const flat = getFlatCatalog(locale);
      expect(Object.keys(CATALOGS[locale]).sort()).toEqual([...REQUIRED_PARTIAL_NAMESPACES].sort());
      const expected = Object.keys(en).filter((k) => (REQUIRED_PARTIAL_NAMESPACES as readonly string[]).includes(k.split('.')[0]!));
      expect(Object.keys(flat).sort()).toEqual(expected.sort());
    }
  });

  it('no message is empty or whitespace-only', () => {
    for (const locale of SUPPORTED_UI_LOCALES) {
      const empty = Object.entries(getFlatCatalog(locale)).filter(([, v]) => v.trim() === '');
      expect(empty, `${locale} empty messages`).toEqual([]);
    }
  });

  it('every message compiles as ICU MessageFormat in its locale', () => {
    for (const locale of SUPPORTED_UI_LOCALES) {
      expect(findInvalidIcuMessages(getFlatCatalog(locale), locale), `${locale} ICU errors`).toEqual([]);
    }
  });

  it('fr messages use the same ICU argument names as en', () => {
    const args = (msg: string) => [...msg.matchAll(/\{\s*([A-Za-z0-9_]+)\s*[,}]/g)].map((m) => m[1]).sort();
    for (const [key, enMsg] of Object.entries(en)) {
      expect(args(fr[key]!), key).toEqual(args(enMsg));
    }
  });

  it('fr is not a copy of en (natural translation, not placeholder)', () => {
    const identical = Object.keys(en).filter((k) => en[k] === fr[k]);
    // Brand names, numbers-only and short tokens may legitimately match.
    expect(identical.length / Object.keys(en).length).toBeLessThan(0.08);
  });
});

describe('spec-mandated copy', () => {
  it('has the onboarding promise and the learn-from confirmation', () => {
    expect(en['onboarding.heroPromise']).toBe('Start speaking from day one');
    expect(en['onboarding.learnFrom']).toBe('Learn {target} from {source}');
    expect(fr['onboarding.heroPromise']).toMatch(/premier jour/);
  });

  it('pronunciation copy is honest by omission (CONVENTIONS §8): no "not available" line, only what WAS assessed', () => {
    for (const key of ['pronunciation.feedback.phonemeUnavailable', 'pronunciation.feedback.scoreUnavailable', 'pronunciation.feedback.toneUnavailable']) {
      expect(en[key], key).toBeUndefined();
    }
    expect(en['pronunciation.feedback.mode.reference-comparison']).toBeTruthy();
    expect(en['pronunciation.feedback.mode.semantic-only']).toBeTruthy();
  });

  it('covers every mascot state with speech and an accessibility label', () => {
    for (const state of MASCOT_STATE_VALUES) {
      expect(en[`mascot.state.${state}`], state).toBeTruthy();
      expect(en[`mascot.a11yState.${state}`], state).toBeTruthy();
    }
  });

  it('covers mastery states, speech states, conversation states and admin roles', () => {
    for (const s of MASTERY_STATE_VALUES) expect(en[`progress.mastery.${s}`], s).toBeTruthy();
    for (const s of SPEECH_STATE_VALUES) expect(en[`speak.state.${s}`], s).toBeTruthy();
    for (const s of CONVERSATION_STATE_VALUES) expect(en[`speak.state.${s}`], s).toBeTruthy();
    for (const r of ROLE_VALUES) expect(en[`admin.roles.${r}`], r).toBeTruthy();
  });

  /**
   * Namespaces keyed by a @langquest/contracts enum must use the exact enum spellings, and
   * nothing else, so `t(`${ns}.${value}`)` built from a contract value never misses.
   * `extra` lists non-enum keys the namespace may also carry (e.g. a `label`).
   */
  const ENUM_KEYED_NAMESPACES: ReadonlyArray<{ path: string; values: readonly string[]; extra?: readonly string[] }> = [
    { path: 'account.speakMode', values: CONVERSATION_MODE_VALUES, extra: ['label'] },
    { path: 'account.privacy.speechRetention', values: SPEECH_RETENTION_VALUES, extra: ['label'] },
    { path: 'admin.speakersSection.consentState', values: SPEAKER_CONSENT_STATE_VALUES },
    { path: 'admin.transcripts.status', values: TRANSCRIPT_STATUS_VALUES },
    { path: 'progress.outcome', values: OBSERVATION_OUTCOME_VALUES },
    { path: 'catalog.scoringSupport', values: SCORING_SUPPORT_VALUES },
    { path: 'lesson.stepTypes', values: MISSION_STEP_TYPE_VALUES },
    { path: 'progress.mastery', values: MASTERY_STATE_VALUES },
    { path: 'admin.roles', values: ROLE_VALUES },
    { path: 'pronunciation.feedback.errorType', values: WORD_SCORE_ERROR_TYPES },
    { path: 'pronunciation.feedback.feature', values: PRONUNCIATION_FEATURES },
    { path: 'audio.listen.level', values: LEARNER_LEVEL_VALUES },
  ];

  it.each(ENUM_KEYED_NAMESPACES)('$path is keyed exactly by its contract enum (en and fr)', ({ path, values, extra = [] }) => {
    expect(values.length).toBeGreaterThan(0);
    for (const locale of ['en', 'fr'] as const) {
      const flat = getFlatCatalog(locale);
      for (const value of values) expect(flat[`${path}.${value}`], `${locale}:${path}.${value}`).toBeTruthy();
      const keys = Object.keys(nestedAt(CATALOGS[locale], path)).sort();
      expect(keys, `${locale}:${path} keys`).toEqual([...values, ...extra].sort());
    }
  });

  it('provides catalog counterparts for the ui SpeakButton and pronunciation label sets', () => {
    for (const k of ['release', 'processing', 'disabled', 'switchToTap', 'switchToHold']) {
      expect(en[`speak.button.${k}`], k).toBeTruthy();
      expect(fr[`speak.button.${k}`], k).toBeTruthy();
    }
    for (const k of ['wordScores', 'retrySegment', 'scoreOutOf', 'wordLevel', 'phonemeLevel']) {
      expect(en[`pronunciation.feedback.${k}`], k).toBeTruthy();
      expect(fr[`pronunciation.feedback.${k}`], k).toBeTruthy();
    }
    expect(WORD_SCORE_ERROR_TYPES).toContain('mispronunciation');
    expect(PRONUNCIATION_FEATURES).toEqual(['word', 'phoneme', 'tone', 'prosody']);
  });

  it('lists every §7.1 admin section', () => {
    const sections = Object.keys(CATALOGS.en.admin as Record<string, unknown>);
    expect(Object.keys((CATALOGS.en.admin as { sections: Record<string, string> }).sections)).toHaveLength(19);
    expect(sections).toContain('sections');
  });

  describe('free product (CONVENTIONS §6, spec §0.1 / §13 rule 9)', () => {
    /**
     * Monetization vocabulary in any shipped UI language. `\p{L}` boundaries are used instead
     * of `\b` because `\b` is ASCII-only in JavaScript and would never fire around Cyrillic.
     */
    const FORBIDDEN =
      /(?<!\p{L})(?:premium|pro plans?|subscri(?:be|ption)s?|paywalls?|credits?|coins?|tiers?|quotas?|trials?|upgrades?|unlock (?:all|pro|everything)|minutes? (?:left|remaining)|(?:daily|usage|monthly) limits?|allowances?|crédits?|abonnements?|niveau premium|essai gratuit|contenu payant|créditos?|suscripci(?:ón|ones)|prueba gratuita|contenido de pago|кредит\p{L}*|подписк\p{L}*|премиум|платн\p{L}*)(?!\p{L})/iu;

    /**
     * Copy that *denies* paywalls is allowed, but only the exact denial phrase is exempt:
     * it is removed before testing so the rest of the message is still checked.
     */
    const DENIAL_PHRASES: readonly RegExp[] = [
      /\bno (?:subscriptions?|paywalls?)\b/gi,
      /\bnothing to unlock or buy\b/gi,
      /\bsans (?:abonnement|contenu payant)\b/gi,
      /\brien à débloquer ni à acheter\b/gi,
      /\bsin suscripciones\b/gi,
      /\bni contenido de pago\b/gi,
      /\bnada que desbloquear ni comprar\b/gi,
      /без подписок/gi,
      /платного контента/gi,
      /нечего разблокировать или покупать/gi,
    ];

    const stripDenials = (msg: string): string => DENIAL_PHRASES.reduce((m, re) => m.replace(re, ' '), msg);
    const violates = (msg: string): boolean => FORBIDDEN.test(stripDenials(msg));

    /**
     * Keys whose wording resembles a limit or a currency but is pedagogical, legal or
     * descriptive. Each entry documents why it is not a commercial limit; the stricter
     * pattern below still applies to them so the allowlist cannot hide a real violation.
     */
    const ALLOWLIST: Readonly<Record<string, string>> = {
      'legal.attributionsIntro': '"We credit every source" is attribution (verb), not a credit currency.',
      'missions.status.locked': 'Progression gating: a mission unlocks by completing the previous one, never by paying.',
      'audio.progress.remaining': 'Remaining playback time of the lesson audio, not a usage allowance.',
      'audio.attribution': 'Narrator credit line required by the audio licence.',
    };
    const HARD_FORBIDDEN = /(?<!\p{L})(?:premium|paywalls?|subscri(?:be|ption)s?|upgrades?|abonnements?|suscripci(?:ón|ones)|подписк\p{L}*|премиум)(?!\p{L})/iu;

    it('the guard catches monetization wording even next to a denial phrase', () => {
      for (const sample of [
        'No paywalls — upgrade to Premium for unlimited minutes',
        'Buy credits to continue',
        'You have 3 minutes left today',
        'Daily limit reached',
        'Start your free trial',
        'Unlock all lessons',
        'Sans abonnement, mais passez au niveau premium',
        'Achetez des crédits',
        'Sin suscripciones: pasa a premium',
        'Без подписок. Купите кредиты',
        'Оформите подписку',
      ]) {
        expect(violates(sample), sample).toBe(true);
      }
      for (const sample of [
        en['onboarding.heroSubtitle']!,
        fr['onboarding.heroSubtitle']!,
        getFlatCatalog('es')['onboarding.heroSubtitle']!,
        getFlatCatalog('ru')['onboarding.heroSubtitle']!,
        en['onboarding.noPaywall']!,
        '3 min left',
        'Locked',
        'Un problème est survenu. Nouvel essai.',
      ]) {
        expect(violates(sample), sample).toBe(false);
      }
    });

    it('never mentions paywalls, premium tiers, credits, trials or usage limits as product features', () => {
      for (const locale of SUPPORTED_UI_LOCALES) {
        for (const [key, msg] of Object.entries(getFlatCatalog(locale))) {
          if (key in ALLOWLIST) {
            expect(HARD_FORBIDDEN.test(msg), `${locale}:${key} (allowlisted: ${ALLOWLIST[key]})`).toBe(false);
            continue;
          }
          expect(violates(msg), `${locale}:${key} = ${JSON.stringify(msg)}`).toBe(false);
        }
      }
    });

    it('allowlist entries exist in en (no stale exemptions)', () => {
      for (const key of Object.keys(ALLOWLIST)) expect(en[key], key).toBeTruthy();
    });
  });

  it('mascot speech never guilts the learner', () => {
    const guilt = /\b(you (missed|forgot|let)|don't leave|streak (is )?(at risk|lost)|disappointed)\b/i;
    for (const [key, msg] of Object.entries(en)) {
      if (key.startsWith('mascot.')) expect(guilt.test(msg), key).toBe(false);
    }
  });
});

describe('app-facing sections (cross-package gaps 2026-10-15)', () => {
  const keysUnder = (flat: Record<string, string>, prefix: string) => Object.keys(flat).filter((k) => k.startsWith(`${prefix}.`));

  it('every section is a nested namespace in en and fr with the same key set', () => {
    for (const section of CATALOG_SECTIONS) {
      const enKeys = keysUnder(en, section).sort();
      expect(enKeys.length, section).toBeGreaterThan(0);
      expect(keysUnder(fr, section).sort(), section).toEqual(enKeys);
      nestedAt(CATALOGS.en, section);
      nestedAt(CATALOGS.fr, section);
    }
  });

  it('admin.ui carries the admin studio editor copy (formerly apps/admin extra.ts)', () => {
    const keys = keysUnder(en, ADMIN_UI_NAMESPACE);
    expect(keys.length).toBeGreaterThanOrEqual(330);
    for (const k of ['signIn', 'signOut', 'denied', 'rowsSelected', 'upState.queued', 'upState.failed', 'rtGateHint', 'jbRetryHint', 'anNeedsApi', 'usSelfRevoke', 'auNoAccess']) {
      expect(en[`admin.ui.${k}`], k).toBeTruthy();
      expect(fr[`admin.ui.${k}`], k).toBeTruthy();
    }
    expect(en['admin.ui.denied']).toBe('Your role cannot open {section}.');
    expect(fr['admin.ui.denied']).toMatch(/\{section\}/);
  });

  it('catalog.cover has an alt text for every course track, addressed by coverAltTextKey', () => {
    expect(coverAltTextKey('arabic-eastern')).toBe('catalog.cover.arabic_eastern');
    expect(coverAltTextKey('japanese')).toBe('catalog.cover.japanese');
    const coverKeys = Object.keys(nestedAt(CATALOGS.en, COVER_ALT_TEXT_PREFIX)).sort();
    expect(coverKeys).toEqual(COURSE_TRACKS.map((t) => t.id.replace(/-/g, '_')).sort());
    for (const track of COURSE_TRACKS) {
      const key = coverAltTextKey(track.id);
      expect(en[key], key).toMatch(/^Course cover for /);
      expect(en[key], key).toContain(track.displayName);
      expect(fr[key], key).toMatch(/^Couverture du cours /);
      // Alt text describes the abstract artwork honestly: no flags or cultural clichés (covers.ts contract).
      expect(en[key], key).toMatch(/abstract/);
      expect(fr[key], key).toMatch(/abstrait/);
    }
  });

  it('audio.listen carries the mobile audio library copy (formerly apps/mobile audio labels)', () => {
    const keys = keysUnder(en, AUDIO_LISTEN_NAMESPACE);
    expect(keys.length).toBeGreaterThanOrEqual(80);
    for (const k of ['continueListening', 'loopRange', 'saveExpression', 'storageNotEnabled', 'rightsBlocked', 'verifiedSha256', 'verifiedLength', 'rate', 'minutesLeft', 'deviceFree']) {
      expect(en[`audio.listen.${k}`], k).toBeTruthy();
      expect(fr[`audio.listen.${k}`], k).toBeTruthy();
    }
    // download failure codes used by apps/mobile download-manager
    expect(Object.keys(nestedAt(CATALOGS.en, 'audio.listen.failure')).sort()).toEqual(
      ['offline', 'wifi_required', 'rights_blocked', 'media_unavailable', 'checksum_mismatch', 'disk_full', 'http', 'unknown'].sort(),
    );
    // function labels became ICU arguments
    expect(en['audio.listen.lessonsCount']).toContain('plural');
    expect(en['audio.listen.translationUnavailable']).toContain('{language}');
    // honest media states: no claim that the audio is altered or scored
    expect(en['audio.listen.transcriptMachine']).toMatch(/not yet reviewed/);
    expect(en['audio.listen.originalAudio']).toMatch(/unaltered/);
  });
});

describe('flattenCatalog', () => {
  it('flattens nested objects to dot keys and ignores non-strings', () => {
    expect(flattenCatalog({ a: { b: 'x', c: { d: 'y' } }, e: 'z' })).toEqual({ 'a.b': 'x', 'a.c.d': 'y', e: 'z' });
  });
});
