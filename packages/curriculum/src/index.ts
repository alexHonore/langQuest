/**
 * @langquest/curriculum — skills, intents, mission templates, FSRS-like scheduler,
 * mastery state machine, next-mission planner, rubric/XP rules and honestly-labelled
 * seed content. Pure TypeScript, no I/O; consumers are `apps/api`, `apps/jobs`,
 * `apps/mobile` (offline packs) and `scripts` (coverage validation).
 *
 * Entry points:
 *  - `SKILLS` / `INTENTS` registries (`skills.ts`, `intents.ts`)
 *  - `realise(blueprint, languageContext, expressions)` and `SITUATIONAL_BLUEPRINTS` (`missions/`)
 *  - `createScheduler()`, `selectDueCards()`, `reviewBudget()` (`scheduler/`)
 *  - `deriveMastery()` (`mastery/`)
 *  - `planSession()`, `buildOfflinePack()` (`planner/`)
 *  - `evaluateMissionObjectives()`, `validateXpClaim()` (`rubric/`)
 *  - `DRAFT_CHAPTERS`, `buildAllPlannedSkeletons()`, `summariseCoverage()` (`content/`)
 *  - `scoreDialogueDiversity()` — generated dialogue-set diversity gate (`diversity/`)
 */
export * from './skills';
export * from './intents';
export * from './missions';
export * from './scheduler';
export * from './mastery';
export * from './planner';
export * from './rubric';
export * from './content';
export * from './diversity';
