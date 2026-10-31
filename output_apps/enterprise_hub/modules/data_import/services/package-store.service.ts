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
  PACKAGE_UPLOAD_EXTENSIONS,
  packageTmpRoot,
} from '../constants/package-import.constants';

/** فاصلهٔ اجرای جاروکننده: ۱۵ دقیقه. */
const PACKAGE_SWEEP_INTERVAL_MS = 15 * 60 * 1000;
import { PackageAnalysis } from '../analysis/package-analysis';
import { FOREIGN_BINARY_MESSAGE } from '../parsers/sql-dump.parser';

/** وضعیت چرخهٔ عمر یک بستهٔ دیتابیس. */
export type PackageStatus =
  | 'analyzing'
  | 'ready'
  | 'failed'
  | 'committing'
  | 'committed';

/** نوع منبع بسته. */
export type PackageKind = 'sqlite' | 'sql' | 'zip';

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
}

/** فایل بارگذاری‌شدهٔ حداقلی موردنیاز. */
export interface PackageUpload {
  originalname: string;
  mimetype?: string;
  size?: number;
  buffer: Buffer;
}

function isZip(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)
  );
}

function isSqliteHeader(buffer: Buffer): boolean {
  return (
    buffer.length >= 16 &&
    buffer.subarray(0, 16).toString('latin1') === 'SQLite format 3\u0000'
  );
}

/** پسوندهای پشتیبان باینری دیتابیس‌های دیگر (SQL Server / PostgreSQL). */
const FOREIGN_BINARY_EXTENSIONS = ['.bak', '.mdf', '.ldf', '.ndf', '.dump', '.backup'];

/** SQL Server backup (MTF) starts with "TAPE"; pg_dump custom format starts with "PGDMP". */
function isForeignBinary(fileName: string, buffer: Buffer): boolean {
  const lower = (fileName ?? '').toLowerCase();
  if (FOREIGN_BINARY_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return true;
  }
  const magic = buffer.subarray(0, 5).toString('latin1');
  return magic === 'PGDMP' || magic.startsWith('TAPE');
}

/** تشخیص نوع بسته از محتوا و پسوند. */
export function detectPackageKind(fileName: string, buffer: Buffer): PackageKind {
  if (isForeignBinary(fileName, buffer)) {
    throw new BadRequestException(FOREIGN_BINARY_MESSAGE);
  }
  if (isSqliteHeader(buffer)) {
    return 'sqlite';
  }
  if (isZip(buffer)) {
    return 'zip';
  }
  const lower = (fileName ?? '').toLowerCase();
  if (lower.endsWith('.sql')) {
    return 'sql';
  }
  if (
    lower.endsWith('.sqlite') ||
    lower.endsWith('.sqlite3') ||
    lower.endsWith('.db')
  ) {
    return 'sqlite';
  }
  throw new BadRequestException(
    'نوع بسته پشتیبانی نمی‌شود؛ فقط .sqlite/.sqlite3/.db، .sql و .zip مجاز است.',
  );
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
    return path.join(this.packageDir(tenantId, packageId), `source${ext}`);
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

    const extension = path.extname(file.originalname ?? '').toLowerCase();
    if (isForeignBinary(file.originalname, file.buffer)) {
      throw new BadRequestException(FOREIGN_BINARY_MESSAGE);
    }
    if (
      !PACKAGE_UPLOAD_EXTENSIONS.includes(
        extension as (typeof PACKAGE_UPLOAD_EXTENSIONS)[number],
      )
    ) {
      throw new BadRequestException(
        'فقط فایل‌های .sqlite/.sqlite3/.db، .sql و .zip پذیرفته می‌شوند.',
      );
    }
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
    const extension = path.extname(state.fileName ?? '').toLowerCase();
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
