/**
 * seed-curriculum: the plan is pure, deterministic and honestly labelled; the stack-bound suite applies
 * the arabic-moroccan seed to the LOCAL Supabase stack and checks the manifest the learner API serves.
 * The stack suite is skipped without a stack unless LANGQUEST_REQUIRE_LOCAL_STACK=1 (then it fails).
 */
import { DRAFT_CHAPTERS, buildAllPlannedSkeletons } from '@langquest/curriculum';
import { createRepositories } from '@langquest/db';
import { curriculumSeedKeys, curriculumUuid } from '@langquest/db/seed/curriculum-uuid';
import { describe, expect, it } from 'vitest';
import { memoryIo, runCli } from './lib/cli';
import { resolveServiceDb } from './lib/db';
import { applyCurriculumSeedPlan, buildCurriculumSeedPlan, main, objectiveDescriptionKey, spec, summarisePlan, verifyManifests } from './seed-curriculum';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('buildCurriculumSeedPlan', () => {
  const plan = buildCurriculumSeedPlan();

  it('loads the four flagship drafts as published and every other track as an unpublished skeleton', () => {
    expect(plan.chapters).toHaveLength(30);
    const published = plan.chapters.filter((c) => c.state === 'published');
    expect(published.map((c) => c.courseTrackId).sort()).toEqual(['arabic-moroccan', 'english', 'japanese', 'spanish-spain']);
    expect(published.every((c) => c.kind === 'draft')).toBe(true);
    expect(plan.chapters.filter((c) => c.kind === 'skeleton').every((c) => c.state === 'review_needed')).toBe(true);
    expect(plan.supersededSkeletons.map((s) => s.courseTrackId).sort()).toEqual(['arabic-moroccan', 'english', 'japanese', 'spanish-spain']);
    expect(plan.rows.lessonCourses).toHaveLength(30);
    expect(plan.rows.lessonCourses.filter((c) => c.state === 'published').map((c) => c.course_track_id).sort()).toEqual(['arabic-moroccan', 'english', 'japanese', 'spanish-spain']);
  });

  it('never writes placeholder text: skeleton chapters carry no expressions, forms, translations or localizations', () => {
    const skeletonChapterIds = new Set(plan.rows.chapters.filter((c) => c.state === 'review_needed').map((c) => c.id));
    const skeletonMissionIds = new Set(plan.rows.missions.filter((m) => skeletonChapterIds.has(m.chapter_id!)).map((m) => m.id));
    expect(skeletonMissionIds.size).toBe(26 * 6);
    expect(plan.rows.missionLocalizations.some((l) => skeletonMissionIds.has(l.mission_id))).toBe(false);
    expect(plan.rows.missionSteps.filter((s) => skeletonMissionIds.has(s.mission_id)).every((s) => (s.target_expression_ids ?? []).length === 0)).toBe(true);
    expect(plan.rows.expressions.every((e) => e.canonical_text.trim().length > 0 && !/pending|placeholder|lorem/i.test(e.canonical_text))).toBe(true);
    for (const c of plan.rows.chapters.filter((c) => c.state === 'review_needed')) expect(c.title_translations).toEqual({});
  });

  it('keeps every draft honestly unreviewed while publishing it for learners', () => {
    for (const e of plan.rows.expressions) {
      expect(e.reviewed).toBe(false);
      expect(e.state).toBe('published');
      expect(e.origin).toBe('ai_generated');
      expect((e.script_annotations as { provenance: { draftId: string; seed: string } }).provenance.seed).toBe('seed-curriculum');
    }
    expect(plan.rows.expressionTranslations.every((t) => t.qa_state === 'needs_review')).toBe(true);
    expect(plan.rows.missionLocalizations.every((l) => l.qa_state === 'needs_review' && l.title.trim().length > 0)).toBe(true);
    expect(plan.rows.contentRights.every((r) => r.verified === false)).toBe(true);
    expect(plan.rows.missions.filter((m) => m.state === 'published').every((m) => m.published_revision === 1)).toBe(true);
    expect(plan.rows.missions.filter((m) => m.state !== 'published').every((m) => m.published_revision === null)).toBe(true);
    expect(summarisePlan(plan).expression_audio).toBe(0);
  });

  it('writes goals in the object shape the API and publish gate expect, with language-neutral steps', () => {
    for (const m of plan.rows.missions) {
      const goals = m.goals as { id: string; skill_keys: string[]; description_key: string }[];
      expect(goals.length).toBeGreaterThan(0);
      for (const g of goals) {
        expect(typeof g.id).toBe('string');
        expect(Array.isArray(g.skill_keys)).toBe(true);
        expect(g.description_key).toMatch(/^curriculum\.objective\.[a-z0-9_]+\.[a-z0-9_]+$/);
      }
      expect(m.template_key).toBeNull();
    }
    expect(objectiveDescriptionKey('cafe_order_drink', 'pay')).toBe('curriculum.objective.cafe_order_drink.pay');
    const byMission = new Map<string, number>();
    for (const s of plan.rows.missionSteps) byMission.set(s.mission_id, (byMission.get(s.mission_id) ?? 0) + 1);
    expect([...byMission.values()].every((n) => n >= 7)).toBe(true);
    expect(plan.rows.missionSteps.every((s) => s.hint_scaffold?.length === 0 && typeof s.success_conditions === 'object')).toBe(true);
    const conversation = plan.rows.missionSteps.filter((s) => s.step_type === 'character_conversation');
    expect(conversation.length).toBe(plan.rows.missions.length);
    expect(conversation.every((s) => s.branching !== null && s.offline_capable === false)).toBe(true);
  });

  it('is deterministic (uuid v5 of content keys) so re-runs update in place', () => {
    const again = buildCurriculumSeedPlan();
    expect(again.rows.missions.map((m) => m.id)).toEqual(plan.rows.missions.map((m) => m.id));
    expect(again.rows.missionSteps.map((s) => s.id)).toEqual(plan.rows.missionSteps.map((s) => s.id));
    expect(again.rows.expressions.map((e) => e.id)).toEqual(plan.rows.expressions.map((e) => e.id));
    const ids = [...plan.rows.contentRights, ...plan.rows.lessonCourses, ...plan.rows.chapters, ...plan.rows.missions, ...plan.rows.missionSteps, ...plan.rows.expressions, ...plan.rows.expressionForms].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => UUID.test(id))).toBe(true);
    const darija = DRAFT_CHAPTERS.find((c) => c.courseTrackId === 'arabic-moroccan')!;
    const greet = darija.missions[0]!;
    expect(plan.rows.missions.find((m) => m.id === curriculumUuid('mission', curriculumSeedKeys.mission(darija.key, greet.key)))?.sort_order).toBe(0);
    expect(plan.rows.expressions.find((e) => e.id === curriculumUuid('expression', curriculumSeedKeys.expression(darija.key, greet.key, greet.expressions[0]!.key)))?.canonical_text).toBe(greet.expressions[0]!.targetText);
  });

  it('raises coverage to partial from measured overlay counts, only for sources that have overlays', () => {
    expect(plan.rows.coverage.map((c) => `${c.course_track_id}|${c.source_language_code}`).sort()).toEqual(['arabic-moroccan|en', 'arabic-moroccan|fr', 'english|fr', 'english|ru', 'japanese|en', 'spanish-spain|en']);
    const fr = plan.rows.coverage.find((c) => c.course_track_id === 'arabic-moroccan' && c.source_language_code === 'fr')!;
    expect(fr.metrics.mission_instructions_pct).toBe(100);
    expect(fr.metrics.explanations_pct).toBe(100);
    expect(fr.metrics.audio_overlays_pct).toBe(0);
    expect(fr.metrics.subtitles_pct).toBe(0);
    const ja = plan.rows.coverage.find((c) => c.course_track_id === 'japanese')!;
    expect(ja.metrics.mission_instructions_pct).toBeCloseTo(66.7, 1);
  });

  it('filters by track and can drop skeletons', () => {
    const one = buildCurriculumSeedPlan({ tracks: ['arabic-moroccan'] });
    expect(one.chapters).toHaveLength(1);
    expect(one.rows.lessonCourses).toHaveLength(1);
    expect(one.rows.missions).toHaveLength(6);
    expect(one.rows.coverage).toHaveLength(2);
    const noSkeletons = buildCurriculumSeedPlan({ includeSkeletons: false });
    expect(noSkeletons.chapters).toHaveLength(4);
    expect(noSkeletons.supersededSkeletons).toHaveLength(0);
    const onlySkeleton = buildCurriculumSeedPlan({ tracks: ['swahili'], skeletons: buildAllPlannedSkeletons() });
    expect(onlySkeleton.chapters.map((c) => c.kind)).toEqual(['skeleton']);
    expect(onlySkeleton.rows.expressions).toHaveLength(0);
  });
});

