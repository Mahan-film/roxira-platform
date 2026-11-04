import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as fs from 'fs';
import type { Readable } from 'stream';
import { CompletedPart, ObjectStore, PartInfo } from './object-store';

export interface S3Settings {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/** Reads the R2 settings from the environment. Values are never logged or returned to a client. */
export function s3SettingsFromEnv(env: NodeJS.ProcessEnv = process.env): S3Settings {
  return {
    endpoint: env.R2_ENDPOINT ?? '',
    accessKeyId: env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? '',
    bucket: env.R2_BUCKET ?? '',
  };
}

/** Cloudflare R2 (S3 API). Parts go browser -> R2 on presigned URLs; this class only signs and stitches. */
export class S3ObjectStore implements ObjectStore {
  readonly driver = 's3' as const;
  readonly direct = true;
  private readonly client: S3Client;

  constructor(private readonly settings: S3Settings, client?: S3Client) {
    this.client =
      client ??
      new S3Client({
        region: 'auto',
        endpoint: settings.endpoint,
        forcePathStyle: true,
        credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
      });
  }

  async createMultipart(key: string): Promise<{ uploadId: string }> {
    const out = await this.client.send(
      new CreateMultipartUploadCommand({ Bucket: this.settings.bucket, Key: key, ContentType: 'application/octet-stream' }),
    );
    if (!out.UploadId) throw new Error('Object store returned no upload id');
    return { uploadId: out.UploadId };
  }

  presignPart(key: string, uploadId: string, partNumber: number, expiresSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new UploadPartCommand({ Bucket: this.settings.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }),
      { expiresIn: expiresSeconds },
    );
  }

  async listParts(key: string, uploadId: string): Promise<PartInfo[]> {
    const parts: PartInfo[] = [];
    let marker: string | undefined;
    for (;;) {
      const out = await this.client.send(
        new ListPartsCommand({
          Bucket: this.settings.bucket,
          Key: key,
          UploadId: uploadId,
          PartNumberMarker: marker,
          MaxParts: 1000,
        }),
      );
      for (const part of out.Parts ?? []) {
        if (part.PartNumber !== undefined) {
          parts.push({ partNumber: part.PartNumber, size: Number(part.Size ?? 0), etag: part.ETag ?? '' });
        }
      }
      if (!out.IsTruncated || !out.NextPartNumberMarker) break;
      marker = out.NextPartNumberMarker;
    }
    return parts;
  }

  async putPart(): Promise<{ etag: string; size: number }> {
    throw new Error('Parts are uploaded directly to the presigned URL');
  }

  async completeMultipart(key: string, uploadId: string, parts: CompletedPart[]): Promise<{ size: number }> {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.settings.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: [...parts]
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
        },
      }),
    );
    return { size: await this.size(key) };
  }

  async abortMultipart(key: string, uploadId: string): Promise<void> {
    await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.settings.bucket, Key: key, UploadId: uploadId }));
  }

  async read(key: string, start = 0): Promise<Readable> {
    const out = await this.client.send(
      new GetObjectCommand({ Bucket: this.settings.bucket, Key: key, Range: start > 0 ? `bytes=${start}-` : undefined }),
    );
    return out.Body as Readable;
  }

  async size(key: string): Promise<number> {
    const out = await this.client.send(new HeadObjectCommand({ Bucket: this.settings.bucket, Key: key }));
    return Number(out.ContentLength ?? 0);
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.settings.bucket, Key: key }));
  }

  async putFile(key: string, localPath: string): Promise<void> {
    const { uploadId } = await this.createMultipart(key);
    const stat = fs.statSync(localPath);
    const partSize = 64 * 1024 * 1024;
    const parts: CompletedPart[] = [];
    for (let offset = 0, n = 1; offset < stat.size || n === 1; offset += partSize, n += 1) {
      const end = Math.min(offset + partSize, stat.size) - 1;
      const out = await this.client.send(
        new UploadPartCommand({
          Bucket: this.settings.bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: n,
          Body: fs.createReadStream(localPath, { start: offset, end: Math.max(end, offset) }),
          ContentLength: Math.max(end - offset + 1, 0),
        }),
      );
      parts.push({ partNumber: n, etag: out.ETag ?? '' });
      if (end + 1 >= stat.size) break;
    }
    await this.completeMultipart(key, uploadId, parts);
  }
}
