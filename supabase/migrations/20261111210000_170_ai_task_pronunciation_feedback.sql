-- AI pronunciation feedback (POST /v1/speech/pronunciation-feedback) gets its own task, so its listening model is a
-- model profile an admin can change (and its spend is ledgered apart from the acoustic `pronunciation_assessment`).
alter domain public.ai_task_name drop constraint ai_task_name_check;
alter domain public.ai_task_name add constraint ai_task_name_check
  check (value in ('content_generation','scene_planning','character_dialogue','meaning_assessment','source_explanation','learner_evaluation','speech_recognition','speech_synthesis','realtime_conversation','pronunciation_assessment','transcription_alignment','language_quality_check','pronunciation_feedback'));
