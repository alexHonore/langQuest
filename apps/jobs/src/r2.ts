/**
 * Object storage for the job runner (§4.4): Cloudflare R2 through its S3-compatible endpoint via
 * `@aws-sdk/client-s3` (get / put / head / list / copy / delete / multipart) plus presigned GET/PUT URLs,
 * and a **dev-only** filesystem store with the same interface for tests and local runs without R2.
 *
 * Object keys are always the hashed keys from `@langquest/media` (`media/…`, `derived/…`, `public/…`,
 * `uploads/…`) or the import prefix an operator pointed rclone at — never user filenames.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, type Dirent } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  UploadPartCopyCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { JobsEnv } from './config';
import { objectStoreKind } from './config';

export interface ObjectHead {
  key: string;
  byteLength: number;
  contentType: string | null;
  etag: string | null;
  lastModified: string | null;
}

export interface ObjectListing {
  objects: ObjectHead[];
  truncated: boolean;
}

export interface PutOptions {
  contentType?: string;
  /** Opaque metadata stored with the object (S3 user metadata; sidecar JSON for the local store). */
  metadata?: Record<string, string>;
}

export interface MultipartUploadHandle {
  key: string;
  uploadId: string;
}

/** Storage backend used by every handler. Implementations must be safe to call concurrently. */
export interface ObjectStore {
  readonly kind: 'r2' | 'local';
  readonly bucket: string;
  head(key: string): Promise<ObjectHead | null>;
  /** Stream an object; `null` when it does not exist. */
  getStream(key: string): Promise<{ stream: Readable; head: ObjectHead } | null>;
  getBytes(key: string): Promise<Uint8Array | null>;
  /** Download to a local path (streams; never buffers large audio in memory). */
  getToFile(key: string, path: string): Promise<ObjectHead>;
  put(key: string, body: Uint8Array | string, options?: PutOptions): Promise<ObjectHead>;
  putFile(key: string, path: string, options?: PutOptions): Promise<ObjectHead>;
  copy(fromKey: string, toKey: string, options?: PutOptions): Promise<ObjectHead>;
  delete(key: string): Promise<void>;
  list(prefix: string, options?: { limit?: number; continuationToken?: string | null }): Promise<ObjectListing & { continuationToken: string | null }>;
  /** Every object under a prefix (follows pagination). */
  listAll(prefix: string, options?: { maxObjects?: number }): Promise<ObjectHead[]>;
  createMultipart(key: string, options?: PutOptions): Promise<MultipartUploadHandle>;
  uploadPart(handle: MultipartUploadHandle, partNumber: number, body: Uint8Array): Promise<{ partNumber: number; etag: string }>;
  completeMultipart(handle: MultipartUploadHandle, parts: Array<{ partNumber: number; etag: string }>): Promise<ObjectHead>;
  abortMultipart(handle: MultipartUploadHandle): Promise<void>;
  presignGet(key: string, ttlSeconds: number, options?: { downloadFilename?: string }): Promise<string>;
  presignPut(key: string, ttlSeconds: number, options?: { contentType?: string }): Promise<string>;
}

/** Thrown for malformed keys; the local store also uses it to refuse path traversal. */
export class ObjectKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ObjectKeyError';
  }
}

const KEY_RE = /^(?!\/)(?!.*(^|\/)\.\.(\/|$))[^\u0000]{1,1024}$/;
export function assertObjectKey(key: string): string {
  if (typeof key !== 'string' || !KEY_RE.test(key) || key.includes('\\')) throw new ObjectKeyError(`Invalid object key: ${JSON.stringify(key)}`);
  return key;
}

const toIso = (d: Date | undefined): string | null => (d ? d.toISOString() : null);

// ---------------------------------------------------------------------------------------------
// R2 (S3-compatible)
// ---------------------------------------------------------------------------------------------

export interface R2ObjectStoreOptions {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Injected for tests. */
  client?: S3Client;
}

/** Cloudflare R2 through the S3 API. Region is always `auto` for R2. */
export class R2ObjectStore implements ObjectStore {
  readonly kind = 'r2' as const;
  readonly bucket: string;
  readonly client: S3Client;

