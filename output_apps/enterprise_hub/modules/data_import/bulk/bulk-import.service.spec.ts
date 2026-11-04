import { BadRequestException, ConflictException, PayloadTooLargeException } from '@nestjs/common';
import { BulkImportService } from './bulk-import.service';
import { BulkJob } from './bulk-import.types';
import { LocalObjectStore } from './storage/local-object-store';
import { sourceKey } from './storage/object-store';
import { S3ObjectStore } from './storage/s3-object-store';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const T = '11111111-1111-4111-8111-111111111111';
const GB = 1024 ** 3;

function fakeRepo(overrides: Partial<Record<string, unknown>> = {}) {
  const jobs = new Map<string, BulkJob>();
  const repo: any = {
    usedBytes: jest.fn(async () => 0),
    countActive: jest.fn(async () => 0),
    createJob: jest.fn(async (_t: string, j: any) => {
      const job = { ...j, tenantId: T, status: 'uploading', tables: [], notes: [], checkpoint: {}, bytesRead: 0, rowsStaged: 0, sourceRemoved: false, rowsRemoved: false, review: null, postProgress: null, batchId: null, error: null, attempts: 0 } as BulkJob;
      jobs.set(j.id, job);
      return job;
    }),
    getJob: jest.fn(async (_t: string, id: string) => jobs.get(id) ?? null),
    update: jest.fn(async (_t: string, id: string, patch: any) => void Object.assign(jobs.get(id) as BulkJob, patch)),
    transition: jest.fn(async (_t: string, id: string, from: string[], patch: any) => {
      const job = jobs.get(id);
      if (!job || !from.includes(job.status)) return false;
      Object.assign(job, patch);
      return true;
    }),
    ...overrides,
  };
  return { repo, jobs };
}

const queue: any = { add: jest.fn(async () => undefined) };

