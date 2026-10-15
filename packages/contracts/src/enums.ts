/**
 * Shared Zod enums. Each enum is exported three ways:
 *  - `XXX_VALUES`: readonly tuple (for iteration / DB CHECK constraints)
 *  - `XxxSchema`: Zod enum
 *  - `Xxx`: TypeScript union type
 *
 * Values are stable wire/DB identifiers; never rename them.
 */
import { z } from 'zod';

const makeEnum = <const T extends readonly [string, ...string[]]>(values: T) => z.enum(values);

/** §2.4 — learner mastery of a skill or expression. */
export const MASTERY_STATE_VALUES = ['not_attempted', 'emerging', 'practiced', 'independent', 'durable'] as const;
export const MasteryStateSchema = makeEnum(MASTERY_STATE_VALUES);
export type MasteryState = z.infer<typeof MasteryStateSchema>;

/** §7.6 — publication state of shared content (lessons, assets, missions). */
export const CONTENT_STATE_VALUES = [
  'imported_draft',
  'metadata_needed',
  'rights_unverified',
  'transcription_pending',
  'review_needed',
  'approved',
  'published',
  'unpublished',
  'rejected',
] as const;
export const ContentStateSchema = makeEnum(CONTENT_STATE_VALUES);
export type ContentState = z.infer<typeof ContentStateSchema>;

/** §5.3 — asynchronous processing job state. */
export const JOB_STATE_VALUES = ['pending', 'running', 'succeeded', 'failed', 'review_needed'] as const;
export const JobStateSchema = makeEnum(JOB_STATE_VALUES);
export type JobState = z.infer<typeof JobStateSchema>;

/** §5.5 — staff roles. Learners have no role row. */
export const ROLE_VALUES = ['super_admin', 'admin', 'content_editor', 'language_reviewer', 'support_readonly'] as const;
export const RoleSchema = makeEnum(ROLE_VALUES);
export type Role = z.infer<typeof RoleSchema>;

/** §3.2 — all required lesson types. */
export const LESSON_TYPE_VALUES = [
  'listen_identify',
  'anticipate_speak',
  'shadowing',
  'guided_roleplay',
  'free_conversation',
  'listening_comprehension',
  'mission_story',
  'pronunciation_drill',
  'situational_task',
  'audio_only',
  'adaptive_review',
  'audio_course_linked',
  'script_support',
] as const;
export const LessonTypeSchema = makeEnum(LESSON_TYPE_VALUES);
export type LessonType = z.infer<typeof LessonTypeSchema>;

/** §3.3 — step/phase types inside a mission (template phases + lesson-type steps). */
export const MISSION_STEP_TYPE_VALUES = [
  'context_listening',
  'modeled_expression',
  'anticipation',
  'listen_identify',
  'shadowing',
  'comprehension_check',
  'pronunciation_drill',
  'character_conversation',
  'story_branch',
  'feedback_retry',
  'review_recall',
  'script_support',
] as const;
export const MissionStepTypeSchema = makeEnum(MISSION_STEP_TYPE_VALUES);
export type MissionStepType = z.infer<typeof MissionStepTypeSchema>;

/** §3.7 / §5.2 — what kind of mission a row represents. */
export const MISSION_TYPE_VALUES = ['standard', 'story', 'review', 'free_conversation', 'audio_linked', 'pronunciation', 'situational'] as const;
export const MissionTypeSchema = makeEnum(MISSION_TYPE_VALUES);
export type MissionType = z.infer<typeof MissionTypeSchema>;

/** §8.3 — conversation orchestration states. */
export const CONVERSATION_STATE_VALUES = [
  'preparing',
  'connecting',
  'listening',
  'speech_detected',
  'interpreting',
  'responding',
  'paused',
  'interrupted',
  'recoverable_error',
  'finished',
] as const;
export const ConversationStateSchema = makeEnum(CONVERSATION_STATE_VALUES);
export type ConversationState = z.infer<typeof ConversationStateSchema>;

/** §8.3 — push-to-talk vs hands-free VAD. */
export const CONVERSATION_MODE_VALUES = ['push_to_talk', 'hands_free', 'text_only'] as const;
export const ConversationModeSchema = makeEnum(CONVERSATION_MODE_VALUES);
export type ConversationMode = z.infer<typeof ConversationModeSchema>;

/** §8.3 / §8.6 — which realtime pipeline a conversation session runs on (`conversation_sessions.pipeline`, session tickets). */
export const CONVERSATION_PIPELINE_VALUES = ['duplex', 'stt_llm_tts', 'text_only'] as const;
export const ConversationPipelineSchema = makeEnum(CONVERSATION_PIPELINE_VALUES);
export type ConversationPipeline = z.infer<typeof ConversationPipelineSchema>;

