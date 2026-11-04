import type { Readable } from 'stream';

/** One part of a multipart upload as the browser reports it after the PUT. */
export interface CompletedPart {
  partNumber: number;
  etag: string;
}

/** What the API knows about a part it relays (fallback path): exact size and the optional base64 SHA-256. */
export interface PutPartMeta {
  size: number;
  checksumSha256?: string;
}

export interface PartInfo {
  partNumber: number;
  size: number;
  etag: string;
}

/**
 * Object storage used for import sources. The API never carries file bytes: for the S3/R2 driver the
 * browser PUTs each part straight to a presigned URL. The `local` driver exists for developer machines,
 * tests and the benchmark, and receives parts through the API instead.
 */
export interface ObjectStore {
  readonly driver: 's3' | 'local';
  /** True when the browser can PUT directly to a presigned URL (false for `local`). */
  readonly direct: boolean;
  createMultipart(key: string): Promise<{ uploadId: string }>;
  /**
   * `checksumSha256` (base64) binds the URL to that digest: storage rejects a part whose bytes differ, and the
   * browser must send the same value in the `x-amz-checksum-sha256` header.
   */
  presignPart(key: string, uploadId: string, partNumber: number, expiresSeconds: number, checksumSha256?: string): Promise<string>;
  /** Parts already stored: this is what makes an upload resumable after a closed tab. */
  listParts(key: string, uploadId: string): Promise<PartInfo[]>;
  /** Used by the local driver, which has no presigned URLs. */
  putPart(key: string, uploadId: string, partNumber: number, body: Readable, meta?: PutPartMeta): Promise<{ etag: string; size: number }>;
  completeMultipart(key: string, uploadId: string, parts: CompletedPart[]): Promise<{ size: number }>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
  /** Streams an object from `start` (inclusive byte offset). Never buffers the object. */
  read(key: string, start?: number): Promise<Readable>;
  size(key: string): Promise<number>;
  remove(key: string): Promise<void>;
  /** Writes a small object (used by tests and the benchmark fixture loader). */
  putFile(key: string, localPath: string): Promise<void>;
}

export const OBJECT_STORE = 'BULK_OBJECT_STORE';

/** Object keys are always `tenants/<tenantId>/imports/<jobId>/source`; nothing user-controlled enters a key. */
export function sourceKey(tenantId: string, jobId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(tenantId) || !/^[0-9a-f-]{36}$/i.test(jobId)) {
    throw new Error('Invalid id for an object key');
  }
  return `tenants/${tenantId}/imports/${jobId}/source`;
}
