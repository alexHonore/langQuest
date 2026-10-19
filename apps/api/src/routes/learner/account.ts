/**
 * §6.1 account routes: session refresh (Supabase Auth proxy), `GET /v1/me`, `PATCH /v1/me/settings`.
 *
 * `defaultSourceLanguageCode` is only a prefill for NEW enrollments (§2.1); the profile column is nullable
 * until onboarding sets it, so the response is produced with a nullable local schema (contracts gap noted).
 */
import { MeDeleteRequestSchema, MeDeleteResponseSchema, MeExportResponseSchema, MeResponseSchema, PatchSettingsRequestSchema, SessionRefreshRequestSchema, SessionRefreshResponseSchema, SourceLanguageCodeSchema, type MeResponse } from '@langquest/contracts';
import type { Context } from 'hono';
import type { DefineRoute } from '../../app';
import { problem, respondOk } from '../../http/envelope';
import { parseBody } from '../../http/validate';
import { enrollmentToDto, parseAccessibility, parsePrivacy, COVERAGE_COLUMNS, type CoverageRow } from '../../lib/dto';
import type { RequestServices } from '../../services/context';
import type { AppEnv } from '../../types';

/** `defaultSourceLanguageCode` is nullable in the contract (onboarding fills it; it only prefills NEW enrollments). */
export const MeResponseNullableSchema = MeResponseSchema.extend({ defaultSourceLanguageCode: SourceLanguageCodeSchema.nullable() });
export type MeResponseNullable = MeResponse;

const svc = (c: Context<AppEnv>): RequestServices => c.get('services')!;

export async function buildMeResponse(s: RequestServices): Promise<MeResponseNullable> {
  const { db, repos, principal } = s.requireUser();
  const [profile, enrollments] = await Promise.all([repos.profiles.getByUserId(principal.userId), repos.enrollments.listForUser(principal.userId, { includeArchived: true })]);
  if (!profile) throw problem.notFound('Profile');
  const pairs = [...new Set(enrollments.map((e) => `${e.course_track_id}|${e.source_language_code}`))];
  const coverageRows: CoverageRow[] = [];
  if (pairs.length) {
    const res = await db
      .from('course_source_localizations')
      .select(COVERAGE_COLUMNS)
      .in('course_track_id', [...new Set(enrollments.map((e) => e.course_track_id))]);
    if (res.error) throw problem.internal('Could not read coverage');
    coverageRows.push(...(res.data as CoverageRow[]));
  }
  const coverageFor = (trackId: string, source: string) => coverageRows.find((r) => r.course_track_id === trackId && r.source_language_code === source) ?? null;
  return MeResponseNullableSchema.parse({
    userId: principal.userId,
    email: principal.email ?? null,
    displayName: profile.display_name,
    uiLocale: profile.ui_locale,
    defaultSourceLanguageCode: profile.default_source_language_code,
    timeZone: profile.time_zone,
    privacyOptions: parsePrivacy(profile.privacy_options),
    accessibilityOptions: parseAccessibility(profile.accessibility_options),
    roles: principal.roles,
    enrollments: enrollments.map((e) => enrollmentToDto(e, coverageFor(e.course_track_id, e.source_language_code))),
    createdAt: profile.created_at,
  });
}

