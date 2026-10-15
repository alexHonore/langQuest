/**
 * LIVE transcription smoke test — runs ONLY with `LANGQUEST_LIVE_TESTS=1` and a real `OPENROUTER_API_KEY`
 * (CONVENTIONS §7). A 3-second clip is synthesised locally with macOS `say` (free) and sent through the
 * real `transcribe` handler → OpenRouter STT. Spend is a fraction of a cent.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildMasterKey, sha256HexSync } from '@langquest/media';
import { readJobsEnv } from '../config';
import { transcribeHandler } from '../handlers/transcribe';
import { createJobServices } from '../services';
import type { MemoryJobsDb } from '../test-support/memory-db';
import { createTestServices, runHandler, type TestServices } from '../test-support/fakes';

function loadRootEnv(): Record<string, string> {
  const path = resolve(import.meta.dirname, '../../../../.env');
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!.replace(/^"|"$/g, '');
  }
  return out;
}

const live = process.env.LANGQUEST_LIVE_TESTS === '1';
const apiKey = process.env.OPENROUTER_API_KEY ?? loadRootEnv().OPENROUTER_API_KEY;
const sayAvailable = process.platform === 'darwin' && existsSync('/usr/bin/say');
const describeLive = live && apiKey && sayAvailable ? describe : describe.skip;
if (!live) console.warn('[jobs live] LANGQUEST_LIVE_TESTS is not set; skipping the OpenRouter transcription test.');

describeLive('live transcription (OpenRouter STT)', () => {
  let t: TestServices;
  beforeAll(async () => {
    t = await createTestServices();
  });
  afterAll(() => t?.cleanup());

  it('transcribes a 3-second English TTS clip end-to-end and records the cost', async () => {
    const aiff = join(t.root, 'clip.aiff');
    const said = spawnSync('/usr/bin/say', ['-v', 'Samantha', '-o', aiff, 'Good morning. I would like a coffee, please.'], { encoding: 'utf8' });
    expect(said.status).toBe(0);
    const wav = join(t.root, 'clip.wav');
    await t.ffmpeg.run({ bin: 'ffmpeg', args: ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-i', aiff, '-ac', '1', '-ar', '16000', '-t', '3.5', '-c:a', 'pcm_s16le', wav] });
    const bytes = new Uint8Array(await readFile(wav));
    const checksum = sha256HexSync(bytes);
    const id = crypto.randomUUID();
    const key = buildMasterKey({ assetId: id, contentHash: checksum, mimeType: 'audio/wav' });
    await t.store.put(key, bytes, { contentType: 'audio/wav' });
    const db = t.db as MemoryJobsDb;
    db.seedAsset({ id, storage_key: key, checksum_sha256: checksum, mime_type: 'audio/wav', byte_length: bytes.byteLength });
    const lesson = db.seedLesson(db.seedChapter(db.seedCollection().id).id, { target_variety_id: 'en' });
    await db.attachLessonAsset({ lesson_id: lesson.id, asset_id: id, asset_type: 'master' });

    // Real AI adapters, everything else offline.
    const env = readJobsEnv({ ...process.env, OPENROUTER_API_KEY: apiKey, OBJECT_STORE: 'local', LOCAL_OBJECT_STORE_DIR: join(t.root, 'store'), JOBS_WORK_DIR: join(t.root, 'work'), JOBS_TELEMETRY: 'none', JOBS_AUTO_CHAIN: 'false' });
    const real = await createJobServices({ env, offline: true, db, store: t.store, ffmpeg: t.ffmpeg, log: t.services.log });
    const liveT: TestServices = { ...t, services: { ...real, events: t.services.events } };

    const { result, ctx } = await runHandler(transcribeHandler, liveT, { chain: false }, { parent_asset_id: id });
    const out = result.output as Record<string, unknown>;
    expect(out.transcriptId).toBeTruthy();
    const segments = await db.listSegments(out.transcriptId as string);
    const text = segments.map((s) => s.text).join(' ').toLowerCase();
    expect(text).toMatch(/coffee/);
    expect(out.provider).toBe('openrouter');
    const cost = ctx.cost.summary();
    expect(cost.aiCalls).toBeGreaterThanOrEqual(1);
    expect(cost.usd).toBeLessThan(0.05);
    console.warn(`[jobs live] model=${String(out.model)} segments=${segments.length} usd=${cost.usd} text="${text}"`);
  }, 120_000);
});
