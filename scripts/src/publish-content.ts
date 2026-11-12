#!/usr/bin/env tsx
/**
 * publish-content — publishes the app's content and voice clips to the content bucket, a public Supabase Storage
 * bucket on the instance (`langquest-content` on https://sb-languest.tayoo.app by default). The Flutter app reads it
 * (apps/mobile_flutter/lib/core/content/content_source.dart) instead of carrying the content inside the app.
 *
 * Layout of the bucket:
 * - `index.json`: which object holds each content file (`content/chapters/spanish-spain.json` →
 *   `content/chapters/spanish-spain.<hash>.json`). Written last, and never cached, so the app always sees a whole
 *   release.
 * - `content/…`: the files of `apps/mobile_flutter/assets/content` (catalog, skills, cast, examples, each course's
 *   chapters and voices), named by their content: a name never changes meaning, so devices and browsers keep them for
 *   good.
 * - `audio/lines/<voice>-<hash>.mp3` (the course lines' clips) and `audio/tatoeba/<id>.mp3`: already named by content.
 *
 * Only what the bucket does not have yet is uploaded. Without `--apply` it only says what it would do.
 *
 * Needs the instance's anon key (`SUPABASE_ANON_KEY`, else read from the web app's public `config.json`) and its
 * service-role key (`SUPABASE_SERVICE_ROLE_KEY`, or a network secret the session's proxy adds for the host). Keys are
 * never printed.
 *
 * Usage: pnpm --filter @langquest/scripts publish-content [-- --apply] [-- --concurrency 8]
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { flagBool, flagNumber, flagString, isDirectRun, runCli, type CliIo, type CliSpec, type ParsedArgs } from './lib/cli';
import { fileExists, repoRoot } from './lib/io';
import { BUNDLE_DIR } from './lib/flutter-bundle';

export const DEFAULT_SUPABASE_URL = 'https://sb-languest.tayoo.app';
export const DEFAULT_BUCKET = 'langquest-content';
export const DEFAULT_WEB_CONFIG = 'https://web-languest.tayoo.app/config.json';
const AUDIO_DIR = 'apps/mobile_flutter/assets/audio';

/** Content files the app does not read (the inputs the per-course files are split from). */
const NOT_PUBLISHED = new Set(['voices.json']);

export const spec: CliSpec = {
  name: 'publish-content',
  summary: 'Publish the app content and voice clips to the content bucket (Supabase Storage on the instance), uploading only what it lacks.',
  flags: [
    { name: 'apply', type: 'boolean', description: 'Upload (without it, only report what would be uploaded).', default: false },
    { name: 'url', type: 'string', description: `The Supabase instance (default ${DEFAULT_SUPABASE_URL}).` },
    { name: 'bucket', type: 'string', description: `The bucket (default ${DEFAULT_BUCKET}).` },
    { name: 'concurrency', type: 'number', description: 'Parallel uploads.', default: 8 },
  ],
  examples: ['publish-content', 'publish-content -- --apply'],
};

/** One object of the bucket: its name, where its bytes are, and how it is served. */
export interface PlannedObject {
  name: string;
  path: string;
  contentType: string;
  cacheControl: string;
}

export const IMMUTABLE = 'public, max-age=31536000, immutable';

/** `content/chapters/spanish-spain.json` → `content/chapters/spanish-spain.<12 hex of its sha-256>.json`. */
export function contentObjectName(file: string, bytes: Buffer): string {
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  return file.replace(/\.json$/, `.${hash}.json`);
}

function walk(dir: string): string[] {
  if (!fileExists(dir)) return [];
  return readdirSync(dir)
    .sort()
    .flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
}

/** The objects of a release and its index (repository path without `assets/` → object name). Pure but for reads. */
export function planRelease(root: string): { objects: PlannedObject[]; index: Record<string, string> } {
  const objects: PlannedObject[] = [];
  const index: Record<string, string> = {};
  const contentDir = resolve(root, BUNDLE_DIR);
  for (const path of walk(contentDir).filter((p) => p.endsWith('.json'))) {
    const rel = relative(contentDir, path).split('\\').join('/');
    if (NOT_PUBLISHED.has(rel)) continue;
    const key = `content/${rel}`;
    const name = contentObjectName(key, readFileSync(path));
    index[key] = name;
    objects.push({ name, path, contentType: 'application/json; charset=utf-8', cacheControl: IMMUTABLE });
  }
  const audioDir = resolve(root, AUDIO_DIR);
  for (const path of walk(audioDir).filter((p) => p.endsWith('.mp3'))) {
    objects.push({ name: `audio/${relative(audioDir, path).split('\\').join('/')}`, path, contentType: 'audio/mpeg', cacheControl: IMMUTABLE });
  }
  return { objects, index };
}

export function indexDocument(index: Record<string, string>, now: Date): string {
  const files = Object.fromEntries(Object.entries(index).sort(([a], [b]) => a.localeCompare(b)));
  return `${JSON.stringify({ schemaVersion: 1, generatedBy: 'scripts/src/publish-content.ts', publishedAt: now.toISOString(), files }, null, 2)}\n`;
}

interface Storage {
  base: string;
  headers: Record<string, string>;
}