/** §2.2 — polarity of a communicative intent as a social act (`communicative_intents.polarity`). */
export const INTENT_POLARITY_VALUES = ['positive', 'negative', 'neutral'] as const;
export const IntentPolaritySchema = makeEnum(INTENT_POLARITY_VALUES);
export type IntentPolarity = z.infer<typeof IntentPolaritySchema>;

/** §2.2 — politeness requirement of a communicative intent (`communicative_intents.politeness`). */
export const INTENT_POLITENESS_VALUES = ['any', 'polite', 'casual'] as const;
export const IntentPolitenessSchema = makeEnum(INTENT_POLITENESS_VALUES);
export type IntentPoliteness = z.infer<typeof IntentPolitenessSchema>;

/** CONVENTIONS §2.3 — how target text is displayed. */
export const SCRIPT_MODE_VALUES = ['native', 'latin', 'both'] as const;
export const ScriptModeSchema = makeEnum(SCRIPT_MODE_VALUES);
export type ScriptMode = z.infer<typeof ScriptModeSchema>;

/** CONVENTIONS §2.3 — learner level labels (CEFR-aligned, not certified). */
export const LEARNER_LEVEL_VALUES = ['beginner', 'elementary', 'intermediate', 'upper_intermediate', 'advanced'] as const;
export const LearnerLevelSchema = makeEnum(LEARNER_LEVEL_VALUES);
export type LearnerLevel = z.infer<typeof LearnerLevelSchema>;

/** CEFR can-do band used for alignment (never a certification claim). */
export const CEFR_LEVEL_VALUES = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export const CefrLevelSchema = makeEnum(CEFR_LEVEL_VALUES);
export type CefrLevel = z.infer<typeof CefrLevelSchema>;

/** §6.5 — intelligibility verdict of a spoken turn. */
export const INTELLIGIBILITY_VALUES = ['understood', 'partially_understood', 'not_understood', 'no_speech_detected'] as const;
export const IntelligibilitySchema = makeEnum(INTELLIGIBILITY_VALUES);
export type Intelligibility = z.infer<typeof IntelligibilitySchema>;

/** §6.5 — confidence of the pronunciation assessment itself. */
export const PRONUNCIATION_CONFIDENCE_VALUES = ['high', 'medium', 'limited', 'none'] as const;
export const PronunciationConfidenceSchema = makeEnum(PRONUNCIATION_CONFIDENCE_VALUES);
export type PronunciationConfidence = z.infer<typeof PronunciationConfidenceSchema>;

/**
 * §3.6 / §6.5 — how a pronunciation verdict was produced.
 * Only `acoustic-assessor` may carry a numeric score (see `ACOUSTIC_ASSESSMENT_MODES`).
 */
export const ASSESSMENT_MODE_VALUES = [
  'acoustic-assessor',
  'reference-comparison',
  'human-calibrated-reference-comparison',
  'semantic-only',
  'unavailable',
] as const;
export const AssessmentModeSchema = makeEnum(ASSESSMENT_MODE_VALUES);
export type AssessmentMode = z.infer<typeof AssessmentModeSchema>;
/** Assessment modes backed by a capable acoustic scorer; the only ones allowed to emit `numericScore`. */
export const ACOUSTIC_ASSESSMENT_MODES = ['acoustic-assessor'] as const satisfies readonly AssessmentMode[];
export const isAcousticAssessmentMode = (mode: AssessmentMode): boolean =>
  (ACOUSTIC_ASSESSMENT_MODES as readonly AssessmentMode[]).includes(mode);

/** §3.4 — speech register. */
export const REGISTER_VALUES = ['formal', 'polite', 'neutral', 'casual', 'intimate', 'slang'] as const;
export const RegisterSchema = makeEnum(REGISTER_VALUES);
export type Register = z.infer<typeof RegisterSchema>;

/** §3.4 — evidence dimensions stored as observations. */
export const OBSERVATION_TYPE_VALUES = [
  'listening_comprehension',
  'spoken_production',
  'semantic_success',
  'register_appropriateness',
  'intelligibility',
  'pronunciation',
  'fluency',
  'retention',
  'transfer',
] as const;
export const ObservationTypeSchema = makeEnum(OBSERVATION_TYPE_VALUES);
export type ObservationType = z.infer<typeof ObservationTypeSchema>;

/** How much help the learner needed for an observed attempt. */
export const AUTONOMY_LEVEL_VALUES = ['unaided', 'hinted', 'heavily_hinted', 'revealed'] as const;
export const AutonomyLevelSchema = makeEnum(AUTONOMY_LEVEL_VALUES);
export type AutonomyLevel = z.infer<typeof AutonomyLevelSchema>;

