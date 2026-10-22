import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as path from 'path';
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  MAX_REPORTED_ERRORS,
  MAX_SAMPLE_ROWS,
  maxImportRows,
  maxSheetBytes,
} from '../constants/data-import.constants';
import { BatchSummaryDto, UndoBatchResponseDto } from '../dto/batch-response.dto';
import { EntityCommitDto } from '../dto/entity-commit.dto';
import { EntityCommitResponseDto } from '../dto/entity-commit-response.dto';
import {
  EntityDescriptorDto,
  ImportRowFieldErrorDto,
} from '../dto/entity-descriptor-response.dto';
import { EntityPreviewResponseDto } from '../dto/entity-preview-response.dto';
import { parseCsv, ParsedCsv } from '../parsers/csv.parser';
import { parseXlsx } from '../parsers/xlsx.parser';
import { DataImportBatchRepository } from '../repositories/data-import-batch.repository';
import { normaliseAndValidate } from '../registry/field-validation';
import {
  buildEntityFallbackMapping,
  detectEntity,
} from '../registry/entity-detect';
import { EntityRegistryService } from '../registry/entity-registry.service';
import {
  EntityImportAdapter,
  ImportOwnerId,
  NormalisedRecord,
  RefusedRow,
} from '../registry/import-registry.types';
import { OpenRouterMappingService } from './openrouter-mapping.service';
import { UploadedFilePayload } from './data-import.service';
import { UploadStoreService } from './upload-store.service';
import { DailyImportQuotaService } from './daily-import-quota.service';

/** نتیجه ساخت نگاشت یک موجودیت. */
interface ResolvedMapping {
  mapping: Record<string, string>;
  source: 'llm' | 'fallback';
}

/**
 * سرویس عمومی ورود داده برای همه موجودیت‌ها (فاز ۱ سوت کسب‌وکار).
 *
 * جریان: تجزیه فایل → تشخیص موجودیت (مترادف، LLM فقط اگر مبهم) → نگاشت ستون
 * (LLM فقط در صورت نیاز) → نرمال‌سازی/اعتبارسنجی ردیف‌به‌ردیف → تشخیص تکراری
 * → درج از طریق آداپتور ماژول مالک → ثبت دسته برای undo.
 *
 * شناسه مستأجر تنها از توکن تأییدشده گرفته و به همه لایه‌ها پاس داده می‌شود
 * (Rule #4 - AGENTS.md).
 */
@Injectable()
export class EntityImportService {
  private readonly logger = new Logger(EntityImportService.name);

  constructor(
    private readonly registry: EntityRegistryService,
    private readonly openRouter: OpenRouterMappingService,
    private readonly uploadStore: UploadStoreService,
    private readonly batchRepository: DataImportBatchRepository,
    private readonly quota: DailyImportQuotaService,
  ) {}

  /** فهرست موجودیت‌های قابل ورود و فیلدهای آن‌ها. */
  listEntities(): EntityDescriptorDto[] {
    return this.registry.descriptors();
  }

  /** پیش‌نمایش فایل با تشخیص خودکار موجودیت (یا موجودیت اجباری). */
  async preview(
    tenantId: string,
    file?: UploadedFilePayload,
    forcedEntity?: string,
  ): Promise<EntityPreviewResponseDto> {
    await this.quota.assertWithinQuota(tenantId);
    const parsed = this.parseFile(file);
    const rowLimit = maxImportRows();
    if (parsed.rows.length > rowLimit) {
      throw new BadRequestException(
        `حداکثر ${rowLimit} ردیف در هر بارگذاری مجاز است.`,
      );
    }

    const sampleRows = parsed.rows.slice(0, MAX_SAMPLE_ROWS);
    const { adapter, confidence } = await this.resolveEntity(
      parsed.headers,
      sampleRows,
      forcedEntity,
    );

    const { mapping } = await this.resolveMapping(
      adapter,
      parsed.headers,
      sampleRows,
      confidence < 1,
    );

    const { records, errors } = this.buildRecords(adapter, {
      headers: parsed.headers,
      rows: parsed.rows,
      mapping,
    });

    const uploadId = randomUUID();
    this.uploadStore.save(tenantId, uploadId, {
      headers: parsed.headers,
      rows: parsed.rows,
      fileName: file?.originalname,
    });

    return {
      uploadId,
      detectedEntity: adapter.key,
      confidence,
      headers: parsed.headers,
      mapping: this.toNullableMapping(parsed.headers, mapping),
      sampleRows: this.buildSampleRows(parsed.headers, sampleRows),
      rowCount: parsed.rows.length,
      errors: errors.slice(0, MAX_REPORTED_ERRORS),
    };
  }