  constructor(options: R2ObjectStoreOptions) {
    this.bucket = options.bucket;
    this.client =
      options.client ??
      new S3Client({
        region: 'auto',
        endpoint: options.endpoint,
        credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
        // R2 does not support the newer flexible checksum headers on every operation.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
  }

  async head(key: string): Promise<ObjectHead | null> {
    assertObjectKey(key);
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { key, byteLength: res.ContentLength ?? 0, contentType: res.ContentType ?? null, etag: res.ETag ?? null, lastModified: toIso(res.LastModified) };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async getStream(key: string): Promise<{ stream: Readable; head: ObjectHead } | null> {
    assertObjectKey(key);
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!res.Body) return null;
      const body = res.Body as Readable | ReadableStream<Uint8Array>;
      const stream = body instanceof Readable ? body : Readable.fromWeb(body as never);
      return { stream, head: { key, byteLength: res.ContentLength ?? 0, contentType: res.ContentType ?? null, etag: res.ETag ?? null, lastModified: toIso(res.LastModified) } };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async getBytes(key: string): Promise<Uint8Array | null> {
    const got = await this.getStream(key);
    if (!got) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of got.stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return new Uint8Array(Buffer.concat(chunks));
  }

  async getToFile(key: string, path: string): Promise<ObjectHead> {
    const got = await this.getStream(key);
    if (!got) throw new Error(`Object not found: ${key}`);
    await mkdir(dirname(path), { recursive: true });
    await pipeline(got.stream, createWriteStream(path));
    return got.head;
  }

  async put(key: string, body: Uint8Array | string, options: PutOptions = {}): Promise<ObjectHead> {
    assertObjectKey(key);
    const bytes = typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body);
    const res = await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: options.contentType, ContentLength: bytes.byteLength, Metadata: options.metadata }));
    return { key, byteLength: bytes.byteLength, contentType: options.contentType ?? null, etag: res.ETag ?? null, lastModified: new Date().toISOString() };
  }

  async putFile(key: string, path: string, options: PutOptions = {}): Promise<ObjectHead> {
    assertObjectKey(key);
    const info = await stat(path);
    const res = await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: createReadStream(path), ContentLength: info.size, ContentType: options.contentType, Metadata: options.metadata }));
    return { key, byteLength: info.size, contentType: options.contentType ?? null, etag: res.ETag ?? null, lastModified: new Date().toISOString() };
  }

  /** Server-side copy; objects above 5 GiB use multipart copy (S3 CopyObject limit). */
  async copy(fromKey: string, toKey: string, options: PutOptions = {}): Promise<ObjectHead> {
    assertObjectKey(fromKey);
    assertObjectKey(toKey);
    const source = await this.head(fromKey);
    if (!source) throw new Error(`Object not found: ${fromKey}`);
    const copySource = `${this.bucket}/${encodeURIComponent(fromKey).replace(/%2F/g, '/')}`;
    const FIVE_GIB = 5 * 1024 ** 3;
    if (source.byteLength <= FIVE_GIB) {
      await this.client.send(
        new CopyObjectCommand({ Bucket: this.bucket, Key: toKey, CopySource: copySource, ContentType: options.contentType ?? source.contentType ?? undefined, MetadataDirective: options.contentType || options.metadata ? 'REPLACE' : 'COPY', Metadata: options.metadata }),
      );
    } else {
      const handle = await this.createMultipart(toKey, { contentType: options.contentType ?? source.contentType ?? undefined, metadata: options.metadata });
      const partSize = 256 * 1024 ** 2;
      const parts: Array<{ partNumber: number; etag: string }> = [];
      try {
        for (let offset = 0, n = 1; offset < source.byteLength; offset += partSize, n += 1) {
          const end = Math.min(offset + partSize, source.byteLength) - 1;
          const res = await this.client.send(new UploadPartCopyCommand({ Bucket: this.bucket, Key: toKey, UploadId: handle.uploadId, PartNumber: n, CopySource: copySource, CopySourceRange: `bytes=${offset}-${end}` }));
          parts.push({ partNumber: n, etag: res.CopyPartResult?.ETag ?? '' });
        }
        await this.completeMultipart(handle, parts);
      } catch (error) {
        await this.abortMultipart(handle).catch(() => {});
        throw error;
      }
    }
    return (await this.head(toKey)) ?? { ...source, key: toKey };
  }

  async delete(key: string): Promise<void> {
    assertObjectKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async list(prefix: string, options: { limit?: number; continuationToken?: string | null } = {}): Promise<ObjectListing & { continuationToken: string | null }> {
    const res = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, MaxKeys: Math.min(options.limit ?? 1000, 1000), ContinuationToken: options.continuationToken ?? undefined }));
    const objects = (res.Contents ?? []).filter((o) => o.Key).map((o) => ({ key: o.Key!, byteLength: o.Size ?? 0, contentType: null, etag: o.ETag ?? null, lastModified: toIso(o.LastModified) }));
    return { objects, truncated: Boolean(res.IsTruncated), continuationToken: res.NextContinuationToken ?? null };
  }

  async listAll(prefix: string, options: { maxObjects?: number } = {}): Promise<ObjectHead[]> {
    const max = options.maxObjects ?? 200_000;
    const out: ObjectHead[] = [];
    let token: string | null = null;
    do {
      const page: ObjectListing & { continuationToken: string | null } = await this.list(prefix, { continuationToken: token });
      out.push(...page.objects);
      token = page.truncated ? page.continuationToken : null;
    } while (token && out.length < max);
    return out.slice(0, max);
  }

  async createMultipart(key: string, options: PutOptions = {}): Promise<MultipartUploadHandle> {
    assertObjectKey(key);
    const res = await this.client.send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: options.contentType, Metadata: options.metadata }));
    if (!res.UploadId) throw new Error('R2 did not return an UploadId');
    return { key, uploadId: res.UploadId };
  }

  async uploadPart(handle: MultipartUploadHandle, partNumber: number, body: Uint8Array): Promise<{ partNumber: number; etag: string }> {
    const res = await this.client.send(new UploadPartCommand({ Bucket: this.bucket, Key: handle.key, UploadId: handle.uploadId, PartNumber: partNumber, Body: Buffer.from(body), ContentLength: body.byteLength }));
    return { partNumber, etag: res.ETag ?? '' };
  }

  async completeMultipart(handle: MultipartUploadHandle, parts: Array<{ partNumber: number; etag: string }>): Promise<ObjectHead> {
    await this.client.send(
      new CompleteMultipartUploadCommand({ Bucket: this.bucket, Key: handle.key, UploadId: handle.uploadId, MultipartUpload: { Parts: [...parts].sort((a, b) => a.partNumber - b.partNumber).map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) } }),
    );
    const head = await this.head(handle.key);
    if (!head) throw new Error(`Completed multipart upload but object is missing: ${handle.key}`);
    return head;
  }

  async abortMultipart(handle: MultipartUploadHandle): Promise<void> {
    await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: handle.key, UploadId: handle.uploadId }));
  }

  async presignGet(key: string, ttlSeconds: number, options: { downloadFilename?: string } = {}): Promise<string> {
    assertObjectKey(key);
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseContentDisposition: options.downloadFilename ? `attachment; filename="${options.downloadFilename.replace(/["\\\r\n]/g, '_')}"` : undefined });
    return getSignedUrl(this.client, cmd, { expiresIn: ttlSeconds });
  }

  async presignPut(key: string, ttlSeconds: number, options: { contentType?: string } = {}): Promise<string> {
    assertObjectKey(key);
    return getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: options.contentType }), { expiresIn: ttlSeconds });
  }
}

