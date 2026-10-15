-- 040 — AI routing, evaluations, personalization and tracking (§5.4).

create table public.ai_model_profiles (
  id uuid primary key default gen_random_uuid(),
  task public.ai_task_name not null,
  target_variety_id text null references public.language_varieties(id) on delete cascade,
  source_language_code text null references public.languages(code) on delete cascade,
  provider public.ai_provider not null,
  primary_model text not null check (char_length(primary_model) > 0),
  fallback_models text[] not null default '{}',
  /** Sampling params, STT language hints, TTS voice ids. Never secrets. */
  params jsonb not null default '{}'::jsonb,
  capabilities jsonb not null default '{}'::jsonb,
  latency_class public.latency_class not null default 'interactive',
  daily_budget_usd numeric null check (daily_budget_usd is null or daily_budget_usd >= 0),
  enabled boolean not null default false,
  version integer not null default 1 check (version >= 0),
  benchmark_status text not null default 'unbenchmarked' check (benchmark_status in ('unbenchmarked','passing','failing','stale')),
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
/** One profile per (task, variety|any, source|any); NULLS NOT DISTINCT makes the "any" rows unique too. */
create unique index ai_model_profiles_scope_idx on public.ai_model_profiles(task, target_variety_id, source_language_code) nulls not distinct;
create index ai_model_profiles_task_enabled_idx on public.ai_model_profiles(task, enabled);
select public.attach_updated_at('public.ai_model_profiles');

create table public.ai_model_benchmarks (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.ai_model_profiles(id) on delete cascade,
  model text not null,
  target_variety_id text null references public.language_varieties(id) on delete set null,
  source_language_code text null references public.languages(code) on delete set null,
  sample_set_id text not null,
  evaluator_version text not null,
  naturalness public.unit_interval null,
  intelligibility public.unit_interval null,
  dialect_adherence public.unit_interval null,
  false_correction_rate public.unit_interval null,
  wer public.unit_interval null,
  latency_p50_ms integer null check (latency_p50_ms is null or latency_p50_ms >= 0),
  latency_p95_ms integer null check (latency_p95_ms is null or latency_p95_ms >= 0),
  cost_per_call_usd numeric null check (cost_per_call_usd is null or cost_per_call_usd >= 0),
  passed boolean not null default false,
  reviewer_id uuid null references auth.users(id) on delete set null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_model_benchmarks_profile_idx on public.ai_model_benchmarks(profile_id, created_at desc);
select public.attach_updated_at('public.ai_model_benchmarks');

create table public.ai_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete set null,
  enrollment_id uuid null references public.user_course_enrollments(id) on delete set null,
  task public.ai_task_name not null,
  provider text not null,
  model text not null,
  profile_id uuid null references public.ai_model_profiles(id) on delete set null,
  fallback_index integer not null default 0 check (fallback_index >= 0),
  latency_ms integer null check (latency_ms is null or latency_ms >= 0),
  input_tokens integer null check (input_tokens is null or input_tokens >= 0),
  output_tokens integer null check (output_tokens is null or output_tokens >= 0),
  audio_seconds numeric null check (audio_seconds is null or audio_seconds >= 0),
  estimated_cost_usd numeric null check (estimated_cost_usd is null or estimated_cost_usd >= 0),
  success boolean not null,
  error_code text null,
  trace_id text not null,
  /** Redacted metadata only — never raw prompts with learner data. */
  redacted_log jsonb null,
  created_at timestamptz not null default now()
);
create index ai_requests_created_idx on public.ai_requests(created_at desc);
create index ai_requests_task_idx on public.ai_requests(task, created_at desc);
create index ai_requests_trace_idx on public.ai_requests(trace_id);
select public.attach_append_only('public.ai_requests');

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------
create table public.conversation_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  enrollment_id uuid not null references public.user_course_enrollments(id) on delete cascade,
  mission_id uuid null references public.missions(id) on delete set null,
  scenario_id uuid null references public.dialogue_scenarios(id) on delete set null,
  character_id uuid not null references public.characters(id) on delete restrict,
  target_variety_id text not null references public.language_varieties(id) on delete restrict,
  source_language_code text not null references public.languages(code) on delete restrict,
  mode public.conversation_mode not null default 'push_to_talk',
  state public.conversation_state not null default 'preparing',
  pipeline text not null default 'stt_llm_tts' check (pipeline in ('duplex','stt_llm_tts','text_only')),
  turn_count integer not null default 0 check (turn_count >= 0),
  started_at timestamptz not null default now(),
  ended_at timestamptz null,
  summary text null,
  speech_retention public.speech_retention not null default 'none',
  rubric_outcomes jsonb null,
  objectives_completed text[] not null default '{}',
  revision integer not null default 0 check (revision >= 0),
  last_seq integer not null default 0 check (last_seq >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversation_sessions_user_idx on public.conversation_sessions(user_id, started_at desc);
create index conversation_sessions_enrollment_idx on public.conversation_sessions(enrollment_id, started_at desc);
select public.attach_updated_at('public.conversation_sessions');

create table public.conversation_turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.conversation_sessions(id) on delete cascade,
  turn_index integer not null check (turn_index >= 0),
  speaker text not null check (speaker in ('learner','character')),
  client_turn_id uuid null,
  /** Sanitized text, or null when retention disallows. Never raw audio by default. */
  text text null,
  text_hash text null,
  audio_asset_id uuid null references public.media_assets(id) on delete set null,
  goals text[] not null default '{}',
  hints_used integer not null default 0 check (hints_used >= 0),
  command text null,
  confidence public.unit_interval null,
  latency_ms integer null check (latency_ms is null or latency_ms >= 0),
  occurred_at timestamptz not null default now(),
  expires_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (session_id, turn_index)
);
create unique index conversation_turns_client_turn_idx on public.conversation_turns(session_id, client_turn_id) where client_turn_id is not null;
select public.attach_append_only('public.conversation_turns');

create table public.character_relationship_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  enrollment_id uuid not null references public.user_course_enrollments(id) on delete cascade,
  story_summary text not null default '' check (char_length(story_summary) <= 2000),
  durable_preferences jsonb not null default '{}'::jsonb,
  consented boolean not null default false,
  missions_completed_together integer not null default 0 check (missions_completed_together >= 0),
  last_interaction_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, character_id, enrollment_id)
);
select public.attach_updated_at('public.character_relationship_memory');

