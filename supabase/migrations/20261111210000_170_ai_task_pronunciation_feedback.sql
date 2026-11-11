-- AI pronunciation feedback (POST /v1/speech/pronunciation-feedback) gets its own task, so its listening model is a
-- model profile an admin can change (and its spend is ledgered apart from the acoustic `pronunciation_assessment`).
alter domain public.ai_task_name drop constraint ai_task_name_check;
alter domain public.ai_task_name add constraint ai_task_name_check
  check (value in ('content_generation','scene_planning','character_dialogue','meaning_assessment','source_explanation','learner_evaluation','speech_recognition','speech_synthesis','realtime_conversation','pronunciation_assessment','transcription_alignment','language_quality_check','pronunciation_feedback'));

-- Its default route, disabled until an admin saves it (the package default in @langquest/ai routes meanwhile), as the
-- catalog seed (080) does for the other tasks.
insert into public.ai_model_profiles (task, target_variety_id, source_language_code, provider, primary_model, fallback_models, params, capabilities, latency_class, enabled, version, benchmark_status) values ('pronunciation_feedback', null, null, 'openrouter', 'google/gemini-3.8-flash', array['google/gemini-3.5-flash-lite']::text[], '{"temperature":0,"maxOutputTokens":1200,"timeoutMs":25000}'::jsonb, '{"audioInput":true,"structuredOutput":true}'::jsonb, 'interactive', false, 1, 'unbenchmarked') on conflict (task, target_variety_id, source_language_code) do nothing;
