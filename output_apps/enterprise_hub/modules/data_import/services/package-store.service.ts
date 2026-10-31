import type { OcrResult } from './package-ocr.service';
import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  PACKAGE_TTL_MS,
  packageTmpRoot,
} from '../constants/package-import.constants';

/** فاصلهٔ اجرای جاروکننده: ۱۵ دقیقه. */
const PACKAGE_SWEEP_INTERVAL_MS = 15 * 60 * 1000;
import { PackageAnalysis } from '../analysis/package-analysis';
import { detectFormat, UNKNOWN_FORMAT_MESSAGE } from '../readers/format-registry';
import { FormatId, UnsupportedFormatError } from '../readers/reader.types';

/** وضعیت چرخهٔ عمر یک بستهٔ دیتابیس. */
export type PackageStatus =
  | 'analyzing'
  | 'ready'
  | 'failed'
  | 'committing'
  | 'committed';

/** نوع منبع بسته: شناسهٔ قالبِ تشخیص‌داده‌شده از روی محتوا (readers/reader.types.ts). */
export type PackageKind = FormatId;

/** وضعیت کامل یک بسته که روی دیسک موقت نگه داشته می‌شود. */
export interface PackageState {
  packageId: string;
  tenantId: string;
  fileName: string;
  kind: PackageKind;
  size: number;
  createdAt: number;
  status: PackageStatus;
  error?: string;
  analysis?: PackageAnalysis;
  batchId?: string;
  /** برای بستهٔ چندفایلی (پوشه/انتخاب چندتایی): نام اصلی هر فایل به ترتیب `parts/<n>.bin`. */
  parts?: string[];
  /** آخرین گزارش مغایرت‌گیری (کلید = هش انتخاب‌ها) تا commit دوباره محاسبه نکند. */
  reconciliation?: { key: string; report: unknown };
  /** جدول‌های OCR یک PDF اسکن‌شده یا تصویر؛ مدل فقط یک بار صدا زده می‌شود. */
  ocr?: OcrResult;
  /** کلید انتخاب‌هایی که صفحهٔ بازبینی برایشان ساخته شد؛ ثبت دادهٔ OCR بدون آن مسدود است. */
  reviewedKey?: string;
}

/** فایل بارگذاری‌شدهٔ حداقلی موردنیاز. */
export interface PackageUpload {
  originalname: string;
  mimetype?: string;
  size?: number;
  buffer: Buffer;
}

/** پسوند امن برای نام فایل روی دیسک (فقط حروف/رقم کوتاه؛ هرگز مسیر یا نویسهٔ کنترلی). */
export function safeExtension(fileName: string): string {
  const ext = path.extname(fileName ?? '').toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '.bin';
}

/**
 * تشخیص نوع بسته از «محتوا» (پسوند فقط تساوی‌شکن است). قالب‌هایی که عمداً خوانده نمی‌شوند
 * (Access، .bak، PGDMP، PDF/تصویر) با راهنمای فارسی و `BadRequestException` رد می‌شوند.
 */