  /** ورود نهایی ردیف‌های معتبر و ثبت دسته برای undo. */
  async commit(
    tenantId: string,
    dto: EntityCommitDto,
  ): Promise<EntityCommitResponseDto> {
    const upload = this.uploadStore.get(tenantId, dto.uploadId);
    if (!upload) {
      throw new BadRequestException(
        'بارگذاری یافت نشد یا منقضی شده است؛ لطفاً دوباره بارگذاری کنید.',
      );
    }

    const adapter = this.registry.get(dto.entity);
    if (!adapter) {
      throw new BadRequestException(`موجودیت «${dto.entity}» پشتیبانی نمی‌شود.`);
    }
    this.assertMappingFields(adapter, dto.mapping);

    await this.quota.assertWithinQuota(tenantId);

    const { records, errors } = this.buildRecords(adapter, {
      headers: upload.headers,
      rows: upload.rows,
      mapping: this.toConcreteMapping(adapter, dto.mapping),
    });

    const failed = errors.map((error) => ({
      row: error.row,
      message: `${error.field}: ${error.message}`,
    }));

    const { unique, skipped } = await this.filterDuplicates(
      adapter,
      tenantId,
      records,
    );

    const result = await adapter.commit(tenantId, unique);
    for (const failure of result.failed) {
      failed.push({ row: failure.rowNumber, message: failure.message });
    }

    const batchId = randomUUID();
    await this.batchRepository.createBatch(tenantId, {
      id: batchId,
      entity: adapter.key,
      fileName: upload.fileName ?? 'upload',
      inserted: result.inserted.length,
    });
    if (result.inserted.length > 0) {
      await this.batchRepository.addItems(
        tenantId,
        batchId,
        adapter.key,
        result.inserted.map((row) => ({
          ownerId: row.ownerId,
          rowNumber: row.rowNumber,
        })),
      );
    }

    this.uploadStore.remove(tenantId, dto.uploadId);
    await this.quota.recordImport(tenantId);

    return {
      batchId,
      inserted: result.inserted.length,
      skippedDuplicates: skipped,
      failed,
    };
  }

  /** بازگردانی کامل یک دسته ورود (حذف دقیق ردیف‌های همان دسته). */
  async undoBatch(
    tenantId: string,
    batchId: string,
  ): Promise<UndoBatchResponseDto> {
    const batch = await this.batchRepository.findBatch(tenantId, batchId);
    if (!batch) {
      throw new NotFoundException('دسته ورود یافت نشد.');
    }
    if (batch.undone) {
      throw new BadRequestException('این دسته قبلاً بازگردانی شده است.');
    }

    const items = await this.batchRepository.findItems(tenantId, batchId);
    const ownerIdsByEntity = new Map<string, ImportOwnerId[]>();
    for (const item of items) {
      const list = ownerIdsByEntity.get(item.entity) ?? [];
      list.push(EntityImportService.normalizeOwnerId(item.ownerId));
      ownerIdsByEntity.set(item.entity, list);
    }

    let removed = 0;
    const refused: RefusedRow[] = [];
    for (const [entityKey, ownerIds] of ownerIdsByEntity) {
      const adapter = this.registry.get(entityKey);
      if (!adapter) {
        refused.push(
          ...ownerIds.map((ownerId) => ({
            ownerId,
            message: 'آداپتور این موجودیت یافت نشد.',
          })),
        );
        continue;
      }
      const outcome = await adapter.undo(
        tenantId,
        Array.from(new Set(ownerIds)),
      );
      removed += outcome.removed;
      refused.push(...outcome.refused);
    }

    await this.batchRepository.markUndone(tenantId, batchId);
    await this.batchRepository.removeItems(tenantId, batchId);

    return { removed, refused };
  }

  /** فهرست آخرین دسته‌های ورود مستأجر. */
  async listBatches(tenantId: string): Promise<BatchSummaryDto[]> {
    const batches = await this.batchRepository.listBatches(tenantId);
    return batches.map((batch) => ({
      batchId: batch.id,
      entity: batch.entity,
      fileName: batch.fileName,
      inserted: batch.inserted,
      createdAt: batch.createdAt,
      undone: batch.undone,
    }));
  }

