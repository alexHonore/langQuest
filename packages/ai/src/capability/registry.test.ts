import { describe, expect, it } from 'vitest';
import { COURSE_TRACKS, COURSE_TRACK_IDS, VARIETY_IDS, unsupportedCapability, type Capability, type SpeechRecognizer, type SpeechSynthesizer } from '@langquest/contracts';
import { AZURE_PRONUNCIATION_LOCALES, isAzurePronunciationLocale } from './azure-locales';
import { TRACK_CAPABILITY_MATRIX, VARIETY_CAPABILITIES, capabilityForTrack } from './matrix';
import { DefaultCapabilityRegistry, capabilityFromStatus, providerLocaleFor, resolveVariety, varietyBoundaryViolation } from './registry';

describe('Azure pronunciation locale table', () => {
  it('matches the 33-locale list fetched on 2026-10-14 and excludes ary / rw / ln / ht / Levantine', () => {
    expect(AZURE_PRONUNCIATION_LOCALES).toHaveLength(33);
    for (const l of ['ar-EG', 'zh-HK', 'zh-CN', 'da-DK', 'fr-FR', 'pt-BR', 'pt-PT', 'es-MX', 'es-ES', 'vi-VN']) expect(isAzurePronunciationLocale(l)).toBe(true);
    for (const l of ['ar-MA', 'ar-SY', 'ar-LB', 'rw-RW', 'ln-CD', 'ht-HT', 'sw-KE', 'he-IL', 'el-GR', 'uk-UA', 'ro-RO']) expect(isAzurePronunciationLocale(l)).toBe(false);
  });
});

describe('capability matrix', () => {
  it('has an honest entry for all 30 tracks and 29 varieties', () => {
    expect(Object.keys(TRACK_CAPABILITY_MATRIX)).toHaveLength(30);
    for (const id of COURSE_TRACK_IDS) expect(TRACK_CAPABILITY_MATRIX[id].trackId).toBe(id);
    for (const v of VARIETY_IDS) expect(VARIETY_CAPABILITIES[v].varietyId).toBe(v);
    expect(capabilityForTrack('chinese-simplified').stt).toEqual(capabilityForTrack('chinese-mandarin').stt);
  });
  it('never claims phoneme scoring for ary / rw / ln / ht / Levantine / sw and marks limited tracks', () => {
    for (const v of ['ary', 'rw', 'ln', 'ht', 'ar-levant', 'sw', 'el', 'he', 'uk', 'ro'] as const) expect(VARIETY_CAPABILITIES[v].pronunciation.phoneme.status).toBe('unavailable');
    for (const v of ['ary', 'arz', 'ar-levant', 'rw', 'ln', 'ht', 'sw'] as const) expect(['limited', 'unavailable']).toContain(VARIETY_CAPABILITIES[v].stt.status);
    expect(VARIETY_CAPABILITIES.arz.pronunciation.azureLocale).toBe('ar-EG');
    expect(VARIETY_CAPABILITIES.yue.pronunciation.azureLocale).toBe('zh-HK');
    expect(VARIETY_CAPABILITIES.rw.tts.status).toBe('unavailable');
    expect(VARIETY_CAPABILITIES.ln.tts.status).toBe('unavailable');
    for (const v of VARIETY_IDS) expect(VARIETY_CAPABILITIES[v].realtimeDuplex.status).toBe('unavailable');
  });
  it('carries evidence strings everywhere', () => {
    for (const t of COURSE_TRACKS) {
      const c = TRACK_CAPABILITY_MATRIX[t.id];
      for (const e of [c.stt, c.tts, c.realtimePipeline, c.pronunciation.word, c.pronunciation.phoneme]) expect(e.evidence.length).toBeGreaterThan(10);
    }
  });
});

describe('resolveVariety / providerLocaleFor', () => {
  it('maps locales, regional options and ids to varieties, never guessing ambiguous ones', () => {
    expect(resolveVariety('ar-MA')).toBe('ary');
    expect(resolveVariety('ar-EG')).toBe('arz');
    expect(resolveVariety('ar-SY')).toBe('ar-levant');
    expect(resolveVariety('ar-LB')).toBe('ar-levant');
    expect(resolveVariety('ar')).toBe('arb');
    expect(resolveVariety('zh-HK')).toBe('yue');
    expect(resolveVariety('yue')).toBe('yue');
    expect(resolveVariety('zh-CN')).toBe('cmn');
    expect(resolveVariety('zh-TW')).toBe('cmn');
    expect(resolveVariety('ht-HT')).toBe('ht');
    expect(resolveVariety('fr-CA')).toBe('fr');
    expect(resolveVariety('fr-BE')).toBe('fr');
    expect(resolveVariety('es-MX')).toBe('es-419');
    expect(resolveVariety('es-ES')).toBe('es-ES');
    expect(resolveVariety('arabic-moroccan')).toBe('ary');
    expect(resolveVariety('es')).toBeNull();
    expect(resolveVariety('pt')).toBeNull();
    expect(resolveVariety('zh')).toBeNull();
    expect(resolveVariety('xx-YY')).toBeNull();
  });
  it('returns provider locales honouring regional preferences', () => {
    expect(providerLocaleFor('ary')).toBe('ar-MA');
    expect(providerLocaleFor('ar-levant', 'LB')).toBe('ar-LB');
    expect(providerLocaleFor('es-419', 'CO')).toBe('es-CO');
    expect(providerLocaleFor('fr', 'CA')).toBe('fr-CA');
    expect(providerLocaleFor('fr', 'nope')).toBe('fr-FR');
  });
});