export function detectPackageKind(fileName: string, buffer: Buffer): PackageKind {
  const detection = detectFormat(buffer, fileName);
  if (!detection.reader) {
    throw new BadRequestException(UNKNOWN_FORMAT_MESSAGE);
  }
  if (detection.id === 'access' || detection.id === 'mssql-backup' || detection.id === 'pg-custom') {
    try {
      detection.reader.read(buffer, { fileName, depth: 0 });
    } catch (error) {
      if (error instanceof UnsupportedFormatError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
  return detection.id;
}

/**
 * انبار بسته‌های دیتابیس روی دیسک موقت (per-tenant، TTL ۲ ساعت).
 *
 * دادهٔ خام مشتری فقط در پوشهٔ موقت همان مستأجر نگه داشته می‌شود و هرگز به
 * پایگاه‌داده یا مخزن دیگری نوشته نمی‌شود (Rule #4 - AGENTS.md).
 */
@Injectable()
export class PackageStoreService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PackageStoreService.name);
  private readonly root: string;
  private sweepTimer?: NodeJS.Timeout;

  constructor() {
    this.root = packageTmpRoot();
  }

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    void this.sweepExpired();
    this.sweepTimer = setInterval(() => void this.sweepExpired(), PACKAGE_SWEEP_INTERVAL_MS);
    this.sweepTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
    }
  }

  /**
   * حذف پوشهٔ بسته‌های منقضی (بیش از TTL) از دیسک موقت. `getState` فقط دسترسی را
   * می‌بندد؛ بدون این جاروکننده فایل‌های آپلودشده تا ریبوت روی دیسک می‌ماندند.
   * بسته‌ای که هنوز در حال تحلیل/ثبت است تا دو برابر TTL نگه داشته می‌شود.
   */
  async sweepExpired(now: number = Date.now()): Promise<number> {
    let removed = 0;
    let tenantDirs: string[];
    try {
      tenantDirs = await fs.readdir(this.root);
    } catch {
      return 0;
    }
    for (const tenantDir of tenantDirs) {
      const tenantPath = path.join(this.root, tenantDir);
      let packageDirs: string[];
      try {
        packageDirs = await fs.readdir(tenantPath);
      } catch {
        continue;
      }
      for (const packageDir of packageDirs) {
        const dir = path.join(tenantPath, packageDir);
        try {
          if (await this.isExpired(dir, now)) {
            await fs.rm(dir, { recursive: true, force: true });
            removed += 1;
          }
        } catch (error) {
          this.logger.warn(
            `[PACKAGE-IMPORT] پاک‌سازی ${dir} ناموفق بود: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }
    if (removed > 0) {
      this.logger.log(`[PACKAGE-IMPORT] ${removed} بستهٔ منقضی از دیسک حذف شد.`);
    }
    return removed;
  }

  private async isExpired(dir: string, now: number): Promise<boolean> {
    let createdAt: number;
    let busy = false;
    try {
      const state = JSON.parse(
        await fs.readFile(path.join(dir, 'meta.json'), 'utf8'),
      ) as PackageState;
      createdAt = state.createdAt;
      busy = state.status === 'analyzing' || state.status === 'committing';
    } catch {
      // Missing/corrupt meta.json: fall back to the directory's mtime.
      createdAt = (await fs.stat(dir)).mtimeMs;
    }
    if (!Number.isFinite(createdAt)) {
      createdAt = (await fs.stat(dir)).mtimeMs;
    }
    return now - createdAt > (busy ? PACKAGE_TTL_MS * 2 : PACKAGE_TTL_MS);
  }

  private safeSegment(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  private packageDir(tenantId: string, packageId: string): string {
    return path.join(this.root, this.safeSegment(tenantId), packageId);
  }

  private metaPath(tenantId: string, packageId: string): string {
    return path.join(this.packageDir(tenantId, packageId), 'meta.json');
  }

  private sourcePath(
    tenantId: string,
    packageId: string,
    extension: string,
  ): string {
    const ext = extension.startsWith('.') ? extension : `.${extension}`;
    return path.join(this.packageDir(tenantId, packageId), `source${safeExtension(ext)}`);
  }

  /** ذخیرهٔ فایل بسته و ساخت وضعیت اولیهٔ «در حال تحلیل». */
  async createPackage(
    tenantId: string,
    file: PackageUpload,
    maxBytes: number,
  ): Promise<PackageState> {
    if (!file || !file.buffer) {
      throw new BadRequestException('فایلی بارگذاری نشده است.');
    }
    if (file.buffer.length > maxBytes) {
      throw new BadRequestException(
        `حجم فایل بیشتر از ${Math.round(maxBytes / 1024 / 1024)} مگابایت است.`,
      );
    }

    const extension = safeExtension(file.originalname);
    const kind = detectPackageKind(file.originalname, file.buffer);

    const packageId = randomUUID();
    const dir = this.packageDir(tenantId, packageId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      this.sourcePath(tenantId, packageId, extension),
      file.buffer,
    );

    const state: PackageState = {
      packageId,
      tenantId,
      fileName: file.originalname ?? 'package',
      kind,
      size: file.buffer.length,
      createdAt: Date.now(),
      status: 'analyzing',
    };
    await this.writeState(state);
    return state;
  }

  /**
   * ساخت بسته از فایلی که پیش‌تر (بارگذاری تکه‌ای) روی دیسک موقت کامل شده است. فایل جابه‌جا می‌شود
   * (rename، بدون کپی)؛ برای تشخیص قالب یک بار در حافظه خوانده می‌شود و سقف آن همان سقف هر فایل است.
   */
  async createPackageFromDisk(
    tenantId: string,
    filePath: string,
    originalName: string,
  ): Promise<PackageState> {
    const buffer = await fs.readFile(filePath);
    const kind = detectPackageKind(originalName, buffer);
    const packageId = randomUUID();
    await fs.mkdir(this.packageDir(tenantId, packageId), { recursive: true });
    await fs.rename(filePath, this.sourcePath(tenantId, packageId, safeExtension(originalName)));
    const state: PackageState = {
      packageId,
      tenantId,
      fileName: originalName || 'package',
      kind,
      size: buffer.length,
      createdAt: Date.now(),
      status: 'analyzing',
    };
    await this.writeState(state);
    return state;
  }

  /** بستهٔ چندفایلی (رها کردن پوشه یا چند فایل): هر فایل به‌صورت `parts/<n>.bin` نگه داشته می‌شود. */
  async createMultiPackage(
    tenantId: string,
    files: Array<{ name: string; filePath: string; size: number }>,
  ): Promise<PackageState> {
    if (files.length === 0) {
      throw new BadRequestException('هیچ فایلی انتخاب نشده است.');
    }
    const packageId = randomUUID();
    const dir = path.join(this.packageDir(tenantId, packageId), 'parts');
    await fs.mkdir(dir, { recursive: true });
    const names: string[] = [];
    let size = 0;
    for (const [index, file] of files.entries()) {
      await fs.rename(file.filePath, path.join(dir, `${index}.bin`));
      names.push(file.name);
      size += file.size;
    }
    const state: PackageState = {
      packageId,
      tenantId,
      fileName: names.length === 1 ? names[0] : `${names.length} files`,
      kind: 'multi',
      size,
      createdAt: Date.now(),
      status: 'analyzing',
      parts: names,
    };
    await this.writeState(state);
    return state;
  }

  /** مسیر یکی از فایل‌های بستهٔ چندفایلی روی دیسک موقت. */
  partFilePath(tenantId: string, packageId: string, index: number): string {
    return path.join(this.packageDir(tenantId, packageId), 'parts', `${index}.bin`);
  }

  /** خواندن یکی از فایل‌های بستهٔ چندفایلی. */
  async readPart(tenantId: string, packageId: string, index: number): Promise<Buffer> {
    return fs.readFile(
      path.join(this.packageDir(tenantId, packageId), 'parts', `${index}.bin`),
    );
  }

  /** خواندن وضعیت بسته در محدودهٔ همان مستأجر (با بررسی TTL). */
  async getState(
    tenantId: string,
    packageId: string,
  ): Promise<PackageState | null> {
    try {
      const raw = await fs.readFile(this.metaPath(tenantId, packageId), 'utf8');
      const state = JSON.parse(raw) as PackageState;
      if (state.tenantId !== tenantId) {
        return null;
      }
      if (Date.now() - state.createdAt > PACKAGE_TTL_MS) {
        return null;
      }
      return state;
    } catch {
      return null;
    }
  }

  /** نوشتن دوبارهٔ وضعیت بسته. */
  async writeState(state: PackageState): Promise<void> {
    await fs.mkdir(this.packageDir(state.tenantId, state.packageId), {
      recursive: true,
    });
    // Atomic replace: a status poll that reads meta.json while the analysis job rewrites it used
    // to see a truncated file, fail JSON.parse and answer 404 (seen in the E2E sandbox).
    const target = this.metaPath(state.tenantId, state.packageId);
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(state), 'utf8');
    await fs.rename(temp, target);
  }

  /** خواندن بایت‌های فایل اصلی بسته. */
  async readSource(tenantId: string, packageId: string): Promise<Buffer> {
    const state = await this.getState(tenantId, packageId);
    if (!state) {
      throw new BadRequestException('این بسته یافت نشد یا منقضی شده است.');
    }
    const extension = safeExtension(state.fileName);
    try {
      return await fs.readFile(this.sourcePath(tenantId, packageId, extension));
    } catch {
      throw new BadRequestException('فایل بسته یافت نشد یا منقضی شده است.');
    }
  }

  /** حذف پوشهٔ یک بسته (پس از پایان یا انقضا). */
  async remove(tenantId: string, packageId: string): Promise<void> {
    try {
      await fs.rm(this.packageDir(tenantId, packageId), {
        recursive: true,
        force: true,
      });
    } catch {
      // عدم موفقیت پاک‌سازی نباید جریان اصلی را متوقف کند.
    }
  }
}