export function registerAccountRoutes(define: DefineRoute): void {
  // The refresh token is the credential here: the access token is optional (it is usually already expired), so the
  // contract's `learner` class is overridden to `public` (optional Bearer) and the `auth` bucket is keyed by client
  // IP — the identity being probed must never be the key that protects the probe (§11).
  define('authSessionRefresh', { auth: 'public', rate: 'auth', rateKeyBy: 'client', idempotent: false }, async (c) => {
    const body = await parseBody(c, SessionRefreshRequestSchema);
    const s = svc(c);
    const res = await fetch(new URL('/auth/v1/token?grant_type=refresh_token', s.config.env.SUPABASE_URL), {
      method: 'POST',
      headers: { apikey: s.config.env.SUPABASE_ANON_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: body.refreshToken }),
    });
    if (res.status === 400 || res.status === 401 || res.status === 403) throw problem.unauthorized('Refresh token is invalid or has been rotated. Please sign in again.');
    if (!res.ok) throw problem.provider('Authentication service is temporarily unavailable');
    const json = (await res.json()) as { access_token: string; refresh_token: string; expires_at?: number; expires_in?: number };
    const expiresAt = json.expires_at ? new Date(json.expires_at * 1000) : new Date(Date.now() + (json.expires_in ?? 3600) * 1000);
    return respondOk(c, SessionRefreshResponseSchema.parse({ accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt: expiresAt.toISOString() }));
  });

  define('me', {}, async (c) => respondOk(c, await buildMeResponse(svc(c))));

  define('meSettingsPatch', {}, async (c) => {
    const body = await parseBody(c, PatchSettingsRequestSchema);
    const s = svc(c);
    const { repos, principal } = s.requireUser();
    const profile = await repos.profiles.getByUserId(principal.userId);
    if (!profile) throw problem.notFound('Profile');
    const profilePatch: Record<string, unknown> = {};
    if (body.displayName !== undefined) profilePatch.display_name = body.displayName;
    if (body.uiLocale !== undefined) profilePatch.ui_locale = body.uiLocale;
    if (body.defaultSourceLanguageCode !== undefined) profilePatch.default_source_language_code = body.defaultSourceLanguageCode;
    if (body.timeZone !== undefined) profilePatch.time_zone = body.timeZone;
    if (body.privacyOptions) profilePatch.privacy_options = { ...parsePrivacy(profile.privacy_options), ...body.privacyOptions };
    if (body.accessibilityOptions) profilePatch.accessibility_options = { ...parseAccessibility(profile.accessibility_options), ...body.accessibilityOptions };
    if (Object.keys(profilePatch).length) await repos.profiles.update(principal.userId, profilePatch);

    const settingsPatch: Record<string, unknown> = {};
    if (body.notificationPreferences || body.offlineDownloadSettings) {
      const current = await repos.profiles.getSettings(principal.userId);
      if (body.notificationPreferences) settingsPatch.notification_preferences = { ...((current?.notification_preferences as object) ?? {}), ...body.notificationPreferences };
      if (body.offlineDownloadSettings) {
        const prev = (current?.offline_download_settings as Record<string, unknown>) ?? {};
        settingsPatch.offline_download_settings = {
          auto_download: body.offlineDownloadSettings.autoDownload ?? prev.auto_download ?? false,
          wifi_only: body.offlineDownloadSettings.wifiOnly ?? prev.wifi_only ?? true,
          max_storage_mb: body.offlineDownloadSettings.maxStorageMb ?? prev.max_storage_mb ?? 2048,
        };
      }
    }
    if (body.audioSpeed !== undefined) settingsPatch.audio_speed = body.audioSpeed;
    if (body.defaultHintBehavior !== undefined) settingsPatch.default_hint_behavior = body.defaultHintBehavior;
    if (body.conversationMode !== undefined) settingsPatch.conversation_mode = body.conversationMode;
    if (Object.keys(settingsPatch).length) await repos.profiles.upsertSettings({ user_id: principal.userId, ...settingsPatch });
    s.log.info('me.settings_updated', { fields: [...Object.keys(profilePatch), ...Object.keys(settingsPatch)] });
    return respondOk(c, await buildMeResponse(s));
  });
}

/**
 * §11 / A28 — data export and account deletion.
 * Export: a portable JSON bundle built only from the learner's own rows (RLS client). Raw recordings are not
 * embedded (they are listed by asset id); conversation turns are included only as the persisted summaries.
 * Deletion: requires the literal confirmation `DELETE`; opt-in recording objects are removed from storage first, then
 * `delete_account` (service-role RPC) deletes/anonymises the rows and the auth user is deleted when the summary says it
 * can be (`authUserDeletable`); otherwise the account is deactivated and the hard delete left to the retention job.
 */
