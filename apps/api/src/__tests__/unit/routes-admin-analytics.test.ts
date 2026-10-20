/**
 * `GET /v1/admin/analytics/{quality,cost,usage,errors}` (R-6.4-20) through the real app against seeded in-memory rows:
 * staff-only gate, query validation (including a reversed range on every panel), the response contracts, numbers
 * computed from stored rows only (metrics that are not recorded stay `null`, never estimated), the track / source
 * filters the admin dashboard sends to every panel, honest per-track live capabilities, and operator alerts.
 *
 * The in-memory PostgREST is wrapped (`postgrestSemantics`) with the four behaviours of the real server these panels
 * depend on: an embed between tables linked by two foreign keys (`media_assets` / `content_rights`) must name the
 * relationship or fails with PGRST201, the many-to-one `user_course_enrollments(...)` embed is resolved from the
 * stored enrollments (the FK join), `alias:column->>key` reads one key of a JSON column as text, and every response is
 * capped at `max_rows` = 1000 rows whatever `limit` asks for (`supabase/config.toml`).
 * Staff and job `ai_requests` rows (Studio probes and smoke tests tagged `redacted_log.actor = 'staff'`, benchmark and
 * content jobs tagged `redacted_log.jobId`) stay in the bill but never count as learners, learner spend, conversation
 * cost or learner latency. Rows with neither an enrollment nor a tag (a deleted course or account, untagged probes) are
 * `unattributedUsd`, never passed off as staff spend.
 * The ">1000 rows" block proves the totals stay exact past that cap, and that a read cut by the page bound (or by a
 * lower server cap) is declared in the `x-langquest-analytics-truncated` header (CORS-exposed to the Studio) and in
 * the body's `truncated` list instead of passing for a full count.
 */
import { AnalyticsCostResponseSchema, AnalyticsErrorsResponseSchema, AnalyticsQualityResponseSchema, AnalyticsUsageResponseSchema, COURSE_TRACKS, apiEnvelope } from '@langquest/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ANALYTICS_EXTRA_PAGE_BUDGET, ANALYTICS_PAGE_ROWS, ANALYTICS_TRUNCATED_HEADER, aiRowAttribution, allocatePages, isLearnerAiRow } from '../../routes/admin/analytics';
import { enrollmentRow, mediaAssetRow, routeHarness, type DbRow, type FakePostgrest, type RouteHarness } from './route-fixtures';

const LEARNER = '11111111-1111-4111-8111-111111111111';
const LEARNER_2 = '77777777-7777-4777-8777-777777777777';
const SUPPORT = '44444444-4444-4444-8444-444444444444';
const ADMIN = '66666666-6666-4666-8666-666666666666';
const ROLES = { [SUPPORT]: ['support_readonly' as const], [ADMIN]: ['admin' as const] };
const RANGE = 'from=2026-10-01&to=2026-10-02';
const PANELS = ['quality', 'cost', 'usage', 'errors'] as const;
const DAY_MS = 86_400_000;
/** The Studio origin the offline env allows (`CORS_ALLOWED_ORIGINS`). */
const STUDIO_ORIGIN = 'https://admin.example.test';

interface PostgrestProbe {
  /** Largest number of rows any single response carried. */
  maxRowsServed: number;
  /** `offset` of every ranged GET per table, in request order. */
  offsets: Record<string, number[]>;
  /** `table->embed` of every read refused as an ambiguous embed (PGRST201). */
  ambiguousEmbeds: string[];
}

/**
 * Table pairs linked by MORE than one foreign key in the real schema. PostgREST refuses an embed between them that
 * does not name the relationship (`rel!<fk or column>(...)`) with PGRST201 / HTTP 300. `media_assets` and
 * `content_rights` are linked both ways: `media_assets.content_rights_id` (many-to-one) and
 * `content_rights.evidence_asset_id` (one-to-many).
 */
const AMBIGUOUS_EMBEDS: Record<string, readonly string[]> = { media_assets: ['content_rights'], content_rights: ['media_assets'] };
/** `!inner` / `!left` pick the join type; any other `!segment` names the relationship. */
const JOIN_MODIFIERS = new Set(['inner', 'left']);

/** The embeds in `select` from `table` that would hit PGRST201 on the real server (no relationship named). */
function ambiguousEmbeds(table: string, select: string): string[] {
  const out: string[] = [];
  for (const target of AMBIGUOUS_EMBEDS[table] ?? []) {
    for (const m of select.matchAll(new RegExp(`(?:^|[,(])\\s*(?:[a-zA-Z0-9_]+:)?${target}((?:![a-zA-Z0-9_]+)*)\\(`, 'g'))) {
      const segments = (m[1] ?? '').split('!').filter(Boolean);
      if (!segments.some((seg) => !JOIN_MODIFIERS.has(seg))) out.push(target);
    }
  }
  return out;
}

/**
 * PostgREST `alias:column->>key` selections read one key of a JSON column as text (null when the column or the key is
 * missing). The in-memory fake projects plain columns only, so each stored row gets the resolved value under the
 * selection's own name (`column->>key`) before the request is handled; the fake then projects it under the alias.
 */
function resolveJsonPaths(db: FakePostgrest, table: string, select: string): void {
  for (const m of select.matchAll(/([a-zA-Z0-9_]+)->>([a-zA-Z0-9_]+)/g)) {
    const [path, column, key] = [m[0], m[1]!, m[2]!];
    for (const row of db.rows(table)) {
      const json = row[column];
      const value = json !== null && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>)[key] : undefined;
      row[path] = value === undefined || value === null ? null : typeof value === 'string' ? value : JSON.stringify(value);
    }
  }
}

/**
 * Gives the in-memory PostgREST the real server's behaviour on the four points the analytics reads rely on:
 * - an embed between tables linked by two foreign keys must name the relationship, or the read fails with PGRST201
 *   (HTTP 300, no `Content-Range`), exactly as the local stack answers `media_assets?select=id,content_rights(...)`;
 * - `user_course_enrollments(...)` embeds are resolved from the stored enrollments through `enrollment_id` (the FK
 *   join), so a fixture cannot seed an embed that disagrees with the enrollments table;
 * - `alias:column->>key` selections are resolved from the stored JSON column (`resolveJsonPaths`);
 * - no response carries more than `maxRows` rows (`[api] max_rows`), and `Content-Range` reports the rows actually
 *   served plus the exact total, as PostgREST does.
 */
