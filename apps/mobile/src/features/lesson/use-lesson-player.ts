/**
 * Lesson player hook (§3.1 loop, screen 4): binds the pure lesson machine to
 * the recorder, clip player, API and the offline outbox.
 *
 * - Attempt creation and evaluation use client UUIDs (idempotent replay).
 * - Each completed step is recorded in the outbox (`step_completed`) so
 *   progress survives offline; `mission_abandoned` on leave.
 * - Speech is evaluated through `/v1/speech/pronunciation-assess` (meaning +
 *   honest pronunciation block). Offline, repeat steps still work with local
 *   playback but no result is invented: the UI shows "needs connection".
 */
import { getCourseTrack, type EnrollmentDto, type MissionDetailResponse, type MissionEvaluateResponse, type SpeechEvaluationResult } from '@langquest/contracts';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ApiClientError } from '@/lib/api/client';
import type { ClipPlayer } from '@/lib/clip-player';
import { localDateKey, newUuid, nowIso, nowMs } from '@/lib/ids';
import type { Recorder } from '@/lib/recorder';
import type { RecordedClip } from '@/features/conversation/controller';
import { useServices } from '@/lib/services';
import { track } from '@/lib/telemetry';
import { getLocalStore } from '@/store';
import { createLesson, reduceLesson, type LessonEffect, type LessonEvent, type LessonState, type LessonStepSpec } from './machine';

type MissionStep = MissionDetailResponse['steps'][number];

export function toStepSpecs(mission: MissionDetailResponse): LessonStepSpec[] {
  return mission.steps.map((s): LessonStepSpec => {
    const expressions = s.expressions;
    const options = s.type === 'listen_identify' || s.type === 'comprehension_check' ? expressions.map((e) => ({ id: e.id, label: e.meaning })) : [];
    return {
      id: s.id,
      type: s.type,
      requiresAttemptBeforeReveal: s.type === 'anticipation' || Boolean((s.successConditions as { requiresAttemptBeforeReveal?: boolean }).requiresAttemptBeforeReveal),
      options,
      correctOptionId: options.length > 0 ? (expressions[0]?.id ?? null) : null,
      hintCount: s.hints.length,
      offlineCapable: s.offlineCapable,
    };
  });
}

export interface LessonPlayer {
  state: LessonState;
  step: MissionStep;
  dispatch: (event: LessonEvent) => void;
  /** Reference audio availability for the current step (null when the API gave no playable asset). */
  referenceUri: string | null;
  playing: boolean;
  recording: boolean;
  evaluating: boolean;
  evaluation: SpeechEvaluationResult | null;
  result: MissionEvaluateResponse | null;
  finishing: boolean;
  finishError: unknown;
  offlineLimited: boolean;
  finish: () => Promise<void>;
  leave: () => Promise<void>;
}

interface Options {
  mission: MissionDetailResponse;
  enrollment: EnrollmentDto;
  recorder: Recorder;
  player: ClipPlayer;
}

const isAudioAsset = (s: MissionStep) => s.expressions.flatMap((e) => e.audio).find((a) => a.asset.publicUrl) ?? null;

