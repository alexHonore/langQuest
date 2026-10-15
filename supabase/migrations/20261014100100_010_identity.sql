-- 010 — identity and configuration (§5.1): profiles, settings, catalog, roles, enrollments, coverage.

-- ---------------------------------------------------------------------------
-- Catalog (languages, scripts, varieties, tracks). Seeded in 080_seed_catalog.
-- ---------------------------------------------------------------------------
create table public.languages (
  id text primary key,
  code text not null unique check (code ~ '^[a-z]{2,3}$'),
  english_name text not null,
  native_name text not null,
  default_script public.script_id not null,
  rtl boolean not null default false,
  plural_categories text[] not null default '{other}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (id = code)
);
select public.attach_updated_at('public.languages');

create table public.writing_systems (
  id text primary key,
  kind text not null check (kind in ('script','transliteration','annotation')),
  name text not null,
  direction text not null check (direction in ('ltr','rtl')),
  renders_script public.script_id null,
  renderer_rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
select public.attach_updated_at('public.writing_systems');

create table public.language_varieties (
  id text primary key,
  language_id text not null references public.languages(id) on delete restrict,
  dialect_name text not null,
  bcp47_locale text null,
  tonal boolean not null default false,
  regional_notes text not null default '',
  code_switch_norms text not null default '',
  alternative_names text[] not null default '{}',
  localized_voice_settings jsonb not null default '{}'::jsonb,
  /** Varieties that must never be silently substituted for this one (ary→arb, yue→cmn, ht→fr …). */
  must_not_substitute text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index language_varieties_language_idx on public.language_varieties(language_id);
select public.attach_updated_at('public.language_varieties');

create table public.course_tracks (
  id text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  sort_order integer not null unique check (sort_order between 1 and 30),
  display_name text not null,
  language_id text not null references public.languages(id) on delete restrict,
  primary_target_variety_id text not null references public.language_varieties(id) on delete restrict,
  default_locale text not null,
  regional_options jsonb not null default '[]'::jsonb,
  scripts jsonb not null,
  script_mode_options text[] not null default '{native}',
  default_script_mode public.script_mode not null default 'native',
  script_focus public.script_id null,
  default_voices jsonb not null default '{}'::jsonb,
  teaching_focus text not null default '',
  shares_assets_with_track_id text null references public.course_tracks(id) on delete set null,
  tonal boolean not null default false,
  assumptions text[] not null default '{}',
  automated_scoring_support public.scoring_support not null default 'limited',
  publication_state public.content_state not null default 'review_needed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (default_script_mode = any(script_mode_options))
);
create index course_tracks_variety_idx on public.course_tracks(primary_target_variety_id);
select public.attach_updated_at('public.course_tracks');

-- ---------------------------------------------------------------------------
-- Profiles and settings
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text null check (display_name is null or char_length(display_name) <= 80),
  ui_locale text not null default 'en',
  /**
   * Prefills new enrollments only. Never rewrites existing enrollments (§2.1).
   * NULL = the learner has not chosen an instruction language yet (onboarding must set it); there is
   * deliberately no catalog default here — a device-locale prefill belongs in the UI, never in the schema.
   */
  default_source_language_code text null references public.languages(code) on delete restrict,
  time_zone text not null default 'UTC',
  privacy_options jsonb not null default '{"store_speech_recordings":"none","store_raw_transcripts":false,"personalize_from_interests":false,"analytics_opt_out":false,"leaderboard_opt_in":false}'::jsonb,
  accessibility_options jsonb not null default '{"reduce_motion":false,"mascot_enabled":true,"mascot_voice_enabled":true,"high_contrast":false,"text_scale":1,"haptics_enabled":true,"captions_default_on":false}'::jsonb,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
select public.attach_updated_at('public.profiles');

create table public.account_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  notification_preferences jsonb not null default '{"daily_reminder":false,"reminder_time_local":null,"review_due":true,"story_updates":true,"streak_gentle":false}'::jsonb,
  audio_speed double precision not null default 1 check (audio_speed between 0.5 and 1.5),
  preferred_input_device text null,
  preferred_output_device text null,
  default_hint_behavior text not null default 'on_request' check (default_hint_behavior in ('on_request','after_pause','always')),
  script_preferences jsonb not null default '{}'::jsonb,
  transliteration_preferences jsonb not null default '{}'::jsonb,
  offline_download_settings jsonb not null default '{"auto_download":false,"wifi_only":true,"max_storage_mb":2048}'::jsonb,
  retention_settings jsonb not null default '{"speech":"none","transcripts_days":null}'::jsonb,
  conversation_mode public.conversation_mode not null default 'push_to_talk',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
select public.attach_updated_at('public.account_settings');

-- ---------------------------------------------------------------------------
-- Staff roles (§5.5). Learners have no row.
-- ---------------------------------------------------------------------------
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.staff_role not null,
  granted_by uuid null references auth.users(id) on delete set null,
  expires_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, role)
);
create index user_roles_user_idx on public.user_roles(user_id);
select public.attach_updated_at('public.user_roles');

