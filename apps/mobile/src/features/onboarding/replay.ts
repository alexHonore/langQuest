/**
 * Onboarding replay (§10.1 / UX observation 1): the course chosen before an account existed — track,
 * instruction language, script mode, regional option — is kept in device prefs and replayed into
 * `POST /v1/me/enrollments` once the learner is signed in (right after sign-up, or after sign-in when a
 * pending selection is still there). Pure and unit-tested; the hook wires it to prefs, the API and the
 * react-query cache.
 */
import { SOURCE_LANGUAGES, findCourseTrack, type EnrollmentCreateRequest, type ScriptMode, type SourceLanguageCode } from '@langquest/contracts';

export interface PendingOnboardingSelection {
  trackId: string;
  sourceLanguageCode: string;
  scriptMode: string | null;
  regionalOption: string | null;
  /** Idempotency key reused across retries (minted by the caller when absent). */
  idempotencyKey: string | null;
}

export interface PendingPrefs {
  pendingTrackId: string | null;
  pendingDefaultSourceLanguage: string | null;
  pendingScriptMode: string | null;
  pendingRegionalOption: string | null;
  pendingEnrollmentKey: string | null;
}

/** The selection waiting to be replayed, or null when onboarding did not pick a course. */
export function pendingOnboardingSelection(prefs: PendingPrefs): PendingOnboardingSelection | null {
  if (!prefs.pendingTrackId || !prefs.pendingDefaultSourceLanguage) return null;
  return {
    trackId: prefs.pendingTrackId,
    sourceLanguageCode: prefs.pendingDefaultSourceLanguage,
    scriptMode: prefs.pendingScriptMode,
    regionalOption: prefs.pendingRegionalOption,
    idempotencyKey: prefs.pendingEnrollmentKey,
  };
}

/**
 * The enrollment request for a selection, or null when it cannot be honoured (unknown track, unknown
 * instruction language, or learning a language from itself). A script mode or regional option the
 * track does not offer is dropped (the server applies the track default), never substituted.
 */
export function enrollmentRequestFromSelection(selection: PendingOnboardingSelection): EnrollmentCreateRequest | null {
  const track = findCourseTrack(selection.trackId);
  if (!track) return null;
  const source = SOURCE_LANGUAGES.find((s) => s.code === selection.sourceLanguageCode);
  if (!source || source.code === track.languageCode) return null;
  const scriptMode = selection.scriptMode && (track.scriptModeOptions as readonly string[]).includes(selection.scriptMode) ? (selection.scriptMode as ScriptMode) : undefined;
  const regionalPreference = selection.regionalOption && track.regionalOptions.some((o) => o.id === selection.regionalOption) ? selection.regionalOption : undefined;
  return {
    courseTrackId: track.id,
    sourceLanguageCode: source.code as SourceLanguageCode,
    ...(scriptMode ? { scriptMode } : {}),
    ...(regionalPreference ? { regionalPreference } : {}),
    learnerLevel: 'beginner',
  };
}

export interface ExistingEnrollmentLike {
  id: string;
  courseTrackId: string;
  sourceLanguageCode: string;
  status: string;
}

export type ReplayOutcome =
  /** The enrollment was created now; make it active. */
  | { kind: 'created'; enrollmentId: string; idempotencyKey: string }
  /** The learner already has this course from this instruction language; make it active. */
  | { kind: 'existing'; enrollmentId: string }
  /** Nothing to replay. */
  | { kind: 'nothing_pending' }
  /** The selection cannot be turned into an enrollment (stale track id…); drop it. */
  | { kind: 'invalid' }
  /** The request failed; `retryable` says whether trying again later makes sense (connectivity). */
  | { kind: 'failed'; error: unknown; retryable: boolean; idempotencyKey: string };

export interface ReplayDeps {
  selection: PendingOnboardingSelection | null;
  /** The learner's current (non-archived) enrollments from `/v1/me`. */
  existingEnrollments: readonly ExistingEnrollmentLike[];
  createEnrollment: (body: EnrollmentCreateRequest, idempotencyKey: string) => Promise<{ id: string }>;
  newIdempotencyKey: () => string;
  /** True for connectivity-class failures (offline, timeout, not configured). */
  isRetryable: (error: unknown) => boolean;
}

/** Replay the pending selection: reuse a matching enrollment, else create one (idempotently). */
export async function replayPendingOnboarding(deps: ReplayDeps): Promise<ReplayOutcome> {
  if (!deps.selection) return { kind: 'nothing_pending' };
  const body = enrollmentRequestFromSelection(deps.selection);
  if (!body) return { kind: 'invalid' };
  const existing = deps.existingEnrollments.find((e) => e.courseTrackId === body.courseTrackId && e.sourceLanguageCode === body.sourceLanguageCode && e.status !== 'archived');
  if (existing) return { kind: 'existing', enrollmentId: existing.id };
  const idempotencyKey = deps.selection.idempotencyKey ?? deps.newIdempotencyKey();
  try {
    const created = await deps.createEnrollment(body, idempotencyKey);
    return { kind: 'created', enrollmentId: created.id, idempotencyKey };
  } catch (error) {
    return { kind: 'failed', error, retryable: deps.isRetryable(error), idempotencyKey };
  }
}
