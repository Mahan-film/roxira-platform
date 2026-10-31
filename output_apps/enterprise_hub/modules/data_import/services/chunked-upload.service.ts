import { BadRequestException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  DEFAULT_CHUNK_BYTES,
  MAX_ACTIVE_UPLOADS_PER_TENANT,
  MAX_CHUNK_BYTES,
  MIN_CHUNK_BYTES,
  PACKAGE_TTL_MS,
  maxChunkedFileBytes,
  maxTmpBytes,
  minFreeDiskBytes,
  packageTmpRoot,
} from '../constants/package-import.constants';

/** وضعیت یک بارگذاری تکه‌ای روی دیسک (`meta.json`؛ `createdAt` توسط جاروکنندهٔ بسته‌ها هم دیده می‌شود). */
export interface UploadSession {
  uploadId: string;
  tenantId: string;
  fileName: string;
  size: number;
  chunkSize: number;
  totalChunks: number;
  received: number[];
  sha256?: string;
  createdAt: number;
  completed?: boolean;
}

export interface UploadStatus {
  uploadId: string;
  size: number;
  chunkSize: number;
  totalChunks: number;
  received: number[];
  missing: number[];
  complete: boolean;
}

const SEGMENT = /[^a-zA-Z0-9_-]/g;

/**
 * بارگذاری تکه‌ای و قابل‌ازسرگیری، دیسک‌محور: هر تکه در محل خودش (offset) روی یک فایل می‌نشیند و هرگز
 * کل فایل در حافظهٔ فرایند API جمع نمی‌شود. سقف‌ها: حجم هر فایل، کل فضای موقت، کف فضای آزاد دیسک،
 * تعداد بارگذاری ناتمام هر مستأجر. پوشهٔ هر بارگذاری `up-<id>` کنار بسته‌ها می‌نشیند و همان جاروکنندهٔ
 * TTL (`PackageStoreService.sweepExpired`) بارگذاری‌های رهاشده را پاک می‌کند.
 */
@Injectable()
export class ChunkedUploadService {
  private readonly root = packageTmpRoot();
  /** زنجیرهٔ سریال‌سازی نوشتن meta هر بارگذاری (تکه‌ها همزمان می‌رسند). */
  private readonly locks = new Map<string, Promise<unknown>>();

  private tenantDir(tenantId: string): string {
    return path.join(this.root, tenantId.replace(SEGMENT, '_'));
  }

  private uploadDir(tenantId: string, uploadId: string): string {
    if (!/^[0-9a-f-]{36}$/.test(uploadId)) {
      throw new NotFoundException('بارگذاری یافت نشد.');
    }
    return path.join(this.tenantDir(tenantId), `up-${uploadId}`);
  }

  private async readMeta(tenantId: string, uploadId: string): Promise<UploadSession> {
    try {
      const raw = await fs.readFile(path.join(this.uploadDir(tenantId, uploadId), 'meta.json'), 'utf8');
      const meta = JSON.parse(raw) as UploadSession;
      if (meta.tenantId !== tenantId || Date.now() - meta.createdAt > PACKAGE_TTL_MS) {
        throw new Error('expired');
      }
      return meta;
    } catch {
      throw new NotFoundException('این بارگذاری یافت نشد یا منقضی شده است.');
    }
  }

