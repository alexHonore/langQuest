-- 030 — audio library and CMS (§5.3): collections, lessons, transcripts, learner audio state, uploads, jobs.

create table public.speakers (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  pseudonymous boolean not null default true,
  target_variety_id text null references public.language_varieties(id) on delete set null,
  region text null,
  consent_state public.speaker_consent_state not null default 'unknown',
  content_rights_id uuid null references public.content_rights(id) on delete set null,
  voice_description text null,
  synthetic boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
select public.attach_updated_at('public.speakers');

alter table public.expression_audio
  add constraint expression_audio_speaker_fkey foreign key (speaker_id) references public.speakers(id) on delete set null;

create table public.audio_course_collections (
  id uuid primary key default gen_random_uuid(),
  title_translations jsonb not null default '{}'::jsonb,
  description_translations jsonb not null default '{}'::jsonb,
  course_track_id text null references public.course_tracks(id) on delete set null,
  target_variety_id text null references public.language_varieties(id) on delete set null,
  /** Instruction language spoken in the recordings (not the learner's enrollment source). */
  instruction_language_code text null references public.languages(code) on delete set null,
  region text null,
  instructor_speaker_id uuid null references public.speakers(id) on delete set null,
  cover_visual_asset_id uuid null,
  content_rights_id uuid null references public.content_rights(id) on delete set null,
  state public.content_state not null default 'imported_draft',
  sort_order integer not null default 0 check (sort_order >= 0),
  published_version integer null check (published_version is null or published_version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index audio_course_collections_track_idx on public.audio_course_collections(course_track_id, state, sort_order);
create index audio_course_collections_instruction_idx on public.audio_course_collections(instruction_language_code, state);
select public.attach_updated_at('public.audio_course_collections');

create table public.audio_chapters (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.audio_course_collections(id) on delete cascade,
  title_translations jsonb not null default '{}'::jsonb,
  summary_translations jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0 check (sort_order >= 0),
  cover_visual_asset_id uuid null,
  state public.content_state not null default 'imported_draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index audio_chapters_collection_idx on public.audio_chapters(collection_id, sort_order);
select public.attach_updated_at('public.audio_chapters');

create table public.audio_lessons (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.audio_chapters(id) on delete cascade,
  title_translations jsonb not null default '{}'::jsonb,
  description_translations jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0 check (sort_order >= 0),
  episode_number integer null check (episode_number is null or episode_number >= 0),
  level public.learner_level null,
  target_variety_id text null references public.language_varieties(id) on delete set null,
  instruction_language_code text null references public.languages(code) on delete set null,
  spoken_language_codes text[] not null default '{}',
  regional_dialect text null,
  topic text null,
  tags text[] not null default '{}',
  scene text null,
  state public.content_state not null default 'imported_draft',
  transcript_status public.transcript_status not null default 'none',
  listen_length_ms integer null check (listen_length_ms is null or listen_length_ms >= 0),
  quality_review_status text not null default 'unreviewed' check (quality_review_status in ('unreviewed','approved','rejected')),
  visibility text not null default 'private' check (visibility in ('private','authenticated')),
  content_rights_id uuid null references public.content_rights(id) on delete set null,
  cover_visual_asset_id uuid null,
  published_revision integer null check (published_revision is null or published_revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index audio_lessons_chapter_idx on public.audio_lessons(chapter_id, sort_order);
create index audio_lessons_state_idx on public.audio_lessons(state, visibility);
create index audio_lessons_tags_idx on public.audio_lessons using gin(tags);
select public.attach_updated_at('public.audio_lessons');

create table public.audio_lesson_assets (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.audio_lessons(id) on delete cascade,
  asset_id uuid not null references public.media_assets(id) on delete cascade,
  asset_type public.audio_asset_type not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lesson_id, asset_id, asset_type)
);
create index audio_lesson_assets_asset_idx on public.audio_lesson_assets(asset_id);
select public.attach_updated_at('public.audio_lesson_assets');

create table public.lesson_speakers (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.audio_lessons(id) on delete cascade,
  speaker_id uuid not null references public.speakers(id) on delete cascade,
  role text not null default 'other' check (role in ('instructor','native_speaker','narrator','learner_model','other')),
  voice_segments jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lesson_id, speaker_id, role)
);
select public.attach_updated_at('public.lesson_speakers');

-- ---------------------------------------------------------------------------
-- Transcripts
-- ---------------------------------------------------------------------------
create table public.transcripts (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.audio_lessons(id) on delete cascade,
  language_mode text not null default 'mixed' check (language_mode in ('source','target','mixed')),
  primary_language_code text not null,
  revision integer not null default 0 check (revision >= 0),
  coverage_pct public.percent not null default 0,
  status public.transcript_status not null default 'pending',
  qa_state public.translation_qa_state not null default 'machine_draft',
  provider text null,
  model text null,
  access_rights text not null default 'internal_only' check (access_rights in ('internal_only','learners','public')),
  source_asset_id uuid null references public.media_assets(id) on delete set null,
  manually_uploaded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lesson_id, revision)
);
select public.attach_updated_at('public.transcripts');

create table public.transcript_segments (
  id uuid primary key default gen_random_uuid(),
  transcript_id uuid not null references public.transcripts(id) on delete cascade,
  sort_index integer not null check (sort_index >= 0),
  start_ms integer not null check (start_ms >= 0),
  end_ms integer not null check (end_ms >= start_ms),
  text text not null,
  speaker_label text null,
  speaker_id uuid null references public.speakers(id) on delete set null,
  language_code text null,
  target_variety_id text null references public.language_varieties(id) on delete set null,
  script public.script_id null,
  confidence public.unit_interval null,
  reviewed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (transcript_id, sort_index)
);
create index transcript_segments_time_idx on public.transcript_segments(transcript_id, start_ms);
select public.attach_updated_at('public.transcript_segments');

create table public.transcript_translations (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references public.transcript_segments(id) on delete cascade,
  language_code text not null references public.languages(code) on delete cascade,
  text text not null,
  qa_state public.translation_qa_state not null default 'machine_draft',
  quality_flags text[] not null default '{}',
  reviewer_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (segment_id, language_code)
);
select public.attach_updated_at('public.transcript_translations');

create table public.transcript_word_alignments (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references public.transcript_segments(id) on delete cascade,
  word_index integer not null check (word_index >= 0),
  word text not null,
  start_ms integer not null check (start_ms >= 0),
  end_ms integer not null check (end_ms >= start_ms),
  confidence public.unit_interval null,
  expression_id uuid null references public.expressions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (segment_id, word_index)
);
select public.attach_updated_at('public.transcript_word_alignments');

create table public.lesson_tags (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.audio_lessons(id) on delete cascade,
  tag text not null check (char_length(tag) between 1 and 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lesson_id, tag)
);
create index lesson_tags_tag_idx on public.lesson_tags(tag);
select public.attach_updated_at('public.lesson_tags');

create table public.lesson_topics (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.audio_lessons(id) on delete cascade,
  topic_key text not null check (char_length(topic_key) between 1 and 64),
  confidence public.unit_interval null,
  provenance text not null default 'editor' check (provenance in ('editor','ai_suggested','import')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lesson_id, topic_key)
);
select public.attach_updated_at('public.lesson_topics');

-- ---------------------------------------------------------------------------
-- Learner audio state (user-owned)
-- ---------------------------------------------------------------------------
create table public.bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id uuid not null references public.audio_lessons(id) on delete cascade,
  position_ms integer not null check (position_ms >= 0),
  note text null check (note is null or char_length(note) <= 500),
  segment_id uuid null references public.transcript_segments(id) on delete set null,
  client_event_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_event_id)
);
create index bookmarks_user_lesson_idx on public.bookmarks(user_id, lesson_id, position_ms);
select public.attach_updated_at('public.bookmarks');

create table public.user_audio_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id uuid not null references public.audio_lessons(id) on delete cascade,
  position_ms integer not null default 0 check (position_ms >= 0),
  duration_ms integer null check (duration_ms is null or duration_ms >= 0),
  completed boolean not null default false,
  completed_at timestamptz null,
  play_count integer not null default 0 check (play_count >= 0),
  revision integer not null default 0 check (revision >= 0),
  last_client_event_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, lesson_id)
);
select public.attach_updated_at('public.user_audio_progress');

