import 'server-only';
import { JOB_STATE_VALUES, CONTENT_STATE_VALUES, type JobState, type ContentState } from '@langquest/contracts';
import { db, safe } from './index';

export interface DashboardData {
  jobs: Record<JobState, number>;
  assetsByState: Record<ContentState, number>;
  pendingReviews: { lessons: number; transcripts: number; translations: number; visual: number; total: number };
  rightsUnverified: number;
  recentUploads: Array<{ id: string; original_filename: string; status: string; declared_byte_length: number; created_at: string; failure_code: string | null }>;
  coverage: Array<{ status: string; count: number }>;
  costToday: { ok: boolean; usd: number; requests: number; unpriced: number; error: string | null };
}

const countBy = <K extends string>(rows: readonly { [key: string]: unknown }[], key: string, values: readonly K[]): Record<K, number> => {
  const out = Object.fromEntries(values.map((v) => [v, 0])) as Record<K, number>;
  for (const r of rows) {
    const v = r[key] as K;
    if (v in out) out[v] += 1;
  }
  return out;
};

export async function loadDashboard(): Promise<DashboardData> {
  const client = await db();
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);

  const [jobs, assets, lessonsReview, transcriptsReview, translationsReview, visualReview, rights, uploads, coverage, cost] = await Promise.all([
    safe(() => client.from('processing_jobs').select('state').limit(5000)),
    safe(() => client.from('media_assets').select('state').limit(5000)),
    client.from('audio_lessons').select('id', { count: 'exact', head: true }).eq('state', 'review_needed'),
    client.from('transcripts').select('id', { count: 'exact', head: true }).eq('qa_state', 'needs_review'),
    client.from('transcript_translations').select('id', { count: 'exact', head: true }).eq('qa_state', 'needs_review'),
    client.from('visual_assets').select('id', { count: 'exact', head: true }).eq('review_status', 'review_needed'),
    client.from('media_assets').select('id', { count: 'exact', head: true }).is('content_rights_id', null).neq('kind', 'document'),
    safe(() => client.from('uploads').select('id, original_filename, status, declared_byte_length, created_at, failure_code').order('created_at', { ascending: false }).limit(8)),
    safe(() => client.from('course_source_localizations').select('status').limit(2000)),
    safe(() => client.from('ai_requests').select('estimated_cost_usd').gte('created_at', since.toISOString()).limit(10000)),
  ]);

  const coverageCounts = new Map<string, number>();
  if (coverage.ok) for (const r of coverage.data) coverageCounts.set(r.status, (coverageCounts.get(r.status) ?? 0) + 1);

  let costToday: DashboardData['costToday'] = { ok: false, usd: 0, requests: 0, unpriced: 0, error: null };
  if (cost.ok) {
    let usd = 0;
    let unpriced = 0;
    for (const r of cost.data) {
      if (r.estimated_cost_usd == null) unpriced += 1;
      else usd += Number(r.estimated_cost_usd);
    }
    costToday = { ok: true, usd, requests: cost.data.length, unpriced, error: null };
  } else costToday = { ok: false, usd: 0, requests: 0, unpriced: 0, error: cost.forbidden ? 'forbidden' : cost.error };

  const lessons = lessonsReview.count ?? 0;
  const transcripts = transcriptsReview.count ?? 0;
  const translations = translationsReview.count ?? 0;
  const visual = visualReview.count ?? 0;
  return {
    jobs: countBy(jobs.ok ? jobs.data : [], 'state', JOB_STATE_VALUES),
    assetsByState: countBy(assets.ok ? assets.data : [], 'state', CONTENT_STATE_VALUES),
    pendingReviews: { lessons, transcripts, translations, visual, total: lessons + transcripts + translations + visual },
    rightsUnverified: rights.count ?? 0,
    recentUploads: uploads.ok ? uploads.data : [],
    coverage: [...coverageCounts.entries()].map(([status, count]) => ({ status, count })),
    costToday,
  };
}