/**
 * True when the calling JWT's user currently holds `p_role`.
 * SECURITY DEFINER so it can be used inside RLS policies on user_roles itself without recursion.
 */
create or replace function public.has_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = auth.uid()
      and r.role = p_role
      and (r.expires_at is null or r.expires_at > now())
  );
$$;
revoke all on function public.has_role(text) from public;
grant execute on function public.has_role(text) to anon, authenticated, service_role;

/** True when the caller holds any of the given roles. */
create or replace function public.has_any_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = auth.uid()
      and r.role = any(p_roles)
      and (r.expires_at is null or r.expires_at > now())
  );
$$;
revoke all on function public.has_any_role(text[]) from public;
grant execute on function public.has_any_role(text[]) to anon, authenticated, service_role;

/** Any staff role at all (read access to drafts, admin UI). */
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_any_role(array['super_admin','admin','content_editor','language_reviewer','support_readonly']);
$$;
/** May create/edit/publish shared content, rights and media. */
create or replace function public.is_content_editor()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_any_role(array['super_admin','admin','content_editor']);
$$;
/** May review/approve translations and variants (editors included). */
create or replace function public.is_language_reviewer()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_any_role(array['super_admin','admin','content_editor','language_reviewer']);
$$;
/** Platform administration (model routing, roles, moderation, analytics). */
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_any_role(array['super_admin','admin']);
$$;
/** Read-only support view of learner-owned rows (no writes). */
create or replace function public.is_support()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_any_role(array['super_admin','admin','support_readonly']);
$$;
revoke all on function public.is_staff() from public;
revoke all on function public.is_content_editor() from public;
revoke all on function public.is_language_reviewer() from public;
revoke all on function public.is_admin() from public;
revoke all on function public.is_support() from public;
grant execute on function public.is_staff(), public.is_content_editor(), public.is_language_reviewer(), public.is_admin(), public.is_support() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- New auth user → profile + settings
-- ---------------------------------------------------------------------------
/**
 * Normalises a client-supplied instruction-language value to the catalog's ISO-639-1 style code
 * (CONVENTIONS §2.2): trims, lower-cases and keeps only the language subtag, so 'pt-BR', 'fr_CA' or
 * ' ES ' become 'pt', 'fr', 'es'. Returns NULL for NULL/blank input. Does NOT check the catalog.
 */
create or replace function public.normalize_source_language_code(p_value text)
returns text
language sql
immutable
strict
set search_path = public
as $$
  select nullif(lower(split_part(replace(btrim(p_value), '_', '-'), '-', 1)), '');
$$;
revoke all on function public.normalize_source_language_code(text) from public;
grant execute on function public.normalize_source_language_code(text) to anon, authenticated, service_role;