async function anonKey(): Promise<string> {
  const fromEnv = process.env.SUPABASE_ANON_KEY || process.env.LQ_SUPABASE_ANON_KEY;
  if (fromEnv) return fromEnv;
  const res = await fetch(DEFAULT_WEB_CONFIG);
  const json = (await res.json()) as { supabaseAnonKey?: string };
  if (!json.supabaseAnonKey) throw new Error('No anon key: set SUPABASE_ANON_KEY');
  return json.supabaseAnonKey;
}

async function ensureBucket(s: Storage, bucket: string, apply: boolean, io: CliIo): Promise<void> {
  const res = await fetch(`${s.base}/storage/v1/bucket/${bucket}`, { headers: s.headers });
  if (res.ok) {
    const b = (await res.json()) as { public?: boolean };
    if (!b.public) throw new Error(`bucket ${bucket} exists but is not public: the app reads it without a key`);
    return;
  }
  if (!apply) {
    io.log(`dry-run: would create the public bucket ${bucket}`);
    return;
  }
  const created = await fetch(`${s.base}/storage/v1/bucket`, {
    method: 'POST',
    headers: { ...s.headers, 'content-type': 'application/json' },
    body: JSON.stringify({ id: bucket, name: bucket, public: true, file_size_limit: 20 * 1024 * 1024 }),
  });
  if (!created.ok) throw new Error(`creating bucket ${bucket}: HTTP ${created.status} ${(await created.text()).slice(0, 200)}`);
  io.log(`created the public bucket ${bucket}`);
}

/** Every object name under [prefix] (folders listed recursively). */
async function listAll(s: Storage, bucket: string, prefix: string): Promise<string[]> {
  const names: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${s.base}/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      headers: { ...s.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (res.status === 404 || res.status === 400) return names;
    if (!res.ok) throw new Error(`listing ${prefix}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const page = (await res.json()) as { name: string; id: string | null }[];
    for (const e of page) {
      const full = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id === null) names.push(...(await listAll(s, bucket, full)));
      else names.push(full);
    }
    if (page.length < 1000) return names;
  }
}

async function upload(s: Storage, bucket: string, name: string, body: Buffer, contentType: string, cacheControl: string, upsert: boolean): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${s.base}/storage/v1/object/${bucket}/${name.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST',
      headers: { ...s.headers, 'content-type': contentType, 'cache-control': cacheControl, 'x-upsert': upsert ? 'true' : 'false' },
      body: new Uint8Array(body),
    });
    if (res.ok) return;
    const text = await res.text();
    // Already there (an earlier, interrupted run): the same name is the same bytes.
    if (!upsert && (res.status === 409 || /already exists|Duplicate/i.test(text))) return;
    if (attempt < 3 && (res.status >= 500 || res.status === 429)) {
      await new Promise((done) => setTimeout(done, 1000 * attempt));
      continue;
    }
    throw new Error(`uploading ${name}: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
}

export async function main(args: ParsedArgs, io: CliIo): Promise<number> {
  const root = repoRoot();
  const apply = flagBool(args, 'apply');
  const bucket = flagString(args, 'bucket') ?? DEFAULT_BUCKET;
  const base = (flagString(args, 'url') ?? process.env.SUPABASE_URL ?? DEFAULT_SUPABASE_URL).replace(/\/$/, '');
  const { objects, index } = planRelease(root);
  const bytes = objects.reduce((n, o) => n + statSync(o.path).size, 0);
  io.log(`release: ${Object.keys(index).length} content files and ${objects.length - Object.keys(index).length} clips (${(bytes / 1048576).toFixed(1)} MB)`);
  if (args.dryRun) return 0;

  const s: Storage = { base, headers: { apikey: await anonKey(), authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || 'proxy-injected'}` } };
  await ensureBucket(s, bucket, apply, io);
  const existing = new Set([...(await listAll(s, bucket, 'content')), ...(await listAll(s, bucket, 'audio'))]);
  const todo = objects.filter((o) => !existing.has(o.name));
  const todoBytes = todo.reduce((n, o) => n + statSync(o.path).size, 0);
  io.log(`${existing.size} objects already in ${bucket}; ${todo.length} to upload (${(todoBytes / 1048576).toFixed(1)} MB)`);
  if (!apply) {
    io.log('dry-run: nothing uploaded (add --apply)');
    return 0;
  }
  const queue = [...todo];
  let done = 0;
  const workers = Array.from({ length: Math.max(1, flagNumber(args, 'concurrency') ?? 8) }, async () => {
    for (let o = queue.shift(); o; o = queue.shift()) {
      await upload(s, bucket, o.name, readFileSync(o.path), o.contentType, o.cacheControl, false);
      done += 1;
      if (done % 250 === 0) io.log(`  ${done}/${todo.length}`);
    }
  });
  await Promise.all(workers);
  // Last, so the app only ever sees an index whose files are all there.
  await upload(s, bucket, 'index.json', Buffer.from(indexDocument(index, new Date())), 'application/json; charset=utf-8', 'no-cache', true);
  io.log(`uploaded ${todo.length} objects and index.json to ${base}/storage/v1/object/public/${bucket}/`);
  return 0;
}

if (isDirectRun(import.meta.url)) {
  runCli(spec, process.argv.slice(2), main).then((code) => {
    process.exitCode = code;
  });
}