export const OBSERVATION_OUTCOME_VALUES = ['success', 'partial', 'fail', 'unclear'] as const;
export const ObservationOutcomeSchema = makeEnum(OBSERVATION_OUTCOME_VALUES);
export type ObservationOutcome = z.infer<typeof ObservationOutcomeSchema>;

/** Who/what produced an observation or score. */
export const SCORER_KIND_VALUES = ['llm_evaluator', 'acoustic_assessor', 'deterministic', 'human'] as const;
export const ScorerKindSchema = makeEnum(SCORER_KIND_VALUES);
export type ScorerKind = z.infer<typeof ScorerKindSchema>;

/** §5.1 — enrollment lifecycle. */
export const ENROLLMENT_STATUS_VALUES = ['active', 'paused', 'completed', 'archived'] as const;
export const EnrollmentStatusSchema = makeEnum(ENROLLMENT_STATUS_VALUES);
export type EnrollmentStatus = z.infer<typeof EnrollmentStatusSchema>;

/** §5.2 — broad media kind of a stored object. */
export const ASSET_KIND_VALUES = ['audio', 'image', 'video', 'animation', 'document', 'subtitle', 'archive'] as const;
export const AssetKindSchema = makeEnum(ASSET_KIND_VALUES);
export type AssetKind = z.infer<typeof AssetKindSchema>;

/** §5.3 — `audio_lesson_assets.type`. */
export const AUDIO_ASSET_TYPE_VALUES = ['master', 'mobile_encoded', 'review', 'slow', 'clip', 'cover'] as const;
export const AudioAssetTypeSchema = makeEnum(AUDIO_ASSET_TYPE_VALUES);
export type AudioAssetType = z.infer<typeof AudioAssetTypeSchema>;

/** §10.2A artwork categories — `visual_assets.type`. */
export const VISUAL_ASSET_TYPE_VALUES = [
  'course_cover',
  'mission_scene',
  'context_object',
  'character_portrait',
  'character_expression',
  'character_body',
  'mascot_illustration',
  'mascot_animation',
  'audio_cover',
  'map_region',
  'celebration',
  'story_panel',
  'achievement_badge',
  'avatar_decoration',
  'icon',
] as const;
export const VisualAssetTypeSchema = makeEnum(VISUAL_ASSET_TYPE_VALUES);
export type VisualAssetType = z.infer<typeof VisualAssetTypeSchema>;

/** §10.2A — the 17 required mascot states. */
export const MASCOT_STATE_VALUES = [
  'neutral',
  'welcome',
  'happy',
  'curious',
  'listening',
  'speaking',
  'thinking',
  'encouraging',
  'try_again',
  'celebrate',
  'achievement',
  'quiet_audio',
  'sleep',
  'offline',
  'connection_error',
  'success',
  'gentle_hint',
] as const;
export const MascotStateSchema = makeEnum(MASCOT_STATE_VALUES);
export type MascotState = z.infer<typeof MascotStateSchema>;

/** §10.2A — mascot animation clips (optional, skippable, short). */
export const MASCOT_ANIMATION_VALUES = [
  'idle',
  'blink',
  'reaction',
  'anticipation',
  'celebrate_bounce',
  'achievement_reveal',
  'thinking',
  'error_recovery',
] as const;
export const MascotAnimationSchema = makeEnum(MASCOT_ANIMATION_VALUES);
export type MascotAnimation = z.infer<typeof MascotAnimationSchema>;

/** §10.2A — the 9 required lead-character expressions/poses. */
export const CHARACTER_EXPRESSION_VALUES = [
  'neutral',
  'greeting',
  'listening',
  'talking',
  'surprise',
  'confusion',
  'friendly_success',
  'follow_up_question',
  'lip_sync',
] as const;
export const CharacterExpressionSchema = makeEnum(CHARACTER_EXPRESSION_VALUES);
export type CharacterExpression = z.infer<typeof CharacterExpressionSchema>;

/** §10.2A — transparent speech-status visualisation. */
export const SPEECH_STATE_VALUES = [
  'idle',
  'character_speaking',
  'waiting',
  'learner_mic_active',
  'thinking',
  'reconnecting',
  'error',
] as const;
export const SpeechStateSchema = makeEnum(SPEECH_STATE_VALUES);
export type SpeechState = z.infer<typeof SpeechStateSchema>;

