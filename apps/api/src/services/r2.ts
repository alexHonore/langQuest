/**
 * Media object store (§4.4, §7.2) over Cloudflare R2.
 *
 * Two transports, both optional until R2 is enabled on the account (docs/runbooks/provisioning.md):
 *   - S3 API via `aws4fetch` (R2_ACCOUNT_ID + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY): presigned range-capable
 *     GET URLs, multipart uploads (Create/UploadPart presign/Complete/Abort), ListObjectsV2, HEAD, PUT.
 *   - Worker binding `MEDIA`: direct reads/writes/listing from inside the Worker (no presigning).
 * When neither is configured every media operation reports `capability_unsupported` with a clear message —
 * the API never fabricates a URL.
 *
 * Object keys are always generated (`@langquest/media` key scheme); user filenames never reach R2.
 */
import { AwsClient } from 'aws4fetch';
import type { ApiEnv, R2BucketLike } from '../env';
import { problem } from '../http/envelope';

export interface ObjectHead {
  size: number;
  etag: string | null;
  contentType: string | null;
}
export interface ListedObject {
  key: string;
  size: number;
  etag: string | null;
  lastModified: string | null;
}
export interface MultipartPart {
  partNumber: number;
  etag: string;
}
export interface StreamedObject {
  body: ReadableStream<Uint8Array>;
  size: number;
  etag: string | null;
  contentType: string | null;
}

export interface MediaStore {
  readonly mode: 'none' | 's3' | 'binding' | 's3+binding';
  /** Presigned URLs need S3 credentials. */
  readonly canPresign: boolean;
  /** Any transport available. */
  readonly available: boolean;
  readonly bucket: string;
  head(key: string): Promise<ObjectHead | null>;
  /** First bytes for container sniffing (never the whole object). */
  readBytes(key: string, start: number, endInclusive: number): Promise<Uint8Array | null>;
  /** Streamed read for the Worker proxy (binding only). */
  stream(key: string, range?: { offset: number; length?: number }): Promise<StreamedObject | null>;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string, cursor?: string | null, limit?: number): Promise<{ objects: ListedObject[]; cursor: string | null }>;
  presignGet(key: string, expiresSeconds: number, options?: { responseContentType?: string; downloadFilename?: string }): Promise<string>;
  createMultipart(key: string, contentType: string): Promise<string>;
  presignUploadPart(key: string, uploadId: string, partNumber: number, expiresSeconds: number): Promise<string>;
  completeMultipart(key: string, uploadId: string, parts: MultipartPart[]): Promise<{ etag: string | null }>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
}

export const R2_UNAVAILABLE_MESSAGE = 'Media storage (Cloudflare R2) is not enabled for this deployment yet. Enable R2 in the Cloudflare dashboard, create the buckets and set the R2_* secrets (see infra/cloudflare/README.md).';
export const PRESIGN_UNAVAILABLE_MESSAGE = 'Signed media URLs require R2 S3 credentials (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY). The Worker proxy is used when only the MEDIA binding is bound.';

const encodeKey = (key: string): string => key.split('/').map(encodeURIComponent).join('/');
const xmlText = (xml: string, tag: string): string | null => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m?.[1] !== undefined ? m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : null;
};
const xmlAll = (xml: string, tag: string): string[] => {
  const out: string[] = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1] ?? '');
  return out;
};

interface S3Transport {
  client: AwsClient;
  endpoint: string;
  bucket: string;
  fetch: typeof fetch;
}

export interface MediaStoreDeps {
  fetch?: typeof fetch;
  binding?: R2BucketLike;
}

