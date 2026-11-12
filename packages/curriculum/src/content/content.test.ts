import { COURSE_TRACKS, DraftContentSchema, SOURCE_LANGUAGES, buildLanguageContext, getCourseTrack, type SourceLanguageCode } from '@langquest/contracts';
import { describe, expect, it } from 'vitest';
import { getBlueprint } from '../missions/scenarios';
import { realise } from '../missions/realise';
import { ARABIC_MOROCCAN_CHAPTER_1 } from './arabic-moroccan';
import { DRAFT_CHAPTERS, HAND_AUTHORED_CHAPTERS, summariseCoverage } from './coverage';
import { GENERATED_CHAPTERS } from './generated';
import { ENGLISH_CHAPTER_1 } from './english';
import { JAPANESE_CHAPTER_1 } from './japanese';
import { CHAPTER_1_BLUEPRINT_KEYS, buildAllPlannedSkeletons, buildPlannedSkeleton } from './skeletons';
import { SPANISH_SPAIN_CHAPTER_1 } from './spanish-spain';
import { SeedChapterSchema, defineSeedChapter, seedExpressionsToCandidates, toDraftContent, type SeedChapter } from './types';

const ENROLLMENT = '00000000-0000-4000-8000-000000000001';
const ARABIC = /[؀-ۿ]/;
const KANA_OR_KANJI = /[぀-ヿ一-鿿]/;
const LATIN_ONLY = /^[\p{Script=Latin}\p{N}\p{P}\s]+$/u;