  private async writeMeta(meta: UploadSession): Promise<void> {
    const target = path.join(this.uploadDir(meta.tenantId, meta.uploadId), 'meta.json');
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(meta), 'utf8');
    await fs.rename(temp, target);
  }

  private async serial<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.then(task, task);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(key, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }

  /** مجموع بایت‌های بارگذاری‌های ناتمام + بسته‌های موجود (برآورد از meta و اندازهٔ فایل‌ها). */
  private async usedBytes(): Promise<number> {
    let total = 0;
    const walk = async (dir: string, depth: number): Promise<void> => {
      let entries: fsSync.Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && depth < 4) await walk(full, depth + 1);
        else if (entry.isFile()) {
          try {
            total += (await fs.stat(full)).size;
          } catch {
            /* vanished */
          }
        }
      }
    };
    await walk(this.root, 0);
    return total;
  }

  private async freeDiskBytes(): Promise<number | null> {
    try {
      await fs.mkdir(this.root, { recursive: true });
      const stat = await fs.statfs(this.root);
      return Number(stat.bavail) * Number(stat.bsize);
    } catch {
      return null;
    }
  }

  /** شروع بارگذاری؛ همهٔ سقف‌های حافظه/دیسک پیش از ساخت هر فایلی بررسی می‌شود. */
  async init(
    tenantId: string,
    input: { fileName: string; size: number; chunkSize?: number; sha256?: string },
  ): Promise<UploadStatus> {
    const size = Math.floor(Number(input.size));
    if (!Number.isFinite(size) || size <= 0) {
      throw new BadRequestException('حجم فایل نامعتبر است.');
    }
    if (size > maxChunkedFileBytes()) {
      throw new PayloadTooLargeException(
        `حجم فایل بیشتر از ${Math.round(maxChunkedFileBytes() / 1024 / 1024)} مگابایت است.`,
      );
    }
    const chunkSize = Math.min(
      MAX_CHUNK_BYTES,
      Math.max(MIN_CHUNK_BYTES, Math.floor(input.chunkSize ?? DEFAULT_CHUNK_BYTES)),
    );
    const totalChunks = Math.ceil(size / chunkSize);
    if (totalChunks > 2048) {
      throw new BadRequestException('تعداد تکه‌ها بیش از حد است؛ اندازهٔ تکه را بزرگ‌تر کنید.');
    }
    if (input.sha256 !== undefined && !/^[0-9a-f]{64}$/i.test(input.sha256)) {
      throw new BadRequestException('هش SHA-256 نامعتبر است.');
    }

    const free = await this.freeDiskBytes();
    if (free !== null && free - size < minFreeDiskBytes()) {
      throw new PayloadTooLargeException('فضای آزاد سرور برای این بارگذاری کافی نیست؛ بعداً دوباره تلاش کنید.');
    }
    if ((await this.usedBytes()) + size > maxTmpBytes()) {
      throw new PayloadTooLargeException('ظرفیت موقت ورود داده پر است؛ چند دقیقه بعد دوباره تلاش کنید.');
    }
    const tenantDir = this.tenantDir(tenantId);
    await fs.mkdir(tenantDir, { recursive: true });
    const active = (await fs.readdir(tenantDir)).filter((n) => n.startsWith('up-')).length;
    if (active >= MAX_ACTIVE_UPLOADS_PER_TENANT) {
      throw new BadRequestException('تعداد بارگذاری‌های ناتمام سازمان بیش از حد است.');
    }

    const uploadId = randomUUID();
    const dir = this.uploadDir(tenantId, uploadId);
    await fs.mkdir(dir, { recursive: true });
    const handle = await fs.open(path.join(dir, 'data.part'), 'w');
    await handle.truncate(size); // sparse: no space is reserved until chunks land
    await handle.close();
    const meta: UploadSession = {
      uploadId,
      tenantId,
      fileName: path.basename(String(input.fileName ?? 'upload')).slice(0, 200) || 'upload',
      size,
      chunkSize,
      totalChunks,
      received: [],
      sha256: input.sha256?.toLowerCase(),
      createdAt: Date.now(),
    };
    await this.writeMeta(meta);
    return this.toStatus(meta);
  }

  private toStatus(meta: UploadSession): UploadStatus {
    const have = new Set(meta.received);
    const missing: number[] = [];
    for (let i = 0; i < meta.totalChunks; i += 1) if (!have.has(i)) missing.push(i);
    return {
      uploadId: meta.uploadId,
      size: meta.size,
      chunkSize: meta.chunkSize,
      totalChunks: meta.totalChunks,
      received: [...have].sort((a, b) => a - b),
      missing,
      complete: missing.length === 0,
    };
  }

  async status(tenantId: string, uploadId: string): Promise<UploadStatus> {
    return this.toStatus(await this.readMeta(tenantId, uploadId));
  }

  /** نوشتن یک تکه؛ ارسال دوبارهٔ همان تکه بی‌ضرر است (ازسرگیری). طول تکه باید دقیقاً درست باشد. */
  async writeChunk(tenantId: string, uploadId: string, index: number, body: Buffer): Promise<UploadStatus> {
    return this.serial(`${tenantId}:${uploadId}`, async () => {
      const meta = await this.readMeta(tenantId, uploadId);
      if (meta.completed) {
        throw new BadRequestException('این بارگذاری قبلاً کامل شده است.');
      }
      if (!Number.isInteger(index) || index < 0 || index >= meta.totalChunks) {
        throw new BadRequestException('شمارهٔ تکه نامعتبر است.');
      }
      const expected =
        index === meta.totalChunks - 1 ? meta.size - index * meta.chunkSize : meta.chunkSize;
      if (body.length !== expected) {
        throw new BadRequestException(`اندازهٔ تکه ${index} باید ${expected} بایت باشد.`);
      }
      const handle = await fs.open(path.join(this.uploadDir(tenantId, uploadId), 'data.part'), 'r+');
      try {
        await handle.write(body, 0, body.length, index * meta.chunkSize);
      } finally {
        await handle.close();
      }
      if (!meta.received.includes(index)) meta.received.push(index);
      await this.writeMeta(meta);
      return this.toStatus(meta);
    });
  }

  /** پایان: همهٔ تکه‌ها و (در صورت اعلام) SHA-256 بررسی می‌شود. فایل کامل را برمی‌گرداند. */
  async complete(
    tenantId: string,
    uploadId: string,
  ): Promise<{ filePath: string; fileName: string; size: number }> {
    return this.serial(`${tenantId}:${uploadId}`, async () => {
      const meta = await this.readMeta(tenantId, uploadId);
      const status = this.toStatus(meta);
      if (!status.complete) {
        throw new BadRequestException(`تکه‌های ${status.missing.slice(0, 10).join('، ')} هنوز نرسیده است.`);
      }
      const filePath = path.join(this.uploadDir(tenantId, uploadId), 'data.part');
      if ((await fs.stat(filePath)).size !== meta.size) {
        throw new BadRequestException('اندازهٔ فایل کامل‌شده با مقدار اعلام‌شده نمی‌خواند.');
      }
      if (meta.sha256) {
        const hash = createHash('sha256');
        await new Promise<void>((resolve, reject) => {
          fsSync
            .createReadStream(filePath)
            .on('data', (chunk) => hash.update(chunk))
            .on('end', () => resolve())
            .on('error', reject);
        });
        if (hash.digest('hex') !== meta.sha256) {
          throw new BadRequestException('SHA-256 فایل با مقدار اعلام‌شده نمی‌خواند؛ بارگذاری آسیب دیده است.');
        }
      }
      meta.completed = true;
      await this.writeMeta(meta);
      return { filePath, fileName: meta.fileName, size: meta.size };
    });
  }

  /** پاک‌کردن پوشهٔ بارگذاری (پس از انتقال فایل به بسته یا لغو). */
  async discard(tenantId: string, uploadId: string): Promise<void> {
    try {
      await fs.rm(this.uploadDir(tenantId, uploadId), { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}