describe('variety boundary', () => {
  it('rejects forbidden substitutions and different varieties', () => {
    expect(varietyBoundaryViolation('p', 'ary', 'ar-MA')).toBeNull();
    expect(varietyBoundaryViolation('p', 'ary', 'ar')).toMatchObject({ supported: false, reasons: ['variety_boundary'] });
    expect(varietyBoundaryViolation('p', 'yue', 'zh-CN')?.notes[0]).toMatch(/forbidden/);
    expect(varietyBoundaryViolation('p', 'ht', 'fr-FR')?.reasons).toEqual(['variety_boundary']);
    expect(varietyBoundaryViolation('p', 'pt-PT', 'pt-BR')?.supported).toBe(false);
    expect(varietyBoundaryViolation('p', 'es-ES', 'es-MX')?.supported).toBe(false);
    expect(varietyBoundaryViolation('p', 'fr', 'xx')?.reasons).toEqual(['locale_unsupported']);
  });
  it('capabilityFromStatus derives supported/reasons/quality', () => {
    expect(capabilityFromStatus({ provider: 'p', status: 'limited', effectiveLocale: 'ar-MA', latencyClass: 'interactive' })).toMatchObject({ supported: true, reasons: ['not_benchmarked'], qualityEstimate: 0.35, effectiveLocale: 'ar-MA' });
    expect(capabilityFromStatus({ provider: 'p', status: 'unavailable', effectiveLocale: 'rw-RW', latencyClass: 'interactive' })).toMatchObject({ supported: false, effectiveLocale: null, qualityEstimate: null });
  });
});

describe('DefaultCapabilityRegistry', () => {
  const cap = (provider: string, locale: string, extra: Partial<Capability> = {}): Capability => ({ supported: true, reasons: [], features: { word: true, phoneme: false, tone: false, prosody: false, streaming: false, interruptible: false, codeSwitch: false, multiSpeaker: false }, latencyClass: 'interactive', effectiveLocale: locale, qualityEstimate: 0.5, provider, notes: [], ...extra });
  const recognizer = (provider: string, answer: (locale: string) => Capability): SpeechRecognizer => ({ provider, supports: async (l) => answer(l), transcribe: async () => { throw new Error('n/a'); } });
  const synthesizer = (provider: string, answer: (locale: string) => Capability): SpeechSynthesizer => ({ provider, supports: async (l) => answer(l), synthesize: async () => { throw new Error('n/a'); } });

  it('skips adapters whose effective locale crosses the variety boundary even if they claim support', async () => {
    const crossing = recognizer('msa-only', () => cap('msa-only', 'ar')); // would serve Darija with MSA
    const honest = recognizer('darija', (l) => (resolveVariety(l) === 'ary' ? cap('darija', 'ar-MA') : unsupportedCapability('darija', ['locale_unsupported'])));
    const registry = new DefaultCapabilityRegistry({ recognizers: [crossing, honest], synthesizers: [], realtime: [], assessors: [] });
    const pick = await registry.recognizerFor('ar-MA');
    expect(pick?.adapter.provider).toBe('darija');
    expect(await registry.recognizerFor('es')).toBeNull();
    expect(await registry.synthesizerFor('ar-MA')).toBeNull();
  });
  it('requires every requested pronunciation feature', async () => {
    const assessor = { provider: 'a', supports: async () => true, capability: async () => cap('a', 'fr-FR', { features: { word: true, phoneme: true, tone: false, prosody: false, streaming: false, interruptible: false, codeSwitch: false, multiSpeaker: false } }), assess: async () => { throw new Error('n/a'); } };
    const registry = new DefaultCapabilityRegistry({ recognizers: [], synthesizers: [synthesizer('s', () => cap('s', 'fr-FR'))], realtime: [], assessors: [assessor] });
    expect((await registry.assessorFor('fr-FR', ['word', 'phoneme']))?.adapter.provider).toBe('a');
    expect(await registry.assessorFor('fr-FR', ['tone'])).toBeNull();
    expect((await registry.synthesizerFor('fr-CA'))?.capability.effectiveLocale).toBe('fr-FR');
  });
});
