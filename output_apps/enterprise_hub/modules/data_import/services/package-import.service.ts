import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import {
  MAX_MULTI_FILES,
  PACKAGE_ANALYZE_JOB,
  PACKAGE_COMMIT_JOB,
  PACKAGE_QUEUE_NAME,
  maxMultiPackageBytes,
  maxPackageBytes,
} from '../constants/package-import.constants';
import { ReconciliationReport } from '../analysis/reconciliation';
import { ChunkedUploadService } from './chunked-upload.service';
import { PackageReconciliationService } from './package-reconciliation.service';
import { PackageCommitDto } from '../dto/package-commit.dto';
import {
  PackageCommitResponseDto,
  PackageCreatedDto,
  PackageProgressDto,
  PackageStatusDto,
} from '../dto/package-response.dto';
import { DailyImportQuotaService } from './daily-import-quota.service';
import { PackageAnalysisService } from './package-analysis.service';
import { PackageCommitService } from './package-commit.service';
import { PackageProgressService } from './package-progress.service';
import {
  PackageState,
  PackageStoreService,
  PackageUpload,
} from './package-store.service';

/**
 * سرویس عمومی ورود بستهٔ دیتابیس (کل شرکت).
 *
 * جریان: بارگذاری (multipart) → ذخیرهٔ موقت هر مستأجر → صف تحلیل →
 * GET وضعیت/تحلیل → commit در ترتیب وابستگی → یک دستهٔ ورود برای undo.
 * شناسهٔ مستأجر فقط از توکن تأییدشده می‌آید (Rule #4 - AGENTS.md).
 */
@Injectable()
export class PackageImportService {
  private readonly logger = new Logger(PackageImportService.name);

  constructor(
    private readonly store: PackageStoreService,
    private readonly analysisService: PackageAnalysisService,
    private readonly commitService: PackageCommitService,
    private readonly quota: DailyImportQuotaService,
    private readonly progress: PackageProgressService,
    @Optional()
    @InjectQueue(PACKAGE_QUEUE_NAME)
    private readonly queue?: Queue,
    @Optional() private readonly reconciliation?: PackageReconciliationService,
    @Optional() private readonly chunked?: ChunkedUploadService,
  ) {}

  /**
   * ساخت بسته از بارگذاری‌های تکه‌ای کامل‌شده: یک شناسه = یک فایل، چند شناسه = پوشه/چندفایلی.
   * فایل‌ها روی دیسک جابه‌جا می‌شوند (نه کپی) و هرگز در حافظهٔ API جمع نمی‌شوند.
   */
  async createFromUploads(tenantId: string, uploadIds: string[]): Promise<PackageCreatedDto> {
    if (!this.chunked) {
      throw new BadRequestException('بارگذاری تکه‌ای فعال نیست.');
    }
    if (uploadIds.length === 0 || uploadIds.length > MAX_MULTI_FILES) {
      throw new BadRequestException(`تعداد فایل باید بین ۱ و ${MAX_MULTI_FILES} باشد.`);
    }
    await this.quota.assertWithinQuota(tenantId);
    const files: Array<{ name: string; filePath: string; size: number }> = [];
    let total = 0;
    for (const uploadId of new Set(uploadIds)) {
      const done = await this.chunked.complete(tenantId, uploadId);
      total += done.size;
      files.push({ name: done.fileName, filePath: done.filePath, size: done.size });
    }
    if (total > maxMultiPackageBytes()) {
      throw new BadRequestException(
        `مجموع حجم فایل‌ها بیشتر از ${Math.round(maxMultiPackageBytes() / 1024 / 1024)} مگابایت است.`,
      );
    }
    const state =
      files.length === 1
        ? await this.store.createPackageFromDisk(tenantId, files[0].filePath, files[0].name)
        : await this.store.createMultiPackage(tenantId, files);
    for (const uploadId of new Set(uploadIds)) {
      await this.chunked.discard(tenantId, uploadId);
    }
    await this.quota.recordImport(tenantId);
    await this.enqueueAnalysis(tenantId, state.packageId);
    return { packageId: state.packageId, status: 'analyzing' };
  }

  private async enqueueAnalysis(tenantId: string, packageId: string): Promise<void> {
    if (this.queue) {
      await this.queue.add(
        PACKAGE_ANALYZE_JOB,
        { tenantId, packageId },
        { removeOnComplete: true, removeOnFail: true },
      );
    } else {
      // بدون صف (محیط تست/تک‌پروسه): تحلیل همزمان.
      await this.analysisService.analyze(tenantId, packageId);
    }
  }

  /** گزارش مغایرت‌گیری پیش از ثبت (تعداد ردیف، جمع بدهکار/بستانکار، تکراری، ستون‌های بی‌نگاشت). */
  async reconcile(
    tenantId: string,
    packageId: string,
    dto: PackageCommitDto,
  ): Promise<ReconciliationReport> {
    if (!this.reconciliation) {
      throw new BadRequestException('مغایرت‌گیری فعال نیست.');
    }
    return this.reconciliation.reconcile(tenantId, packageId, dto.tables ?? []);
  }