function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
}

// ---------------------------------------------------------------------------------------------
// Local filesystem store — DEV / TEST ONLY
// ---------------------------------------------------------------------------------------------

/**
 * **Dev-only** object store backed by a directory. Used by unit tests and by local runs when R2 is not
 * enabled on the Cloudflare account yet (docs/runbooks/provisioning.md). Presigned URLs are `file://`
 * URLs: they carry no signature and must never be handed to a client.
 */
export class LocalFsObjectStore implements ObjectStore {
  readonly kind = 'local' as const;
  readonly bucket: string;
  readonly root: string;
  private readonly multipart = new Map<string, { key: string; parts: Map<number, Uint8Array>; options: PutOptions }>();

  constructor(root: string, bucket = 'local') {
    this.root = resolve(root);
    this.bucket = bucket;
  }

  private pathFor(key: string): string {
    assertObjectKey(key);
    const full = resolve(this.root, key);
    if (full !== this.root && !full.startsWith(this.root + sep)) throw new ObjectKeyError(`Key escapes the store root: ${key}`);
    return full;
  }

  private metaPath(key: string): string {
    return `${this.pathFor(key)}.__meta.json`;
  }

  private async readMeta(key: string): Promise<{ contentType: string | null; metadata: Record<string, string> }> {
    try {
      return JSON.parse(await readFile(this.metaPath(key), 'utf8'));
    } catch {
      return { contentType: null, metadata: {} };
    }
  }