create table public.user_download_manifests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id uuid not null references public.audio_lessons(id) on delete cascade,
  pack_id uuid not null,
  version integer not null default 0 check (version >= 0),
  checksum public.sha256_hex not null,
  total_bytes bigint not null check (total_bytes >= 0),
  device_id text null,
  downloaded_at timestamptz null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, lesson_id, pack_id)
);
create index user_download_manifests_lesson_idx on public.user_download_manifests(lesson_id) where revoked_at is null;
select public.attach_updated_at('public.user_download_manifests');

-- ---------------------------------------------------------------------------
-- Uploads (multipart to R2) and processing jobs (Postgres-backed queue, ADR-005)
-- ---------------------------------------------------------------------------
create table public.uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  draft_asset_id uuid null references public.media_assets(id) on delete set null,
  /** Staging key `uploads/{id}/{client checksum}.{ext}` until verification, then the promoted master key. */
  storage_key text not null check (coalesce(public.object_key_scope(storage_key), '') in ('upload','master')),
  multipart_upload_id text null,
  part_size_bytes bigint not null check (part_size_bytes > 0),
  part_count integer not null default 0 check (part_count >= 0),
  completed_parts jsonb not null default '[]'::jsonb,
  original_filename text not null,
  original_path text null,
  declared_mime_type text not null,
  declared_byte_length bigint not null check (declared_byte_length >= 0),
  client_checksum_sha256 public.sha256_hex not null,
  verified_checksum_sha256 public.sha256_hex null,
  status public.upload_status not null default 'initiated',
  failure_code text null,
  idempotency_key text not null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index uploads_status_idx on public.uploads(status, expires_at);