describe('seed-curriculum CLI', () => {
  it('prints --help and rejects unknown flags / tracks', async () => {
    const io = memoryIo();
    expect(await runCli(spec, ['--help'], main, io)).toBe(0);
    expect(io.lines.join('\n')).toContain('seed-curriculum —');
    expect(io.lines.join('\n')).toContain('--dry-run');
    expect(await runCli(spec, ['--definitely-unknown-flag'], main, memoryIo())).toBe(2);
    const bad = memoryIo();
    expect(await runCli(spec, ['--track', 'klingon', '--dry-run'], main, bad)).toBe(2);
    expect(bad.errors.join('\n')).toMatch(/Unknown course track/);
  });

  it('never writes without --apply and reports the plan', async () => {
    const io = memoryIo();
    expect(await runCli(spec, ['--track', 'arabic-moroccan,japanese', '--dry-run'], main, io)).toBe(0);
    const text = io.lines.join('\n');
    expect(text).toMatch(/draft {4}published {5}arabic-moroccan/);
    expect(text).toMatch(/chapters_published=2/);
    expect(text).toContain('expression_audio: 0 rows by design');
    expect(text).toContain('dry-run: nothing applied');
    const io2 = memoryIo();
    expect(await runCli(spec, ['--track', 'japanese'], main, io2)).toBe(0);
    expect(io2.lines.join('\n')).toContain('nothing applied: pass --apply');
  });
});