describe('draft chapters are honestly labelled', () => {
  it('ships the four hand-authored drafts with the requested mission counts (Spanish and Japanese with a French overlay)', () => {
    expect(HAND_AUTHORED_CHAPTERS.map((c) => [c.courseTrackId, c.sourceLanguages, c.missions.length])).toEqual([
      ['arabic-moroccan', ['fr', 'en'], 7],
      ['spanish-spain', ['en', 'fr'], 6],
      ['japanese', ['en', 'fr'], 4],
      ['english', ['fr', 'ru'], 4],
    ]);
  });

  it('every track has chapters 1 to 4 for learners from English and from French (the French course from English, the English course from French)', () => {
    expect(DRAFT_CHAPTERS).toHaveLength(120);
    for (const track of COURSE_TRACKS) {
      const chapters = DRAFT_CHAPTERS.filter((c) => c.courseTrackId === track.id);
      expect(chapters.map((c) => c.chapterIndex), track.id).toEqual([1, 2, 3, 4]);
      expect(new Set(chapters.flatMap((c) => c.characters.map((ch) => ch.characterKey))).size, `${track.id}: character keys are unique across chapters`).toBe(chapters.reduce((n, c) => n + c.characters.length, 0));
      expect(new Set(chapters.flatMap((c) => c.missions.map((m) => m.key))).size, `${track.id}: mission keys are unique across chapters`).toBe(chapters.reduce((n, c) => n + c.missions.length, 0));
      for (const chapter of chapters) {
        const sources = chapter.sourceLanguages;
        if (track.id === 'english') expect(sources).toContain('fr');
        else if (track.id === 'french') expect(sources).toEqual(['en']);
        else expect([...sources].sort(), chapter.key).toEqual(expect.arrayContaining(['en', 'fr']));
      }
    }
    for (const c of GENERATED_CHAPTERS) {
      expect(c.missions.map((m) => m.blueprintKey), c.key).toEqual(CHAPTER_1_BLUEPRINT_KEYS);
      expect(Object.values(c.titles).every((t) => !t.startsWith('story.')), `${c.key} shows a real chapter title`).toBe(true);
      for (const ch of c.characters) expect(ch.voice, `${c.key}/${ch.characterKey}`).not.toBeNull();
    }
  });

  it('generated drafts are written in the course script, with its transliteration', () => {
    const script: Record<string, RegExp> = { Cyrl: /[Ѐ-ӿ]/, Grek: /[Ͱ-Ͽ]/, Hebr: /[֐-׿]/, Deva: /[ऀ-ॿ]/, Kore: /[가-힯]/, Hans: /[一-鿿]/, Hant: /[一-鿿]/, Arab: ARABIC };
    for (const c of GENERATED_CHAPTERS) {
      const track = getCourseTrack(c.courseTrackId);
      const want = script[track.scriptFocus ?? track.scripts.primary];
      for (const e of c.missions.flatMap((m) => m.expressions)) {
        if (want) expect(e.targetText, `${c.key}: ${e.key}`).toMatch(want);
        else expect(e.targetText, `${c.key}: ${e.key}`).toMatch(LATIN_ONLY);
        for (const scheme of track.scripts.transliterations) expect(e.forms.some((f) => f.transliterationScheme === scheme), `${c.key}: ${e.key} ${scheme}`).toBe(true);
      }
    }
  });

  it.each(DRAFT_CHAPTERS.map((c) => [c.key, c] as const))('%s: every expression is an unreviewed ai_draft with target text and overlays for every chapter source', (_key, chapter) => {
    expect(SeedChapterSchema.safeParse(chapter).success).toBe(true);
    expect(chapter.nativeReviewed).toBe(false);
    expect(chapter.reviewStatus).toBe('review_needed');
    expect(chapter.provenance).toBe('ai_draft');
    for (const m of chapter.missions) {
      expect(m.expressions.length).toBeGreaterThan(0);
      for (const e of m.expressions) {
        expect(e.nativeReviewed).toBe(false);
        expect(e.reviewStatus).toBe('review_needed');
        expect(e.provenance).toBe('ai_draft');
        expect(e.targetText).not.toBeNull();
        expect(e.targetText).not.toMatch(/pending|placeholder|lorem/i);
        for (const src of chapter.sourceLanguages) expect(e.meanings[src]?.meaning, `${m.key}/${e.key}/${src}`).toBeTruthy();
      }
    }
  });

  it('realises every draft mission completely for every chapter source language (required slots filled)', () => {
    for (const chapter of DRAFT_CHAPTERS) {
      for (const source of chapter.sourceLanguages) {
        const ctx = buildLanguageContext({ uiLocale: 'en-US', enrollmentId: ENROLLMENT, sourceLanguageCode: source, courseTrackId: chapter.courseTrackId });
        for (const mission of chapter.missions) {
          const realised = realise(getBlueprint(mission.blueprintKey), ctx, seedExpressionsToCandidates(chapter, mission));
          expect(realised.missingSlots, `${chapter.key}/${mission.key}/${source}`).toEqual([]);
          expect(realised.complete).toBe(true);
          expect(realised.nativeReviewed).toBe(false);
          expect(realised.rejectedCandidates.filter((r) => r.reason !== 'unused_intent')).toEqual([]);
        }
      }
    }
  });

  it('Darija carries Arabic script + Arabizi, code-switch notes and register for every expression', () => {
    const expressions = ARABIC_MOROCCAN_CHAPTER_1.missions.flatMap((m) => m.expressions);
    for (const e of expressions) {
      expect(e.targetText).toMatch(ARABIC);
      const arab = e.forms.find((f) => f.script === 'Arab' && f.transliterationScheme === null);
      const arabizi = e.forms.find((f) => f.transliterationScheme === 'arabizi');
      expect(arab?.text, e.key).toMatch(ARABIC);
      expect(arabizi?.text, e.key).toMatch(LATIN_ONLY);
      expect(e.register).toBeTruthy();
    }
    expect(expressions.some((e) => e.codeSwitchNote)).toBe(true);
    expect(ARABIC_MOROCCAN_CHAPTER_1.targetVarietyId).toBe('ary');
    expect(ARABIC_MOROCCAN_CHAPTER_1.notes.join(' ')).toMatch(/native reviewer/i);
  });

  it('Japanese carries kana/kanji, a furigana reading and romaji', () => {
    for (const e of JAPANESE_CHAPTER_1.missions.flatMap((m) => m.expressions)) {
      expect(e.targetText).toMatch(KANA_OR_KANJI);
      expect(e.forms.map((f) => f.transliterationScheme)).toEqual([null, 'furigana', 'romaji']);
      expect(e.forms[1]!.text).not.toMatch(/[一-鿿]/);
      expect(e.forms[2]!.text).toMatch(LATIN_ONLY);
    }
  });

  it('Spanish is Castilian only and English carries French and Russian overlays', () => {
    expect(SPANISH_SPAIN_CHAPTER_1.targetVarietyId).toBe('es-ES');
    expect(SPANISH_SPAIN_CHAPTER_1.titles.fr).toBeTruthy();
    for (const e of [...SPANISH_SPAIN_CHAPTER_1.missions, ...JAPANESE_CHAPTER_1.missions].flatMap((m) => m.expressions)) expect(e.meanings.fr?.meaning).toBeTruthy();
    expect(ENGLISH_CHAPTER_1.targetVarietyId).toBe('en');
    for (const e of ENGLISH_CHAPTER_1.missions.flatMap((m) => m.expressions)) {
      expect(e.meanings.fr?.meaning).toBeTruthy();
      expect(e.meanings.ru?.meaning).toMatch(/[Ѐ-ӿ]/);
      expect(e.targetText).toMatch(LATIN_ONLY);
    }
    const sameBlueprints = ENGLISH_CHAPTER_1.missions.map((m) => m.blueprintKey);
    expect(sameBlueprints).toEqual(['greet_and_introduce', 'cafe_order_drink', 'ask_directions', 'take_taxi']);
  });

  it('projects into the §9.8 draft content schema with publication gates on', () => {
    const cafe = ARABIC_MOROCCAN_CHAPTER_1.missions[1]!;
    const draft = toDraftContent(ARABIC_MOROCCAN_CHAPTER_1, cafe, 'fr');
    expect(DraftContentSchema.safeParse(draft).success).toBe(true);
    expect(draft.mission.title).toBe('Commander au café');
    expect(draft.mission.scene).toBe(cafe.sceneNotes.fr);
    expect(draft.missingSourceFields).toEqual([]);
    expect(draft.publication).toEqual({ status: 'draft', requiresVerifiedSourceRights: true, requiresNativeReview: true });
    expect(draft.expressions.every((e) => !e.nativeReviewed && !e.approvedForPublishing)).toBe(true);
  });

  it('never substitutes another source language: a draft for a missing source gets neutral keys and lists the gaps', () => {
    const cafe = ARABIC_MOROCCAN_CHAPTER_1.missions[1]!;
    const learnerCount = cafe.expressions.filter((e) => e.speaker === 'learner').length;
    expect(learnerCount).toBeGreaterThan(0);
    // 'es' is a valid source language but the Moroccan seed only carries fr + en overlays.
    const draft = toDraftContent(ARABIC_MOROCCAN_CHAPTER_1, cafe, 'es');
    expect(DraftContentSchema.safeParse(draft).success).toBe(true);
    expect(draft.sourceLanguage).toBe('es');
    expect(draft.mission.title).toBe(cafe.key);
    expect(draft.mission.title).not.toBe(cafe.titles.fr);
    expect(draft.mission.title).not.toBe(cafe.titles.en);
    expect(draft.mission.scene).not.toBe(cafe.sceneNotes.fr);
    expect(draft.mission.scene).not.toBe(cafe.sceneNotes.en);
    expect(draft.expressions.every((e) => e.sourceMeaning === '')).toBe(true);
    expect(draft.missingSourceFields).toEqual(['mission.title', 'mission.scene', ...Array.from({ length: learnerCount }, (_, i) => `expressions.${i}.sourceMeaning`)]);

    // A mission whose title exists only in French must not leak it into an English draft.
    const frOnly = { ...cafe, titles: { fr: cafe.titles.fr! }, sceneNotes: {} };
    const en = toDraftContent(ARABIC_MOROCCAN_CHAPTER_1, frOnly, 'en');
    expect(en.mission.title).toBe(cafe.key);
    expect(en.missingSourceFields).toEqual(['mission.title', 'mission.scene']);
    expect(en.expressions.every((e) => e.sourceMeaning.length > 0)).toBe(true);
  });

  it('rejects dishonest seeds: skeleton with target text, draft without it, draft marked approved', () => {
    const base = ARABIC_MOROCCAN_CHAPTER_1;
    const mission = base.missions[0]!;
    const e = mission.expressions[0]!;
    const withChapter = (expr: Partial<SeedChapter['missions'][number]['expressions'][number]>, chapterOver: Partial<SeedChapter> = {}) =>
      defineSeedChapter({ ...base, ...chapterOver, missions: [{ ...mission, expressions: [{ ...e, ...expr }] }] } as never);
    expect(() => withChapter({ provenance: 'planned_skeleton', reviewStatus: 'draft' })).toThrow(/planned skeletons must not carry target text/);
    expect(() => withChapter({ targetText: null })).toThrow(/ai drafts must carry target text/);
    expect(() => withChapter({ reviewStatus: 'approved' })).toThrow(/review_needed/);
    expect(() => withChapter({ nativeReviewed: true as never })).toThrow();
    expect(() => withChapter({ meanings: { fr: e.meanings.fr! } })).toThrow(/missing en meaning/);
    expect(() => withChapter({}, { targetVarietyId: 'arb' })).toThrow(/teaches ary/);
  });
});

