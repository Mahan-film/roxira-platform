import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { ValidationError, validate } from 'class-validator';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  CRM_LEAD_FIELDS,
  CrmLeadField,
  IMPORT_BATCH_SIZE,
  MAX_IMPORT_ROWS,
  MAX_REPORTED_ERRORS,
  MAX_SAMPLE_ROWS,
} from '../constants/data-import.constants';
import { CreateLeadDto } from '../../crm/dto/create-lead.dto';
import { PipelineStage } from '../../crm/enums/crm.enums';
import { MONEY_SCALE } from '../../crm/constants/crm.constants';
import { CommitImportDto } from '../dto/commit-import.dto';
import {
  CommitResponseDto,
  ImportRowErrorDto,
} from '../dto/commit-response.dto';
import {
  MappingSource,
  PreviewResponseDto,
} from '../dto/preview-response.dto';
import { buildFallbackMapping } from '../mapping/lead-field-synonyms';
import { ParsedCsv, parseCsv } from '../parsers/csv.parser';
import { parseXlsx } from '../parsers/xlsx.parser';
import {
  DataImportRepository,
  ImportLeadData,
} from '../repositories/data-import.repository';
import { OpenRouterMappingService } from './openrouter-mapping.service';
import { UploadStoreService } from './upload-store.service';

/** شکل حداقلی فایل بارگذاری‌شده که به سرویس نیاز داریم. */
export interface UploadedFilePayload {
  originalname: string;
  mimetype?: string;
  size?: number;
  buffer: Buffer;
}

/** ردیف معتبرشده همراه با شماره ردیف فایل. */
interface ValidatedRow {
  rowNumber: number;
  email: string;
  data: ImportLeadData;
}

/**
 * سرویس ورود داده با کمک هوش مصنوعی (MVP سرنخ‌های CRM).
 *
 * - `preview`: فایل CSV یا XLSX را تجزیه می‌کند، نمونه‌ای محدود (۵ ردیف/۴۰ نویسه) به
 *   مدل می‌دهد و نگاشت پیشنهادی را با نگاشت قطعی مترادف‌ها پشتیبان‌سازی می‌کند.
 * - `commit`: هر ردیف را با قواعد `CreateLeadDto` اعتبارسنجی کرده، تکراری‌های
 *   (مستأجر، رایانامه) را رد و بقیه را گروهی درج می‌کند.
 *
 * همه نوشتن‌ها از طریق `DataImportRepository` (روی `CrmRepository`) و با
 * `tenantId` گرفته‌شده از توکن انجام می‌شود (Rule #3 و #4 - AGENTS.md).
 */
@Injectable()
export class DataImportService {
  private readonly logger = new Logger(DataImportService.name);

  constructor(
    private readonly repository: DataImportRepository,
    private readonly openRouter: OpenRouterMappingService,
    private readonly uploadStore: UploadStoreService,
  ) {}

  private roundMoney(value: number): number {
    const factor = 10 ** MONEY_SCALE;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  /** تجزیه CSV با تبدیل خطا به پاسخ ۴۰۰ فارسی. */
  private parseCsvOrThrow(text: string): ParsedCsv {
    try {
      return parseCsv(text);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'خطا در تجزیه فایل CSV.',
      );
    }
  }