/** §10.2A — provenance of a visual or audio asset. */
export const CONTENT_ORIGIN_VALUES = ['original_upload', 'licensed_stock', 'open_license', 'ai_generated', 'in_code_vector', 'native_recording', 'synthetic_voice', 'public_dataset'] as const;
export const ContentOriginSchema = makeEnum(CONTENT_ORIGIN_VALUES);
export type ContentOrigin = z.infer<typeof ContentOriginSchema>;

/** Editorial review status for any reviewable record. */
export const REVIEW_STATUS_VALUES = ['draft', 'review_needed', 'in_review', 'approved', 'rejected'] as const;
export const ReviewStatusSchema = makeEnum(REVIEW_STATUS_VALUES);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

/** Translation QA state (expression/transcript/mission localizations). */
export const TRANSLATION_QA_STATE_VALUES = ['machine_draft', 'needs_review', 'reviewed', 'approved', 'rejected'] as const;
export const TranslationQaStateSchema = makeEnum(TRANSLATION_QA_STATE_VALUES);
export type TranslationQaState = z.infer<typeof TranslationQaStateSchema>;

/** Per-(track, source) editorial coverage status shown to learners (§2.1). */
export const COVERAGE_STATUS_VALUES = ['complete', 'partial', 'planned', 'unavailable'] as const;
export const CoverageStatusSchema = makeEnum(COVERAGE_STATUS_VALUES);
export type CoverageStatus = z.infer<typeof CoverageStatusSchema>;

/** §5.3 — transcript lifecycle. */
export const TRANSCRIPT_STATUS_VALUES = ['none', 'pending', 'machine', 'edited', 'reviewed', 'failed'] as const;
export const TranscriptStatusSchema = makeEnum(TRANSCRIPT_STATUS_VALUES);
export type TranscriptStatus = z.infer<typeof TranscriptStatusSchema>;

/** §7.2 — multipart upload lifecycle. */
export const UPLOAD_STATUS_VALUES = ['initiated', 'uploading', 'completed', 'verified', 'aborted', 'failed', 'expired'] as const;
export const UploadStatusSchema = makeEnum(UPLOAD_STATUS_VALUES);
export type UploadStatus = z.infer<typeof UploadStatusSchema>;

/**
 * §5.3 — processing job types: the **base** set every job runner must map (stable key set; runners key
 * `Record<ProcessingJobType, …>` maps on it, so it is never widened in place).
 *
 * Migration 100 (2026-10-15) widened the `processing_job_type` DB domain with dedicated values for the
 * apps/jobs handlers that previously ran under the `describe` carrier type + `params.handler`. Those live in
 * `PROCESSING_JOB_TYPE_EXTENSION_VALUES`; the union the DB actually accepts (and that DB rows / admin API
 * payloads carry) is `PROCESSING_JOB_TYPE_VALUES_ALL` / `ProcessingJobTypeAllSchema` / `ProcessingJobTypeAll`.
 */
export const PROCESSING_JOB_TYPE_VALUES = [
  'verify',
  'extract_metadata',
  'transcode',
  'transcribe',
  'align',
  'detect_language',
  'describe',
  'segment_lessons',
  'generate_cover',
  'import_prefix',
  'import_manifest',
  'content_generate',
  'benchmark_model',
  'image_generate',
] as const;
export const ProcessingJobTypeSchema = makeEnum(PROCESSING_JOB_TYPE_VALUES);
export type ProcessingJobType = z.infer<typeof ProcessingJobTypeSchema>;

/**
 * Job types added in migration 100 (2026-10-15): dedicated values for apps/jobs handlers that used to ride on the
 * `describe` carrier, plus the handler-name aliases of existing base types (render_cover ≙ generate_cover,
 * infer_metadata ≙ describe, generate_content ≙ content_generate, import_r2_prefix ≙ import_prefix).
 * The DB domain accepts all of them; base values stay valid. Runners can key a `Record<ProcessingJobTypeExtension, …>`
 * on this set additively, next to their base map.
 */
export const PROCESSING_JOB_TYPE_EXTENSION_VALUES = [
  'translate_transcript',
  'regenerate_manifest',
  'cleanup_orphan_uploads',
  'render_cover',
  'infer_metadata',
  'generate_content',
  'import_r2_prefix',
] as const;
export const ProcessingJobTypeExtensionSchema = makeEnum(PROCESSING_JOB_TYPE_EXTENSION_VALUES);
export type ProcessingJobTypeExtension = z.infer<typeof ProcessingJobTypeExtensionSchema>;
/** Alias kept for callers that picked the dated name up earlier on 2026-10-15; same tuple as the extension set. */
export const PROCESSING_JOB_TYPE_VALUES_ADDED_2026_10_15 = PROCESSING_JOB_TYPE_EXTENSION_VALUES;