/**
 * auth.users → profiles + account_settings.
 * `default_source_language_code` metadata is normalised to its language subtag and must then exist in
 * `public.languages`; an unknown value aborts the signup (never silently substituted — spec §2.1 item 4).
 * Absent metadata (OAuth/magic-link signups) leaves the column NULL for onboarding to fill in.
 */
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_locale text := coalesce(nullif(new.raw_user_meta_data ->> 'ui_locale', ''), 'en');
  v_source_raw text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'default_source_language_code', '')), '');
  v_source text := public.normalize_source_language_code(v_source_raw);
  v_name   text := nullif(left(coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name', ''), 80), '');
  v_tz     text := coalesce(nullif(new.raw_user_meta_data ->> 'time_zone', ''), 'UTC');
begin
  if v_source is not null and not exists (select 1 from public.languages where code = v_source) then
    raise exception 'default_source_language_code "%" (normalised "%") is not a catalog language; expected an ISO-639-1 style code such as en, fr, es',
      v_source_raw, v_source
      using errcode = 'invalid_parameter_value', hint = 'Omit the value to let onboarding set it, or send a code listed in public.languages.';
  end if;
  insert into public.profiles (user_id, display_name, ui_locale, default_source_language_code, time_zone)
  values (new.id, v_name, v_locale, v_source, v_tz)
  on conflict (user_id) do nothing;
  insert into public.account_settings (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Enrollments: one row per (user, track, source language); one active per (user, track)
-- ---------------------------------------------------------------------------
create table public.user_course_enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_track_id text not null references public.course_tracks(id) on delete restrict,
  /** NOT NULL — the instruction language of THIS enrollment, independent of the profile default. */
  source_language_code text not null references public.languages(code) on delete restrict,
  preferred_target_variant_id text null references public.language_varieties(id) on delete set null,
  regional_preference text null,
  script_mode public.script_mode not null default 'native',
  learner_level public.learner_level not null default 'beginner',
  added_at timestamptz not null default now(),
  last_opened_at timestamptz null,
  status public.enrollment_status not null default 'active',
  active_mission_id uuid null, -- FK added in 020_curriculum
  preferred_learning_speed public.learning_speed not null default 'regular',
  translation_peek_language_code text null references public.languages(code) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, course_track_id, source_language_code)
);
create unique index user_course_enrollments_one_active_idx
  on public.user_course_enrollments(user_id, course_track_id) where status = 'active';
create index user_course_enrollments_user_idx on public.user_course_enrollments(user_id, status);
select public.attach_updated_at('public.user_course_enrollments');

/** Enrollment identity is immutable: user and track never change after creation. */
create or replace function public.guard_enrollment_identity()
returns trigger language plpgsql as $$
begin
  if new.user_id <> old.user_id or new.course_track_id <> old.course_track_id then
    raise exception 'user_id and course_track_id of an enrollment are immutable' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger guard_enrollment_identity before update on public.user_course_enrollments
  for each row execute function public.guard_enrollment_identity();

-- ---------------------------------------------------------------------------
-- Honest per-(track, source) coverage
-- ---------------------------------------------------------------------------
create table public.course_source_localizations (
  id uuid primary key default gen_random_uuid(),
  course_track_id text not null references public.course_tracks(id) on delete cascade,
  source_language_code text not null references public.languages(code) on delete cascade,
  status public.coverage_status not null default 'planned',
  metrics jsonb not null default '{"mission_instructions_pct":0,"explanations_pct":0,"ui_pct":0,"subtitles_pct":0,"audio_overlays_pct":0}'::jsonb,
  native_reviewed boolean not null default false,
  reviewer_id uuid null references auth.users(id) on delete set null,
  reviewed_at timestamptz null,
  editorial_note_key text null,
  /** Opt-in fallback the learner may choose when coverage is partial — never applied silently. */
  fallback_source_language_code text null references public.languages(code) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_track_id, source_language_code),
  check (fallback_source_language_code is distinct from source_language_code)
);
create index course_source_localizations_source_idx on public.course_source_localizations(source_language_code, status);
select public.attach_updated_at('public.course_source_localizations');