/** Build the store from env + optional binding. Never throws on missing config; operations do. */
export function createMediaStore(env: Pick<ApiEnv, 'R2_ACCOUNT_ID' | 'R2_ACCESS_KEY_ID' | 'R2_SECRET_ACCESS_KEY' | 'R2_BUCKET'>, deps: MediaStoreDeps = {}): MediaStore {
  const fetchImpl = deps.fetch ?? fetch;
  const binding = deps.binding ?? null;
  const s3: S3Transport | null =
    env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY
      ? {
          client: new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, service: 's3', region: 'auto' }),
          endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
          bucket: env.R2_BUCKET,
          fetch: fetchImpl,
        }
      : null;
  const mode: MediaStore['mode'] = s3 && binding ? 's3+binding' : s3 ? 's3' : binding ? 'binding' : 'none';
  const objectUrl = (key: string, query?: Record<string, string>): string => {
    const u = new URL(`${s3!.endpoint}/${s3!.bucket}/${encodeKey(key)}`);
    if (query) for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    return u.toString();
  };
  const requireS3 = (): S3Transport => {
    if (!s3) throw problem.unsupported(mode === 'none' ? R2_UNAVAILABLE_MESSAGE : PRESIGN_UNAVAILABLE_MESSAGE);
    return s3;
  };
  const requireAny = (): void => {
    if (mode === 'none') throw problem.unsupported(R2_UNAVAILABLE_MESSAGE);
  };
  const s3Fetch = async (method: string, url: string, init: { body?: BodyInit | null; headers?: Record<string, string> } = {}): Promise<Response> => {
    const t = requireS3();
    const signed = await t.client.sign(new Request(url, { method, body: init.body ?? null, headers: init.headers }), { aws: { allHeaders: true } });
    return t.fetch(signed);
  };
  const presign = async (method: string, url: string, expiresSeconds: number): Promise<string> => {
    const t = requireS3();
    const u = new URL(url);
    u.searchParams.set('X-Amz-Expires', String(Math.max(1, Math.min(7 * 24 * 3600, Math.floor(expiresSeconds)))));
    const signed = await t.client.sign(new Request(u.toString(), { method }), { aws: { signQuery: true } });
    return signed.url;
  };

  return {
    mode,
    canPresign: s3 !== null,
    available: mode !== 'none',
    bucket: env.R2_BUCKET,

    async head(key) {
      requireAny();
      if (binding) {
        const obj = await binding.head(key);
        return obj ? { size: obj.size, etag: obj.etag ?? null, contentType: obj.httpMetadata?.contentType ?? null } : null;
      }
      const res = await s3Fetch('HEAD', objectUrl(key));
      if (res.status === 404) return null;
      if (!res.ok) throw problem.provider(`Media storage HEAD failed (${res.status})`);
      return { size: Number(res.headers.get('content-length') ?? '0'), etag: stripQuotes(res.headers.get('etag')), contentType: res.headers.get('content-type') };
    },

    async readBytes(key, start, endInclusive) {
      requireAny();
      if (binding) {
        const obj = await binding.get(key, { range: { offset: start, length: endInclusive - start + 1 } });
        return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
      }
      const res = await s3Fetch('GET', objectUrl(key), { headers: { Range: `bytes=${start}-${endInclusive}` } });
      if (res.status === 404) return null;
      if (!res.ok) throw problem.provider(`Media storage GET failed (${res.status})`);
      return new Uint8Array(await res.arrayBuffer());
    },

    async stream(key, range) {
      if (!binding) throw problem.unsupported(mode === 'none' ? R2_UNAVAILABLE_MESSAGE : 'Worker-proxied streaming requires the MEDIA R2 binding');
      const obj = await binding.get(key, range ? { range } : undefined);
      return obj ? { body: obj.body, size: obj.size, etag: obj.etag ?? null, contentType: obj.httpMetadata?.contentType ?? null } : null;
    },

    async put(key, bytes, contentType) {
      requireAny();
      if (binding) {
        await binding.put(key, bytes, { httpMetadata: { contentType } });
        return;
      }
      const res = await s3Fetch('PUT', objectUrl(key), { body: bytes as unknown as BodyInit, headers: { 'content-type': contentType, 'content-length': String(bytes.byteLength) } });
      if (!res.ok) throw problem.provider(`Media storage PUT failed (${res.status})`);
    },

    async delete(key) {
      requireAny();
      if (binding) return binding.delete(key);
      const res = await s3Fetch('DELETE', objectUrl(key));
      if (!res.ok && res.status !== 404) throw problem.provider(`Media storage DELETE failed (${res.status})`);
    },

    async list(prefix, cursor, limit = 1000) {
      requireAny();
      if (binding) {
        const page = await binding.list({ prefix, cursor: cursor ?? undefined, limit });
        return { objects: page.objects.map((o) => ({ key: o.key, size: o.size, etag: o.etag ?? null, lastModified: o.uploaded?.toISOString?.() ?? null })), cursor: page.truncated ? (page.cursor ?? null) : null };
      }
      const t = requireS3();
      const u = new URL(`${t.endpoint}/${t.bucket}`);
      u.searchParams.set('list-type', '2');
      u.searchParams.set('prefix', prefix);
      u.searchParams.set('max-keys', String(Math.min(1000, limit)));
      if (cursor) u.searchParams.set('continuation-token', cursor);
      const res = await s3Fetch('GET', u.toString());
      if (!res.ok) throw problem.provider(`Media storage LIST failed (${res.status})`);
      const xml = await res.text();
      const objects = xmlAll(xml, 'Contents').map((c) => ({ key: xmlText(c, 'Key') ?? '', size: Number(xmlText(c, 'Size') ?? '0'), etag: stripQuotes(xmlText(c, 'ETag')), lastModified: xmlText(c, 'LastModified') }));
      const truncated = xmlText(xml, 'IsTruncated') === 'true';
      return { objects, cursor: truncated ? xmlText(xml, 'NextContinuationToken') : null };
    },

    async presignGet(key, expiresSeconds, options) {
      const query: Record<string, string> = {};
      if (options?.responseContentType) query['response-content-type'] = options.responseContentType;
      if (options?.downloadFilename) query['response-content-disposition'] = `attachment; filename="${options.downloadFilename.replace(/["\r\n]/g, '')}"`;
      return presign('GET', objectUrl(key, query), expiresSeconds);
    },

    async createMultipart(key, contentType) {
      const res = await s3Fetch('POST', objectUrl(key, { uploads: '' }), { headers: { 'content-type': contentType } });
      if (!res.ok) throw problem.provider(`Could not start a multipart upload (${res.status})`);
      const uploadId = xmlText(await res.text(), 'UploadId');
      if (!uploadId) throw problem.provider('Multipart upload id missing from storage response');
      return uploadId;
    },

    async presignUploadPart(key, uploadId, partNumber, expiresSeconds) {
      return presign('PUT', objectUrl(key, { partNumber: String(partNumber), uploadId }), expiresSeconds);
    },

    async completeMultipart(key, uploadId, parts) {
      const body = `<CompleteMultipartUpload>${[...parts]
        .sort((a, b) => a.partNumber - b.partNumber)
        .map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${escapeXml(p.etag.startsWith('"') ? p.etag : `"${p.etag}"`)}</ETag></Part>`)
        .join('')}</CompleteMultipartUpload>`;
      const res = await s3Fetch('POST', objectUrl(key, { uploadId }), { body, headers: { 'content-type': 'application/xml' } });
      const text = await res.text();
      if (!res.ok || /<Error>/.test(text)) throw problem.provider(`Could not complete the multipart upload (${res.status})`);
      return { etag: stripQuotes(xmlText(text, 'ETag')) };
    },

    async abortMultipart(key, uploadId) {
      const res = await s3Fetch('DELETE', objectUrl(key, { uploadId }));
      if (!res.ok && res.status !== 404) throw problem.provider(`Could not abort the multipart upload (${res.status})`);
    },
  };
}

const stripQuotes = (v: string | null): string | null => (v ? v.replace(/^"|"$/g, '') : null);
const escapeXml = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