  /** بارگذاری بسته و قرار دادن آن در صف تحلیل. */
  async createPackage(
    tenantId: string,
    file?: PackageUpload,
  ): Promise<PackageCreatedDto> {
    if (!file || !file.buffer) {
      throw new BadRequestException('فایلی بارگذاری نشده است.');
    }
    await this.quota.assertWithinQuota(tenantId);
    const state = await this.store.createPackage(
      tenantId,
      file,
      maxPackageBytes(),
    );
    await this.quota.recordImport(tenantId);

    await this.enqueueAnalysis(tenantId, state.packageId);

    return { packageId: state.packageId, status: 'analyzing' };
  }

  /** خواندن وضعیت و تحلیل کامل یک بسته. */
  async getPackage(
    tenantId: string,
    packageId: string,
  ): Promise<PackageStatusDto> {
    const state = await this.store.getState(tenantId, packageId);
    if (!state) {
      throw new NotFoundException('این بسته یافت نشد یا منقضی شده است.');
    }
    return this.toStatusDto(state);
  }

  /** ثبت نهایی بسته و بازگرداندن شناسهٔ دستهٔ ورود. */
  async commitPackage(
    tenantId: string,
    packageId: string,
    dto: PackageCommitDto,
    actor: { canOverrideImbalance: boolean; userId?: string } = { canOverrideImbalance: false },
  ): Promise<PackageCommitResponseDto> {
    const state = await this.store.getState(tenantId, packageId);
    if (!state) {
      throw new NotFoundException('این بسته یافت نشد یا منقضی شده است.');
    }
    if (state.status !== 'ready') {
      throw new BadRequestException(
        'این بسته آمادهٔ ثبت نیست؛ ابتدا تحلیل باید با موفقیت کامل شود.',
      );
    }
    if (!dto?.tables || dto.tables.length === 0) {
      throw new BadRequestException('هیچ جدولی برای ثبت انتخاب نشده است.');
    }
    await this.quota.assertWithinQuota(tenantId);

    // Server-side gate: the client's report is never trusted. An imbalance blocks the commit unless
    // the platform admin / tenant owner explicitly confirms it (and that is logged).
    if (this.reconciliation) {
      const report = await this.reconciliation.reconcile(tenantId, packageId, dto.tables);
      if (!report.balanced) {
        if (!(dto.confirmImbalance === true && actor.canOverrideImbalance)) {
          throw new ConflictException({
            code: 'IMBALANCE',
            message:
              'ثبت مسدود شد: داده‌ها تراز نیستند. اختلاف را اصلاح کنید یا مدیر/مالک سازمان صراحتاً تأیید کند.',
            report,
          });
        }
        this.logger.warn(
          `[PACKAGE-IMPORT] ثبت بسته ${packageId} با عدم‌تراز توسط ${actor.userId ?? 'نامشخص'} تأیید شد: ${report.blockersFa.join(' | ')}`,
        );
      }
    }

    const batchId = randomUUID();
    state.status = 'committing';
    state.batchId = batchId;
    await this.store.writeState(state);

    if (this.queue) {
      await this.queue.add(
        PACKAGE_COMMIT_JOB,
        { tenantId, packageId, tables: dto.tables, batchId },
        { removeOnComplete: true, removeOnFail: true },
      );
    } else {
      await this.commitService.commit(tenantId, packageId, dto.tables, batchId);
    }

    return { batchId };
  }

  /** خواندن پیشرفت commit یک بسته. */
  async getProgress(
    tenantId: string,
    packageId: string,
  ): Promise<PackageProgressDto> {
    const progress = await this.progress.get(tenantId, packageId);
    if (progress) {
      return progress;
    }
    const state = await this.store.getState(tenantId, packageId);
    if (!state) {
      throw new NotFoundException('این بسته یافت نشد یا منقضی شده است.');
    }
    return {
      phase: state.status,
      done: 0,
      total: 0,
      inserted: {},
      skipped: {},
      errors: state.error ? [state.error] : [],
    };
  }

  /** تبدیل وضعیت ذخیره‌شده به قرارداد پاسخ GET /packages/:id. */
  private toStatusDto(state: PackageState): PackageStatusDto {
    const analysis = state.analysis;
    const dto: PackageStatusDto = {
      packageId: state.packageId,
      status: state.status,
      tables: analysis?.tables ?? [],
      relationships: analysis?.relationships ?? [],
      health: analysis?.health ?? { checks: [] },
      currencies: analysis?.currencies ?? [],
    };
    if (analysis?.format) {
      dto.format = analysis.format;
    }
    if (state.error) {
      dto.error = state.error;
    }
    return dto;
  }
}