  private async writeMeta(key: string, options: PutOptions): Promise<void> {
    await writeFile(this.metaPath(key), JSON.stringify({ contentType: options.contentType ?? null, metadata: options.metadata ?? {} }));
  }

  private etagFor(bytes: Uint8Array): string {
    return `"${createHash('md5').update(bytes).digest('hex')}"`;
  }

  async head(key: string): Promise<ObjectHead | null> {
    const path = this.pathFor(key);
    try {
      const info = await stat(path);
      if (!info.isFile()) return null;
      const meta = await this.readMeta(key);
      return { key, byteLength: info.size, contentType: meta.contentType, etag: null, lastModified: info.mtime.toISOString() };
    } catch {
      return null;
    }
  }

  async getStream(key: string): Promise<{ stream: Readable; head: ObjectHead } | null> {
    const head = await this.head(key);
    if (!head) return null;
    return { stream: createReadStream(this.pathFor(key)), head };
  }

  async getBytes(key: string): Promise<Uint8Array | null> {
    const head = await this.head(key);
    if (!head) return null;
    return new Uint8Array(await readFile(this.pathFor(key)));
  }

  async getToFile(key: string, path: string): Promise<ObjectHead> {
    const got = await this.getStream(key);
    if (!got) throw new Error(`Object not found: ${key}`);
    await mkdir(dirname(path), { recursive: true });
    await pipeline(got.stream, createWriteStream(path));
    return got.head;
  }