describe('planned skeletons for all 30 tracks', () => {
  it('instantiates chapter 1 for every track with null target text and the shared blueprints', () => {
    const skeletons = buildAllPlannedSkeletons(['en', 'fr']);
    expect(skeletons).toHaveLength(30);
    expect(new Set(skeletons.map((s) => s.courseTrackId))).toEqual(new Set(COURSE_TRACKS.map((t) => t.id)));
    for (const s of skeletons) {
      expect(s.provenance).toBe('planned_skeleton');
      expect(s.reviewStatus).toBe('draft');
      expect(s.nativeReviewed).toBe(false);
      expect(s.targetVarietyId).toBe(getCourseTrack(s.courseTrackId).targetVarietyId);
      expect(s.missions.map((m) => m.blueprintKey)).toEqual(CHAPTER_1_BLUEPRINT_KEYS);
      for (const m of s.missions) {
        expect(m.expressions.length).toBe(getBlueprint(m.blueprintKey).slots.length);
        for (const e of m.expressions) {
          expect(e.targetText).toBeNull();
          expect(e.forms).toEqual([]);
          expect(e.provenance).toBe('planned_skeleton');
        }
      }
    }
    const simplified = buildPlannedSkeleton('chinese-simplified');
    expect(simplified.notes.join(' ')).toMatch(/chinese-mandarin/);
    expect(buildPlannedSkeleton('arabic-eastern').notes.join(' ')).toMatch(/MSA is never substituted/);
  });

  it('realising a skeleton mission is honestly incomplete rather than faked', () => {
    const skeleton = buildPlannedSkeleton('lingala', ['fr']);
    const ctx = buildLanguageContext({ uiLocale: 'fr-FR', enrollmentId: ENROLLMENT, sourceLanguageCode: 'fr', courseTrackId: 'lingala' });
    const mission = skeleton.missions[0]!;
    const realised = realise(getBlueprint(mission.blueprintKey), ctx, seedExpressionsToCandidates(skeleton, mission));
    expect(realised.complete).toBe(false);
    expect(realised.missingSlots.length).toBeGreaterThan(0);
    expect(realised.steps.flatMap((s) => s.expressions)).toEqual([]);
  });
});