function postgrestSemantics(db: FakePostgrest, maxRows: number): PostgrestProbe {
  const probe: PostgrestProbe = { maxRowsServed: 0, offsets: {}, ambiguousEmbeds: [] };
  const handle = db.handle.bind(db);
  db.handle = async (request: Request) => {
    const url = new URL(request.url);
    const table = url.pathname.replace(/^\/rest\/v1\//, '');
    const reading = request.method === 'GET' || request.method === 'HEAD';
    const ambiguous = reading ? ambiguousEmbeds(table, url.searchParams.get('select') ?? '') : [];
    if (ambiguous.length > 0) {
      probe.ambiguousEmbeds.push(...ambiguous.map((target) => `${table}->${target}`));
      const body = { code: 'PGRST201', message: `Could not embed because more than one relationship was found for '${table}' and '${ambiguous[0]}'`, details: null, hint: null };
      return new Response(request.method === 'HEAD' ? null : JSON.stringify(body), { status: 300, headers: { 'content-type': 'application/json' } });
    }
    if (reading && (url.searchParams.get('select') ?? '').includes('user_course_enrollments(')) {
      const byId = new Map(db.rows('user_course_enrollments').map((e) => [e.id, e]));
      for (const row of db.rows(table)) row.user_course_enrollments = typeof row.enrollment_id === 'string' ? (byId.get(row.enrollment_id) ?? null) : null;
    }
    if (reading) resolveJsonPaths(db, table, url.searchParams.get('select') ?? '');
    const res = await handle(request);
    if (request.method !== 'GET' || !(res.headers.get('content-type') ?? '').includes('json')) return res;
    const offset = Number(url.searchParams.get('offset') ?? '0');
    if (url.searchParams.has('offset')) (probe.offsets[table] ??= []).push(offset);
    const body: unknown = await res.json();
    const headers = new Headers(res.headers);
    let served = body;
    if (Array.isArray(body) && body.length > maxRows) {
      served = body.slice(0, maxRows);
      const total = res.headers.get('content-range')?.split('/')[1];
      if (total !== undefined) headers.set('content-range', `${offset}-${offset + maxRows - 1}/${total}`);
    }
    if (Array.isArray(served)) probe.maxRowsServed = Math.max(probe.maxRowsServed, served.length);
    return new Response(JSON.stringify(served), { status: res.status, headers });
  };
  return probe;
}

describe('admin analytics', () => {
  let h: RouteHarness;
  let admin: string;
  let frenchEn: DbRow;
  let darijaFr: DbRow;
  let probe: PostgrestProbe;
  beforeEach(async () => {
    h = routeHarness({ roles: ROLES });
    probe = postgrestSemantics(h.db, ANALYTICS_PAGE_ROWS);
    admin = await h.token(ADMIN);
    [frenchEn, darijaFr] = h.db.seed('user_course_enrollments', [
      enrollmentRow(LEARNER, 'french', { source_language_code: 'en' }),
      enrollmentRow(LEARNER, 'arabic-moroccan', { source_language_code: 'fr' }),
      enrollmentRow(LEARNER_2, 'french', { source_language_code: 'en' }),
      enrollmentRow(LEARNER_2, 'french', { source_language_code: 'en', status: 'archived' }),
    ]) as [DbRow, DbRow];
  });
  afterEach(() => h.restore());
  const get = (panel: string, extra = '') => h.call(`/v1/admin/analytics/${panel}?${RANGE}${extra}`, { token: admin });

  it('is staff-only: anonymous 401, learner 403, read-only support staff allowed', async () => {
    const learner = await h.token(LEARNER);
    const support = await h.token(SUPPORT);
    for (const panel of PANELS) {
      expect((await h.call(`/v1/admin/analytics/${panel}?${RANGE}`)).status, panel).toBe(401);
      const denied = await h.call(`/v1/admin/analytics/${panel}?${RANGE}`, { token: learner });
      expect(denied.status, panel).toBe(403);
      expect(denied.json.error.code).toBe('forbidden');
      expect((await h.call(`/v1/admin/analytics/${panel}?${RANGE}`, { token: support })).status, panel).toBe(200);
    }
  });

  it('validates the query on every panel (422), including a reversed date range', async () => {
    for (const panel of PANELS) {
      for (const qs of ['to=2026-10-02', 'from=yesterday&to=2026-10-02', `${RANGE}&granularity=hour`, `${RANGE}&trackId=klingon`, `${RANGE}&sourceLanguage=xx`, 'from=2026-10-05&to=2026-10-01']) {
        const res = await h.call(`/v1/admin/analytics/${panel}?${qs}`, { token: admin });
        expect(res.status, `${panel} ?${qs}`).toBe(422);
        expect(res.json.error.code).toBe('validation_failed');
      }
    }
  });

  describe('quality', () => {
    beforeEach(() => {
      h.db.seed('expressions', [
        { state: 'approved', reviewed: true },
        { state: 'published', reviewed: true },
        { state: 'published', reviewed: true },
        { state: 'published', reviewed: false },
        { state: 'review_needed', reviewed: true },
      ]);
      h.db.seed('media_assets', [mediaAssetRow({ content_rights: { verified: true } }), mediaAssetRow({ content_rights: { verified: false } }), mediaAssetRow({ content_rights: null }), mediaAssetRow(), mediaAssetRow({ disposition: 'quarantined' })]);
      h.db.seed('course_source_localizations', [
        { course_track_id: 'french', source_language_code: 'en', metrics: { mission_instructions_pct: 80 } },
        { course_track_id: 'arabic-moroccan', source_language_code: 'fr', metrics: { mission_instructions_pct: 120 } },
        { course_track_id: 'french', source_language_code: 'fr', metrics: {} },
        { course_track_id: 'klingon', source_language_code: 'en', metrics: { mission_instructions_pct: 50 } },
      ]);
      h.db.seed('feedback_reports', [
        { status: 'open', category: 'false_correction', enrollment_id: frenchEn.id, course_track_id: null },
        { status: 'open', category: 'false_correction', enrollment_id: null, course_track_id: 'french' },
        { status: 'open', category: 'offensive', enrollment_id: null, course_track_id: null },
        { status: 'open', category: 'wrong_dialect', enrollment_id: darijaFr.id, course_track_id: null },
        { status: 'resolved', category: 'offensive', enrollment_id: null, course_track_id: null },
      ]);
      h.db.seed('mission_progress', [
        { first_completed_at: '2026-10-01T10:00:00.000Z', completed_without_hints: false },
        { first_completed_at: '2026-10-01T11:00:00.000Z', completed_without_hints: true },
        { first_completed_at: '2026-10-02T09:00:00.000Z', completed_without_hints: true },
        { first_completed_at: '2026-09-30T23:00:00.000Z', completed_without_hints: false },
      ]);
      h.db.seed('transcript_segments', [{ confidence: 0.8 }, { confidence: 0.6 }, { confidence: null }]);
    });

    it('computes every fraction from stored rows and leaves unrecorded recall null', async () => {
      const res = await get('quality');
      expect(res.status).toBe(200);
      const parsed = apiEnvelope(AnalyticsQualityResponseSchema).parse(res.json);
      if (!parsed.ok) throw new Error('expected ok');
      const d = parsed.data;
      expect(d.nativeReviewedFraction).toBe(0.75);
      expect(d.rightsCoverageFraction).toBe(0.25);
      expect(d.unresolvedTakedowns).toBe(3); // 1 quarantined asset + open offensive + open wrong-dialect reports
      expect(d.transcriptAlignmentQuality).toBeCloseTo(0.7, 10);
      expect(d.localizationCoverageBySource).toEqual([
        { sourceLanguage: 'en', trackId: 'french', pct: 80 },
        { sourceLanguage: 'fr', trackId: 'arabic-moroccan', pct: 100 },
        { sourceLanguage: 'fr', trackId: 'french', pct: 0 },
      ]);
      expect(d.missionCompletionWithoutHints).toEqual([{ period: '2026-10-01', value: 0.5 }, { period: '2026-10-02', value: 1 }]);
      expect(d.recall7Day).toEqual([{ period: '2026-10-01', value: null }, { period: '2026-10-02', value: null }]);
      expect(d.recall30Day.every((p) => p.value === null)).toBe(true);
      const rate = (trackId: string) => d.falseCorrectionRateByTrack.find((r) => r.trackId === trackId)?.rate;
      expect(rate('french')).toBeCloseTo(2 / 3, 10); // 2 reports over 3 french enrollments
      expect(rate('arabic-moroccan')).toBe(0);
      expect(rate('german')).toBeNull(); // no enrollments: no rate, not zero
      expect(d.liveCapabilityByTrack).toHaveLength(COURSE_TRACKS.length * 4);
    });

    it('rights coverage names the media_assets -> content_rights relationship (two FKs link them; an unnamed embed is PGRST201)', async () => {
      // The emulation refuses the unnamed embed the way the real server does (HTTP 300, no count) ...
      const unnamed = await h.db.handle(new Request('http://fake.supabase/rest/v1/media_assets?select=id,content_rights!inner(verified)&content_rights.verified=eq.true', { method: 'HEAD', headers: { prefer: 'count=exact' } }));
      expect(unnamed.status).toBe(300);
      expect(unnamed.headers.get('content-range')).toBeNull();
      const named = await h.db.handle(new Request('http://fake.supabase/rest/v1/media_assets?select=id,content_rights!content_rights_id!inner(verified)&content_rights.verified=eq.true', { method: 'HEAD', headers: { prefer: 'count=exact' } }));
      expect(named.status).toBe(200);
      probe.ambiguousEmbeds.length = 0;
      // ... and the panel's own reads never hit it, so the rights fraction is a measured number, not a 500.
      const res = await get('quality');
      expect(res.status).toBe(200);
      expect(probe.ambiguousEmbeds).toEqual([]);
      expect(res.json.data.rightsCoverageFraction).toBe(0.25);
    });

    it('per-track live capabilities are honest (no voice claimed where the matrix has none) and follow the track filter', async () => {
      const res = await get('quality', '&trackId=kinyarwanda&sourceLanguage=en');
      expect(res.status).toBe(200);
      const caps = res.json.data.liveCapabilityByTrack as { trackId: string; task: string; capability: { supported: boolean; effectiveLocale: string | null } }[];
      expect(caps.map((c) => c.task)).toEqual(['speech_recognition', 'speech_synthesis', 'realtime_conversation', 'pronunciation_assessment']);
      expect(caps.every((c) => c.trackId === 'kinyarwanda')).toBe(true);
      expect(caps.find((c) => c.task === 'speech_synthesis')?.capability).toMatchObject({ supported: false, effectiveLocale: null });
      expect(res.json.data.localizationCoverageBySource).toEqual([]);
      expect(res.json.data.falseCorrectionRateByTrack).toEqual([{ trackId: 'kinyarwanda', rate: null }]);
    });
  });

  describe('cost', () => {
    beforeEach(() => {
      h.db.seed('ai_requests', [
        { task: 'speech_recognition', provider: 'openrouter', model: 'openai/whisper-large-v3', input_tokens: null, output_tokens: null, audio_seconds: 4, estimated_cost_usd: 0.5, user_id: LEARNER, enrollment_id: frenchEn.id, created_at: '2026-10-01T10:00:00.000Z' },
        { task: 'character_dialogue', provider: 'openrouter', model: 'fake/dialogue', input_tokens: 100, output_tokens: 20, audio_seconds: null, estimated_cost_usd: 0.25, user_id: LEARNER, enrollment_id: darijaFr.id, created_at: '2026-10-02T10:00:00.000Z' },
        { task: 'content_generation', provider: 'openrouter', model: 'fake/factory', input_tokens: 1000, output_tokens: 500, audio_seconds: null, estimated_cost_usd: 1, user_id: null, enrollment_id: null, created_at: '2026-10-02T11:00:00.000Z' },
        { task: 'character_dialogue', provider: 'openrouter', model: 'fake/dialogue', input_tokens: 1, output_tokens: 1, audio_seconds: null, estimated_cost_usd: 9, user_id: LEARNER, enrollment_id: frenchEn.id, created_at: '2026-09-29T10:00:00.000Z' },
      ]);
    });

    it('totals stored request costs in range by task, provider and period', async () => {
      const res = await get('cost');
      expect(res.status).toBe(200);
      const parsed = apiEnvelope(AnalyticsCostResponseSchema).parse(res.json);
      if (!parsed.ok) throw new Error('expected ok');
      expect(parsed.data.totalUsd).toBeCloseTo(1.75, 10);
      expect(parsed.data.byTask).toEqual(expect.arrayContaining([{ task: 'speech_recognition', requests: 1, tokens: 0, audioSeconds: 4, usd: 0.5 }, { task: 'character_dialogue', requests: 1, tokens: 120, audioSeconds: 0, usd: 0.25 }]));
      expect(parsed.data.timeline).toEqual([{ period: '2026-10-01', value: 0.5 }, { period: '2026-10-02', value: 1.25 }]);
      // Learner spend over the one learner: the $1 content-generation row has no enrollment, so it is not learner spend;
      // it carries no staff or job tag either, so it is unattributed, not staff spend.
      expect(parsed.data.estimatedUsdPerActiveLearner).toBeCloseTo(0.75, 10);
      expect(parsed.data).toMatchObject({ learnerUsd: expect.closeTo(0.75, 10), staffAndJobsUsd: 0, unattributedUsd: expect.closeTo(1, 10), activeLearners: 1, truncated: [] });
      expect(parsed.data.reconciliation).toEqual({ invoicedUsd: null, deltaUsd: null, asOf: null });
    });

    it('isLearnerAiRow: a learner row has an enrollment and is neither a staff nor a job row', () => {
      const enrollment = String(frenchEn.id);
      expect(isLearnerAiRow({ enrollment_id: enrollment, actor: null, job_id: null })).toBe(true);
      expect(isLearnerAiRow({ enrollment_id: null, actor: null, job_id: null })).toBe(false); // Studio speech probe, operator script
      expect(isLearnerAiRow({ enrollment_id: '', actor: null, job_id: null })).toBe(false);
      expect(isLearnerAiRow({ enrollment_id: enrollment, actor: 'staff', job_id: null })).toBe(false);
      expect(isLearnerAiRow({ enrollment_id: enrollment, actor: null, job_id: crypto.randomUUID() })).toBe(false);
    });

    it('aiRowAttribution: staff and job rows are identified by their tag, never by a missing enrollment', () => {
      const enrollment = String(frenchEn.id);
      expect(aiRowAttribution({ enrollment_id: enrollment, actor: null, job_id: null })).toBe('learner');
      expect(aiRowAttribution({ enrollment_id: null, actor: 'staff', job_id: null })).toBe('staff_or_job'); // `staffLedgerSink`
      expect(aiRowAttribution({ enrollment_id: null, actor: null, job_id: crypto.randomUUID() })).toBe('staff_or_job'); // job cost ledger
      expect(aiRowAttribution({ enrollment_id: enrollment, actor: null, job_id: crypto.randomUUID() })).toBe('staff_or_job');
      // No enrollment and no tag: a deleted course or account (`on delete set null`), an untagged probe, an older row.
      expect(aiRowAttribution({ enrollment_id: null, actor: null, job_id: null })).toBe('unattributed');
      expect(aiRowAttribution({ enrollment_id: '', actor: null, job_id: '' })).toBe('unattributed');
      expect(aiRowAttribution({ enrollment_id: null, actor: 'learner', job_id: null })).toBe('unattributed'); // only 'staff' is a staff tag
    });

    it('learner spend whose course or account was deleted is unattributed, never staff spend; the three figures add up to the bill', async () => {
      // `ai_requests.enrollment_id` is `on delete set null`: deleting a course (`DELETE /v1/me/enrollments/:id`) keeps the
      // cost row and clears its enrollment; account deletion clears `user_id` and `enrollment_id`. The rows below are
      // what those two deletes leave behind (the in-memory PostgREST does not run foreign-key actions).
      const row = (over: DbRow): DbRow => ({ provider: 'openrouter', model: 'fake/model', input_tokens: 10, output_tokens: 10, audio_seconds: null, created_at: '2026-10-01T12:00:00.000Z', redacted_log: null, ...over });
      h.db.seed('ai_requests', [
        row({ task: 'character_dialogue', estimated_cost_usd: 6, user_id: LEARNER_2, enrollment_id: null }), // course deleted
        row({ task: 'speech_recognition', estimated_cost_usd: 2, user_id: null, enrollment_id: null }), // account deleted
        row({ task: 'character_dialogue', estimated_cost_usd: 3, user_id: ADMIN, enrollment_id: null, redacted_log: { purpose: 'admin_model_test', actor: 'staff' } }),
      ]);
      const parsed = apiEnvelope(AnalyticsCostResponseSchema).parse((await get('cost')).json);
      if (!parsed.ok) throw new Error('expected ok');
      const d = parsed.data;
      // Base seed: learner 0.75 (one learner) + untagged content generation 1. Added: 6 + 2 unattributed, 3 staff.
      expect(d.totalUsd).toBeCloseTo(12.75, 10);
      expect(d.learnerUsd).toBeCloseTo(0.75, 10);
      expect(d.staffAndJobsUsd).toBeCloseTo(3, 10); // only the staff-tagged probe: deleting a course does not make it staff spend
      expect(d.unattributedUsd).toBeCloseTo(1 + 6 + 2, 10);
      expect((d.learnerUsd ?? 0) + (d.staffAndJobsUsd ?? 0) + (d.unattributedUsd ?? 0)).toBeCloseTo(d.totalUsd, 10);
      // The deleted course's learner is no longer known: neither numerator nor divisor of the per-learner cost moves.
      expect(d.activeLearners).toBe(1);
      expect(d.estimatedUsdPerActiveLearner).toBeCloseTo(0.75, 10);
      // Under a filter the rows without an enrollment are out of scope and neither figure has an honest scoped value.
      const french = apiEnvelope(AnalyticsCostResponseSchema).parse((await get('cost', '&trackId=french')).json);
      if (!french.ok) throw new Error('expected ok');
      expect(french.data).toMatchObject({ totalUsd: expect.closeTo(0.5, 10), learnerUsd: expect.closeTo(0.5, 10), staffAndJobsUsd: null, unattributedUsd: null });
    });

    it('staff and job rows are spend, never learners: learner figures use learner rows, the bill keeps every row', async () => {
      const job = crypto.randomUUID();
      const row = (over: DbRow): DbRow => ({ provider: 'openrouter', model: 'fake/model', input_tokens: 10, output_tokens: 10, audio_seconds: null, created_at: '2026-10-01T12:00:00.000Z', ...over });
      h.db.seed('ai_requests', [
        // Studio prompt probe (`staffLedgerSink`): attributed to the admin, staff-tagged, no enrollment.
        row({ task: 'character_dialogue', estimated_cost_usd: 2, user_id: ADMIN, enrollment_id: null, redacted_log: { purpose: 'admin_model_test', actor: 'staff' } }),
        // Model benchmark run by the jobs runner: staff actor and the job id.
        row({ task: 'character_dialogue', estimated_cost_usd: 3, user_id: ADMIN, enrollment_id: null, redacted_log: { purpose: 'model_benchmark', actor: 'staff', jobId: job, sampleId: 'greeting' } }),
        // Studio speech probe: names the admin, carries no tag and no enrollment.
        row({ task: 'speech_synthesis', estimated_cost_usd: 0.5, user_id: ADMIN, enrollment_id: null, redacted_log: null }),
        // A job row stays a job row even when it names an enrollment.
        row({ task: 'learner_evaluation', estimated_cost_usd: 4, user_id: LEARNER_2, enrollment_id: frenchEn.id, redacted_log: { jobId: job }, created_at: '2026-10-02T09:00:00.000Z' }),
      ]);
      const finished = (enrollment: DbRow) => ({ user_id: enrollment.user_id, enrollment_id: enrollment.id, state: 'finished', turn_count: 3, started_at: '2026-10-01T09:00:00.000Z', ended_at: '2026-10-01T09:10:00.000Z' });
      h.db.seed('conversation_sessions', [finished(frenchEn), finished(darijaFr)]);

      const res = await get('cost');
      expect(res.status).toBe(200);
      const parsed = apiEnvelope(AnalyticsCostResponseSchema).parse(res.json);
      if (!parsed.ok) throw new Error('expected ok');
      const d = parsed.data;
      // The bill keeps every row: learner 0.75 + content generation 1 + probe 2 + benchmark 3 + speech probe 0.5 + job 4.
      expect(d.totalUsd).toBeCloseTo(11.25, 10);
      expect(d.byTask).toEqual(expect.arrayContaining([{ task: 'character_dialogue', requests: 3, tokens: 160, audioSeconds: 0, usd: expect.closeTo(5.25, 10) }]));
      expect(d.timeline).toEqual([{ period: '2026-10-01', value: expect.closeTo(6, 10) }, { period: '2026-10-02', value: expect.closeTo(5.25, 10) }]);
      // Learner figures: the admin is not an active learner, and LEARNER_2's only row is a job row.
      expect(d.learnerUsd).toBeCloseTo(0.75, 10);
      expect(d.staffAndJobsUsd).toBeCloseTo(2 + 3 + 4, 10); // the tagged rows: probe, benchmark, job
      expect(d.unattributedUsd).toBeCloseTo(1 + 0.5, 10); // untagged and without an enrollment: content generation, speech probe
      expect(d.activeLearners).toBe(1);
      expect(d.estimatedUsdPerActiveLearner).toBeCloseTo(0.75, 10);
      expect(d.usdPerMeaningfulConversation).toBeCloseTo(0.75 / 2, 10); // learner STT 0.5 + dialogue 0.25; no probe, benchmark or job
      expect(d.truncated).toEqual([]);

      // Under a filter, only rows tied to an in-scope enrollment remain; the staff and job figure has no honest scope.
      const french = apiEnvelope(AnalyticsCostResponseSchema).parse((await get('cost', '&trackId=french')).json);
      if (!french.ok) throw new Error('expected ok');
      expect(french.data).toMatchObject({ totalUsd: expect.closeTo(4.5, 10), learnerUsd: expect.closeTo(0.5, 10), staffAndJobsUsd: null, unattributedUsd: null, activeLearners: 1, estimatedUsdPerActiveLearner: expect.closeTo(0.5, 10), usdPerMeaningfulConversation: expect.closeTo(0.5, 10) });

      // The actor is read from two JSON keys; the whole `redacted_log` is never fetched.
      const selects = h.db.requests.filter((r) => r.target === 'ai_requests' && r.method === 'GET').map((r) => new URLSearchParams(r.query).get('select') ?? '');
      expect(selects.length).toBeGreaterThan(0);
      for (const select of selects) {
        expect(select).toContain('actor:redacted_log->>actor');
        expect(select).toContain('job_id:redacted_log->>jobId');
        expect(select.split(',')).not.toContain('redacted_log');
      }
    });

    it('applies both the track and the source-language filter', async () => {
      expect((await get('cost', '&trackId=french')).json.data.totalUsd).toBeCloseTo(0.5, 10);
      expect((await get('cost', '&sourceLanguage=fr')).json.data.totalUsd).toBeCloseTo(0.25, 10);
      expect((await get('cost', '&trackId=french&sourceLanguage=fr')).json.data.totalUsd).toBe(0);
    });

    it('per-unit costs divide like by like: scoped conversations under a filter, no per-lesson figure under one', async () => {
      const finished = (enrollment: DbRow) => ({ user_id: enrollment.user_id, enrollment_id: enrollment.id, state: 'finished', turn_count: 3, started_at: '2026-10-01T09:00:00.000Z', ended_at: '2026-10-01T09:10:00.000Z' });
      h.db.seed('conversation_sessions', [finished(frenchEn), finished(darijaFr), finished(darijaFr), finished(darijaFr), { ...finished(frenchEn), turn_count: 1 }]);
      h.db.seed('transcripts', [{ qa_state: 'reviewed', updated_at: '2026-10-01T12:00:00.000Z' }, { qa_state: 'approved', updated_at: '2026-10-02T12:00:00.000Z' }]);
      h.db.seed('ai_requests', [{ task: 'transcription_alignment', provider: 'openrouter', model: 'openai/whisper-large-v3', input_tokens: null, output_tokens: null, audio_seconds: 60, estimated_cost_usd: 0.4, user_id: null, enrollment_id: null, created_at: '2026-10-01T12:00:00.000Z' }]);
      const all = (await get('cost')).json.data;
      expect(all.usdPerMeaningfulConversation).toBeCloseTo(0.75 / 4, 10); // STT 0.5 + dialogue 0.25 over 4 meaningful sessions
      expect(all.usdPerReviewedLesson).toBeCloseTo(0.2, 10); // 0.4 alignment over 2 reviewed transcripts
      const french = (await get('cost', '&trackId=french')).json.data;
      expect(french.usdPerMeaningfulConversation).toBeCloseTo(0.5, 10); // French cost over the 1 French session, not all 4
      expect(french.usdPerReviewedLesson).toBeNull(); // alignment cost carries no enrollment: no honest scoped figure (not $0)
      const fromFrench = (await get('cost', '&sourceLanguage=fr')).json.data;
      expect(fromFrench.usdPerMeaningfulConversation).toBeCloseTo(0.25 / 3, 10);
      const german = (await get('cost', '&trackId=german')).json.data;
      expect(german).toMatchObject({ totalUsd: 0, usdPerMeaningfulConversation: null, usdPerReviewedLesson: null, estimatedUsdPerActiveLearner: null, learnerUsd: 0, staffAndJobsUsd: null, unattributedUsd: null, activeLearners: 0 });
    });

    it('scopes rows through the embedded enrollment (no per-id lookups) and never reads a failed read as zero', async () => {
      const many = h.db.seed('user_course_enrollments', Array.from({ length: 250 }, () => enrollmentRow(LEARNER_2, 'french', { source_language_code: 'en' })));
      h.db.seed('ai_requests', many.map((e) => ({ task: 'character_dialogue', provider: 'openrouter', model: 'fake/dialogue', input_tokens: 1, output_tokens: 1, audio_seconds: null, estimated_cost_usd: 0.01, user_id: LEARNER_2, enrollment_id: e.id, created_at: '2026-10-01T12:00:00.000Z' })));
      const res = await get('cost', '&trackId=french');
      expect(res.status).toBe(200);
      expect(res.json.data.totalUsd).toBeCloseTo(0.5 + 2.5, 10);
      expect(h.db.requests.filter((r) => r.target === 'user_course_enrollments')).toEqual([]); // the join runs in SQL
      const requestReads = h.db.requests.filter((r) => r.target === 'ai_requests');
      expect(requestReads.every((r) => (new URLSearchParams(r.query).get('select') ?? '').includes('user_course_enrollments(course_track_id,source_language_code)'))).toBe(true);

      h.db.fail('ai_requests', { status: 500, code: 'XX000', message: 'connection reset' });
      for (const panel of ['cost', 'errors']) {
        const failed = await get(panel, '&trackId=french');
        expect(failed.status, panel).toBe(500);
        expect(failed.json.error.code).toBe('internal');
      }
    });

    it('a failed count is a 500, not a measured zero', async () => {
      h.db.fail('transcripts', { status: 500, code: '57014', message: 'canceling statement due to statement timeout' });
      const failed = await get('cost');
      expect(failed.status).toBe(500);
      expect(failed.json.error.code).toBe('internal');
      expect((await get('cost', '&trackId=french')).status).toBe(200); // the scoped view has no per-lesson figure, so it never counts transcripts
    });
  });

  it('usage: series from stored activity, concurrent-session peaks, per-track enrollments, null retention without a cohort', async () => {
    h.db.seed('streak_activity', [
      { user_id: LEARNER, activity_date: '2026-10-01', minutes_active: 10, speaking_seconds: 120 },
      { user_id: LEARNER_2, activity_date: '2026-10-01', minutes_active: 0, speaking_seconds: 30 },
      { user_id: LEARNER, activity_date: '2026-10-02', minutes_active: 5, speaking_seconds: 60 },
    ]);
    h.db.seed('conversation_sessions', [
      { user_id: LEARNER, enrollment_id: frenchEn.id, started_at: '2026-10-01T10:00:00.000Z', ended_at: '2026-10-01T10:30:00.000Z' },
      { user_id: LEARNER_2, enrollment_id: frenchEn.id, started_at: '2026-10-01T10:15:00.000Z', ended_at: '2026-10-01T10:45:00.000Z' },
      { user_id: LEARNER, enrollment_id: darijaFr.id, started_at: '2026-10-02T08:00:00.000Z', ended_at: null },
    ]);
    h.db.seed('mission_attempts', [{ completed_at: '2026-10-01T12:00:00.000Z', enrollment_id: frenchEn.id }, { completed_at: '2026-10-01T13:00:00.000Z', enrollment_id: frenchEn.id }, { completed_at: '2026-10-02T13:00:00.000Z', enrollment_id: darijaFr.id }]);
    h.db.seed('user_audio_progress', [{ user_id: LEARNER, updated_at: '2026-10-02T09:00:00.000Z', position_ms: 61_000 }]);
    h.db.seed('user_download_manifests', [{ downloaded_at: '2026-10-02T09:00:00.000Z' }, { downloaded_at: null }]);
    const res = await get('usage');
    expect(res.status).toBe(200);
    const parsed = apiEnvelope(AnalyticsUsageResponseSchema).parse(res.json);
    if (!parsed.ok) throw new Error('expected ok');
    const values = (s: { value: number }[]) => s.map((p) => p.value);
    expect(values(parsed.data.activeLearners)).toEqual([1, 1]);
    expect(values(parsed.data.speakingSeconds)).toEqual([150, 60]);
    expect(values(parsed.data.concurrentVoiceSessionsPeak)).toEqual([2, 1]);
    expect(values(parsed.data.missionsCompleted)).toEqual([2, 1]);
    expect(values(parsed.data.audioListenSeconds)).toEqual([0, 61]);
    expect(values(parsed.data.downloadsCompleted)).toEqual([0, 1]);
    expect(parsed.data.retentionD7).toBeNull();
    expect(parsed.data.retentionD30).toBeNull();
    const french = parsed.data.byTrack.find((t) => t.trackId === 'french');
    expect(french).toEqual({ trackId: 'french', activeLearners: 2, enrollmentsBySource: [{ sourceLanguage: 'en', count: 2 }] }); // the archived one is not active
    const filtered = await get('usage', '&trackId=arabic-moroccan');
    expect(filtered.json.data.byTrack).toEqual([{ trackId: 'arabic-moroccan', activeLearners: 1, enrollmentsBySource: [{ sourceLanguage: 'fr', count: 1 }] }]);
    expect(values(filtered.json.data.missionsCompleted)).toEqual([0, 1]);
  });

  describe('errors', () => {
    beforeEach(() => {
      const at = (i: number) => `2026-10-02T10:${String(i).padStart(2, '0')}:00.000Z`;
      h.db.seed('ai_requests', [
        ...Array.from({ length: 6 }, (_, i) => ({ task: 'speech_recognition', provider: 'openrouter', success: false, error_code: i < 2 ? 'timeout' : 'server_error', fallback_index: 0, latency_ms: 1000 + i, estimated_cost_usd: 0.001, enrollment_id: frenchEn.id, created_at: at(i) })),
        ...Array.from({ length: 3 }, (_, i) => ({ task: 'character_dialogue', provider: 'openrouter', success: true, error_code: null, fallback_index: i === 0 ? 1 : 0, latency_ms: 500, estimated_cost_usd: 0.001, enrollment_id: darijaFr.id, created_at: at(10 + i) })),
        { task: 'speech_synthesis', provider: 'openrouter', success: true, error_code: null, fallback_index: 0, latency_ms: 800, estimated_cost_usd: 0.001, enrollment_id: frenchEn.id, created_at: at(20) },
        { task: 'speech_synthesis', provider: 'openrouter', success: true, error_code: null, fallback_index: 0, latency_ms: 900, estimated_cost_usd: 0.001, enrollment_id: null, created_at: '2026-10-01T09:00:00.000Z' },
      ]);
      h.db.seed('processing_jobs', [
        { job_type: 'transcode', state: 'failed', failure_code: 'ffmpeg', created_at: '2026-10-01T08:00:00.000Z' },
        { job_type: 'verify', state: 'succeeded', failure_code: null, created_at: '2026-10-01T08:00:00.000Z' },
        { job_type: 'extract_metadata', state: 'review_needed', failure_code: null, created_at: '2026-10-02T08:00:00.000Z' },
        { job_type: 'describe', state: 'failed', failure_code: 'x', created_at: '2026-10-02T08:00:00.000Z' },
      ]);
      h.db.seed('learning_observations', [
        { enrollment_id: frenchEn.id, utterance_confidence: 0.9, observed_at: '2026-10-01T10:00:00.000Z' },
        { enrollment_id: frenchEn.id, utterance_confidence: 0.7, observed_at: '2026-10-02T10:00:00.000Z' },
        { enrollment_id: darijaFr.id, utterance_confidence: 0.5, observed_at: '2026-10-02T10:00:00.000Z' },
      ]);
      h.db.seed('content_rights', [
        { expires_at: new Date(Date.now() + 10 * DAY_MS).toISOString() },
        { expires_at: new Date(Date.now() + 60 * DAY_MS).toISOString() },
        { expires_at: null },
      ]);
    });

    it('reports error rates, provider failures, timeouts, media failures, STT confidence and operator alerts', async () => {
      const res = await get('errors');
      expect(res.status).toBe(200);
      const parsed = apiEnvelope(AnalyticsErrorsResponseSchema).parse(res.json);
      if (!parsed.ok) throw new Error('expected ok');
      const d = parsed.data;
      expect(d.apiErrorRate).toEqual([{ period: '2026-10-01', value: 0 }, { period: '2026-10-02', value: 0.6 }]);
      expect(d.providerFailures).toEqual(expect.arrayContaining([{ provider: 'openrouter', task: 'speech_recognition', failures: 6, fallbacksUsed: 0 }, { provider: 'openrouter', task: 'character_dialogue', failures: 0, fallbacksUsed: 1 }]));
      expect(d.providerFailures).toHaveLength(2); // speech_synthesis had neither failures nor fallbacks
      expect(d.timeouts).toBe(2);
      expect(d.mediaFailureRate).toBeCloseTo(2 / 3, 10); // transcode failed + extract_metadata needs review, of 3 media jobs
      expect(d.downloadFailureRate).toBeNull();
      expect(d.sttConfidenceByTrack).toEqual(expect.arrayContaining([{ trackId: 'french', meanConfidence: expect.closeTo(0.8, 10), languageMismatchRate: null }, { trackId: 'arabic-moroccan', meanConfidence: 0.5, languageMismatchRate: null }]));
      expect(d.alerts.map((a) => a.kind).sort()).toEqual(['provider_outage', 'rights_expiry']);
      expect(d.alerts.find((a) => a.kind === 'provider_outage')?.detail).toContain('6/10');
    });

    it('latency: AI-audio p95 comes from learner audio-producing requests only (no probes, smoke tests or jobs); unrecorded latencies stay null', async () => {
      h.db.seed('ai_requests', [
        { task: 'speech_synthesis', provider: 'openrouter', success: true, error_code: null, fallback_index: 0, latency_ms: 5_000, estimated_cost_usd: 0.001, user_id: ADMIN, enrollment_id: null, redacted_log: { purpose: 'admin_model_test', actor: 'staff' }, created_at: '2026-10-02T11:00:00.000Z' },
        { task: 'realtime_conversation', provider: 'openrouter', success: true, error_code: null, fallback_index: 0, latency_ms: 7_000, estimated_cost_usd: 0.001, user_id: null, enrollment_id: frenchEn.id, redacted_log: { jobId: crypto.randomUUID() }, created_at: '2026-10-02T11:01:00.000Z' },
      ]);
      const d = (await get('errors')).json.data;
      // Only the learner synthesis (800 ms) counts: the 900 ms row has no enrollment (a Studio speech probe), the 5 s row
      // is a staff smoke test and the 7 s row a job.
      expect(d.latency).toEqual({ apiP95Ms: null, timeToFirstAiAudioP95Ms: 800, interruptionLatencyP95Ms: null, mediaStartP99Ms: null });
      // Provider health still counts every request: 6 failures over the 12 requests of 2026-10-02.
      expect(d.apiErrorRate).toEqual([{ period: '2026-10-01', value: 0 }, { period: '2026-10-02', value: 0.5 }]);
      expect(d.truncated).toEqual([]);
    });

    it('applies the track and source filters the dashboard sends to every panel', async () => {
      const french = (await get('errors', '&trackId=french')).json.data;
      expect(french.apiErrorRate).toEqual([{ period: '2026-10-01', value: 0 }, { period: '2026-10-02', value: 6 / 7 }]);
      expect(french.providerFailures).toEqual([{ provider: 'openrouter', task: 'speech_recognition', failures: 6, fallbacksUsed: 0 }]);
      expect(french.sttConfidenceByTrack.map((t: { trackId: string }) => t.trackId)).toEqual(['french']);
      const fromFrench = (await get('errors', '&sourceLanguage=fr')).json.data;
      expect(fromFrench.timeouts).toBe(0);
      expect(fromFrench.providerFailures).toEqual([{ provider: 'openrouter', task: 'character_dialogue', failures: 0, fallbacksUsed: 1 }]);
      expect(fromFrench.sttConfidenceByTrack).toEqual([{ trackId: 'arabic-moroccan', meanConfidence: 0.5, languageMismatchRate: null }]);
    });
  });

  describe('past the 1000-row PostgREST cap', () => {
    const DAY1 = '2026-10-01T10:00:00.000Z';
    const DAY2 = '2026-10-02T10:00:00.000Z';
    const many = (n: number, row: (i: number) => DbRow) => Array.from({ length: n }, (_, i) => row(i));
    /** No response carried more than max_rows, and no read was cut (no header, an empty `truncated` list). */
    const expectExactReads = (res: { headers: Headers; json: { data: { truncated?: unknown } } }) => {
      expect(probe.maxRowsServed).toBeLessThanOrEqual(ANALYTICS_PAGE_ROWS);
      expect(res.headers.get(ANALYTICS_TRUNCATED_HEADER)).toBeNull();
      expect(res.json.data.truncated).toEqual([]);
    };

    it('allocatePages serves the smallest reads in full and never exceeds the budget', () => {
      expect(allocatePages([0, 1, 40], 25)).toEqual([0, 1, 24]);
      expect(allocatePages([20, 20], 25)).toEqual([12, 13]);
      expect(allocatePages([3, 2], 25)).toEqual([3, 2]);
      expect(allocatePages([30, 2, 30], 25)).toEqual([11, 2, 12]);
      expect(allocatePages([5, 5], 0)).toEqual([0, 0]);
    });

    it('cost: totals, per-task counts, storage and per-unit costs are exact over thousands of rows', async () => {
      const frenchMany = h.db.seed('user_course_enrollments', many(1_200, (i) => enrollmentRow(i % 2 ? LEARNER : LEARNER_2, 'french', { source_language_code: 'en' })));
      h.db.seed('ai_requests', [
        ...many(2_600, (i) =>
          i % 2 === 0
            ? { task: 'character_dialogue', provider: 'openrouter', model: 'fake/dialogue', input_tokens: 3, output_tokens: 2, audio_seconds: null, estimated_cost_usd: 0.01, user_id: frenchMany[i % 1_200]!.user_id, enrollment_id: frenchMany[i % 1_200]!.id, created_at: DAY1 }
            : { task: 'speech_recognition', provider: 'other-stt', model: 'fake/stt', input_tokens: null, output_tokens: null, audio_seconds: 2, estimated_cost_usd: 0.02, user_id: LEARNER, enrollment_id: darijaFr.id, created_at: DAY2 },
        ),
        // Alignment runs as a job: the job cost ledger tags it with `redacted_log.jobId`.
        { task: 'transcription_alignment', provider: 'openrouter', model: 'fake/align', input_tokens: null, output_tokens: null, audio_seconds: 600, estimated_cost_usd: 10.5, user_id: null, enrollment_id: null, redacted_log: { jobId: crypto.randomUUID() }, created_at: DAY1 },
      ]);
      h.db.seed('media_assets', [...many(1_500, () => mediaAssetRow({ byte_length: 2_000_000 })), mediaAssetRow({ byte_length: 9e9, disposition: 'quarantined' })]);
      h.db.seed('conversation_sessions', many(1_100, (i) => ({ user_id: LEARNER_2, enrollment_id: frenchMany[i]!.id, state: 'finished', turn_count: 3, started_at: DAY1, ended_at: DAY1 })));
      h.db.seed('transcripts', many(1_050, () => ({ qa_state: 'reviewed', updated_at: DAY2 })));

      const res = await get('cost');
      expect(res.status).toBe(200);
      expectExactReads(res);
      const d = apiEnvelope(AnalyticsCostResponseSchema).parse(res.json);
      if (!d.ok) throw new Error('expected ok');
      expect(d.data.totalUsd).toBeCloseTo(13 + 26 + 10.5, 6);
      expect(d.data.byTask).toEqual(
        expect.arrayContaining([
          { task: 'character_dialogue', requests: 1_300, tokens: 6_500, audioSeconds: 0, usd: expect.closeTo(13, 6) },
          { task: 'speech_recognition', requests: 1_300, tokens: 0, audioSeconds: 2_600, usd: expect.closeTo(26, 6) },
        ]),
      );
      expect(d.data.byProvider).toEqual(expect.arrayContaining([{ provider: 'other-stt', usd: expect.closeTo(26, 6) }]));
      expect(d.data.timeline.map((p) => p.value)).toEqual([expect.closeTo(23.5, 6), expect.closeTo(26, 6)]);
      expect(d.data.storageGb).toBeCloseTo(3, 9); // 1 500 active assets x 2 MB; the quarantined one is not stored media
      expect(d.data.usdPerMeaningfulConversation).toBeCloseTo(39 / 1_100, 9);
      expect(d.data.usdPerReviewedLesson).toBeCloseTo(10.5 / 1_050, 9);
      // Learner spend (13 + 26) over the 2 learners; the alignment row is a job row, so it is not learner spend.
      expect(d.data.estimatedUsdPerActiveLearner).toBeCloseTo(39 / 2, 9);
      expect(d.data).toMatchObject({ learnerUsd: expect.closeTo(39, 6), staffAndJobsUsd: expect.closeTo(10.5, 6), unattributedUsd: 0, activeLearners: 2 });
      expect([...(probe.offsets.ai_requests ?? [])].sort((a, b) => a - b)).toEqual([0, 1_000, 2_000]); // paged, not one capped read
      // What the former single `.limit(50_000)` read received from this server: the first 1000 rows, total 2601.
      const unpaged = await h.db.handle(new Request('http://fake.supabase/rest/v1/ai_requests?select=id&limit=50000', { headers: { prefer: 'count=exact' } }));
      expect(((await unpaged.json()) as unknown[]).length).toBe(1_000);
      expect(unpaged.headers.get('content-range')).toBe('0-999/2601');

      const french = await get('cost', '&trackId=french');
      expectExactReads(french);
      expect(french.json.data.totalUsd).toBeCloseTo(13, 6);
      expect(french.json.data.usdPerMeaningfulConversation).toBeCloseTo(13 / 1_100, 9); // 1 100 scoped sessions, read in 2 pages
      expect((await get('cost', '&sourceLanguage=fr')).json.data.totalUsd).toBeCloseTo(26, 6);
    });

    it('quality: fractions, takedowns, false-correction rates, completion and alignment are exact over thousands of rows', async () => {
      h.db.seed('expressions', [...many(1_200, (i) => ({ state: i % 2 ? 'approved' : 'published', reviewed: i < 900 })), ...many(1_100, () => ({ state: 'review_needed', reviewed: true }))]);
      h.db.seed('media_assets', [...many(1_500, (i) => mediaAssetRow({ content_rights: { verified: i < 600 } })), mediaAssetRow({ disposition: 'quarantined' }), mediaAssetRow({ disposition: 'quarantined' })]);
      const frenchMany = h.db.seed('user_course_enrollments', many(2_200, () => enrollmentRow(LEARNER_2, 'french', { source_language_code: 'en' })));
      h.db.seed('feedback_reports', [
        ...many(1_100, (i) => ({ status: 'open', category: 'false_correction', enrollment_id: frenchMany[i]!.id, course_track_id: null })),
        ...many(1_050, () => ({ status: 'open', category: 'offensive', enrollment_id: null, course_track_id: null })),
        ...many(1_000, () => ({ status: 'resolved', category: 'wrong_dialect', enrollment_id: null, course_track_id: null })),
      ]);
      h.db.seed('mission_progress', [...many(1_000, (i) => ({ first_completed_at: DAY1, completed_without_hints: i < 250 })), ...many(500, () => ({ first_completed_at: DAY2, completed_without_hints: true }))]);
      h.db.seed('transcript_segments', [...many(650, () => ({ confidence: 0.9 })), ...many(650, () => ({ confidence: 0.5 })), ...many(10, () => ({ confidence: null }))]);

      const res = await get('quality');
      expect(res.status).toBe(200);
      expectExactReads(res);
      const parsed = apiEnvelope(AnalyticsQualityResponseSchema).parse(res.json);
      if (!parsed.ok) throw new Error('expected ok');
      const d = parsed.data;
      expect(d.nativeReviewedFraction).toBe(0.75);
      expect(d.rightsCoverageFraction).toBe(0.4);
      expect(d.unresolvedTakedowns).toBe(1_052);
      expect(d.transcriptAlignmentQuality).toBeCloseTo(0.7, 9);
      expect(d.missionCompletionWithoutHints).toEqual([{ period: '2026-10-01', value: 0.25 }, { period: '2026-10-02', value: 1 }]);
      expect(d.falseCorrectionRateByTrack.find((r) => r.trackId === 'french')?.rate).toBeCloseTo(1_100 / 2_203, 9); // + the 3 base French enrollments
      expect((await get('quality', '&trackId=french')).json.data.falseCorrectionRateByTrack).toEqual([{ trackId: 'french', rate: expect.closeTo(1_100 / 2_203, 9) }]);
    });

    it('usage: active learners, peaks, missions and per-track enrollments are exact over thousands of rows', async () => {
      h.db.seed('streak_activity', many(1_500, () => ({ user_id: crypto.randomUUID(), activity_date: '2026-10-01', minutes_active: 5, speaking_seconds: 10 })));
      h.db.seed('conversation_sessions', many(1_200, () => ({ user_id: LEARNER, enrollment_id: frenchEn.id, started_at: '2026-10-01T10:00:00.000Z', ended_at: '2026-10-01T10:30:00.000Z' })));
      h.db.seed('mission_attempts', many(1_100, () => ({ completed_at: DAY2, enrollment_id: darijaFr.id })));
      h.db.seed('user_course_enrollments', [...many(1_500, () => enrollmentRow(crypto.randomUUID(), 'french', { source_language_code: 'fr' })), ...many(1_000, () => enrollmentRow(crypto.randomUUID(), 'french', { source_language_code: 'fr', status: 'archived' }))]);

      const res = await get('usage');
      expect(res.status).toBe(200);
      expectExactReads(res);
      const parsed = apiEnvelope(AnalyticsUsageResponseSchema).parse(res.json);
      if (!parsed.ok) throw new Error('expected ok');
      const values = (s: { value: number }[]) => s.map((p) => p.value);
      expect(values(parsed.data.activeLearners)).toEqual([1_500, 0]);
      expect(values(parsed.data.speakingSeconds)).toEqual([15_000, 0]);
      expect(values(parsed.data.concurrentVoiceSessionsPeak)).toEqual([1_200, 0]);
      expect(values(parsed.data.missionsCompleted)).toEqual([0, 1_100]);
      expect(parsed.data.byTrack.find((t) => t.trackId === 'french')).toEqual({ trackId: 'french', activeLearners: 1_502, enrollmentsBySource: expect.arrayContaining([{ sourceLanguage: 'en', count: 2 }, { sourceLanguage: 'fr', count: 1_500 }]) });

      const frenchFromFrench = (await get('usage', '&trackId=french&sourceLanguage=fr')).json.data;
      expect(frenchFromFrench.byTrack).toEqual([{ trackId: 'french', activeLearners: 1_500, enrollmentsBySource: [{ sourceLanguage: 'fr', count: 1_500 }] }]);
      expect(values(frenchFromFrench.concurrentVoiceSessionsPeak)).toEqual([0, 0]); // the sessions belong to an English-source enrollment
      expect(values((await get('usage', '&trackId=arabic-moroccan')).json.data.missionsCompleted)).toEqual([0, 1_100]);
    });

    it('errors: rates, timeouts, job failure counts, STT confidence and latency are exact over thousands of rows', async () => {
      h.db.seed('ai_requests', [
        ...many(800, (i) => ({ task: 'speech_recognition', provider: 'openrouter', success: false, error_code: i < 300 ? 'timeout' : 'server_error', fallback_index: 0, latency_ms: 2_000, estimated_cost_usd: 0, enrollment_id: frenchEn.id, created_at: DAY2 })),
        ...many(600, (i) => ({ task: 'speech_synthesis', provider: 'openrouter', success: true, error_code: null, fallback_index: 0, latency_ms: i + 1, estimated_cost_usd: 0, enrollment_id: darijaFr.id, created_at: DAY2 })),
      ]);
      h.db.seed('processing_jobs', [
        ...many(1_200, (i) => ({ job_type: 'transcode', state: i < 400 ? 'failed' : 'succeeded', failure_code: null, created_at: DAY1 })),
        ...many(30, () => ({ job_type: 'describe', state: 'failed', failure_code: 'x', created_at: DAY1 })),
      ]);
      h.db.seed('learning_observations', many(1_100, () => ({ enrollment_id: frenchEn.id, utterance_confidence: 0.6, observed_at: DAY1 })));

      const res = await get('errors');
      expect(res.status).toBe(200);
      expectExactReads(res);
      const parsed = apiEnvelope(AnalyticsErrorsResponseSchema).parse(res.json);
      if (!parsed.ok) throw new Error('expected ok');
      const d = parsed.data;
      expect(d.apiErrorRate).toEqual([{ period: '2026-10-01', value: 0 }, { period: '2026-10-02', value: expect.closeTo(800 / 1_400, 9) }]);
      expect(d.timeouts).toBe(300);
      expect(d.providerFailures).toEqual([{ provider: 'openrouter', task: 'speech_recognition', failures: 800, fallbacksUsed: 0 }]);
      expect(d.mediaFailureRate).toBeCloseTo(400 / 1_200, 9);
      expect(d.latency.timeToFirstAiAudioP95Ms).toBe(571); // sorted 1..600, index floor(600 x 0.95)
      expect(d.sttConfidenceByTrack).toEqual([{ trackId: 'french', meanConfidence: expect.closeTo(0.6, 9), languageMismatchRate: null }]);
      expect(d.alerts.find((a) => a.kind === 'provider_outage')?.detail).toContain('800/1400');
      expect(d.alerts.find((a) => a.kind === 'attack')?.detail).toContain('430 processing jobs failed');
    });

    it('past the page bound the cut is declared in a header (and the small reads still complete)', async () => {
      const N = (ANALYTICS_EXTRA_PAGE_BUDGET + 1) * ANALYTICS_PAGE_ROWS + 500;
      h.db.seed('ai_requests', many(N, () => ({ task: 'character_dialogue', provider: 'openrouter', model: 'fake/dialogue', input_tokens: 1, output_tokens: 1, audio_seconds: null, estimated_cost_usd: 0.01, user_id: LEARNER, enrollment_id: frenchEn.id, created_at: DAY1 })));
      h.db.seed('media_assets', many(1_500, () => mediaAssetRow({ byte_length: 1_000_000 })));
      const res = await get('cost');
      expect(res.status).toBe(200);
      // media_assets needs 1 extra page and gets it; ai_requests gets the rest of the budget on top of its first page.
      const aiPages = 1 + (ANALYTICS_EXTRA_PAGE_BUDGET - 1);
      expect(res.headers.get(ANALYTICS_TRUNCATED_HEADER)).toBe(`ai_requests=${aiPages * ANALYTICS_PAGE_ROWS}/${N}`);
      expect(res.json.data.truncated).toEqual([{ read: 'ai_requests', fetched: aiPages * ANALYTICS_PAGE_ROWS, total: N }]); // the same cut, in the body
      expect(probe.offsets.ai_requests).toHaveLength(aiPages);
      expect(res.json.data.storageGb).toBeCloseTo(1.5, 9); // the small read is exact
    });

    it('the Studio in the browser can read the truncation: the header is CORS-exposed and the body lists the same cut', async () => {
      h.db.seed('ai_requests', many((ANALYTICS_EXTRA_PAGE_BUDGET + 1) * ANALYTICS_PAGE_ROWS + 10, () => ({ task: 'character_dialogue', provider: 'openrouter', model: 'fake/dialogue', input_tokens: 1, output_tokens: 1, audio_seconds: null, estimated_cost_usd: 0.01, user_id: LEARNER, enrollment_id: frenchEn.id, created_at: DAY1 })));
      const res = await h.call(`/v1/admin/analytics/cost?${RANGE}`, { token: admin, headers: { origin: STUDIO_ORIGIN } });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe(STUDIO_ORIGIN);
      const exposed = (res.headers.get('access-control-expose-headers') ?? '').split(',').map((name) => name.trim().toLowerCase());
      expect(exposed).toContain(ANALYTICS_TRUNCATED_HEADER);
      const cut = res.json.data.truncated as { read: string; fetched: number; total: number }[];
      expect(cut).toHaveLength(1);
      expect(res.headers.get(ANALYTICS_TRUNCATED_HEADER)).toBe(cut.map((r) => `${r.read}=${r.fetched}/${r.total}`).join(', '));
      // An origin outside the allowlist gets no CORS headers at all (the exposure is not a way around the allowlist).
      const elsewhere = await h.call(`/v1/admin/analytics/cost?${RANGE}`, { token: admin, headers: { origin: 'https://evil.example' } });
      expect(elsewhere.headers.get('access-control-allow-origin')).toBeNull();
      expect(elsewhere.headers.get('access-control-expose-headers')).toBeNull();
    });

    it('a server cap below 1000 rows is detected as a cut, never passed off as a full count', async () => {
      postgrestSemantics(h.db, 500); // a deployment configured with max_rows = 500
      h.db.seed('ai_requests', many(1_200, () => ({ task: 'character_dialogue', provider: 'openrouter', model: 'fake/dialogue', input_tokens: 1, output_tokens: 1, audio_seconds: null, estimated_cost_usd: 0.01, user_id: LEARNER, enrollment_id: frenchEn.id, created_at: DAY1 })));
      const res = await get('cost');
      expect(res.status).toBe(200);
      expect(res.headers.get(ANALYTICS_TRUNCATED_HEADER)).toBe('ai_requests=700/1200');
      expect(res.json.data.truncated).toEqual([{ read: 'ai_requests', fetched: 700, total: 1_200 }]);
    });
  });
});