select public.attach_updated_at('public.uploads');

/**
 * DB-side mirror of UPLOAD_TRANSITIONS (packages/media/src/uploads.ts), enforced for every role,
 * service role included:
 *   initiated | uploading → uploading | completed | aborted | expired | failed
 *   completed             → verified | failed
 *   verified | aborted | failed | expired are terminal: object identity is frozen.
 * `verified` requires the server-computed checksum, and a staging key must name this very upload and
 * its declared checksum, so a row can never point at somebody else's object (§7.2, §11).
 */
create or replace function public.guard_upload_row()
returns trigger
language plpgsql
as $$
declare
  v_prefix text := 'uploads/' || new.id::text || '/' || new.client_checksum_sha256 || '.';
begin
  if public.object_key_scope(new.storage_key) = 'upload' and left(new.storage_key, length(v_prefix)) <> v_prefix then
    raise exception 'staging key % must be uploads/{upload id}/{client checksum}.{ext}', new.storage_key using errcode = 'check_violation';
  end if;
  if new.status = 'verified' and new.verified_checksum_sha256 is null then
    raise exception 'verified uploads require verified_checksum_sha256' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      if not ((old.status in ('initiated','uploading') and new.status in ('uploading','completed','aborted','expired','failed'))
              or (old.status = 'completed' and new.status in ('verified','failed'))) then
        raise exception 'invalid_state: upload % cannot move from % to %', old.id, old.status, new.status using errcode = 'check_violation';
      end if;
    elsif old.status in ('verified','aborted','failed','expired')
          and (new.storage_key is distinct from old.storage_key
               or new.verified_checksum_sha256 is distinct from old.verified_checksum_sha256
               or new.completed_parts is distinct from old.completed_parts
               or new.multipart_upload_id is distinct from old.multipart_upload_id) then
      raise exception 'upload % is terminal (%) and its object identity is frozen', old.id, old.status using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_upload_row before insert or update on public.uploads
  for each row execute function public.guard_upload_row();

create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type public.processing_job_type not null,
  parent_asset_id uuid null references public.media_assets(id) on delete cascade,
  parent_entity_table text null,
  parent_entity_id uuid null,
  state public.job_state not null default 'pending',
  priority integer not null default 5 check (priority between 0 and 10),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts >= 1),
  progress_pct public.percent not null default 0,
  provider text null,
  params jsonb not null default '{}'::jsonb,
  cost_estimate_usd numeric null check (cost_estimate_usd is null or cost_estimate_usd >= 0),
  cost_actual_usd numeric null check (cost_actual_usd is null or cost_actual_usd >= 0),
  failure_code text null,
  failure_message text null,
  output_asset_ids uuid[] not null default '{}',
  output jsonb null,
  idempotency_key text not null unique,
  requested_by uuid null references auth.users(id) on delete set null,
  started_at timestamptz null,
  finished_at timestamptz null,
  locked_by text null,
  locked_until timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
/** Hot path for claim_processing_job(): claimable rows ordered by priority then age. */
create index processing_jobs_claim_idx on public.processing_jobs(state, priority desc, created_at) where state in ('pending','running');
create index processing_jobs_parent_asset_idx on public.processing_jobs(parent_asset_id);
create index processing_jobs_parent_entity_idx on public.processing_jobs(parent_entity_table, parent_entity_id);
select public.attach_updated_at('public.processing_jobs');

create table public.asset_provenance_events (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.media_assets(id) on delete cascade,
  event_type text not null check (event_type in ('uploaded','imported','rights_attached','rights_revoked','transcoded','transcribed','aligned','edited','replaced','removed')),
  actor_id uuid null references auth.users(id) on delete set null,
  job_id uuid null references public.processing_jobs(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index asset_provenance_events_asset_idx on public.asset_provenance_events(asset_id, created_at);
select public.attach_append_only('public.asset_provenance_events');
