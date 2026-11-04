import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, Optional, PayloadTooLargeException, ServiceUnavailableException } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Readable } from 'stream';
import { BulkImportRepository } from './bulk-import.repository';
import { BulkJob, BulkStatus, TERMINAL } from './bulk-import.types';
import {
  BULK_CLEANUP_JOB,
  BULK_SWEEP_JOB,
  BULK_POST_JOB,
  BULK_QUEUE_NAME,
  BULK_RUN_JOB,
  MAX_PARTS,
  RESERVED_PRESIGN_SECONDS,
  maxActiveJobsPerTenant,
  maxFileBytes,
  partBytes,
  storageDriver,
  tenantQuotaBytes,
} from './bulk.constants';
import { ApproveBulkDto } from './bulk-import.dto';
import { OBJECT_STORE, ObjectStore, sourceKey } from './storage/object-store';

const GB = 1024 ** 3;
function human(bytes: number): string {
  return bytes >= GB ? `${(bytes / GB).toFixed(1)} گیگابایت` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} مگابایت`;
}

export function publicJob(job: BulkJob) {
  return {
    id: job.id,
    fileName: job.fileName,
    sizeBytes: job.sizeBytes,
    status: job.status,
    bytesRead: job.bytesRead,
    rowsStaged: job.rowsStaged,
    percent: job.sizeBytes > 0 ? Math.min(100, Math.round((job.bytesRead / job.sizeBytes) * 100)) : 0,
    tables: job.tables.map((t) => ({ idx: t.idx, name: t.name, columns: t.columns, rows: t.rows })),
    notes: job.notes,
    review: job.review,
    postProgress: job.postProgress,
    batchId: job.batchId,
    error: job.error,
    attempts: job.attempts,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
  };
}

/** Upload lifecycle, quota and job control. File bytes never pass through here: parts go straight to object storage. */
@Injectable()
export class BulkImportService implements OnModuleInit {
  private readonly logger = new Logger(BulkImportService.name);

  constructor(
    private readonly repo: BulkImportRepository,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Optional() @InjectQueue(BULK_QUEUE_NAME) private readonly queue?: Queue,
  ) {}

  /** Registers the daily sweep (expiry of stale jobs and unfinished cleanups) once per process start. */
  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test' || !this.queue) return;
    await this.queue
      .add(BULK_SWEEP_JOB, {}, { repeat: { every: 6 * 60 * 60 * 1000 }, jobId: 'bulk-sweep', removeOnComplete: 10, removeOnFail: 10 })
      .catch((e) => this.logger.warn(`sweep schedule failed: ${(e as Error).message}`));
  }

  config() {
    const driver = storageDriver();
    return { enabled: driver !== 'disabled', driver, direct: this.store.direct, partBytes: partBytes(), quotaBytes: tenantQuotaBytes() };
  }

  async quota(tenantId: string) {
    const used = await this.repo.usedBytes(tenantId);
    const quota = tenantQuotaBytes();
    return { usedBytes: used, quotaBytes: quota, remainingBytes: Math.max(0, quota - used) };
  }

  async startUpload(tenantId: string, userId: string | null, input: { fileName: string; size: number }) {
    if (storageDriver() === 'disabled') {
      throw new ServiceUnavailableException('ذخیره‌سازی بارگذاری بزرگ هنوز برای این سرور تنظیم نشده است.');
    }
    const size = Math.floor(input.size);
    if (size > maxFileBytes()) throw new PayloadTooLargeException(`حجم فایل از ${human(maxFileBytes())} بیشتر است.`);
    const { usedBytes, quotaBytes } = await this.quota(tenantId);
    if (usedBytes + size > quotaBytes) {
      throw new PayloadTooLargeException(
        `فضای ورود داده سازمان شما ${human(quotaBytes)} است؛ ${human(usedBytes)} استفاده شده و این فایل ${human(size)} است. ` +
          'فایل‌های ورود قدیمی را لغو یا حذف کنید یا برای افزایش سقف با پشتیبانی تماس بگیرید.',
      );
    }
    if ((await this.repo.countActive(tenantId)) >= maxActiveJobsPerTenant()) {
      throw new ConflictException(`حداکثر ${maxActiveJobsPerTenant()} ورود هم‌زمان مجاز است؛ صبر کنید تا یکی تمام شود.`);
    }
    const part = Math.max(partBytes(), Math.ceil(size / MAX_PARTS));
    const id = randomUUID();
    const key = sourceKey(tenantId, id);
    const { uploadId } = await this.store.createMultipart(key);
    const fileName = input.fileName.replace(/[\\/]/g, '_').slice(0, 255) || 'upload';
    const job = await this.repo.createJob(tenantId, {
      id,
      createdBy: userId,
      fileName,
      sizeBytes: size,
      objectKey: key,
      multipartId: uploadId,
      driver: this.store.driver,
      partBytes: part,
    });
    return { jobId: job.id, partBytes: part, totalParts: Math.ceil(size / part), direct: this.store.direct };
  }

  private async mustGet(tenantId: string, id: string): Promise<BulkJob> {
    const job = await this.repo.getJob(tenantId, id);
    if (!job) throw new NotFoundException('این ورود یافت نشد.');
    return job;
  }

  private async uploading(tenantId: string, id: string): Promise<BulkJob> {
    const job = await this.mustGet(tenantId, id);
    if (job.status !== 'uploading' || !job.multipartId) throw new ConflictException('بارگذاری این فایل بسته شده است.');
    return job;
  }

  async uploadedParts(tenantId: string, id: string) {
    const job = await this.uploading(tenantId, id);
    const parts = await this.store.listParts(job.objectKey, job.multipartId as string);
    return { partBytes: job.partBytes, totalParts: Math.ceil(job.sizeBytes / job.partBytes), uploaded: parts.map((p) => ({ partNumber: p.partNumber, size: p.size })) };
  }

  async signParts(tenantId: string, id: string, numbers: number[]) {
    const job = await this.uploading(tenantId, id);
    const total = Math.ceil(job.sizeBytes / job.partBytes);
    if (!this.store.direct) throw new BadRequestException('این سرور آپلود مستقیم ندارد.');
    const urls: Record<number, string> = {};
    for (const n of numbers) {
      if (n < 1 || n > total) throw new BadRequestException('شمارهٔ تکه نامعتبر است.');
      urls[n] = await this.store.presignPart(job.objectKey, job.multipartId as string, n, RESERVED_PRESIGN_SECONDS);
    }
    return { urls };
  }

  /** Development / test driver only: the API receives the part. */
  async putLocalPart(tenantId: string, id: string, partNumber: number, body: Readable) {
    const job = await this.uploading(tenantId, id);
    if (this.store.direct) throw new BadRequestException('این سرور آپلود مستقیم دارد.');
    const total = Math.ceil(job.sizeBytes / job.partBytes);
    if (partNumber < 1 || partNumber > total) throw new BadRequestException('شمارهٔ تکه نامعتبر است.');
    return this.store.putPart(job.objectKey, job.multipartId as string, partNumber, body);
  }

  /** Verifies every part is present with the right size, stitches the object and queues the job. */
  async completeUpload(tenantId: string, id: string) {
    const job = await this.uploading(tenantId, id);
    const total = Math.ceil(job.sizeBytes / job.partBytes);
    const parts = await this.store.listParts(job.objectKey, job.multipartId as string);
    const byNumber = new Map(parts.map((p) => [p.partNumber, p]));
    const missing: number[] = [];
    for (let n = 1; n <= total; n += 1) {
      const expected = n < total ? job.partBytes : job.sizeBytes - job.partBytes * (total - 1);
      if (byNumber.get(n)?.size !== expected) missing.push(n);
    }
    if (missing.length > 0) {
      throw new BadRequestException(`تکه‌های ${missing.slice(0, 10).join('، ')} هنوز کامل نرسیده است؛ دوباره ادامه دهید.`);
    }
    const { size } = await this.store.completeMultipart(
      job.objectKey,
      job.multipartId as string,
      parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })),
    );
    if (size !== job.sizeBytes) {
      await this.store.remove(job.objectKey);
      throw new BadRequestException('اندازهٔ فایل ذخیره‌شده با مقدار اعلام‌شده نمی‌خواند.');
    }
    await this.repo.update(tenantId, id, { status: 'queued', multipartId: null });
    await this.enqueueRun(tenantId, id);
    return publicJob(await this.mustGet(tenantId, id));
  }

  private async enqueueRun(tenantId: string, jobId: string): Promise<void> {
    if (!this.queue) throw new ServiceUnavailableException('صف پردازش در دسترس نیست.');
    await this.queue.add(BULK_RUN_JOB, { tenantId, jobId }, { jobId: `run-${jobId}-${Date.now()}`, attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 100, removeOnFail: 100 });
  }

  async list(tenantId: string) {
    return (await this.repo.listJobs(tenantId)).map((j) => ({ ...publicJob(j), review: undefined }));
  }

  async get(tenantId: string, id: string) {
    return publicJob(await this.mustGet(tenantId, id));
  }

  async pause(tenantId: string, id: string) {
    const ok = await this.repo.transition(tenantId, id, ['running'], { status: 'pausing' });
    if (!ok) await this.explain(tenantId, id, 'فقط ورودِ در حال پردازش را می‌توان متوقف کرد.');
    return this.get(tenantId, id);
  }

  async resume(tenantId: string, id: string) {
    const ok = await this.repo.transition(tenantId, id, ['paused'], { status: 'queued', error: null });
    if (!ok) await this.explain(tenantId, id, 'فقط ورودِ متوقف‌شده را می‌توان ادامه داد.');
    await this.enqueueRun(tenantId, id);
    return this.get(tenantId, id);
  }

  async retry(tenantId: string, id: string) {
    const ok = await this.repo.transition(tenantId, id, ['failed'], { status: 'queued', error: null, finishedAt: null });
    if (!ok) await this.explain(tenantId, id, 'فقط ورود ناموفق را می‌توان دوباره امتحان کرد.');
    await this.enqueueRun(tenantId, id);
    return this.get(tenantId, id);
  }

  async cancel(tenantId: string, id: string) {
    const job = await this.mustGet(tenantId, id);
    if (TERMINAL.includes(job.status)) throw new ConflictException('این ورود قبلاً پایان یافته است.');
    if (job.status === 'running' || job.status === 'pausing') {
      await this.repo.transition(tenantId, id, ['running', 'pausing'], { status: 'cancelling' });
    } else if (job.status === 'uploading') {
      if (job.multipartId) await this.store.abortMultipart(job.objectKey, job.multipartId).catch(() => undefined);
      await this.repo.update(tenantId, id, { status: 'cancelled', finishedAt: new Date(), sourceRemoved: true, rowsRemoved: true });
    } else {
      await this.repo.update(tenantId, id, { status: 'cancelled', finishedAt: new Date() });
    }
    await this.queue?.add(BULK_CLEANUP_JOB, { tenantId, jobId: id }, { delay: 3000, removeOnComplete: 100, removeOnFail: 100 });
    return this.get(tenantId, id);
  }

  async rows(tenantId: string, id: string, tableIdx: number, after: number, limit: number) {
    const job = await this.mustGet(tenantId, id);
    const table = job.tables.find((t) => t.idx === tableIdx);
    if (!table) throw new NotFoundException('جدول یافت نشد.');
    if (job.rowsRemoved) throw new ConflictException('ردیف‌های این ورود دیگر نگهداری نمی‌شود.');
    const rows = await this.repo.readRows(tenantId, id, tableIdx, after, Math.min(Math.max(limit, 1), 200));
    return { columns: table.columns, rows: rows.map((r) => ({ rowNo: r.rowNo, cells: r.cells })), total: table.rows };
  }

  /** The review gate: only a staged ('ready') job can be approved, and only with an explicit confirmation. */
  async approve(tenantId: string, id: string, dto: ApproveBulkDto) {
    if (!dto.confirmReviewed) throw new BadRequestException('پیش از ثبت باید بازبینی را تأیید کنید.');
    const job = await this.mustGet(tenantId, id);
    const idx = new Set(job.tables.map((t) => t.idx));
    for (const t of dto.tables) if (!idx.has(t.idx)) throw new BadRequestException('جدول انتخاب‌شده در این فایل نیست.');
    if (dto.tables.every((t) => t.skip)) throw new BadRequestException('دست‌کم یک جدول را برای ثبت انتخاب کنید.');
    const ok = await this.repo.transition(tenantId, id, ['ready'], {
      status: 'posting',
      postProgress: { phase: 'posting', done: 0, total: 0, inserted: {}, skipped: {}, errors: [] },
      error: null,
    });
    if (!ok) throw new ConflictException('فقط ورودِ آمادهٔ بازبینی را می‌توان ثبت کرد.');
    if (!this.queue) throw new ServiceUnavailableException('صف پردازش در دسترس نیست.');
    await this.queue.add(BULK_POST_JOB, { tenantId, jobId: id, tables: dto.tables, batchId: randomUUID() }, { jobId: `post-${id}`, attempts: 1, removeOnComplete: 100, removeOnFail: 100 });
    return this.get(tenantId, id);
  }

  private async explain(tenantId: string, id: string, message: string): Promise<never> {
    await this.mustGet(tenantId, id);
    throw new ConflictException(message);
  }

  /** Removes the source object and staged rows of a finished job (frees quota). Safe to call repeatedly. */
  async cleanup(tenantId: string, id: string): Promise<void> {
    const job = await this.repo.getJob(tenantId, id);
    if (!job || !['cancelled', 'posted', 'expired', 'failed', 'ready', 'paused', 'uploading'].includes(job.status)) return;
    if (!job.sourceRemoved) {
      if (job.multipartId) await this.store.abortMultipart(job.objectKey, job.multipartId).catch(() => undefined);
      await this.store.remove(job.objectKey).catch((e) => this.logger.warn(`remove ${id}: ${(e as Error).message}`));
      await this.repo.update(tenantId, id, { sourceRemoved: true });
    }
    if (!job.rowsRemoved) {
      while ((await this.repo.deleteRows(tenantId, id)) > 0) {
        /* batches of 50 000 so no single statement is huge */
      }
      await this.repo.update(tenantId, id, { rowsRemoved: true });
    }
  }

  /** Daily sweep: expire stale jobs (default 14 days) and finish half-done cleanups. */
  async sweep(retentionDays = Number(process.env.IMPORT_STAGING_RETENTION_DAYS) || 14): Promise<number> {
    let n = 0;
    for (const tenantId of await this.repo.tenantIds()) {
      for (const job of await this.repo.findPendingCleanup(tenantId)) {
        await this.cleanup(tenantId, job.id);
        n += 1;
      }
      for (const job of await this.repo.findExpired(tenantId, retentionDays)) {
        if (job.status !== 'posted') await this.repo.update(tenantId, job.id, { status: 'expired' as BulkStatus, finishedAt: new Date() });
        await this.cleanup(tenantId, job.id);
        n += 1;
      }
    }
    return n;
  }
}
