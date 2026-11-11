/**
 * seed-curriculum: the plan is pure, deterministic and honestly labelled; the stack-bound suite applies
 * the arabic-moroccan seed to the LOCAL Supabase stack and checks the manifest the learner API serves.
 * The stack suite is skipped without a stack unless LANGQUEST_REQUIRE_LOCAL_STACK=1 (then it fails).
 */
import { CHAPTER_1_BLUEPRINT_KEYS, DRAFT_CHAPTERS, HAND_AUTHORED_CHAPTERS, buildAllPlannedSkeletons, getBlueprint } from '@langquest/curriculum';
import { createRepositories } from '@langquest/db';
import { CAST_ROSTER } from '@langquest/db/seed/cast-roster';
import { curriculumSeedKeys, curriculumUuid } from '@langquest/db/seed/curriculum-uuid';
import { describe, expect, it } from 'vitest';
import { memoryIo, runCli } from './lib/cli';
import { resolveServiceDb } from './lib/db';
import { applyCurriculumSeedPlan, buildCurriculumSeedPlan, main, objectiveDescriptionKey, spec, summarisePlan, verifyManifests } from './seed-curriculum';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('buildCurriculumSeedPlan', () => {
  const plan = buildCurriculumSeedPlan();
  /** The plan as it was with the four hand-authored drafts only: 26 tracks still planned skeletons. */
  const handAuthored = buildCurriculumSeedPlan({ drafts: HAND_AUTHORED_CHAPTERS });

  it('loads every track’s draft chapter as published; the planned skeletons they supersede are not loaded', () => {
    expect(plan.chapters).toHaveLength(30);
    const published = plan.chapters.filter((c) => c.state === 'published');
    expect(published).toHaveLength(30);
    expect(published.every((c) => c.kind === 'draft')).toBe(true);
    expect(plan.chapters.filter((c) => c.kind === 'skeleton')).toEqual([]);
    expect(plan.supersededSkeletons).toHaveLength(30);
    expect(plan.rows.lessonCourses).toHaveLength(30);
    expect(plan.rows.lessonCourses.every((c) => c.state === 'published')).toBe(true);
    // With only the hand-authored drafts, the other tracks are unpublished skeletons.
    expect(handAuthored.chapters.filter((c) => c.state === 'published').map((c) => c.courseTrackId).sort()).toEqual(['arabic-moroccan', 'english', 'japanese', 'spanish-spain']);
    expect(handAuthored.chapters.filter((c) => c.kind === 'skeleton').every((c) => c.state === 'review_needed')).toBe(true);
  });

  it('never writes placeholder text: skeleton chapters carry no expressions, forms, translations or localizations', () => {
    for (const p of [plan, handAuthored]) expect(p.rows.expressions.every((e) => e.canonical_text.trim().length > 0 && !/pending|placeholder|lorem/i.test(e.canonical_text))).toBe(true);
    const skeletonChapterIds = new Set(handAuthored.rows.chapters.filter((c) => c.state === 'review_needed').map((c) => c.id));
    const skeletonMissionIds = new Set(handAuthored.rows.missions.filter((m) => skeletonChapterIds.has(m.chapter_id!)).map((m) => m.id));
    expect(skeletonMissionIds.size).toBe(26 * CHAPTER_1_BLUEPRINT_KEYS.length);
    expect(handAuthored.rows.missionLocalizations.some((l) => skeletonMissionIds.has(l.mission_id))).toBe(false);
    expect(handAuthored.rows.missionSteps.filter((s) => skeletonMissionIds.has(s.mission_id)).every((s) => (s.target_expression_ids ?? []).length === 0)).toBe(true);
    for (const c of handAuthored.rows.chapters.filter((c) => c.state === 'review_needed')) expect(c.title_translations).toEqual({});
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
    expect(plan.rows.coverage.map((c) => `${c.course_track_id}|${c.source_language_code}`).sort()).toEqual(DRAFT_CHAPTERS.flatMap((c) => c.sourceLanguages.map((s) => `${c.courseTrackId}|${s}`)).sort());
    expect(plan.rows.coverage).toHaveLength(59);
    const fr = plan.rows.coverage.find((c) => c.course_track_id === 'arabic-moroccan' && c.source_language_code === 'fr')!;
    expect(fr.metrics.mission_instructions_pct).toBe(100);
    expect(fr.metrics.explanations_pct).toBe(100);
    expect(fr.metrics.audio_overlays_pct).toBe(0);
    expect(fr.metrics.subtitles_pct).toBe(0);
    const ja = plan.rows.coverage.find((c) => c.course_track_id === 'japanese')!;
    expect(ja.metrics.mission_instructions_pct).toBeCloseTo((4 / CHAPTER_1_BLUEPRINT_KEYS.length) * 100, 1);
  });

  it('casts a roster character whose role matches the lesson (café → café staff, directions → elder, ice cream → child) and leaves missions honestly uncast when nobody fits', () => {
    const byKey = new Map(plan.cast.map((c) => [c.missionKey, c]));
    const rosterById = new Map(CAST_ROSTER.map((c) => [c.characterId, c]));
    expect(plan.cast).toHaveLength(plan.rows.missions.length);
    const cafe = byKey.get('ary_cafe_order_drink')!;
    expect(cafe.character?.characterKey).toBe('ary-cafe-staff-nadia');
    expect(cafe.character?.role).toMatch(/caf/i);
    expect(cafe.fit).toBe('role');
    const directions = byKey.get('ary_ask_directions')!;
    expect(['elder', 'adult']).toContain(directions.character?.ageBand);
    expect(directions.character?.characterKey).toBe('ary-neighbour-youssef');
    const ice = byKey.get('ary_buy_ice_cream')!;
    expect(ice.character?.ageBand).toBe('child');
    expect(ice.character?.characterKey).toBe('ary-schoolgirl-salma');
    expect(ice.fit).toBe('pinned');
    // No Darija taxi driver / market vendor in the roster yet: honest null, no scenario row, no wrong character.
    expect(byKey.get('ary_take_taxi')!.character).toBeNull();
    expect(byKey.get('ary_take_taxi')!.fit).toBe('none');
    for (const c of plan.cast) {
      expect(c.preferred.preferredCharacterIntents.length).toBeGreaterThan(0);
      if (!c.character) continue;
      const member = rosterById.get(c.character.id)!;
      expect(member, c.missionKey).toBeDefined();
      expect(member.varietyId, c.missionKey).toBe(c.targetVarietyId);
      expect(c.character.characterKey).toBe(member.id);
      if (c.blueprintKey === 'buy_ice_cream') expect(['child', 'teen'], c.missionKey).toContain(member.ageBand);
      if (c.blueprintKey === 'take_taxi') expect(member.ageBand, c.missionKey).toBe('adult');
      if (c.blueprintKey === 'ask_directions') expect(['elder', 'adult'], c.missionKey).toContain(member.ageBand);
      if (c.fit === 'role') expect(c.reasons.join(' ')).toMatch(/matches/);
    }
    // Every chapter that has the ice-cream mission (Darija and the 26 generated drafts) casts a kid for it (the roster has ≥ 1 child or teen per track).
    const iceCreams = plan.cast.filter((c) => c.blueprintKey === 'buy_ice_cream');
    expect(iceCreams).toHaveLength(DRAFT_CHAPTERS.filter((c) => c.missions.some((m) => m.blueprintKey === 'buy_ice_cream')).length);
    expect(iceCreams.filter((c) => c.character).every((c) => ['child', 'teen'].includes(c.character!.ageBand))).toBe(true);
    // Varieties without a kid who carries the scene (arabic-msa today) stay uncast rather than getting an adult.
    expect(iceCreams.filter((c) => !c.character).length).toBeLessThanOrEqual(2);
    expect(iceCreams.filter((c) => c.character?.ageBand === 'child').length).toBeGreaterThanOrEqual(20);
    const summary = summarisePlan(plan);
    expect(summary.missions_cast! + summary.missions_uncast!).toBe(plan.rows.missions.length);
    expect(summary.missions_cast!).toBeGreaterThan(plan.rows.missions.length / 2);
    expect(plan.chapters.reduce((n, c) => n + c.cast, 0)).toBe(summary.missions_cast!);
  });

  it('writes one seed-owned dialogue_scenarios row per cast mission with the roster uuid, the blueprint objectives and the mission state', () => {
    const missionsById = new Map(plan.rows.missions.map((m) => [m.id, m]));
    const castMissions = plan.cast.filter((c) => c.character);
    expect(plan.rows.dialogueScenarios).toHaveLength(castMissions.length);
    expect(new Set(plan.rows.dialogueScenarios.map((s) => s.id)).size).toBe(plan.rows.dialogueScenarios.length);
    for (const c of castMissions) {
      const row = plan.rows.dialogueScenarios.find((s) => s.mission_id === c.missionId)!;
      expect(row, c.missionKey).toBeDefined();
      expect(row.id).toBe(curriculumUuid('dialogue_scenario', curriculumSeedKeys.dialogueScenario(c.chapterKey, c.missionKey)));
      expect(row.character_id).toBe(c.character!.id);
      const bp = getBlueprint(c.blueprintKey);
      expect(row.learner_role).toBe(bp.learnerRole);
      expect(row.scene).toBe(bp.sceneVariants[0]!.id);
      expect(row.min_level).toBe(bp.level);
      expect(row.expectedIntentKeys).toEqual([...new Set(bp.objectives.flatMap((o) => o.intentKeys))]);
      expect(row.state).toBe(missionsById.get(c.missionId)!.state);
      expect(row.scene_facts!.length).toBeGreaterThan(0);
    }
    const uncast = new Set(plan.cast.filter((c) => !c.character).map((c) => c.missionId));
    expect(plan.rows.dialogueScenarios.some((s) => uncast.has(s.mission_id))).toBe(false);
    for (const m of plan.rows.missions) {
      const seg = m.narrative_segment as { casting: { fit: string; character: { characterKey: string } | null; preferred: { preferredAgeBands: string[] } } };
      expect(typeof seg.casting.fit).toBe('string');
      expect(Array.isArray(seg.casting.preferred.preferredAgeBands)).toBe(true);
    }
    const custom = buildCurriculumSeedPlan({ tracks: ['arabic-moroccan'], roster: [] });
    expect(custom.rows.dialogueScenarios).toHaveLength(0);
    expect(custom.cast.every((c) => c.fit === 'none' && c.character === null)).toBe(true);
  });

  it('filters by track and can drop skeletons', () => {
    const one = buildCurriculumSeedPlan({ tracks: ['arabic-moroccan'] });
    expect(one.chapters).toHaveLength(1);
    expect(one.rows.lessonCourses).toHaveLength(1);
    expect(one.rows.missions).toHaveLength(7);
    expect(one.rows.coverage).toHaveLength(2);
    const noSkeletons = buildCurriculumSeedPlan({ drafts: HAND_AUTHORED_CHAPTERS, includeSkeletons: false });
    expect(noSkeletons.chapters).toHaveLength(4);
    expect(noSkeletons.supersededSkeletons).toHaveLength(0);
    const onlySkeleton = buildCurriculumSeedPlan({ drafts: HAND_AUTHORED_CHAPTERS, tracks: ['swahili'], skeletons: buildAllPlannedSkeletons() });
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
    expect(text).toMatch(/missions_cast=\d+ missions_uncast=\d+/);
    expect(text).not.toContain('cast     role');
    expect(text).toContain('expression_audio: 0 rows by design');
    const withCast = memoryIo();
    expect(await runCli(spec, ['--track', 'arabic-moroccan', '--dry-run', '--cast'], main, withCast)).toBe(0);
    expect(withCast.lines.join('\n')).toMatch(/cast {5}role {5}arabic-moroccan {10}ary_cafe_order_drink.*→ ary-cafe-staff-nadia \(Café staff, adult\)/);
    expect(withCast.lines.join('\n')).toMatch(/ary_buy_ice_cream.*→ ary-schoolgirl-salma \(Schoolgirl, child\)/);
    expect(withCast.lines.join('\n')).toMatch(/ary_take_taxi.*nobody in the variety carries this scene/);
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
  it('applies arabic-moroccan idempotently and the fr / en manifests list its published chapter with 7 missions and their cast', async () => {
    const db = resolved!.client;
    const plan = buildCurriculumSeedPlan({ tracks: ['arabic-moroccan'] });
    const first = await applyCurriculumSeedPlan(db, plan, memoryIo());
    const second = await applyCurriculumSeedPlan(db, plan, memoryIo());
    expect(second.missions.inserted).toBe(0);
    expect(second.missions.updated).toBe(7);
    expect(second.mission_steps.deleted).toBe(0);
    expect(second.dialogue_scenarios.inserted).toBe(0);
    expect(second.dialogue_scenarios.updated).toBe(plan.rows.dialogueScenarios.length);
    expect(second.dialogue_scenarios.deleted).toBe(0);
    expect(second.expressions.inserted).toBe(0);
    expect(second.expression_forms.deleted).toBe(0);
    expect(first.expression_audio).toEqual({ inserted: 0, updated: 0, deleted: 0, skipped: 0 });

    const checks = await verifyManifests(db, plan);
    expect(checks.map((c) => c.sourceLanguageCode).sort()).toEqual(['en', 'fr']);
    for (const c of checks) {
      expect(c.ok, `${c.courseTrackId} × ${c.sourceLanguageCode}`).toBe(true);
      expect(c.seededMissions).toBe(7);
      expect(c.titledInSource).toBe(7);
      expect(c.expectedCast).toBe(plan.rows.dialogueScenarios.length);
      expect(c.castListed).toBe(c.expectedCast);
      expect(c.uncast).toBe(7 - c.expectedCast);
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

    // Per-mission cast as the learner API serves it: café → café staff, directions → elder, ice cream → child; taxi honestly uncast.
    const castOf = (title: string) => chapter!.missions.find((m) => m.title === title)!.characterIds;
    const rosterKey = (id: string) => manifest.characters.find((c) => c.id === id)?.characterKey;
    expect(castOf('Commander au café').map(rosterKey)).toEqual(['ary-cafe-staff-nadia']);
    expect(castOf('Demander son chemin').map(rosterKey)).toEqual(['ary-neighbour-youssef']);
    expect(castOf('Une glace avec Salma').map(rosterKey)).toEqual(['ary-schoolgirl-salma']);
    expect(castOf('Prendre un petit taxi')).toEqual([]);
    const cafeCharacter = manifest.characters.find((c) => c.characterKey === 'ary-cafe-staff-nadia')!;
    expect(cafeCharacter.role).toMatch(/caf/i);
    expect(cafeCharacter.syntheticVoice).toBe(true);
    const scenarios = await db.from('dialogue_scenarios').select('mission_id, character_id, state').in('mission_id', plan.rows.missions.map((m) => m.id));
    expect(scenarios.data).toHaveLength(plan.rows.dialogueScenarios.length);
    expect(scenarios.data!.every((s) => s.state === 'published')).toBe(true);

    const coverage = await db.from('course_source_localizations').select('status, native_reviewed, editorial_note_key, metrics').eq('course_track_id', 'arabic-moroccan').eq('source_language_code', 'fr').single();
    expect(coverage.data?.status).toBe('partial');
    expect(coverage.data?.native_reviewed).toBe(false);
    expect(coverage.data?.editorial_note_key).toBe('enrollment.coverage.draftAvailable');
    expect((coverage.data?.metrics as { mission_instructions_pct: number }).mission_instructions_pct).toBe(100);
  });
});