  /** تجزیه XLSX با تبدیل خطا به پاسخ ۴۰۰ فارسی. */
  private parseXlsxOrThrow(buffer: Buffer): ParsedCsv {
    try {
      return parseXlsx(buffer);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'خطا در تجزیه فایل اکسل.',
      );
    }
  }

  /** تشخیص فایل XLSX بر پایه پسوند یا MIME type. */
  private isXlsxFile(file: UploadedFilePayload): boolean {
    const extension = path.extname(file.originalname ?? '').toLowerCase();
    if (extension === '.xlsx') {
      return true;
    }
    return (file.mimetype ?? '').toLowerCase().includes('spreadsheetml');
  }

  /** پیش‌نمایش فایل و نگاشت پیشنهادی ستون‌ها. */
  async preview(
    tenantId: string,
    file?: UploadedFilePayload,
  ): Promise<PreviewResponseDto> {
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

    const parsed = this.isXlsxFile(file)
      ? this.parseXlsxOrThrow(file.buffer)
      : this.parseCsvOrThrow(file.buffer.toString('utf8'));

    if (parsed.rows.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(
        `حداکثر ${MAX_IMPORT_ROWS} ردیف در هر بارگذاری مجاز است.`,
      );
    }

    const sampleRows = parsed.rows.slice(0, MAX_SAMPLE_ROWS);

    let mapping: Record<string, string> = {};
    let mappingSource: MappingSource = 'fallback';
    try {
      mapping = await this.openRouter.proposeMapping(
        parsed.headers,
        sampleRows,
      );
      mappingSource = 'llm';
    } catch (error) {
      this.logger.warn(
        `[DATA-IMPORT] نگاشت با LLM ناموفق بود؛ استفاده از نگاشت قطعی: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (Object.keys(mapping).length === 0) {
      mapping = buildFallbackMapping(parsed.headers);
      mappingSource = 'fallback';
    }

    const uploadId = randomUUID();
    this.uploadStore.save(tenantId, uploadId, {
      headers: parsed.headers,
      rows: parsed.rows,
    });

    return {
      uploadId,
      headers: parsed.headers,
      sampleRows,
      mapping,
      mappingSource,
      totalRows: parsed.rows.length,
    };
  }

  /** تأیید نگاشت و ورود نهایی ردیف‌های معتبر. */
  async commit(
    tenantId: string,
    dto: CommitImportDto,
  ): Promise<CommitResponseDto> {
    const upload = this.uploadStore.get(tenantId, dto.uploadId);
    if (!upload) {
      throw new BadRequestException(
        'بارگذاری یافت نشد یا منقضی شده است؛ لطفاً دوباره بارگذاری کنید.',
      );
    }

    const columnByField = this.resolveColumnIndex(upload.headers, dto.mapping);
    const now = new Date();
    const errors: ImportRowErrorDto[] = [];
    const validRows: ValidatedRow[] = [];

    for (let index = 0; index < upload.rows.length; index += 1) {
      const raw = this.buildRecord(upload.rows[index], columnByField);
      const candidate = plainToInstance(CreateLeadDto, raw, {
        enableImplicitConversion: true,
      });
      const validationErrors = await validate(candidate, {
        whitelist: true,
      });

      if (validationErrors.length > 0) {
        this.pushError(
          errors,
          index + 2,
          this.describeValidationErrors(validationErrors),
        );
        continue;
      }

      validRows.push({
        rowNumber: index + 2,
        email: candidate.email.trim().toLowerCase(),
        data: this.toEntityData(candidate, now),
      });
    }

    const { imported, skipped } = await this.persist(tenantId, validRows, errors);

    this.uploadStore.remove(tenantId, dto.uploadId);

    return { imported, skipped, errors };
  }

  /** درج ردیف‌های معتبر با رد کردن تکراری‌ها و درج گروهی. */
  private async persist(
    tenantId: string,
    validRows: ValidatedRow[],
    errors: ImportRowErrorDto[],
  ): Promise<{ imported: number; skipped: number }> {
    if (validRows.length === 0) {
      return { imported: 0, skipped: 0 };
    }

    const uniqueEmails = Array.from(
      new Set(validRows.map((row) => row.email)),
    );
    const existingEmails = new Set<string>();
    try {
      const found = await this.repository.findLeadEmails(
        tenantId,
        uniqueEmails,
      );
      for (const email of found) {
        existingEmails.add(email.toLowerCase());
      }
    } catch (error) {
      this.logger.warn(
        `[DATA-IMPORT] بررسی تکراری‌ها ناموفق بود: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const seen = new Set<string>();
    const pending: ValidatedRow[] = [];
    let skipped = 0;
    for (const row of validRows) {
      if (existingEmails.has(row.email) || seen.has(row.email)) {
        skipped += 1;
        continue;
      }
      seen.add(row.email);
      pending.push(row);
    }

    let imported = 0;
    for (let start = 0; start < pending.length; start += IMPORT_BATCH_SIZE) {
      const batch = pending.slice(start, start + IMPORT_BATCH_SIZE);
      try {
        imported += await this.repository.createLeads(
          tenantId,
          batch.map((row) => row.data),
        );
      } catch {
        for (const row of batch) {
          try {
            await this.repository.createLead(tenantId, row.data);
            imported += 1;
          } catch {
            this.pushError(
              errors,
              row.rowNumber,
              'درج ردیف ناموفق بود (احتمال تکرار همزمان رایانامه).',
            );
          }
        }
      }
    }

    return { imported, skipped };
  }

  /** ساخت نگاشت فیلد به شماره ستون (اولین ستون منطبق برای هر فیلد). */
  private resolveColumnIndex(
    headers: string[],
    mapping: Record<string, string>,
  ): Map<CrmLeadField, number> {
    const columnByField = new Map<CrmLeadField, number>();
    headers.forEach((header, index) => {
      const field = mapping[header];
      if (
        field &&
        (CRM_LEAD_FIELDS as readonly string[]).includes(field) &&
        !columnByField.has(field as CrmLeadField)
      ) {
        columnByField.set(field as CrmLeadField, index);
      }
    });
    return columnByField;
  }

  /** ساخت شیء خام سرنخ از یک ردیف بر پایه نگاشت ستون‌ها. */
  private buildRecord(
    row: string[],
    columnByField: Map<CrmLeadField, number>,
  ): Record<string, unknown> {
    const record: Record<string, unknown> = {};
    for (const [field, index] of columnByField) {
      const value = row[index];
      if (value !== undefined && value !== '') {
        record[field] = value;
      }
    }
    return record;
  }

  /** تبدیل DTO معتبرشده به داده قابل درج در جدول سرنخ‌ها. */
  private toEntityData(dto: CreateLeadDto, now: Date): ImportLeadData {
    return {
      fullName: dto.fullName.trim(),
      email: dto.email.trim().toLowerCase(),
      phone: dto.phone?.trim() || null,
      company: dto.company?.trim() || null,
      pipelineStage: dto.pipelineStage ?? PipelineStage.NEW,
      estimatedValue: this.roundMoney(dto.estimatedValue ?? 0),
      owner: dto.owner?.trim() || null,
      notes: dto.notes?.trim() || null,
      createdAt: now,
      updatedAt: now,
    };
  }

  private describeValidationErrors(errors: ValidationError[]): string {
    return errors
      .map((error) => {
        const messages = error.constraints
          ? Object.values(error.constraints).join('، ')
          : 'مقدار نامعتبر';
        return `${error.property}: ${messages}`;
      })
      .join(' | ');
  }

  private pushError(
    errors: ImportRowErrorDto[],
    row: number,
    reason: string,
  ): void {
    if (errors.length < MAX_REPORTED_ERRORS) {
      errors.push({ row, reason });
    }
  }
}
