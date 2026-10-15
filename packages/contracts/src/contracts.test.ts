import { describe, expect, it } from 'vitest';
import * as contracts from './index';
import { CHARACTER_EXPRESSION_VALUES, MASCOT_STATE_VALUES, LESSON_TYPE_VALUES, isAcousticAssessmentMode } from './enums';
import { CourseManifestSchema } from './manifest';
import { DEFAULT_SCHEDULER_PARAMS, ReviewCardSchema, SkillObservationSchema, masteryRank } from './srs';
import { TelemetryEventSchema } from './telemetry';
import { ART_DIRECTION_PROMPT_TEMPLATES, ArtDirectionPromptTemplateSchema } from './visual';

const uuid = '8f4b6c1e-1f3a-4c0b-9a7d-5e6f7a8b9c0d';
const at = '2026-10-14T10:00:00.000Z';

describe('enums', () => {
  it('has the 17 mascot states, 9 character expressions and 13 lesson types', () => {
    expect(MASCOT_STATE_VALUES).toHaveLength(17);
    expect(CHARACTER_EXPRESSION_VALUES).toHaveLength(9);
    expect(LESSON_TYPE_VALUES).toHaveLength(13);
  });
  it('only the acoustic assessor mode is numeric-capable', () => {
    expect(isAcousticAssessmentMode('acoustic-assessor')).toBe(true);
    expect(isAcousticAssessmentMode('reference-comparison')).toBe(false);
  });
});

describe('index exports', () => {
  it('exposes namespaces and key symbols', () => {
    expect(contracts.db.DB_TABLES.profiles.name).toBe('profiles');
    expect(contracts.api.ROUTES.me.path).toBe('/v1/me');
    expect(contracts.ai.CONVERSATION_TRANSITIONS.finished).toEqual([]);
    expect(contracts.COURSE_TRACKS).toHaveLength(30);
    expect(contracts.LanguageContextSchema).toBeDefined();
  });
});

describe('srs', () => {
  it('defaults and mastery ordering', () => {
    expect(DEFAULT_SCHEDULER_PARAMS.desiredRetention).toBe(0.9);
    expect(masteryRank('durable')).toBeGreaterThan(masteryRank('emerging'));
    const card = ReviewCardSchema.parse({ id: uuid, enrollmentId: uuid, targetKind: 'skill', targetId: 'ask_price', state: 'review', memory: { stability: 12.5, difficulty: 5, retrievability: 0.91 }, due: at, lastReviewedAt: at, reps: 3, lapses: 0, scheduledDays: 12, elapsedDays: 11 });
    expect(card.recentScenarioIds).toEqual([]);
  });
  it('observations require scorer version and uncertainty', () => {
    const obs = { id: uuid, enrollmentId: uuid, skillKey: 'greet_politely', observationType: 'semantic_success', scenarioId: 'cafe_01', missionId: null, missionAttemptId: null, conversationSessionId: uuid, expressionId: null, autonomy: 'unaided', hintsUsed: 0, outcome: 'success', utteranceConfidence: 0.8, scorerKind: 'llm_evaluator', scorerVersion: 'evaluator@1', uncertainty: 0.2, observedAt: at, note: null };
    expect(SkillObservationSchema.safeParse(obs).success).toBe(true);
    const { scorerVersion: _v, ...noVersion } = obs;
    expect(SkillObservationSchema.safeParse(noVersion).success).toBe(false);
  });
});

describe('manifest', () => {
  it('validates a minimal course manifest with lazy asset refs', () => {
    const manifest = CourseManifestSchema.parse({
      formatVersion: 1, courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'fr', targetVarietyId: 'ary', version: 7, checksum: 'b'.repeat(64), generatedAt: at, coverArt: null, cacheTtlSeconds: 3600, characters: [],
      chapters: [{ id: uuid, order: 0, title: 'Au café', description: null, scene: 'Casablanca cafe', region: 'Casablanca', coverArt: null, mapArt: null, missions: [{ id: uuid, order: 0, type: 'standard', titleKey: null, title: 'Commander au café', level: 'beginner', difficulty: 0.2, recommendedMinutes: 8, prerequisiteSkillKeys: [], skillKeys: ['request_drink'], characterIds: [], sceneArt: null, publishedRevision: 2, localizationComplete: true, steps: [{ id: uuid, order: 0, type: 'context_listening', lessonType: 'listening_comprehension', estimatedSeconds: 60, expressionIds: [], assets: [{ assetId: uuid, kind: 'audio', contentHash: 'c'.repeat(64), byteLength: 1000, mimeType: 'audio/aac', durationMs: 4000, publicUrl: null, altTextKey: null }], visuals: [], offlineCapable: true }] }] }],
    });
    expect(manifest.chapters[0]?.missions[0]?.steps[0]?.assets[0]?.publicUrl).toBeNull();
  });
});

describe('telemetry and visual', () => {
  it('telemetry events discriminate on name and carry privacy level', () => {
    const ev = TelemetryEventSchema.parse({ eventId: uuid, occurredAt: at, platform: 'ios', appVersion: '1.0.0', sessionId: null, userHash: null, enrollmentId: null, trackId: 'french', targetVarietyId: 'fr', sourceLanguageCode: 'en', privacyLevel: 'anonymous', name: 'app_start', category: 'performance', props: { coldStartMs: 900, lowEndDevice: true } });
    expect(ev.name).toBe('app_start');
    expect(TelemetryEventSchema.safeParse({ ...ev, name: 'mission_completed' }).success).toBe(false);
  });
  it('art-direction templates are valid and cover the four kinds', () => {
    ART_DIRECTION_PROMPT_TEMPLATES.forEach((t) => expect(() => ArtDirectionPromptTemplateSchema.parse(t)).not.toThrow());
    expect(ART_DIRECTION_PROMPT_TEMPLATES.map((t) => t.kind)).toEqual(['mission_environment', 'conversation_character', 'mascot_pack', 'context_image']);
  });
});