describe('BulkImportService', () => {
  let dir: string;
  let store: LocalObjectStore;
  beforeEach(() => {
    process.env.IMPORT_STORAGE_DRIVER = 'local';
    process.env.IMPORT_PART_BYTES = String(5 * 1024 * 1024);
    delete process.env.IMPORT_TENANT_QUOTA_BYTES;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bulk-svc-'));
    store = new LocalObjectStore(dir);
    queue.add.mockClear();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('has no row or daily-file limit and a 50 GiB default quota', async () => {
    const { repo } = fakeRepo();
    const svc = new BulkImportService(repo, store, queue);
    const config = svc.config();
    expect(config.quotaBytes).toBe(50 * GB);
    const big = await svc.startUpload(T, 'u', { fileName: 'huge.csv', size: 40 * GB });
    expect(big.totalParts).toBeGreaterThan(1);
  });

  it('refuses over-quota uploads with a clear Persian message and creates nothing', async () => {
    process.env.IMPORT_TENANT_QUOTA_BYTES = String(10 * GB);
    const { repo } = fakeRepo({ usedBytes: jest.fn(async () => 8 * GB) });
    const svc = new BulkImportService(repo, store, queue);
    await expect(svc.startUpload(T, 'u', { fileName: 'a.csv', size: 3 * GB })).rejects.toThrow(PayloadTooLargeException);
    await expect(svc.startUpload(T, 'u', { fileName: 'a.csv', size: 3 * GB })).rejects.toThrow(/10\.0 گیگابایت.*8\.0 گیگابایت.*3\.0 گیگابایت/);
    expect(repo.createJob).not.toHaveBeenCalled();
  });

  it('refuses to start when storage is not configured in production', async () => {
    process.env.IMPORT_STORAGE_DRIVER = 'disabled';
    const { repo } = fakeRepo();
    await expect(new BulkImportService(repo, store, queue).startUpload(T, 'u', { fileName: 'a.csv', size: 10 })).rejects.toThrow(/تنظیم نشده/);
  });

  it('completes only when every part is present with the right size, then queues the job', async () => {
    const { repo, jobs } = fakeRepo();
    const svc = new BulkImportService(repo, store, queue);
    const size = 5 * 1024 * 1024 * 2 + 100;
    const started = await svc.startUpload(T, 'u', { fileName: 'a.csv', size });
    expect(started.totalParts).toBe(3);
    const job = jobs.get(started.jobId) as BulkJob;
    const part = (n: number, bytes: number) => svc.putProxyPart(T, job.id, n, require('stream').Readable.from([Buffer.alloc(bytes, 97)]), bytes);
    await part(1, started.partBytes);
    await expect(svc.completeUpload(T, job.id)).rejects.toThrow(BadRequestException);
    await part(2, started.partBytes);
    await expect(part(3, 99)).rejects.toThrow(BadRequestException); // wrong size is refused before storing
    await expect(svc.completeUpload(T, job.id)).rejects.toThrow(/3/);
    await part(3, 100);
    const done = await svc.completeUpload(T, job.id);
    expect(done.status).toBe('queued');
    expect(queue.add).toHaveBeenCalledWith('bulk-run', { tenantId: T, jobId: job.id }, expect.objectContaining({ attempts: 3 }));
    expect(await store.size(sourceKey(T, job.id))).toBe(size);
  });

  it('enforces the review gate: approve needs a ready job and an explicit confirmation', async () => {
    const { repo, jobs } = fakeRepo();
    const svc = new BulkImportService(repo, store, queue);
    const started = await svc.startUpload(T, 'u', { fileName: 'a.csv', size: 100 });
    const job = jobs.get(started.jobId) as BulkJob;
    job.tables = [{ idx: 0, name: 'a', columns: ['x'], rows: 1 }];
    const dto = { tables: [{ idx: 0, entity: 'crm-leads', mapping: {} }], confirmReviewed: true };
    await expect(svc.approve(T, job.id, { ...dto, confirmReviewed: false })).rejects.toThrow(BadRequestException);
    await expect(svc.approve(T, job.id, dto)).rejects.toThrow(ConflictException); // still uploading
    job.status = 'ready';
    await expect(svc.approve(T, job.id, { ...dto, tables: [{ idx: 9, entity: 'crm-leads', mapping: {} }] })).rejects.toThrow(/جدول/);
    await expect(svc.approve(T, job.id, { ...dto, tables: [{ idx: 0, entity: 'crm-leads', mapping: {}, skip: true }] })).rejects.toThrow(/دست‌کم/);
    const posted = await svc.approve(T, job.id, dto);
    expect(posted.status).toBe('posting');
    expect(queue.add).toHaveBeenCalledWith('bulk-post', expect.objectContaining({ tenantId: T, jobId: job.id }), expect.anything());
    await expect(svc.approve(T, job.id, dto)).rejects.toThrow(ConflictException); // cannot post twice
  });

  it('pause/resume/retry only work from the right state', async () => {
    const { repo, jobs } = fakeRepo();
    const svc = new BulkImportService(repo, store, queue);
    const { jobId } = await svc.startUpload(T, 'u', { fileName: 'a.csv', size: 100 });
    const job = jobs.get(jobId) as BulkJob;
    await expect(svc.pause(T, jobId)).rejects.toThrow(ConflictException);
    job.status = 'running';
    expect((await svc.pause(T, jobId)).status).toBe('pausing');
    job.status = 'paused';
    expect((await svc.resume(T, jobId)).status).toBe('queued');
    job.status = 'failed';
    expect((await svc.retry(T, jobId)).status).toBe('queued');
  });
});

describe('object keys and the S3 store', () => {
  it('never lets a user-controlled string into an object key', () => {
    expect(sourceKey(T, '22222222-2222-4222-8222-222222222222')).toBe(`tenants/${T}/imports/22222222-2222-4222-8222-222222222222/source`);
    expect(() => sourceKey('../etc', 'x')).toThrow();
  });

  it('signs part URLs with the R2 endpoint, bucket and part number', async () => {
    const store = new S3ObjectStore({ endpoint: 'https://acc.r2.cloudflarestorage.com', accessKeyId: 'AK', secretAccessKey: 'SK', bucket: 'imports' });
    const url = await store.presignPart(`tenants/${T}/imports/j/source`, 'upload-1', 7, 3600);
    expect(url).toContain('acc.r2.cloudflarestorage.com/imports/tenants/');
    expect(url).toContain('partNumber=7');
    expect(url).toContain('uploadId=upload-1');
    expect(url).toContain('X-Amz-Signature=');
    expect(url).not.toContain('SK'); // the secret is never in the URL
  });
});

describe('R2 fallback relay and per-part checksums', () => {
  const SUM = 'a'.repeat(43) + '=';
  const make = () => {
    const calls: any[] = [];
    const s3: any = new S3ObjectStore({ endpoint: 'https://acc.r2.cloudflarestorage.com', accessKeyId: 'AK', secretAccessKey: 'SK', bucket: 'imports' });
    return { s3, calls };
  };
  beforeEach(() => {
    process.env.IMPORT_STORAGE_DRIVER = 's3';
    process.env.IMPORT_PART_BYTES = String(5 * 1024 * 1024);
    delete process.env.IMPORT_PROXY_PARTS;
    delete process.env.IMPORT_PART_CHECKSUMS;
  });

  it('binds the SHA-256 header into the signed URL (not hoisted to the query string)', async () => {
    const { s3 } = make();
    const url: string = await s3.presignPart(`tenants/${T}/imports/j/source`, 'u1', 2, 3600, SUM);
    expect(url).toMatch(/X-Amz-SignedHeaders=[^&]*x-amz-checksum-sha256/i);
    expect(url).not.toMatch(/[?&]x-amz-checksum-sha256=/i);
    const plain: string = await s3.presignPart(`tenants/${T}/imports/j/source`, 'u1', 2, 3600);
    expect(plain).not.toMatch(/checksum/i);
  });

  it('signs checksums only when enabled and well-formed, and tells the browser which header to send', async () => {
    const { repo } = fakeRepo();
    const s3: any = make().s3;
    s3.createMultipart = jest.fn(async () => ({ uploadId: 'u1' }));
    const svc = new BulkImportService(repo, s3, queue);
    const started = await svc.startUpload(T, 'u', { fileName: 'a.csv', size: 5 * 1024 * 1024 * 2 });
    expect(started.checksums).toBe(false);
    expect((await svc.signParts(T, started.jobId, [1], { '1': SUM })).headers).toEqual({});
    process.env.IMPORT_PART_CHECKSUMS = '1';
    const signed = await svc.signParts(T, started.jobId, [1, 2], { '1': SUM });
    expect(signed.headers[1]).toEqual({ 'x-amz-checksum-sha256': SUM });
    expect(signed.headers[2]).toBeUndefined();
  });

  it('relays a part as a stream with its exact size and refuses wrong lengths, bad digests and the off switch', async () => {
    const { repo } = fakeRepo();
    const s3: any = make().s3;
    s3.createMultipart = jest.fn(async () => ({ uploadId: 'u1' }));
    s3.putPart = jest.fn(async (_k: string, _u: string, n: number, _b: unknown, meta: any) => ({ etag: `"e${n}"`, size: meta.size }));
    const svc = new BulkImportService(repo, s3, queue);
    const size = 5 * 1024 * 1024 * 2 + 10;
    const started = await svc.startUpload(T, 'u', { fileName: 'a.csv', size });
    expect(started.proxyParts).toBe(true);
    const body = require('stream').Readable.from([]);
    await expect(svc.putProxyPart(T, started.jobId, 1, body, 123)).rejects.toThrow(BadRequestException);
    await expect(svc.putProxyPart(T, started.jobId, 1, body, started.partBytes, 'not-base64')).rejects.toThrow(/چکیده/);
    await expect(svc.putProxyPart(T, started.jobId, 9, body, started.partBytes)).rejects.toThrow(/نامعتبر/);
    expect(await svc.putProxyPart(T, started.jobId, 3, body, 10, SUM)).toEqual({ etag: '"e3"', size: 10 });
    expect(s3.putPart).toHaveBeenCalledWith(expect.any(String), 'u1', 3, body, { size: 10, checksumSha256: SUM });
    process.env.IMPORT_PROXY_PARTS = '0';
    await expect(svc.putProxyPart(T, started.jobId, 3, body, 10)).rejects.toThrow(/غیرفعال/);
    expect(svc.config().proxyParts).toBe(false);
  });
});