export function useLessonPlayer({ mission, enrollment, recorder, player }: Options): LessonPlayer {
  const { api, online, enqueue } = useServices();
  const specs = useMemo(() => toStepSpecs(mission), [mission]);
  const [state, rawDispatch] = useReducer((s: LessonState, e: LessonEvent) => reduceLesson(s, e).state, specs, (sp) => createLesson(sp, nowMs()));
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [result, setResult] = useState<MissionEvaluateResponse | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<unknown>(null);
  const attemptRef = useRef<{ clientAttemptId: string; attemptId: string | null; startedAt: string } | null>(null);
  /** Attempt identity (client UUID + server id); created lazily outside render. */
  const getAttempt = useCallback(() => (attemptRef.current ??= { clientAttemptId: newUuid(), attemptId: null, startedAt: nowIso() }), []);
  const speakingSeconds = useRef(0);

  const step = mission.steps[state.index] ?? mission.steps[0]!;
  const asset = isAudioAsset(step);
  const referenceUri = asset?.asset.publicUrl ?? null;
  const trackDef = getCourseTrack(enrollment.courseTrackId);

  // Create (or replay) the attempt and mark the mission in progress locally.
  useEffect(() => {
    let alive = true;
    (async () => {
      const attempt = getAttempt();
      const store = await getLocalStore();
      const existing = await store.cache.getLocalMission(enrollment.id, mission.id);
      if (existing && existing.status === 'in_progress') Object.assign(attempt, { clientAttemptId: existing.clientAttemptId, attemptId: existing.attemptId, startedAt: existing.startedAt });
      await store.cache.putLocalMission({ missionId: mission.id, enrollmentId: enrollment.id, status: 'in_progress', stepIndex: 0, attemptId: attempt.attemptId, clientAttemptId: attempt.clientAttemptId, startedAt: attempt.startedAt, completedAt: null, pendingEvaluation: false });
      if (!attempt.attemptId && online) {
        try {
          const res = await api.missionAttemptCreate(mission.id, { enrollmentId: enrollment.id, clientAttemptId: attempt.clientAttemptId, missionRevision: mission.revision, startedAt: attempt.startedAt });
          if (alive) attempt.attemptId = res.attemptId;
        } catch {
          /* offline or API down: evaluation will retry with the same clientAttemptId */
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mission.id, enrollment.id]);

  const evaluateClip = useCallback(
    async (clip: RecordedClip | null, text: string | null) => {
      const current = mission.steps[stateRef.current.index]!;
      const expression = current.expressions[0] ?? null;
      if (!clip && !text) {
        rawDispatch({ type: 'evaluation_failed', message: 'no_input' });
        return;
      }
      if (!online) {
        rawDispatch({ type: 'evaluation_failed', message: 'offline' });
        return;
      }
      setEvaluating(true);
      try {
        let evaluation: SpeechEvaluationResult;
        if (clip) {
          speakingSeconds.current += clip.durationMs / 1000;
          evaluation = await api.pronunciationAssess({
            enrollmentId: enrollment.id,
            targetVarietyId: trackDef.targetVarietyId,
            ...(expression ? { expressionId: expression.id } : { referenceText: current.instruction.slice(0, 500) }),
            audio: { source: 'inline', base64: clip.base64, encoding: clip.encoding, sampleRateHz: clip.sampleRateHz },
            requestedFeatures: trackDef.tonal ? ['word', 'tone'] : ['word'],
            clientRequestId: newUuid(),
            scenarioId: mission.id,
          });
        } else {
          // Typed answers: meaning only. We never report pronunciation for text.
          evaluation = {
            assessmentId: newUuid(),
            targetVarietyId: trackDef.targetVarietyId,
            semanticIntentMatched: expression ? normalise(text!) === normalise(expression.canonicalText) || expression.forms.some((f) => normalise(f.text) === normalise(text!)) : false,
            meaningConfidence: 0.5,
            intelligibility: 'understood',
            pronunciation: { assessmentMode: 'unavailable', numericScore: null, confidence: 'none', feedback: [], featuresAssessed: [], wordScores: [], phonemeHints: [], toneHints: [], highlightedSegment: null, provider: null, scorerVersion: null },
            shouldAdvanceConversation: true,
            transcript: text,
            matchedIntentIds: [],
          };
        }
        rawDispatch({ type: 'evaluated', result: evaluation });
      } catch (error) {
        rawDispatch({ type: 'evaluation_failed', message: error instanceof ApiClientError ? error.kind : 'failed' });
      } finally {
        setEvaluating(false);
      }
    },
    [api, enrollment.id, mission, online, trackDef],
  );

  const runEffects = useCallback(
    async (effects: LessonEffect[], context: { durationMs?: number; text?: string }) => {
      for (const effect of effects) {
        switch (effect.type) {
          case 'play_reference': {
            const uri = isAudioAsset(mission.steps[stateRef.current.index]!)?.asset.publicUrl ?? null;
            if (!uri) break;
            setPlaying(true);
            player.playUri(uri, effect.slow ? 0.75 : 1).catch(() => undefined).finally(() => setPlaying(false));
            break;
          }
          case 'stop_audio':
            player.stop();
            setPlaying(false);
            break;
          case 'start_recording':
            try {
              await recorder.start();
              setRecording(true);
            } catch {
              rawDispatch({ type: 'record_cancel' });
            }
            break;
          case 'cancel_recording':
            await recorder.cancel();
            setRecording(false);
            break;
          case 'stop_recording':
            setRecording(false);
            break;
          case 'evaluate_recording': {
            const clip = await recorder.stop();
            await evaluateClip(clip, null);
            break;
          }
          case 'evaluate_text':
            await evaluateClip(null, effect.text);
            break;
          case 'step_completed': {
            const attempt = getAttempt();
            await enqueue({ type: 'step_completed', attemptId: attempt.attemptId ?? attempt.clientAttemptId, stepId: effect.result.stepId, outcome: effect.result.outcome, hintsUsed: effect.result.hintsUsed, durationMs: effect.result.durationMs }, enrollment.id);
            (await getLocalStore()).cache.putLocalMission({ missionId: mission.id, enrollmentId: enrollment.id, status: 'in_progress', stepIndex: stateRef.current.index + 1, attemptId: attempt.attemptId, clientAttemptId: attempt.clientAttemptId, startedAt: attempt.startedAt, completedAt: null, pendingEvaluation: false }).catch(() => undefined);
            break;
          }
          case 'finished':
            break;
        }
      }
      void context;
    },
    [getAttempt, enqueue, enrollment.id, evaluateClip, mission, player, recorder],
  );

  const dispatch = useCallback(
    (event: LessonEvent) => {
      const { effects } = reduceLesson(stateRef.current, event);
      rawDispatch(event);
      void runEffects(effects, {});
    },
    [runEffects],
  );

  const finish = useCallback(async () => {
    const s = stateRef.current;
    if (s.completed.length === 0) return;
    setFinishing(true);
    setFinishError(null);
    const attempt = getAttempt();
    const store = await getLocalStore();
    const clientEventId = `${attempt.clientAttemptId}`;
    await store.cache.putLocalMission({ missionId: mission.id, enrollmentId: enrollment.id, status: 'completed', stepIndex: s.completed.length, attemptId: attempt.attemptId, clientAttemptId: attempt.clientAttemptId, startedAt: attempt.startedAt, completedAt: nowIso(), pendingEvaluation: true });
    await enqueue({ type: 'activity_minutes', activityDate: localDateKey(), minutesActive: Math.max(1, Math.round((nowMs() - Date.parse(attempt.startedAt)) / 60_000)), speakingSeconds: Math.round(speakingSeconds.current) }, enrollment.id);
    if (speakingSeconds.current > 0) track.speakingTime(Math.round(speakingSeconds.current), 'anticipation');
    try {
      if (!attempt.attemptId) {
        const res = await api.missionAttemptCreate(mission.id, { enrollmentId: enrollment.id, clientAttemptId: attempt.clientAttemptId, missionRevision: mission.revision, startedAt: attempt.startedAt });
        attempt.attemptId = res.attemptId;
      }
      const res = await api.missionEvaluate(mission.id, { attemptId: attempt.attemptId, enrollmentId: enrollment.id, completedAt: nowIso(), stepResults: s.completed, clientEventId });
      setResult(res);
      await store.cache.putLocalMission({ missionId: mission.id, enrollmentId: enrollment.id, status: 'completed', stepIndex: s.completed.length, attemptId: attempt.attemptId, clientAttemptId: attempt.clientAttemptId, startedAt: attempt.startedAt, completedAt: nowIso(), pendingEvaluation: false });
    } catch (error) {
      setFinishError(error);
    } finally {
      setFinishing(false);
    }
  }, [api, getAttempt, enqueue, enrollment.id, mission]);

  const leave = useCallback(async () => {
    const attempt = getAttempt();
    dispatch({ type: 'abandon' });
    player.stop();
    await enqueue({ type: 'mission_abandoned', attemptId: attempt.attemptId ?? attempt.clientAttemptId, atStepIndex: stateRef.current.index }, enrollment.id);
  }, [getAttempt, dispatch, enqueue, enrollment.id, player]);

  useEffect(() => () => player.stop(), [player]);

  return {
    state,
    step,
    dispatch,
    referenceUri,
    playing,
    recording,
    evaluating,
    evaluation: state.current.lastEvaluation,
    result,
    finishing,
    finishError,
    offlineLimited: !online && !step.offlineCapable,
    finish,
    leave,
  };
}

const normalise = (s: string): string => s.toLowerCase().normalize('NFKC').replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();

