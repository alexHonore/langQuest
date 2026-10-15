import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { memoryIo } from './cli';
import { ExpressionDraftSchema } from './drafts';
import { readLines } from './io';
import { importTatoeba, locateTatoebaFiles, parseAudioLine, parseLinkLine, parseSentenceLine, resolveVariety, tatoebaAttribution } from './tatoeba';

const FIXTURES = resolve(__dirname, '../fixtures/tatoeba');

describe('tatoeba parsers', () => {
  it('parses plain and detailed sentence lines, links and audio rows', () => {
    expect(parseSentenceLine('2481\tspa\t¡Intentemos algo!')).toEqual({ id: '2481', lang: 'spa', text: '¡Intentemos algo!', username: null });
    expect(parseSentenceLine('2481\tspa\thola\tuser1\t2020-01-01\t\\N')).toMatchObject({ username: 'user1' });
    expect(parseSentenceLine('garbage')).toBeNull();
    expect(parseLinkLine('2481\t1276')).toEqual({ sentenceId: '2481', translationId: '1276' });
    expect(parseAudioLine('3001\t9001\tmarcelostockle\tCC BY-NC 4.0\t')).toEqual({ sentenceId: '3001', audioId: '9001', username: 'marcelostockle', license: 'CC BY-NC 4.0', attributionUrl: null });
  });

  it('streams .bz2 files through the system bzip2 and stops the decompressor on early exit', async () => {
    const lines: string[] = [];
    for await (const l of readLines(resolve(FIXTURES, 'spa_sentences_bz2_copy.tsv.bz2'))) lines.push(l);
    expect(lines[0]).toBe('2481\tspa\t¡Intentemos algo!');
    expect(lines.length).toBe(13);
    const partial: string[] = [];
    for await (const l of readLines(resolve(FIXTURES, 'spa_sentences_bz2_copy.tsv.bz2'))) {
      partial.push(l);
      if (partial.length === 2) break;
    }
    expect(partial).toHaveLength(2);
  });

  it('locates export files and resolves varieties honestly', () => {
    const files = locateTatoebaFiles(FIXTURES, 'spa', ['eng', 'fra', 'rus']);
    expect(files.sentences.endsWith('spa_sentences.tsv')).toBe(true);
    expect(Object.keys(files.links)).toEqual(['eng', 'fra']);
    expect(files.audio).not.toBeNull();
    expect(files.cc0).not.toBeNull();
    expect(resolveVariety('fra', null)).toMatchObject({ varietyId: 'fr', assignment: 'corpus' });
    expect(resolveVariety('spa', null)).toMatchObject({ varietyId: null, assignment: 'unresolved' });
    expect(resolveVariety('spa', 'es-ES')).toMatchObject({ varietyId: 'es-ES', assignment: 'operator_declared' });
    expect(() => resolveVariety('spa', 'pt-BR')).toThrow(/never crossed/);
    expect(() => resolveVariety('xxx', null)).toThrow(/Unsupported/);
    expect(tatoebaAttribution('3002', 'arh')).toContain('https://tatoeba.org/sentences/show/3002');
  });
});

describe('importTatoeba (fixture)', () => {
  const base = { dir: FIXTURES, target: 'spa', sources: ['eng', 'fra'], maxCandidates: 1000, scanLimit: 0, limit: 100, minIntentConfidence: 0.6, maxWords: 12, requireTranslation: true, now: new Date('2026-10-14T00:00:00Z') };

  it('filters toxic/irrelevant/wrong-language rows, joins translations + audio, preserves rights and provenance', async () => {
    const io = memoryIo();
    const result = await importTatoeba({ ...base, variety: 'es-ES', keepUnmatched: false }, io);
    const s = result.summary;
    expect(s.snapshotId).toBe('2026-10-14T22:31:10Z');
    expect(s.inputs.map((i) => i.file)).toEqual(expect.arrayContaining(['spa_sentences.tsv', 'spa-eng_links.tsv', 'eng_sentences.tsv', 'spa_sentences_with_audio.tsv', 'sentences_CC0.tsv']));
    for (const i of s.inputs) expect(i.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(s.rejected.toxic).toBe(1);
    expect(s.rejected.sanity_no_function_words).toBe(1);
    expect(s.rejected.irrelevant_too_long).toBe(1);
    expect(s.rejected.irrelevant_url_or_email).toBe(1);
    expect(s.varietyAssignment).toBe('operator_declared');

    const byId = new Map(result.drafts.map((d) => [d.target.upstreamId, d]));
    const price = byId.get('3001')!;
    expect(price.curation.intentKey).toBe('ask_price');
    expect(price.translations.map((t) => `${t.sourceLanguageCode}:${t.text}`).sort()).toEqual(['en:How much does this cost?', 'fr:Combien ça coûte ?']);
    expect(price.audio[0]).toMatchObject({ upstreamId: '9001', licenseId: 'CC-BY-NC', redistributionPermitted: false });
    expect(price.rights).toMatchObject({ licenseId: 'CC-BY', licenseVersion: '2.0', licenseSource: 'export_default', commercialRedistribution: true, verified: false });
    expect(price.target.varietyId).toBe('es-ES');
    expect(price.curation.flags).toContain('variety_operator_declared');

    const thanks = byId.get('3002')!;
    expect(thanks.rights.licenseId).toBe('CC0');
    expect(thanks.rights.licenseSource).toBe('per_row');
    expect(thanks.audio[0]?.redistributionPermitted).toBe(true);
    expect(thanks.curation.intentKey).toBe('thank');

    const greet = byId.get('3004')!;
    expect(greet.audio[0]).toMatchObject({ licenseId: null, redistributionPermitted: false });

    const coffee = byId.get('3009')!;
    expect(coffee.curation.intentKey).toBe('request_drink');

    for (const d of result.drafts) {
      expect(ExpressionDraftSchema.safeParse(d).success).toBe(true);
      expect(d.status).toBe('review_needed');
      expect(d.nativeReviewed).toBe(false);
      expect(d.provenance.dataset).toBe('tatoeba');
    }
    expect(s.emitted).toBe(result.drafts.length);
  });

  it('keeps unresolved varieties as null and drops unmatched intents unless asked to keep them', async () => {
    const io = memoryIo();
    const strict = await importTatoeba({ ...base, variety: null, keepUnmatched: false }, io);
    expect(strict.drafts.every((d) => d.target.varietyId === null)).toBe(true);
    expect(strict.summary.notes.join(' ')).toMatch(/several varieties/);
    const loose = await importTatoeba({ ...base, variety: null, keepUnmatched: true }, io);
    expect(loose.drafts.length).toBeGreaterThan(strict.drafts.length);
    expect(loose.drafts.some((d) => d.curation.flags.includes('intent_unmatched'))).toBe(true);
    expect(loose.drafts.find((d) => d.target.upstreamId === '3008')?.curation.flags).toContain('corpus_persona_name');
  });

  it('honours limit / scan-limit', async () => {
    const io = memoryIo();
    const r = await importTatoeba({ ...base, variety: 'es-419', keepUnmatched: true, limit: 2 }, io);
    expect(r.drafts.length).toBe(2);
    const r2 = await importTatoeba({ ...base, variety: 'es-419', keepUnmatched: true, scanLimit: 3 }, io);
    expect(r2.summary.scanned).toBe(3);
  });
});