  // ---------------------------------------------------------------------------
  // کمکی‌ها
  // ---------------------------------------------------------------------------

  /** بازگرداندن شناسه ردیف ذخیره‌شده در دسته به نوع عددی/رشته‌ای اصلی. */
  private static normalizeOwnerId(ownerId: string | number): ImportOwnerId {
    if (typeof ownerId === 'number') {
      return ownerId;
    }
    return /^\d+$/.test(ownerId) ? Number(ownerId) : ownerId;
  }

  private parseFile(file?: UploadedFilePayload): ParsedCsv {
    if (!file || !file.buffer) {
      throw new BadRequestException('فایلی بارگذاری نشده است.');
    }
    const extension = path.extname(file.originalname ?? '').toLowerCase();
    if (
      !ALLOWED_UPLOAD_EXTENSIONS.includes(
        extension as (typeof ALLOWED_UPLOAD_EXTENSIONS)[number],
      ) &&
      !(file.mimetype ?? '').toLowerCase().includes('spreadsheetml')
    ) {
      throw new BadRequestException('فقط فایل‌های CSV و XLSX پذیرفته می‌شوند.');
    }

    const sizeLimit = maxSheetBytes();
    if (file.buffer.length > sizeLimit) {
      throw new BadRequestException(
        `حجم فایل بیش از ${Math.round(sizeLimit / 1024 / 1024)} مگابایت است.`,
      );
    }

    try {
      if (this.isXlsxFile(file)) {
        return parseXlsx(file.buffer);
      }
      return parseCsv(file.buffer.toString('utf8'));
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'خطا در تجزیه فایل.',
      );
    }
  }

  private isXlsxFile(file: UploadedFilePayload): boolean {
    const extension = path.extname(file.originalname ?? '').toLowerCase();
    if (extension === '.xlsx') {
      return true;
    }
    return (file.mimetype ?? '').toLowerCase().includes('spreadsheetml');
  }

  private async resolveEntity(
    headers: string[],
    sampleRows: string[][],
    forcedEntity?: string,
  ): Promise<{ adapter: EntityImportAdapter; confidence: number }> {
    if (forcedEntity) {
      const adapter = this.registry.get(forcedEntity);
      if (!adapter) {
        throw new BadRequestException(
          `موجودیت «${forcedEntity}» پشتیبانی نمی‌شود.`,
        );
      }
      return { adapter, confidence: 1 };
    }

    const detection = detectEntity(headers, this.registry.all());
    if (!detection.ambiguous) {
      const adapter = this.registry.get(detection.key ?? '');
      if (adapter) {
        return { adapter, confidence: detection.confidence };
      }
    }

    try {
      const chosen = await this.openRouter.proposeEntity(
        headers,
        sampleRows,
        this.registry
          .all()
          .map((adapter) => ({ key: adapter.key, labelFa: adapter.labelFa })),
      );
      if (chosen) {
        const adapter = this.registry.get(chosen);
        if (adapter) {
          return { adapter, confidence: 1 };
        }
      }
    } catch (error) {
      this.logger.warn(
        `[DATA-IMPORT] تشخیص موجودیت با LLM ناموفق بود: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const fallbackAdapter =
      this.registry.get(detection.key ?? '') ?? this.registry.all()[0];
    if (!fallbackAdapter) {
      throw new BadRequestException('هیچ موجودیتی برای ورود داده ثبت نشده است.');
    }
    return { adapter: fallbackAdapter, confidence: detection.confidence };
  }

  private async resolveMapping(
    adapter: EntityImportAdapter,
    headers: string[],
    sampleRows: string[][],
    ambiguous: boolean,
  ): Promise<ResolvedMapping> {
    const fallback = buildEntityFallbackMapping(adapter.fields, headers);
    if (!ambiguous && Object.keys(fallback).length > 0) {
      return { mapping: fallback, source: 'fallback' };
    }

    try {
      const llm = await this.openRouter.proposeMappingForFields(
        headers,
        sampleRows,
        adapter.fields.map((field) => ({
          key: field.key,
          labelFa: field.labelFa,
        })),
      );
      if (Object.keys(llm).length > 0) {
        return { mapping: llm, source: 'llm' };
      }
    } catch (error) {
      this.logger.warn(
        `[DATA-IMPORT] نگاشت ستون‌ها با LLM ناموفق بود: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return { mapping: fallback, source: 'fallback' };
  }

  private buildRecords(
    adapter: EntityImportAdapter,
    upload: {
      headers: string[];
      rows: string[][];
      mapping: Record<string, string>;
    },
  ): { records: NormalisedRecord[]; errors: ImportRowFieldErrorDto[] } {
    const columnByField = this.resolveColumnIndex(
      adapter,
      upload.headers,
      upload.mapping,
    );
    const records: NormalisedRecord[] = [];
    const errors: ImportRowFieldErrorDto[] = [];

    upload.rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const values: Record<string, unknown> = {};
      let rowValid = true;

      for (const field of adapter.fields) {
        const column = columnByField.get(field.key);
        const raw = column === undefined ? '' : row[column] ?? '';
        const trimmed = String(raw).trim();

        if (trimmed === '') {
          if (field.required) {
            errors.push({
              row: rowNumber,
              field: field.key,
              message: `${field.labelFa} الزامی است.`,
            });
            rowValid = false;
          }
          continue;
        }

        const { value, error } = normaliseAndValidate(field, trimmed);
        if (error) {
          errors.push({ row: rowNumber, field: field.key, message: error });
          rowValid = false;
          continue;
        }
        values[field.key] = value;
      }

      if (rowValid) {
        records.push({ rowNumber, values });
      }
    });

    return { records, errors };
  }

  private resolveColumnIndex(
    adapter: EntityImportAdapter,
    headers: string[],
    mapping: Record<string, string>,
  ): Map<string, number> {
    const known = new Set(adapter.fields.map((field) => field.key));
    const columnByField = new Map<string, number>();
    headers.forEach((header, index) => {
      const field = mapping[header];
      if (field && known.has(field) && !columnByField.has(field)) {
        columnByField.set(field, index);
      }
    });
    return columnByField;
  }

  private async filterDuplicates(
    adapter: EntityImportAdapter,
    tenantId: string,
    records: NormalisedRecord[],
  ): Promise<{ unique: NormalisedRecord[]; skipped: number }> {
    const keyed = records.map((record) => ({
      record,
      keys: adapter.duplicateKeys(record),
    }));
    const allKeys = Array.from(new Set(keyed.flatMap((item) => item.keys)));

    let existing: string[] = [];
    if (allKeys.length > 0) {
      try {
        existing = await adapter.findExistingDuplicateKeys(tenantId, allKeys);
      } catch (error) {
        this.logger.warn(
          `[DATA-IMPORT] بررسی تکراری‌ها ناموفق بود: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const existingSet = new Set(existing);
    const seen = new Set<string>();
    const unique: NormalisedRecord[] = [];
    let skipped = 0;

    for (const item of keyed) {
      const isDuplicate =
        item.keys.length > 0 &&
        item.keys.some((key) => existingSet.has(key) || seen.has(key));

      if (isDuplicate) {
        skipped += 1;
        continue;
      }
      for (const key of item.keys) {
        seen.add(key);
      }
      unique.push(item.record);
    }

    return { unique, skipped };
  }

  private assertMappingFields(
    adapter: EntityImportAdapter,
    mapping: Record<string, string | null>,
  ): void {
    const known = new Set(adapter.fields.map((field) => field.key));
    for (const value of Object.values(mapping)) {
      if (value !== null && value !== '' && !known.has(value)) {
        throw new BadRequestException(
          `فیلد «${value}» در موجودیت «${adapter.key}» وجود ندارد.`,
        );
      }
    }
  }

  private toConcreteMapping(
    adapter: EntityImportAdapter,
    mapping: Record<string, string | null>,
  ): Record<string, string> {
    const known = new Set(adapter.fields.map((field) => field.key));
    const concrete: Record<string, string> = {};
    for (const [header, value] of Object.entries(mapping)) {
      if (value && known.has(value)) {
        concrete[header] = value;
      }
    }
    return concrete;
  }

  private toNullableMapping(
    headers: string[],
    mapping: Record<string, string>,
  ): Record<string, string | null> {
    const result: Record<string, string | null> = {};
    for (const header of headers) {
      result[header] = mapping[header] ?? null;
    }
    return result;
  }

  private buildSampleRows(
    headers: string[],
    rows: string[][],
  ): Array<Record<string, string>> {
    return rows.map((row) => {
      const sample: Record<string, string> = {};
      headers.forEach((header, index) => {
        sample[header] = row[index] ?? '';
      });
      return sample;
    });
  }
}