/** Every value the `processing_job_type` DB domain accepts after migration 100 (base ∪ extension). */
export const PROCESSING_JOB_TYPE_VALUES_ALL = [...PROCESSING_JOB_TYPE_VALUES, ...PROCESSING_JOB_TYPE_EXTENSION_VALUES] as const;
export const ProcessingJobTypeAllSchema = makeEnum(PROCESSING_JOB_TYPE_VALUES_ALL);
export type ProcessingJobTypeAll = z.infer<typeof ProcessingJobTypeAllSchema>;
export const isProcessingJobTypeAll = (v: unknown): v is ProcessingJobTypeAll => typeof v === 'string' && (PROCESSING_JOB_TYPE_VALUES_ALL as readonly string[]).includes(v);
export const isProcessingJobTypeExtension = (v: unknown): v is ProcessingJobTypeExtension =>
  typeof v === 'string' && (PROCESSING_JOB_TYPE_EXTENSION_VALUES as readonly string[]).includes(v);

/** §5.2 — audio speaker consent/rights state. */
export const SPEAKER_CONSENT_STATE_VALUES = ['unknown', 'pending', 'granted', 'revoked'] as const;
export const SpeakerConsentStateSchema = makeEnum(SPEAKER_CONSENT_STATE_VALUES);
export type SpeakerConsentState = z.infer<typeof SpeakerConsentStateSchema>;

/** §4.4 — asset visibility. */
export const ASSET_VISIBILITY_VALUES = ['private', 'authenticated', 'public'] as const;
export const AssetVisibilitySchema = makeEnum(ASSET_VISIBILITY_VALUES);
export type AssetVisibility = z.infer<typeof AssetVisibilitySchema>;

/** Expected latency class of an AI adapter/route. */
export const LATENCY_CLASS_VALUES = ['realtime', 'interactive', 'batch'] as const;
export const LatencyClassSchema = makeEnum(LATENCY_CLASS_VALUES);
export type LatencyClass = z.infer<typeof LatencyClassSchema>;

/** §3.7 — learner in-conversation commands ("ask slower", "repeat", ...). */
export const CONVERSATION_COMMAND_VALUES = ['slower', 'repeat', 'translate', 'example', 'meaning', 'hint', 'skip'] as const;
export const ConversationCommandSchema = makeEnum(CONVERSATION_COMMAND_VALUES);
export type ConversationCommand = z.infer<typeof ConversationCommandSchema>;

/** Platform identifiers for telemetry and settings. */
export const PLATFORM_VALUES = ['ios', 'android', 'web', 'admin', 'api', 'jobs'] as const;
export const PlatformSchema = makeEnum(PLATFORM_VALUES);
export type Platform = z.infer<typeof PlatformSchema>;

/** Telemetry privacy level (§11). */
export const PRIVACY_LEVEL_VALUES = ['anonymous', 'pseudonymous', 'personal'] as const;
export const PrivacyLevelSchema = makeEnum(PRIVACY_LEVEL_VALUES);
export type PrivacyLevel = z.infer<typeof PrivacyLevelSchema>;

/** Learner-facing XP reasons (server validated, §3.8). */
export const XP_REASON_VALUES = [
  'mission_completed',
  'step_completed',
  'review_completed',
  'conversation_turns',
  'skill_state_advanced',
  'audio_lesson_completed',
  'daily_goal',
  'achievement',
] as const;
export const XpReasonSchema = makeEnum(XP_REASON_VALUES);
export type XpReason = z.infer<typeof XpReasonSchema>;

/** Preferred learning speed stored per enrollment. */
export const LEARNING_SPEED_VALUES = ['relaxed', 'regular', 'intensive'] as const;
export const LearningSpeedSchema = makeEnum(LEARNING_SPEED_VALUES);
export type LearningSpeed = z.infer<typeof LearningSpeedSchema>;

/** Recording retention preference for speech (§3.6, §11). */
export const SPEECH_RETENTION_VALUES = ['none', 'session', 'opt_in_30_days', 'opt_in_until_deleted'] as const;
export const SpeechRetentionSchema = makeEnum(SPEECH_RETENTION_VALUES);
export type SpeechRetention = z.infer<typeof SpeechRetentionSchema>;

/** Automated scoring support expectation for a track (validated at runtime by the capability registry). */
export const SCORING_SUPPORT_VALUES = ['full', 'partial', 'limited'] as const;
export const ScoringSupportSchema = makeEnum(SCORING_SUPPORT_VALUES);
export type ScoringSupport = z.infer<typeof ScoringSupportSchema>;
