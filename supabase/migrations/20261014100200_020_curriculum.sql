-- 020 — curriculum core (§5.2): rights, media, skills, intents, expressions, courses, missions, characters, revisions.

-- ---------------------------------------------------------------------------
-- Rights and media (referenced by everything else)
-- ---------------------------------------------------------------------------
create table public.content_rights (
  id uuid primary key default gen_random_uuid(),
  origin_url text null,
  authors text[] not null default '{}',
  speakers text[] not null default '{}',
  permission_grant text not null,
  license_id text not null,
  license_version text null,
  commercial_redistribution boolean not null default false,
  attribution_required boolean not null default true,
  attribution_text text null,
  alterations_permitted boolean not null default false,
  ai_processing_permitted boolean not null default false,
  voice_rights text not null default 'none' check (voice_rights in ('none','playback_only','synthesis_permitted')),
  expires_at timestamptz null,
  revoked_at timestamptz null,
  evidence_asset_id uuid null, -- FK to media_assets added below
  reviewer_id uuid null references auth.users(id) on delete set null,
  reviewed_at timestamptz null,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index content_rights_license_idx on public.content_rights(license_id);
select public.attach_updated_at('public.content_rights');

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  /** R2 object key (generated id + content hash) — never a user filename; shape enforced by object_key_scope(). */
  storage_key text not null unique check (coalesce(public.object_key_scope(storage_key), '') in ('master','derived','public')),
  bucket text not null,
  owner_id uuid null references auth.users(id) on delete set null,
  kind public.asset_kind not null,
  checksum_sha256 public.sha256_hex not null,
  mime_type text not null,
  byte_length bigint not null check (byte_length >= 0),
  duration_ms integer null check (duration_ms is null or duration_ms >= 0),
  channels integer null check (channels is null or channels >= 1),
  sample_rate_hz integer null check (sample_rate_hz is null or sample_rate_hz > 0),
  bitrate_kbps integer null check (bitrate_kbps is null or bitrate_kbps > 0),
  source_asset_id uuid null references public.media_assets(id) on delete set null,
  derivation text null,
  visibility public.asset_visibility not null default 'private',
  content_rights_id uuid null references public.content_rights(id) on delete set null,
  disposition text not null default 'active' check (disposition in ('active','quarantined','revoked','deleted')),
  legacy_filename text null,
  legacy_path text null,
  state public.content_state not null default 'imported_draft',
  etag text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index media_assets_checksum_idx on public.media_assets(checksum_sha256);
create index media_assets_source_idx on public.media_assets(source_asset_id);
create index media_assets_state_idx on public.media_assets(state, visibility);
create index media_assets_rights_idx on public.media_assets(content_rights_id);
select public.attach_updated_at('public.media_assets');

alter table public.content_rights
  add constraint content_rights_evidence_asset_fkey foreign key (evidence_asset_id) references public.media_assets(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Skills and intents (language independent)
-- ---------------------------------------------------------------------------
create table public.skills (
  id uuid primary key default gen_random_uuid(),
  skill_key text not null unique check (skill_key ~ '^[a-z0-9]+(?:[._][a-z0-9]+)*$'),
  descriptor text not null,
  difficulty public.unit_interval not null default 0.5,
  target_language_id text null references public.languages(id) on delete set null,
  cefr_can_do public.cefr_level null,
  can_do_statement text null,
  prerequisite_skill_keys text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
select public.attach_updated_at('public.skills');

create table public.skill_variants (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references public.skills(id) on delete cascade,
  target_variety_id text not null references public.language_varieties(id) on delete cascade,
  realization_notes text not null default '',
  example_expression_ids uuid[] not null default '{}',
  review_status public.review_status not null default 'draft',
  reviewer_id uuid null references auth.users(id) on delete set null,
  reviewer_region text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (skill_id, target_variety_id)
);
select public.attach_updated_at('public.skill_variants');

create table public.communicative_intents (
  id uuid primary key default gen_random_uuid(),
  intent_key text not null unique check (intent_key ~ '^[a-z0-9]+(?:[._][a-z0-9]+)*$'),
  description text not null,
  response_constraints jsonb not null default '{}'::jsonb,
  social_meaning text null,
  polarity text not null default 'neutral' check (polarity in ('positive','negative','neutral')),
  politeness text not null default 'any' check (politeness in ('any','polite','casual')),
  skill_keys text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
select public.attach_updated_at('public.communicative_intents');

-- ---------------------------------------------------------------------------
-- Expressions (target-variety realisations of intents)
-- ---------------------------------------------------------------------------
create table public.expressions (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid not null references public.communicative_intents(id) on delete restrict,
  target_variety_id text not null references public.language_varieties(id) on delete restrict,
  canonical_text text not null,
  register public.speech_register not null default 'neutral',
  difficulty public.unit_interval not null default 0.5,
  scenario_tags text[] not null default '{}',
  script_annotations jsonb not null default '{}'::jsonb,
  phonetic_annotations jsonb not null default '{}'::jsonb,
  reviewed boolean not null default false,
  reviewer_id uuid null references auth.users(id) on delete set null,
  content_rights_id uuid null references public.content_rights(id) on delete set null,
  origin public.content_origin not null default 'ai_generated',
  state public.content_state not null default 'review_needed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index expressions_intent_variety_idx on public.expressions(intent_id, target_variety_id);
create index expressions_variety_state_idx on public.expressions(target_variety_id, state);
select public.attach_updated_at('public.expressions');

create table public.expression_forms (
  id uuid primary key default gen_random_uuid(),
  expression_id uuid not null references public.expressions(id) on delete cascade,
  script public.script_id null,
  transliteration_scheme public.transliteration_scheme null,
  text text not null,
  word_alignment jsonb not null default '[]'::jsonb,
  tone_markers text[] null,
  ipa text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (script is not null or transliteration_scheme is not null)
);
create index expression_forms_expression_idx on public.expression_forms(expression_id);
select public.attach_updated_at('public.expression_forms');

create table public.expression_translations (
  id uuid primary key default gen_random_uuid(),
  expression_id uuid not null references public.expressions(id) on delete cascade,
  source_language_code text not null references public.languages(code) on delete cascade,
  natural_meaning text not null,
  context_note text null,
  literal_gloss text null,
  qa_state public.translation_qa_state not null default 'machine_draft',
  reviewer_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (expression_id, source_language_code)
);
select public.attach_updated_at('public.expression_translations');

-- speakers live in 030_audio_library; FK added there.
create table public.expression_audio (
  id uuid primary key default gen_random_uuid(),
  expression_id uuid not null references public.expressions(id) on delete cascade,
  voice_id text not null,
  speaker_id uuid null,
  asset_id uuid not null references public.media_assets(id) on delete cascade,
  speech_rate text not null default 'normal' check (speech_rate in ('slow','normal','fast')),
  regional_option text null,
  synthetic boolean not null default false,
  quality_flag text not null default 'unreviewed' check (quality_flag in ('unreviewed','ok','poor','wrong_variety')),
  reviewed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index expression_audio_expression_idx on public.expression_audio(expression_id, speech_rate);
select public.attach_updated_at('public.expression_audio');

-- ---------------------------------------------------------------------------
-- Courses, chapters, missions (visual FKs added in 050_visual)
-- ---------------------------------------------------------------------------
create table public.lesson_courses (
  id uuid primary key default gen_random_uuid(),
  course_track_id text not null references public.course_tracks(id) on delete restrict,
  title_translations jsonb not null default '{}'::jsonb,
  description_translations jsonb not null default '{}'::jsonb,
  cover_visual_asset_id uuid null,
  sort_order integer not null default 0 check (sort_order >= 0),
  state public.content_state not null default 'review_needed',
  content_rights_id uuid null references public.content_rights(id) on delete set null,
  published_revision integer null check (published_revision is null or published_revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lesson_courses_track_idx on public.lesson_courses(course_track_id, state, sort_order);
select public.attach_updated_at('public.lesson_courses');

create table public.chapters (
  id uuid primary key default gen_random_uuid(),
  lesson_course_id uuid not null references public.lesson_courses(id) on delete cascade,
  title_translations jsonb not null default '{}'::jsonb,
  description_translations jsonb not null default '{}'::jsonb,
  sort_index integer not null default 0 check (sort_index >= 0),
  scene text null,
  region text null,
  cover_visual_asset_id uuid null,
  map_visual_asset_id uuid null,
  state public.content_state not null default 'review_needed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index chapters_course_idx on public.chapters(lesson_course_id, sort_index);
select public.attach_updated_at('public.chapters');

create table public.missions (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid null references public.chapters(id) on delete cascade,
  /** Cross-course reusable template key when chapter_id is null. */
  template_key text null check (template_key is null or template_key ~ '^[a-z0-9]+(?:[._][a-z0-9]+)*$'),
  mission_type public.mission_type not null default 'standard',
  title_translations jsonb not null default '{}'::jsonb,
  goals jsonb not null default '[]'::jsonb,
  target_variety_id text not null references public.language_varieties(id) on delete restrict,
  level public.learner_level not null default 'beginner',
  recommended_minutes numeric not null default 8 check (recommended_minutes >= 1),
  published_revision integer null check (published_revision is null or published_revision >= 0),
  prerequisite_skill_keys text[] not null default '{}',
  difficulty public.unit_interval not null default 0.5,
  narrative_segment jsonb null,
  scoring_rubric jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0 check (sort_order >= 0),
  state public.content_state not null default 'review_needed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (chapter_id is not null or template_key is not null)
);
create index missions_chapter_idx on public.missions(chapter_id, sort_order);
create index missions_variety_state_idx on public.missions(target_variety_id, state);
create unique index missions_template_key_idx on public.missions(template_key) where template_key is not null;
select public.attach_updated_at('public.missions');

alter table public.user_course_enrollments
  add constraint user_course_enrollments_active_mission_fkey foreign key (active_mission_id) references public.missions(id) on delete set null;

create table public.mission_localizations (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id) on delete cascade,
  source_language_code text not null references public.languages(code) on delete cascade,
  title text not null,
  instructions text not null,
  hints text[] not null default '{}',
  help_text text null,
  qa_state public.translation_qa_state not null default 'machine_draft',
  reviewer_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mission_id, source_language_code)
);
select public.attach_updated_at('public.mission_localizations');

create table public.mission_steps (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id) on delete cascade,
  sort_order integer not null default 0 check (sort_order >= 0),
  step_type public.mission_step_type not null,
  lesson_type public.lesson_type null,
  prompt_asset_ids uuid[] not null default '{}',
  visual_asset_ids uuid[] not null default '{}',
  target_expression_ids uuid[] not null default '{}',
  success_conditions jsonb not null default '{}'::jsonb,
  hint_scaffold text[] not null default '{}',
  valid_intent_ids uuid[] not null default '{}',
  branching jsonb null,
  estimated_seconds integer not null default 60 check (estimated_seconds >= 0),
  offline_capable boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mission_id, sort_order)
);
select public.attach_updated_at('public.mission_steps');

create table public.mission_graph_edges (
  id uuid primary key default gen_random_uuid(),
  from_mission_id uuid not null references public.missions(id) on delete cascade,
  to_mission_id uuid not null references public.missions(id) on delete cascade,
  edge_type text not null check (edge_type in ('prerequisite','next','branch')),
  branch_condition jsonb null,
  reward jsonb null,
  character_memory_change jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (from_mission_id, to_mission_id, edge_type),
  check (from_mission_id <> to_mission_id)
);
create index mission_graph_edges_to_idx on public.mission_graph_edges(to_mission_id);
select public.attach_updated_at('public.mission_graph_edges');

-- ---------------------------------------------------------------------------
-- Characters, scenarios, story arcs
-- ---------------------------------------------------------------------------
create table public.characters (
  id uuid primary key default gen_random_uuid(),
  character_key text not null unique check (character_key ~ '^[a-z0-9]+(?:[._][a-z0-9]+)*$'),
  name text not null,
  role text not null,
  personality text not null,
  home_region text not null,
  target_variety_id text not null references public.language_varieties(id) on delete restrict,
  regional_option text null,
  voice_profile jsonb not null default '{}'::jsonb,
  storyline_facts text[] not null default '{}',
  portrait_visual_asset_id uuid null,
  safety_rules text[] not null default '{}',
  relationships jsonb not null default '[]'::jsonb,
  state public.content_state not null default 'review_needed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index characters_variety_idx on public.characters(target_variety_id, state);
select public.attach_updated_at('public.characters');

create table public.dialogue_scenarios (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid null references public.missions(id) on delete cascade,
  scene text not null,
  learner_role text not null,
  character_id uuid not null references public.characters(id) on delete restrict,
  min_level public.learner_level not null default 'beginner',
  max_level public.learner_level not null default 'advanced',
  expected_intent_ids uuid[] not null default '{}',
  interruption_policy text not null default 'allow_barge_in' check (interruption_policy in ('allow_barge_in','finish_sentence','no_interruptions')),
  safety_rules text[] not null default '{}',
  topic_rules text[] not null default '{}',
  scene_facts text[] not null default '{}',
  state public.content_state not null default 'review_needed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index dialogue_scenarios_mission_idx on public.dialogue_scenarios(mission_id);
create index dialogue_scenarios_character_idx on public.dialogue_scenarios(character_id);
select public.attach_updated_at('public.dialogue_scenarios');

create table public.dialogue_variants (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references public.dialogue_scenarios(id) on delete cascade,
  target_variety_id text not null references public.language_varieties(id) on delete restrict,
  regional_option text null,
  turns jsonb not null default '[]'::jsonb,
  source_language_code text null references public.languages(code) on delete set null,
  source_support jsonb null,
  review_status public.review_status not null default 'draft',
  reviewer_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index dialogue_variants_scenario_idx on public.dialogue_variants(scenario_id);
select public.attach_updated_at('public.dialogue_variants');

create table public.story_arcs (
  id uuid primary key default gen_random_uuid(),
  course_track_id text not null references public.course_tracks(id) on delete cascade,
  character_ids uuid[] not null default '{}',
  region text not null,
  title_translations jsonb not null default '{}'::jsonb,
  milestones jsonb not null default '[]'::jsonb,
  learner_memory_schema jsonb not null default '{}'::jsonb,
  state public.content_state not null default 'review_needed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index story_arcs_track_idx on public.story_arcs(course_track_id);
select public.attach_updated_at('public.story_arcs');

-- ---------------------------------------------------------------------------
-- Revisions and publication events (append-only)
-- ---------------------------------------------------------------------------
create table public.content_revisions (
  id uuid primary key default gen_random_uuid(),
  entity_table text not null,
  entity_id uuid not null,
  revision integer not null check (revision >= 0),
  diff jsonb not null default '{}'::jsonb,
  snapshot jsonb null,
  editor_id uuid not null references auth.users(id) on delete restrict,
  note text null,
  created_at timestamptz not null default now(),
  unique (entity_table, entity_id, revision)
);
select public.attach_append_only('public.content_revisions');

create table public.publication_events (
  id uuid primary key default gen_random_uuid(),
  entity_table text not null,
  entity_id uuid not null,
  revision integer not null check (revision >= 0),
  from_state public.content_state null,
  to_state public.content_state not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  reason text null,
  rollback_of_event_id uuid null references public.publication_events(id) on delete set null,
  created_at timestamptz not null default now()
);
create index publication_events_entity_idx on public.publication_events(entity_table, entity_id, created_at desc);
select public.attach_append_only('public.publication_events');
