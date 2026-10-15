/**
 * §6.4 bulk imports (§7.2, A19): reconcile an R2 prefix populated by rclone into import candidates, and apply
 * CSV/JSON label manifests. Both default to `dryRun: true` and report what WOULD happen; the real work is a
 * `processing_jobs` row (`import_prefix` / `import_manifest`) executed by the Node runner, never in the Worker.
 */
import { ImportManifestRequestSchema, ImportManifestResponseSchema, ImportManifestRowSchema, ImportR2PrefixRequestSchema, ImportR2PrefixResponseSchema, type ImportManifestRow } from '@langquest/contracts';
import { parseCsvManifest, parseJsonManifest, reconcilePrefix, type PrefixObject } from '@langquest/media/imports';
import type { DefineRoute } from '../../app';
import { problem, respondOk } from '../../http/envelope';
import { parseBody } from '../../http/validate';
import { uuidFrom } from '../../lib/learning';
import type { RequestServices } from '../../services/context';
import { R2_UNAVAILABLE_MESSAGE } from '../../services/r2';

const MAX_LISTED_OBJECTS = 10_000;
const MAX_SIDECAR_BYTES = 5 * 1024 * 1024;

async function listPrefix(s: RequestServices, prefix: string): Promise<PrefixObject[]> {
  const out: PrefixObject[] = [];
  let cursor: string | null = null;
  do {
    const page = await s.media.list(prefix, cursor, 1000);
    for (const o of page.objects) out.push({ key: o.key, byteLength: o.size, etag: o.etag, lastModified: o.lastModified });
    cursor = page.cursor;
  } while (cursor && out.length < MAX_LISTED_OBJECTS);
  return out;
}

async function readTextObject(s: RequestServices, key: string): Promise<string> {
  const head = await s.media.head(key);
  if (!head) throw problem.notFound(`Object ${key}`);
  if (head.size > MAX_SIDECAR_BYTES) throw problem.tooLarge('Manifest object exceeds 5 MiB');
  const bytes = await s.media.readBytes(key, 0, head.size - 1);
  if (!bytes) throw problem.notFound(`Object ${key}`);
  return new TextDecoder().decode(bytes);
}

function parseManifestText(format: 'csv' | 'json', text: string) {
  return format === 'csv' ? parseCsvManifest(text) : parseJsonManifest(text);
}