export function registerAccountLifecycleRoutes(define: DefineRoute): void {
  define('meExport', { timeoutMs: 40_000 }, async (c) => {
    const s = svc(c);
    const { db, repos, principal } = s.requireUser();
    const profile = await buildMeResponse(s);
    const [sessions, audio, totalXp, achievements, xp] = await Promise.all([
      db.from('conversation_sessions').select('id, enrollment_id, mission_id, character_id, state, started_at, ended_at, summary, objectives_completed, turn_count').order('started_at', { ascending: false }).limit(500),
      db.from('user_audio_progress').select('lesson_id, position_ms, duration_ms, completed, completed_at, play_count, updated_at').limit(2000),
      repos.progress.totalXp(principal.userId),
      repos.progress.listAchievements(principal.userId),
      repos.progress.listXp(principal.userId, { limit: 2000 }),
    ]);
    const perEnrollment = await Promise.all(profile.enrollments.map(async (e) => ({ enrollmentId: e.id, mastery: await repos.progress.listMastery(e.id), missionProgress: await repos.progress.listMissionProgress(e.id), reviews: (await db.from('user_expression_reviews').select('*').eq('enrollment_id', e.id)).data ?? [] })));
    return respondOk(
      c,
      MeExportResponseSchema.parse({
        exportedAt: new Date().toISOString(),
        profile,
        enrollments: profile.enrollments,
        progress: { totalXp: Number(totalXp), xpLedger: xp, achievements, perEnrollment },
        conversationSummaries: sessions.data ?? [],
        audioProgress: audio.data ?? [],
        notes: ['Raw speech recordings are not embedded; opt-in recordings are referenced by asset id in conversation turns and can be deleted with DELETE /v1/me.', 'Conversation transcripts are not retained unless you opted in; only the persisted summaries are included.', 'AI request logs are stored pseudonymously for cost accounting and are not part of this export.'],
      }),
      200,
      { 'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="langquest-export.json"' },
    );
  });

  define('meDelete', { timeoutMs: 55_000 }, async (c) => {
    const body = await parseBody(c, MeDeleteRequestSchema);
    const s = svc(c);
    const { principal } = s.requireUser();
    // 1. Opt-in recordings: the objects leave storage first (the RPC only marks the rows; it says so in its summary).
    let objectsDeleted = 0;
    if (body.deleteOptInRecordings && s.media.available) {
      const assets = await s.service.from('media_assets').select('id, storage_key').eq('owner_id', principal.userId).eq('kind', 'audio').neq('disposition', 'deleted');
      for (const a of assets.data ?? []) {
        await s.media.delete(a.storage_key).catch((error) => s.log.warn('account.delete_object_failed', { error }));
        objectsDeleted += 1;
      }
    }
    // 2. `delete_account` (migration 100, service role): every user-owned row and the learner's own evidence ledgers go,
    //    retained ledgers (cost / audit / safety) are anonymised, recordings are marked deleted — one transaction.
    const summary = await s.repos.accountLifecycle.deleteAccount(principal.userId, { deleteOptInRecordings: body.deleteOptInRecordings });
    s.audit({ action: 'account.delete', entityTable: 'profiles', entityId: principal.userId, after: { recordingsDeleted: summary.recordingsDeleted, objectsDeleted, deleteOptInRecordings: body.deleteOptInRecordings, authUserDeletable: summary.authUserDeletable, counts: summary.counts }, anonymousActor: true });
    // 3. The auth user: deleted outright unless NOT NULL editorial attribution (content_revisions / publication_events)
    //    still references it — then the account is deactivated (sign-in banned, e-mail anonymised) and reported as such.
    if (summary.authUserDeletable) {
      const res = await s.service.auth.admin.deleteUser(principal.userId);
      if (!res.error) {
        s.log.info('account.deleted', { recordingsDeleted: summary.recordingsDeleted, deletedTables: summary.deletedTables.length });
        return respondOk(c, MeDeleteResponseSchema.parse({ status: 'deleted', anonymisedTables: summary.anonymisedTables, retainedForLegalReasons: summary.retainedForLegalReasons }));
      }
      s.log.warn('account.auth_delete_failed', { error: res.error.message });
    }
    const anonymisedEmail = `deleted-${principal.userId}@deleted.invalid`;
    const ban = await s.service.auth.admin.updateUserById(principal.userId, { ban_duration: '876000h', email: anonymisedEmail, user_metadata: {}, email_confirm: true } as never);
    if (ban.error) throw problem.internal(`Account deactivation failed: ${ban.error.message}`);
    return respondOk(
      c,
      MeDeleteResponseSchema.parse({
        status: 'scheduled',
        anonymisedTables: [...summary.anonymisedTables, 'auth.users (e-mail anonymised, sign-in banned)'],
        retainedForLegalReasons: [...summary.retainedForLegalReasons, summary.authUserDeletable ? 'auth.users (deletion deferred to the retention job after a transient auth error)' : 'auth.users (editorial attribution in content_revisions / publication_events keeps the account id; deletion deferred to the retention job)'],
      }),
    );
  });
}
