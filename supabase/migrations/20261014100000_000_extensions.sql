-- 000 — extensions, enum domains and generic helpers.
-- Enum domains mirror @langquest/contracts enums.ts exactly (values are stable wire/DB identifiers).

create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

-- ---------------------------------------------------------------------------
-- Enum domains (CHECK-constrained text so generated types stay `string`)
-- ---------------------------------------------------------------------------
create domain public.mastery_state as text
  check (value in ('not_attempted','emerging','practiced','independent','durable'));
create domain public.content_state as text
  check (value in ('imported_draft','metadata_needed','rights_unverified','transcription_pending','review_needed','approved','published','unpublished','rejected'));
create domain public.job_state as text
  check (value in ('pending','running','succeeded','failed','review_needed'));
create domain public.staff_role as text
  check (value in ('super_admin','admin','content_editor','language_reviewer','support_readonly'));
create domain public.lesson_type as text
  check (value in ('listen_identify','anticipate_speak','shadowing','guided_roleplay','free_conversation','listening_comprehension','mission_story','pronunciation_drill','situational_task','audio_only','adaptive_review','audio_course_linked','script_support'));
create domain public.mission_step_type as text
  check (value in ('context_listening','modeled_expression','anticipation','listen_identify','shadowing','comprehension_check','pronunciation_drill','character_conversation','story_branch','feedback_retry','review_recall','script_support'));
create domain public.mission_type as text
  check (value in ('standard','story','review','free_conversation','audio_linked','pronunciation','situational'));
create domain public.conversation_state as text
  check (value in ('preparing','connecting','listening','speech_detected','interpreting','responding','paused','interrupted','recoverable_error','finished'));
create domain public.conversation_mode as text
  check (value in ('push_to_talk','hands_free','text_only'));
create domain public.script_mode as text
  check (value in ('native','latin','both'));
create domain public.learner_level as text
  check (value in ('beginner','elementary','intermediate','upper_intermediate','advanced'));
create domain public.cefr_level as text
  check (value in ('A1','A2','B1','B2','C1','C2'));
create domain public.intelligibility as text
  check (value in ('understood','partially_understood','not_understood','no_speech_detected'));
create domain public.pronunciation_confidence as text
  check (value in ('high','medium','limited','none'));
create domain public.assessment_mode as text
  check (value in ('acoustic-assessor','reference-comparison','human-calibrated-reference-comparison','semantic-only','unavailable'));
create domain public.speech_register as text
  check (value in ('formal','polite','neutral','casual','intimate','slang'));
create domain public.observation_type as text
  check (value in ('listening_comprehension','spoken_production','semantic_success','register_appropriateness','intelligibility','pronunciation','fluency','retention','transfer'));
create domain public.autonomy_level as text
  check (value in ('unaided','hinted','heavily_hinted','revealed'));
create domain public.observation_outcome as text
  check (value in ('success','partial','fail','unclear'));
create domain public.scorer_kind as text
  check (value in ('llm_evaluator','acoustic_assessor','deterministic','human'));
create domain public.enrollment_status as text
  check (value in ('active','paused','completed','archived'));
create domain public.asset_kind as text
  check (value in ('audio','image','video','animation','document','subtitle','archive'));
create domain public.audio_asset_type as text
  check (value in ('master','mobile_encoded','review','slow','clip','cover'));
create domain public.visual_asset_type as text
  check (value in ('course_cover','mission_scene','context_object','character_portrait','character_expression','character_body','mascot_illustration','mascot_animation','audio_cover','map_region','celebration','story_panel','achievement_badge','avatar_decoration','icon'));
create domain public.mascot_state as text
  check (value in ('neutral','welcome','happy','curious','listening','speaking','thinking','encouraging','try_again','celebrate','achievement','quiet_audio','sleep','offline','connection_error','success','gentle_hint'));
create domain public.mascot_animation as text
  check (value in ('idle','blink','reaction','anticipation','celebrate_bounce','achievement_reveal','thinking','error_recovery'));
create domain public.character_expression as text
  check (value in ('neutral','greeting','listening','talking','surprise','confusion','friendly_success','follow_up_question','lip_sync'));
create domain public.content_origin as text
  check (value in ('original_upload','licensed_stock','open_license','ai_generated','in_code_vector','native_recording','synthetic_voice','public_dataset'));
create domain public.review_status as text
  check (value in ('draft','review_needed','in_review','approved','rejected'));
create domain public.translation_qa_state as text
  check (value in ('machine_draft','needs_review','reviewed','approved','rejected'));
create domain public.coverage_status as text
  check (value in ('complete','partial','planned','unavailable'));
create domain public.transcript_status as text
  check (value in ('none','pending','machine','edited','reviewed','failed'));