export function registerImportRoutes(define: DefineRoute): void {
  define('adminImportR2Prefix', { role: 'contentEditor', timeoutMs: 55_000 }, async (c) => {
    const body = await parseBody(c, ImportR2PrefixRequestSchema);
    const s = c.get('services')!;
    const { principal } = s.requireUser();
    if (!s.media.available) throw problem.unsupported(R2_UNAVAILABLE_MESSAGE);
    const objects = await listPrefix(s, body.prefix);
    let sidecarRows: ImportManifestRow[] = [];
    let sidecarErrors = 0;
    if (body.manifestKey) {
      const text = await readTextObject(s, body.manifestKey);
      const parsed = parseManifestText(body.manifestKey.toLowerCase().endsWith('.csv') ? 'csv' : 'json', text);
      sidecarRows = parsed.rows;
      sidecarErrors = parsed.errors.length;
    }
    const known = await s.service.from('media_assets').select('storage_key, legacy_path').or(`storage_key.like.${body.prefix}%,legacy_path.like.${body.prefix}%`).limit(10_000);
    const knownKeys = new Set<string>();
    for (const k of known.data ?? []) {
      knownKeys.add(k.storage_key);
      if (k.legacy_path) knownKeys.add(k.legacy_path);
    }
    const reconciled = reconcilePrefix(objects, { prefix: body.prefix, sidecarRows, knownKeys, defaults: { targetVarietyId: undefined, instructionLanguage: body.defaultInstructionLanguage, collectionId: body.defaultCollectionId } });
    const sidecars = reconciled.entries.filter((e) => e.parsed.isSidecar).length;
    const unsupported = reconciled.entries.filter((e) => e.status === 'skipped' && !e.parsed.isSidecar).length;
    const discovered = { objects: objects.length, audio: reconciled.entries.filter((e) => e.parsed.isAudio).length, sidecars, alreadyImported: reconciled.summary.known, unsupported };
    const sample = reconciled.entries.filter((e) => e.status === 'new').slice(0, 50).map((e) => ({ key: e.key, byteLength: e.byteLength, inferred: { ...e.merged.values, provenance: e.merged.provenance, inheritFolderMetadata: body.inheritFolderMetadata } as Record<string, unknown> }));
    let jobId = uuidFrom(`import-plan:${principal.userId}:${body.idempotencyKey}`);
    if (!body.dryRun) {
      const job = await s.repos.processingJobs.enqueue({ jobType: 'import_prefix', idempotencyKey: `import_prefix:${body.idempotencyKey}`, requestedBy: principal.userId, params: { prefix: body.prefix, manifestKey: body.manifestKey ?? null, inheritFolderMetadata: body.inheritFolderMetadata, defaults: { trackId: body.defaultTrackId ?? null, instructionLanguage: body.defaultInstructionLanguage ?? null, collectionId: body.defaultCollectionId ?? null }, entries: reconciled.entries.filter((e) => e.status === 'new').slice(0, MAX_LISTED_OBJECTS).map((e) => ({ key: e.key, byteLength: e.byteLength, values: e.merged.values })) } });
      jobId = job.id;
      s.audit({ action: 'import.r2_prefix', entityTable: 'processing_jobs', entityId: job.id, after: { prefix: body.prefix, discovered, sidecarErrors } });
    }
    return respondOk(c, ImportR2PrefixResponseSchema.parse({ jobId, dryRun: body.dryRun, discovered, sample }), body.dryRun ? 200 : 202);
  });

  define('adminImportManifest', { role: 'contentEditor', timeoutMs: 55_000, bodyLimitBytes: 8 * 1024 * 1024 }, async (c) => {
    const body = await parseBody(c, ImportManifestRequestSchema);
    const s = c.get('services')!;
    const { principal } = s.requireUser();
    let rows: ImportManifestRow[] = body.rows ?? [];
    const validationErrors: { row: number; field: string; message: string }[] = [];
    if (body.uploadId) {
      const upload = await s.service.from('uploads').select('storage_key, status, declared_mime_type').eq('id', body.uploadId).maybeSingle();
      if (!upload.data) throw problem.notFound('Upload');
      if (upload.data.status !== 'completed' && upload.data.status !== 'verified') throw problem.precondition('The manifest upload is not complete');
      const parsed = parseManifestText(body.format, await readTextObject(s, upload.data.storage_key));
      rows = parsed.rows;
      validationErrors.push(...parsed.errors.slice(0, 200));
    }
    const checked: ImportManifestRow[] = [];
    rows.forEach((row, i) => {
      const r = ImportManifestRowSchema.safeParse(row);
      if (r.success) checked.push(r.data);
      else validationErrors.push({ row: i, field: r.error.issues[0]?.path.join('.') ?? '', message: r.error.issues[0]?.message ?? 'invalid' });
    });
    const keys = checked.map((r) => r.storageKey).filter((v): v is string => Boolean(v));
    const paths = checked.map((r) => r.legacyPath).filter((v): v is string => Boolean(v));
    const ids = checked.map((r) => r.assetId).filter((v): v is string => Boolean(v));
    const [byKey, byPath, byId] = await Promise.all([
      keys.length ? s.service.from('media_assets').select('id, storage_key').in('storage_key', keys).then((r) => r.data ?? []) : Promise.resolve([]),
      paths.length ? s.service.from('media_assets').select('id, legacy_path').in('legacy_path', paths).then((r) => r.data ?? []) : Promise.resolve([]),
      ids.length ? s.service.from('media_assets').select('id').in('id', ids).then((r) => r.data ?? []) : Promise.resolve([]),
    ]);
    const keySet = new Set(byKey.map((a) => a.storage_key));
    const pathSet = new Set(byPath.map((a) => a.legacy_path));
    const idSet = new Set(byId.map((a) => a.id));
    const unmatched: { row: number; reason: string }[] = [];
    let matched = 0;
    checked.forEach((r, i) => {
      if ((r.assetId && idSet.has(r.assetId)) || (r.storageKey && keySet.has(r.storageKey)) || (r.legacyPath && pathSet.has(r.legacyPath))) matched += 1;
      else unmatched.push({ row: i, reason: 'no media asset matches storageKey, legacyPath or assetId' });
    });
    let jobId = uuidFrom(`import-manifest-plan:${principal.userId}:${body.idempotencyKey}`);
    if (!body.dryRun) {
      const job = await s.repos.processingJobs.enqueue({ jobType: 'import_manifest', idempotencyKey: `import_manifest:${body.idempotencyKey}`, requestedBy: principal.userId, params: { format: body.format, uploadId: body.uploadId ?? null, rows: checked } });
      jobId = job.id;
      s.audit({ action: 'import.manifest', entityTable: 'processing_jobs', entityId: job.id, after: { rowCount: checked.length, matched, unmatched: unmatched.length } });
    }
    return respondOk(c, ImportManifestResponseSchema.parse({ jobId, dryRun: body.dryRun, rowCount: checked.length, matched, unmatched: unmatched.slice(0, 200), validationErrors: validationErrors.slice(0, 200) }), body.dryRun ? 200 : 202);
  });
}
