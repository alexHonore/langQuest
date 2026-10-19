/**
 * Load script for the manifest (cacheable GET) and progress-sync (idempotent POST) traffic classes (§4.6, §14.3).
 * fetch-based (autocannon is not a workspace dependency), with concurrency knobs; documented in load/README.md and
 * NEVER run in CI. Usage: `pnpm --filter @langquest/tests load -- --base-url=http://localhost:8787 --token=... --enrollment=...`
 */
import { buildReport, parseOptions, syncPayload, type Sample } from './lib';

async function main(): Promise<void> {
  const options = parseOptions(process.env, process.argv.slice(2));
  if (!options.token) {
    console.error('LOAD_TOKEN (a learner access token from the target stack) is required; manifest and sync are learner routes.');
    process.exit(2);
  }
  if (options.syncShare > 0 && !options.enrollmentId) {
    console.error('LOAD_ENROLLMENT_ID is required when LOAD_SYNC_SHARE > 0 (sync events need an owned enrollment).');
    process.exit(2);
  }
  const headers = { authorization: `Bearer ${options.token}`, 'content-type': 'application/json' };
  const manifestUrl = `${options.baseUrl}/v1/courses/${encodeURIComponent(options.trackId)}/manifest?source=${encodeURIComponent(options.source)}`;
  const syncUrl = `${options.baseUrl}/v1/me/progress/sync`;
  const samples: Sample[] = [];
  const startedAt = new Date();
  const endAt = startedAt.getTime() + (options.warmupSeconds + options.durationSeconds) * 1000;
  const warmupUntil = startedAt.getTime() + options.warmupSeconds * 1000;
  let etag: string | null = null;

  const worker = async (index: number): Promise<void> => {
    let revision = 1;
    const deviceId = `load-${index}-${startedAt.getTime()}`;
    while (Date.now() < endAt) {
      const isSync = Math.random() < options.syncShare;
      const t0 = performance.now();
      let sample: Sample;
      try {
        const res = isSync
          ? await fetch(syncUrl, { method: 'POST', headers, body: JSON.stringify(syncPayload(options.enrollmentId!, deviceId, revision)) })
          : await fetch(manifestUrl, { headers: etag ? { ...headers, 'if-none-match': etag } : headers });
        if (!isSync && res.headers.get('etag')) etag = res.headers.get('etag');
        await res.arrayBuffer();
        sample = { route: isSync ? 'sync' : 'manifest', status: res.status, latencyMs: performance.now() - t0, cache: res.headers.get('x-cache'), error: null };
        revision += 2;
      } catch (error) {
        sample = { route: isSync ? 'sync' : 'manifest', status: 0, latencyMs: performance.now() - t0, cache: null, error: error instanceof Error ? error.message : String(error) };
      }
      if (Date.now() >= warmupUntil) samples.push(sample);
    }
  };

  console.error(`load: ${options.concurrency} workers × ${options.durationSeconds}s (+${options.warmupSeconds}s warm-up) against ${options.baseUrl}`);
  await Promise.all(Array.from({ length: options.concurrency }, (_, i) => worker(i)));
  const elapsed = (Date.now() - warmupUntil) / 1000;
  const report = buildReport(options, samples, startedAt, elapsed);
  console.log(JSON.stringify(report, null, 2));
  if (report.routes.some((r) => r.count > 0 && r.errors / r.count > 0.05)) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