create domain public.upload_status as text
  check (value in ('initiated','uploading','completed','verified','aborted','failed','expired'));
create domain public.processing_job_type as text
  check (value in ('verify','extract_metadata','transcode','transcribe','align','detect_language','describe','segment_lessons','generate_cover','import_prefix','import_manifest','content_generate','benchmark_model','image_generate'));
create domain public.speaker_consent_state as text
  check (value in ('unknown','pending','granted','revoked'));
create domain public.asset_visibility as text
  check (value in ('private','authenticated','public'));
create domain public.latency_class as text
  check (value in ('realtime','interactive','batch'));
create domain public.platform as text
  check (value in ('ios','android','web','admin','api','jobs'));
create domain public.xp_reason as text
  check (value in ('mission_completed','step_completed','review_completed','conversation_turns','skill_state_advanced','audio_lesson_completed','daily_goal','achievement'));
create domain public.learning_speed as text
  check (value in ('relaxed','regular','intensive'));
create domain public.speech_retention as text
  check (value in ('none','session','opt_in_30_days','opt_in_until_deleted'));
create domain public.scoring_support as text
  check (value in ('full','partial','limited'));
create domain public.ai_task_name as text
  check (value in ('content_generation','scene_planning','character_dialogue','meaning_assessment','source_explanation','learner_evaluation','speech_recognition','speech_synthesis','realtime_conversation','pronunciation_assessment','transcription_alignment','language_quality_check'));
create domain public.ai_provider as text
  check (value in ('openrouter','openai','azure_speech','deepgram','elevenlabs','google','local','other'));
create domain public.script_id as text
  check (value in ('Arab','Latn','Hans','Hant','Cyrl','Grek','Hebr','Deva','Jpan','Kore'));
create domain public.transliteration_scheme as text
  check (value in ('translit-latn','arabizi','jyutping','pinyin','romaji','furigana','revised-romanization','niqqud'));
create domain public.sha256_hex as text
  check (value ~ '^[a-f0-9]{64}$');
create domain public.unit_interval as double precision
  check (value >= 0 and value <= 1);
create domain public.percent as double precision
  check (value >= 0 and value <= 100);

-- ---------------------------------------------------------------------------
-- Generic triggers
-- ---------------------------------------------------------------------------

/** Keeps `updated_at` current on every UPDATE. */
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

/** Append-only guard for ledgers: rejects UPDATE/DELETE outright. */
create or replace function public.raise_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'table % is append-only', tg_table_name using errcode = 'check_violation';
end;
$$;

/** Convenience: attaches the updated_at trigger to a table. */
create or replace function public.attach_updated_at(p_table regclass)
returns void
language plpgsql
as $$
begin
  execute format('drop trigger if exists set_updated_at on %s', p_table);
  execute format('create trigger set_updated_at before update on %s for each row execute function public.set_updated_at()', p_table);
end;
$$;

/** Convenience: makes a table append-only (no UPDATE/DELETE for any role, service role included). */
create or replace function public.attach_append_only(p_table regclass)
returns void
language plpgsql
as $$
begin
  execute format('drop trigger if exists append_only on %s', p_table);
  execute format('create trigger append_only before update or delete on %s for each row execute function public.raise_append_only()', p_table);
end;
$$;

-- ---------------------------------------------------------------------------
-- R2 object-key scheme (mirrors packages/media/src/keys.ts) — enforced by CHECK constraints
-- ---------------------------------------------------------------------------

/**
 * Classifies an object key under the LangQuest key scheme, or returns NULL for anything else
 * (user-shaped keys, path traversal, foreign prefixes). Keys are built only from generated ids,
 * lowercase SHA-256 hashes and a verified-MIME extension — never from user filenames (§4.4, §7.2, §11):
 *   master   media/{assetId}/{sha256}.{ext}
 *   derived  derived/{assetId}/{variant}/{sha256}.{ext}
 *   public   public/{image|animation}/{assetId}/{sha256}.{ext}   (the only kinds ever allowed public)
 *   upload   uploads/{uploadId}/{clientChecksum}.{ext}            (multipart staging)
 */
create or replace function public.object_key_scope(p_key text)
returns text
language sql
immutable
strict
parallel safe
as $$
  select case
    when p_key ~ '^media/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-f0-9]{64}\.[a-z0-9]{1,8}$' then 'master'
    when p_key ~ '^derived/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-z0-9_]{1,32}/[a-f0-9]{64}\.[a-z0-9]{1,8}$' then 'derived'
    when p_key ~ '^public/(image|animation)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-f0-9]{64}\.[a-z0-9]{1,8}$' then 'public'
    when p_key ~ '^uploads/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-f0-9]{64}\.[a-z0-9]{1,8}$' then 'upload'
    else null
  end;
$$;