-- ---------------------------------------------------------------------------
-- Mastery, reviews, observations (keyed by enrollment; survive source-language changes)
-- ---------------------------------------------------------------------------
create table public.user_skill_mastery (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  enrollment_id uuid not null references public.user_course_enrollments(id) on delete cascade,
  skill_key text not null,
  mastery_state public.mastery_state not null default 'not_attempted',
  internal_score public.unit_interval not null default 0,
  last_practiced_at timestamptz null,
  due_at timestamptz null,
  evidence_count integer not null default 0 check (evidence_count >= 0),
  uncertainty public.unit_interval not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (enrollment_id, skill_key)
);
create index user_skill_mastery_user_idx on public.user_skill_mastery(user_id, enrollment_id);
create index user_skill_mastery_due_idx on public.user_skill_mastery(enrollment_id, due_at) where due_at is not null;
select public.attach_updated_at('public.user_skill_mastery');

create table public.user_expression_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  enrollment_id uuid not null references public.user_course_enrollments(id) on delete cascade,
  expression_id uuid null references public.expressions(id) on delete cascade,
  skill_key text null,
  card_state text not null default 'new' check (card_state in ('new','learning','review','relearning')),
  stability double precision not null default 0 check (stability >= 0),
  difficulty double precision not null default 5 check (difficulty between 1 and 10),
  retrievability public.unit_interval not null default 1,
  reps integer not null default 0 check (reps >= 0),
  lapses integer not null default 0 check (lapses >= 0),
  scheduled_days double precision not null default 0 check (scheduled_days >= 0),
  elapsed_days double precision not null default 0 check (elapsed_days >= 0),
  last_rating text null check (last_rating is null or last_rating in ('again','hard','good','easy')),
  last_hint_count integer not null default 0 check (last_hint_count >= 0),
  last_reviewed_at timestamptz null,
  next_due_at timestamptz not null default now(),
  recent_scenario_ids text[] not null default '{}',
  scheduler_version text not null default 'fsrs-lite-1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expression_id is not null or skill_key is not null)
);
/** Hot path for get_due_reviews(). */
create index user_expression_reviews_due_idx on public.user_expression_reviews(enrollment_id, next_due_at);
create unique index user_expression_reviews_expression_idx on public.user_expression_reviews(enrollment_id, expression_id) where expression_id is not null;
create unique index user_expression_reviews_skill_idx on public.user_expression_reviews(enrollment_id, skill_key) where expression_id is null and skill_key is not null;
select public.attach_updated_at('public.user_expression_reviews');