describe('coverage summary', () => {
  it('reports partial for drafted (track, source) pairs, planned elsewhere, and all invariants hold', () => {
    const summary = summariseCoverage({ now: '2026-10-14T00:00:00.000Z' });
    expect(summary.trackCount).toBe(30);
    expect(summary.sourceCount).toBe(SOURCE_LANGUAGES.length);
    expect(summary.rows).toHaveLength(30 * SOURCE_LANGUAGES.length);
    expect(summary.invariants).toEqual({ everyTrackHasSkeleton: true, noPublishedContent: true, noNativeReviewedClaims: true, noSkeletonTargetText: true });
    expect(summary.totals.complete).toBe(0);
    expect(summary.totals.unavailable).toBe(0);
    // 4 hand-authored chapters (8 pairs) + 24 generated (en+fr) + French (en) + the Simplified copy (en+fr).
    expect(summary.totals.partial).toBe(8 + 24 * 2 + 1 + 2);
    expect(summary.totals.planned).toBe(summary.rows.length - summary.totals.partial);
    const row = (track: string, source: SourceLanguageCode) => summary.rows.find((r) => r.courseTrackId === track && r.sourceLanguageCode === source)!;
    // Chapter 1 (7 missions) and chapters 2–4 (6 each) of the story arc, all drafted.
    expect(row('arabic-moroccan', 'fr')).toMatchObject({ status: 'partial', nativeReviewed: false, draftedMissionCount: 25, nativeReviewedExpressionCount: 0 });
    expect(row('arabic-moroccan', 'fr').reason).toMatch(/^25\/25 missions of chapters 1–4 drafted/);
    expect(row('arabic-moroccan', 'fr').metrics.mission_instructions_pct).toBe(100);
    expect(row('arabic-moroccan', 'ru').status).toBe('planned');
    // English from Russian has chapter 1 only (4 of its 7 missions); from French, chapters 2–4 as well (22 of 25).
    expect(row('english', 'ru')).toMatchObject({ status: 'partial', draftedMissionCount: 4 });
    expect(row('english', 'ru').metrics.mission_instructions_pct).toBeCloseTo(57.1, 1);
    expect(row('english', 'ru').reason).toMatch(/^4\/7 chapter-1 missions drafted/);
    expect(row('english', 'fr')).toMatchObject({ status: 'partial', draftedMissionCount: 22 });
    expect(row('english', 'fr').metrics.mission_instructions_pct).toBeCloseTo(88, 1);
    expect(row('lingala', 'fr')).toMatchObject({ status: 'partial', draftedMissionCount: 25, nativeReviewedExpressionCount: 0 });
    expect(row('russian', 'fr')).toMatchObject({ status: 'partial', draftedMissionCount: 25 });
    expect(row('lingala', 'ru')).toMatchObject({ status: 'planned', expressionsWithTargetText: 0 });
    expect(row('lingala', 'ru').reason).toMatch(/no target text/);
    expect(row('chinese-simplified', 'ru').plannedChapterKeys).toEqual(['chinese_simplified_ch1_planned']);
  });
});