// ---------------------------------------------------------------------------
// Local stack: apply + manifest verification (what GET /v1/courses/:track/manifest serves).
// ---------------------------------------------------------------------------
const resolved = process.env.LANGQUEST_SKIP_LOCAL_STACK === '1' ? null : resolveServiceDb();
const describeWithStack = (() => {
  if (resolved) return describe;
  const message = '[seed-curriculum] Local Supabase stack not reachable; skipping the apply + manifest verification suite.';
  if (process.env.LANGQUEST_REQUIRE_LOCAL_STACK === '1') throw new Error(`${message} LANGQUEST_REQUIRE_LOCAL_STACK=1 forbids skipping.`);
  console.warn(message);
  return describe.skip as unknown as typeof describe;
})();

describeWithStack('seed-curriculum against the local stack', () => {
  it('applies arabic-moroccan idempotently and the fr / en manifests list its published chapter with 6 missions', async () => {
    const db = resolved!.client;
    const plan = buildCurriculumSeedPlan({ tracks: ['arabic-moroccan'] });
    const first = await applyCurriculumSeedPlan(db, plan, memoryIo());
    const second = await applyCurriculumSeedPlan(db, plan, memoryIo());
    expect(second.missions.inserted).toBe(0);
    expect(second.missions.updated).toBe(6);
    expect(second.mission_steps.deleted).toBe(0);
    expect(second.expressions.inserted).toBe(0);
    expect(second.expression_forms.deleted).toBe(0);
    expect(first.expression_audio).toEqual({ inserted: 0, updated: 0, deleted: 0, skipped: 0 });

    const checks = await verifyManifests(db, plan);
    expect(checks.map((c) => c.sourceLanguageCode).sort()).toEqual(['en', 'fr']);
    for (const c of checks) {
      expect(c.ok, `${c.courseTrackId} × ${c.sourceLanguageCode}`).toBe(true);
      expect(c.seededMissions).toBe(6);
      expect(c.titledInSource).toBe(6);
      // Drafts: the overlay exists but is not reviewed, so the manifest must NOT claim localizationComplete.
      expect(c.localizationComplete).toBe(0);
    }

    const repos = createRepositories(db);
    const manifest = await repos.curriculum.buildManifest('arabic-moroccan', 'fr', 'ary', 'casablanca');
    const chapterId = curriculumUuid('chapter', curriculumSeedKeys.chapter('ary_ch1_arrival_casablanca'));
    const chapter = manifest.chapters.find((ch) => ch.id === chapterId);
    expect(chapter).toBeDefined();
    expect(chapter!.title).toBe('Premiers jours à Casablanca');
    expect(chapter!.titleLanguageCode).toBe('fr');
    expect(chapter!.missions.map((m) => m.title)).toContain('Saluer et se présenter');
    expect(chapter!.missions.every((m) => m.steps.length >= 8 && m.steps.some((s) => s.expressionIds.length > 0))).toBe(true);
    expect(chapter!.missions.every((m) => m.localizationComplete === false)).toBe(true);

    const coverage = await db.from('course_source_localizations').select('status, native_reviewed, editorial_note_key, metrics').eq('course_track_id', 'arabic-moroccan').eq('source_language_code', 'fr').single();
    expect(coverage.data?.status).toBe('partial');
    expect(coverage.data?.native_reviewed).toBe(false);
    expect(coverage.data?.editorial_note_key).toBe('enrollment.coverage.draftAvailable');
    expect((coverage.data?.metrics as { mission_instructions_pct: number }).mission_instructions_pct).toBe(100);
  });
});