create table public.learning_observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  enrollment_id uuid not null references public.user_course_enrollments(id) on delete cascade,
  skill_key text not null,
  observation_type public.observation_type not null,
  scenario_id text not null,
  mission_id uuid null references public.missions(id) on delete set null,
  mission_attempt_id uuid null,
  conversation_session_id uuid null references public.conversation_sessions(id) on delete set null,
  expression_id uuid null references public.expressions(id) on delete set null,
  autonomy public.autonomy_level not null,
  hints_used integer not null default 0 check (hints_used >= 0),
  outcome public.observation_outcome not null,
  utterance_confidence public.unit_interval null,
  intelligibility public.intelligibility null,
  pronunciation_mode public.assessment_mode null,
  pronunciation_confidence public.pronunciation_confidence null,
  scorer_kind public.scorer_kind not null,
  scorer_version text not null,
  asr_version text null,
  uncertainty public.unit_interval not null default 0.5,
  feedback_evidence jsonb null,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index learning_observations_enrollment_idx on public.learning_observations(enrollment_id, skill_key, observed_at desc);
create index learning_observations_user_idx on public.learning_observations(user_id, observed_at desc);
select public.attach_append_only('public.learning_observations');

-- ---------------------------------------------------------------------------
-- Mission attempts and progress
-- ---------------------------------------------------------------------------
create table public.mission_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  enrollment_id uuid not null references public.user_course_enrollments(id) on delete cascade,
  mission_id uuid not null references public.missions(id) on delete cascade,
  mission_revision integer not null default 0 check (mission_revision >= 0),
  client_attempt_id uuid not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  abandoned_at timestamptz null,
  current_step_index integer not null default 0 check (current_step_index >= 0),
  step_results jsonb not null default '[]'::jsonb,
  objectives_completed text[] not null default '{}',
  evaluation jsonb null,
  xp_awarded integer not null default 0 check (xp_awarded >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_attempt_id)
);
create index mission_attempts_enrollment_idx on public.mission_attempts(enrollment_id, mission_id, started_at desc);
select public.attach_updated_at('public.mission_attempts');

alter table public.learning_observations
  add constraint learning_observations_attempt_fkey foreign key (mission_attempt_id) references public.mission_attempts(id) on delete set null;

create table public.mission_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  enrollment_id uuid not null references public.user_course_enrollments(id) on delete cascade,
  mission_id uuid not null references public.missions(id) on delete cascade,
  status text not null default 'available' check (status in ('locked','available','in_progress','completed')),
  best_attempt_id uuid null references public.mission_attempts(id) on delete set null,
  completions integer not null default 0 check (completions >= 0),
  completed_without_hints boolean not null default false,
  first_completed_at timestamptz null,
  last_completed_at timestamptz null,
  revision integer not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (enrollment_id, mission_id)
);
create index mission_progress_user_idx on public.mission_progress(user_id, enrollment_id, status);
select public.attach_updated_at('public.mission_progress');

create table public.user_achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  enrollment_id uuid null references public.user_course_enrollments(id) on delete cascade,
  achievement_key text not null check (achievement_key ~ '^[a-z0-9]+(?:[._][a-z0-9]+)*$'),
  unlocked_at timestamptz not null default now(),
  evidence jsonb null,
  client_event_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_event_id)
);
/** An achievement is unlocked once per user (or once per enrollment when enrollment-scoped). */
create unique index user_achievements_key_idx on public.user_achievements(user_id, achievement_key, coalesce(enrollment_id, '00000000-0000-0000-0000-000000000000'::uuid));
select public.attach_updated_at('public.user_achievements');

create table public.streak_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_date date not null,
  time_zone text not null default 'UTC',
  minutes_active integer not null default 0 check (minutes_active >= 0),
  speaking_seconds integer not null default 0 check (speaking_seconds >= 0),
  missions_completed integer not null default 0 check (missions_completed >= 0),
  reviews_completed integer not null default 0 check (reviews_completed >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, activity_date)
);
select public.attach_updated_at('public.streak_activity');

-- ---------------------------------------------------------------------------
-- XP ledger (append-only, idempotent) — §3.8
-- ---------------------------------------------------------------------------
create table public.xp_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  enrollment_id uuid null references public.user_course_enrollments(id) on delete set null,
  amount integer not null check (amount <> 0),
  reason public.xp_reason not null,
  reference_table text null,
  reference_id uuid null,
  /** Unique client event UUID; replay returns the original row (award_xp). */
  idempotency_key uuid not null unique,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index xp_ledger_user_idx on public.xp_ledger(user_id, occurred_at desc);
create index xp_ledger_enrollment_idx on public.xp_ledger(enrollment_id, occurred_at desc);
/** A given completion/review/achievement row is paid at most once per reason (§3.8 "not farmable"). */
create unique index xp_ledger_reference_once on public.xp_ledger(user_id, reason, reference_id) where reference_id is not null;
select public.attach_append_only('public.xp_ledger');