  async put(key: string, body: Uint8Array | string, options: PutOptions = {}): Promise<ObjectHead> {
    const path = this.pathFor(key);
    const bytes = typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body);
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.__tmp_${process.pid}_${Date.now()}`;
    await writeFile(tmp, bytes);
    await rename(tmp, path);
    await this.writeMeta(key, options);
    return { key, byteLength: bytes.byteLength, contentType: options.contentType ?? null, etag: this.etagFor(bytes), lastModified: new Date().toISOString() };
  }

  async putFile(key: string, sourcePath: string, options: PutOptions = {}): Promise<ObjectHead> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.__tmp_${process.pid}_${Date.now()}`;
    await pipeline(createReadStream(sourcePath), createWriteStream(tmp));
    await rename(tmp, path);
    await this.writeMeta(key, options);
    const info = await stat(path);
    return { key, byteLength: info.size, contentType: options.contentType ?? null, etag: null, lastModified: info.mtime.toISOString() };
  }

  async copy(fromKey: string, toKey: string, options: PutOptions = {}): Promise<ObjectHead> {
    const head = await this.head(fromKey);
    if (!head) throw new Error(`Object not found: ${fromKey}`);
    const meta = await this.readMeta(fromKey);
    return this.putFile(toKey, this.pathFor(fromKey), { contentType: options.contentType ?? meta.contentType ?? undefined, metadata: options.metadata ?? meta.metadata });
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
    await rm(this.metaPath(key), { force: true });
  }

  async list(prefix: string, options: { limit?: number; continuationToken?: string | null } = {}): Promise<ObjectListing & { continuationToken: string | null }> {
    const all = await this.listAll(prefix);
    const start = options.continuationToken ? Number.parseInt(options.continuationToken, 10) : 0;
    const limit = options.limit ?? 1000;
    const page = all.slice(start, start + limit);
    const truncated = start + limit < all.length;
    return { objects: page, truncated, continuationToken: truncated ? String(start + limit) : null };
  }

  async listAll(prefix: string, options: { maxObjects?: number } = {}): Promise<ObjectHead[]> {
    const out: ObjectHead[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries: Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile() && !entry.name.endsWith('.__meta.json') && !entry.name.includes('.__tmp_')) {
          const key = relative(this.root, full).split(sep).join('/');
          if (!key.startsWith(prefix)) continue;
          const info = await stat(full);
          const meta = await this.readMeta(key);
          out.push({ key, byteLength: info.size, contentType: meta.contentType, etag: null, lastModified: info.mtime.toISOString() });
        }
      }
    };
    await walk(this.root);
    out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return out.slice(0, options.maxObjects ?? 200_000);
  }

  async createMultipart(key: string, options: PutOptions = {}): Promise<MultipartUploadHandle> {
    assertObjectKey(key);
    const uploadId = `local-${createHash('sha1').update(`${key}:${Date.now()}:${Math.random()}`).digest('hex')}`;
    this.multipart.set(uploadId, { key, parts: new Map(), options });
    return { key, uploadId };
  }

  async uploadPart(handle: MultipartUploadHandle, partNumber: number, body: Uint8Array): Promise<{ partNumber: number; etag: string }> {
    const mp = this.multipart.get(handle.uploadId);
    if (!mp) throw new Error(`Unknown multipart upload ${handle.uploadId}`);
    mp.parts.set(partNumber, new Uint8Array(body));
    return { partNumber, etag: this.etagFor(body) };
  }

  async completeMultipart(handle: MultipartUploadHandle, parts: Array<{ partNumber: number; etag: string }>): Promise<ObjectHead> {
    const mp = this.multipart.get(handle.uploadId);
    if (!mp) throw new Error(`Unknown multipart upload ${handle.uploadId}`);
    const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber).map((p) => {
      const bytes = mp.parts.get(p.partNumber);
      if (!bytes) throw new Error(`Missing part ${p.partNumber}`);
      return bytes;
    });
    this.multipart.delete(handle.uploadId);
    return this.put(mp.key, Buffer.concat(ordered.map((b) => Buffer.from(b))), mp.options);
  }

  async abortMultipart(handle: MultipartUploadHandle): Promise<void> {
    this.multipart.delete(handle.uploadId);
  }

  /** `file://` URL — unsigned; dev only. */
  async presignGet(key: string, _ttlSeconds?: number, _options?: { downloadFilename?: string }): Promise<string> {
    return `file://${this.pathFor(key)}`;
  }

  async presignPut(key: string, _ttlSeconds?: number, _options?: { contentType?: string }): Promise<string> {
    return `file://${this.pathFor(key)}`;
  }
}

/** Build the configured store (R2 when configured or forced; otherwise the dev-only local store). */
export function createObjectStore(env: JobsEnv, options: { log?: (msg: string) => void } = {}): ObjectStore {
  const kind = objectStoreKind(env);
  if (kind === 'r2') {
    if (!env.R2_ENDPOINT || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET) throw new Error('OBJECT_STORE=r2 requires R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET');
    return new R2ObjectStore({ endpoint: env.R2_ENDPOINT, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, bucket: env.R2_BUCKET });
  }
  const root = env.LOCAL_OBJECT_STORE_DIR ?? join(env.JOBS_WORK_DIR ?? process.cwd(), '.langquest-object-store');
  options.log?.(`[jobs] DEV-ONLY LocalFsObjectStore at ${root} (R2 is not configured)`);
  return new LocalFsObjectStore(root, env.R2_BUCKET ?? 'local');
}
