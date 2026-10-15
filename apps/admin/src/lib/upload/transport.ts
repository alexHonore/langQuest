/**
 * Part transport: PUT one part to a presigned R2 URL with upload progress. `fetch` has no
 * upload progress events, so the browser implementation uses XMLHttpRequest. R2 must expose
 * the `ETag` header through the bucket CORS policy (`ExposeHeaders: [ETag]`); without it the
 * part is reported as failed with an explicit message rather than silently completing.
 */
export interface PutPartOptions {
  onProgress?: (bytes: number) => void;
  signal?: AbortSignal;
  contentType?: string;
}

export interface PartTransport {
  putPart(url: string, body: Blob, options?: PutPartOptions): Promise<{ etag: string }>;
}

export class PartUploadError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;
  constructor(message: string, status: number | null, retryable: boolean) {
    super(message);
    this.name = 'PartUploadError';
    this.status = status;
    this.retryable = retryable;
  }
}

export class XhrPartTransport implements PartTransport {
  putPart(url: string, body: Blob, options: PutPartOptions = {}): Promise<{ etag: string }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url, true);
      if (options.contentType) xhr.setRequestHeader('Content-Type', options.contentType);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) options.onProgress?.(e.loaded);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const etag = xhr.getResponseHeader('ETag');
          if (!etag) reject(new PartUploadError('Part stored but no ETag header exposed (check R2 CORS ExposeHeaders)', xhr.status, false));
          else resolve({ etag: etag.replace(/^"|"$/g, '') });
        } else {
          reject(new PartUploadError(`Part upload failed with HTTP ${xhr.status}`, xhr.status, xhr.status >= 500 || xhr.status === 429 || xhr.status === 408));
        }
      };
      xhr.onerror = () => reject(new PartUploadError('Network error while uploading part', null, true));
      xhr.onabort = () => reject(new PartUploadError('Part upload aborted', null, false));
      xhr.ontimeout = () => reject(new PartUploadError('Part upload timed out', null, true));
      options.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
      xhr.send(body);
    });
  }
}