create table public.daily_learning_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  enrollment_id uuid not null references public.user_course_enrollments(id) on delete cascade,
  metric_date date not null,
  minutes_active integer not null default 0 check (minutes_active >= 0),
  speaking_seconds integer not null default 0 check (speaking_seconds >= 0),
  missions_completed integer not null default 0 check (missions_completed >= 0),
  missions_completed_without_hints integer not null default 0 check (missions_completed_without_hints >= 0),
  reviews_due integer not null default 0 check (reviews_due >= 0),
  reviews_completed integer not null default 0 check (reviews_completed >= 0),
  review_recall_pct public.percent null,
  conversation_turns integer not null default 0 check (conversation_turns >= 0),
  xp_earned integer not null default 0 check (xp_earned >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (enrollment_id, metric_date)
);
create index daily_learning_metrics_user_idx on public.daily_learning_metrics(user_id, metric_date desc);
select public.attach_updated_at('public.daily_learning_metrics');

-- ---------------------------------------------------------------------------
-- Device sync events (append-only; idempotent on (user_id, client_event_id)) — §4.5
-- ---------------------------------------------------------------------------
create table public.device_sync_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  client_event_id uuid not null,
  payload_type text not null,
  payload jsonb not null default '{}'::jsonb,
  revision integer not null default 0 check (revision >= 0),
  client_occurred_at timestamptz not null,
  clock_skew_ms integer null,
  applied_at timestamptz null,
  resolution text not null check (resolution in ('applied','duplicate','superseded','rejected')),
  rejection_reason text null,
  created_at timestamptz not null default now(),
  unique (user_id, client_event_id)
);
create index device_sync_events_device_idx on public.device_sync_events(user_id, device_id, revision desc);
/** Only applied_at may change after insert (engine-handled events are marked later). */
create or replace function public.guard_sync_event_update()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'device_sync_events is append-only' using errcode = 'check_violation';
  end if;
  if new.user_id <> old.user_id or new.client_event_id <> old.client_event_id or new.payload <> old.payload
     or new.payload_type <> old.payload_type or new.revision <> old.revision or new.device_id <> old.device_id then
    raise exception 'device_sync_events rows are immutable except applied_at/resolution' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger append_only before update or delete on public.device_sync_events
  for each row execute function public.guard_sync_event_update();

-- ---------------------------------------------------------------------------
-- Notifications, feedback, moderation, audit
-- ---------------------------------------------------------------------------
create table public.notification_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('push','email')),
  enabled boolean not null default false,
  quiet_hours jsonb null,
  reminder_time_local text null,
  categories jsonb not null default '{}'::jsonb,
  push_token text null,
  platform public.platform null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (user_id, channel, platform)
);
select public.attach_updated_at('public.notification_settings');

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('push','email')),
  category text not null,
  template_key text not null,
  locale text not null,
  status text not null default 'queued' check (status in ('queued','sent','failed','suppressed')),
  provider_message_id text null,
  error text null,
  sent_at timestamptz null,
  created_at timestamptz not null default now()
);
create index notification_deliveries_user_idx on public.notification_deliveries(user_id, created_at desc);
-- Append-only ledger (contracts APPEND_ONLY_TABLES): one immutable row per delivery attempt.
select public.attach_append_only('public.notification_deliveries');

create table public.feedback_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete set null,
  enrollment_id uuid null references public.user_course_enrollments(id) on delete set null,
  course_track_id text null references public.course_tracks(id) on delete set null,
  category text not null check (category in ('wrong_translation','wrong_dialect','bad_audio','false_correction','offensive','bug','other')),
  entity_table text null,
  entity_id uuid null,
  message text not null check (char_length(message) <= 2000),
  status text not null default 'open' check (status in ('open','triaged','resolved','dismissed')),
  resolved_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index feedback_reports_status_idx on public.feedback_reports(status, created_at desc);
select public.attach_updated_at('public.feedback_reports');

create table public.moderation_incidents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete set null,
  session_id uuid null references public.conversation_sessions(id) on delete set null,
  kind text not null check (kind in ('abuse','prompt_injection','unsafe_content','rate_abuse','other')),
  severity text not null default 'low' check (severity in ('low','medium','high')),
  details jsonb not null default '{}'::jsonb,
  action_taken text null,
  reviewed_by uuid null references auth.users(id) on delete set null,
  status text not null default 'open' check (status in ('open','reviewed','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index moderation_incidents_status_idx on public.moderation_incidents(status, severity, created_at desc);
select public.attach_updated_at('public.moderation_incidents');

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid null references auth.users(id) on delete set null,
  actor_role text null,
  action text not null,
  entity_table text null,
  entity_id text null,
  before jsonb null,
  after jsonb null,
  ip_hash text null,
  request_id text null,
  created_at timestamptz not null default now()
);
create index audit_logs_entity_idx on public.audit_logs(entity_table, entity_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs(actor_id, created_at desc);
select public.attach_append_only('public.audit_logs');
