import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  PACKAGE_ENTITY_ORDER,
  PACKAGE_MAX_ERRORS,
} from '../constants/package-import.constants';
import { iterateRows } from '../analysis/package-analysis';
import {
  PackageTableReader,
  stringifyCell,
} from '../parsers/package-source.types';import { normaliseAndValidate } from '../registry/field-validation';
import {
  EntityImportAdapter,
  NormalisedRecord,
} from '../registry/import-registry.types';
import { EntityRegistryService } from '../registry/entity-registry.service';
import { PackageAnalysisService } from './package-analysis.service';
import { PackageProgressService } from './package-progress.service';
import { PackageStoreService } from './package-store.service';

/** انتخاب یک جدول برای commit از بدنهٔ درخواست. */
export interface PackageCommitTableInput {
  name: string;
  entity: string;
  mapping: Record<string, string | null>;
  skip?: boolean;
}

/**
 * ثبت نهایی بستهٔ دیتابیس در ترتیب وابستگی موجودیت‌ها.
 *
 * همهٔ ردیف‌ها در یک «دستهٔ ورود» ثبت می‌شوند تا endpoint موجود undo بتواند کل
 * مهاجرت را یکجا بازگرداند. تکراری‌ها با کلید طبیعی رد و شمارش می‌شوند.
 */
@Injectable()
export class PackageCommitService {
  private readonly logger = new Logger(PackageCommitService.name);

  constructor(
    private readonly store: PackageStoreService,
    private readonly analysisService: PackageAnalysisService,
    private readonly registry: EntityRegistryService,
    private readonly progress: PackageProgressService,
  ) {}

  /** ثبت انتخاب‌های کاربر در یک دستهٔ ورود واحد. */
  async commit(
    tenantId: string,
    packageId: string,
    tables: PackageCommitTableInput[],
    batchId: string,
  ): Promise<{ batchId: string }> {
    const state = await this.store.getState(tenantId, packageId);
    if (!state) {
      throw new BadRequestException('این بسته یافت نشد یا منقضی شده است.');
    }
    if (!state.analysis) {
      throw new BadRequestException('این بسته هنوز تحلیل نشده است.');
    }

    const selections = tables.filter((table) => !table.skip);
    const total = selections.reduce((sum, selection) => {
      const analysis = state.analysis?.tables.find(
        (item) => item.name === selection.name,
      );
      return sum + (analysis?.rowCount ?? 0);
    }, 0);

    await this.progress.set(tenantId, packageId, {
      phase: 'committing',
      done: 0,
      total,
      inserted: {},
      skipped: {},
      errors: [],
    });

    const buffer = await this.store.readSource(tenantId, packageId);
    const parsed = await this.analysisService.parsePackageBuffer(
      buffer,
      state.fileName,
      state.kind,
    );

    const inserted: Record<string, number> = {};
    const skipped: Record<string, number> = {};
    const errors: string[] = [];
    const batchItems: Array<{ entity: string; ownerId: number | string; rowNumber: number }> =
      [];
    let done = 0;

    try {
      const orderedEntities = this.orderEntities(
        selections.map((selection) => selection.entity),
      );

      for (const entity of orderedEntities) {
        const adapter = this.registry.get(entity);
        if (!adapter) {
          errors.push(`آداپتور موجودیت «${entity}» یافت نشد.`);
          continue;
        }
        const entitySelections = selections.filter(
          (selection) => selection.entity === entity,
        );

        for (const selection of entitySelections) {
          const table = parsed.tables.find(
            (item) => item.name === selection.name,
          );
          const analysis = state.analysis?.tables.find(
            (item) => item.name === selection.name,
          );
          if (!table) {
            errors.push(`جدول «${selection.name}» یافت نشد.`);
            continue;
          }

          const mapping = this.concreteMapping(
            adapter,
            selection.mapping,
            analysis?.mapping ?? {},
          );
          const { records, errors: rowErrors } = this.buildRecords(
            adapter,
            table,
            mapping,
          );
          for (const message of rowErrors.slice(0, PACKAGE_MAX_ERRORS)) {
            errors.push(message);
          }

          const { unique, skippedCount } = await this.filterDuplicates(
            adapter,
            tenantId,
            records,
          );
          skipped[entity] = (skipped[entity] ?? 0) + skippedCount;

          const result = await adapter.commit(tenantId, unique);
          for (const row of result.inserted) {
            batchItems.push({
              entity,
              ownerId: row.ownerId,
              rowNumber: row.rowNumber,
            });
          }
          inserted[entity] = (inserted[entity] ?? 0) + result.inserted.length;
          for (const failure of result.failed) {
            if (errors.length < PACKAGE_MAX_ERRORS) {
              errors.push(failure.message);
            }
          }

          done += table.rowCount;
          await this.progress.set(tenantId, packageId, {
            phase: 'committing',
            done,
            total,
            inserted,
            skipped,
            errors: errors.slice(0, PACKAGE_MAX_ERRORS),
          });
        }
      }
    } finally {
      parsed.close();
    }

    state.status = 'committed';
    state.batchId = batchId;
    await this.store.writeState(state);

    await this.progress.set(tenantId, packageId, {
      phase: 'committed',
      done,
      total,
      inserted,
      skipped,
      errors: errors.slice(0, PACKAGE_MAX_ERRORS),
    });

    this.logger.log(
      `[PACKAGE-IMPORT] بسته ${packageId} در دسته ${batchId} ثبت شد (${batchItems.length} ردیف).`,
    );

    return { batchId };
  }

  /** ترتیب موجودیت‌ها بر پایهٔ وابستگی (سپس هر موجودیت ناشناخته). */
  private orderEntities(entities: string[]): string[] {
    const unique = Array.from(new Set(entities));
    const ordered: string[] = [];
    for (const entity of PACKAGE_ENTITY_ORDER) {
      if (unique.includes(entity)) {
        ordered.push(entity);
      }
    }
    for (const entity of unique) {
      if (!ordered.includes(entity)) {
        ordered.push(entity);
      }
    }
    return ordered;
  }

  /** ادغام نگاشت ارسالی کاربر با نگاشت پیشنهادی تحلیل. */
  private concreteMapping(
    adapter: EntityImportAdapter,
    provided: Record<string, string | null>,
    fallback: Record<string, string | null>,
  ): Record<string, string> {
    const known = new Set(adapter.fields.map((field) => field.key));
    const result: Record<string, string> = {};
    const source =
      Object.keys(provided).length > 0 ? provided : fallback;
    for (const [column, field] of Object.entries(source)) {
      if (field && known.has(field)) {
        result[column] = field;
      }
    }
    return result;
  }

  /** ساخت ردیف‌های نرمال‌شده از یک جدول بر پایهٔ نگاشت فیلدها. */
  private buildRecords(
    adapter: EntityImportAdapter,
    table: PackageTableReader,
    mapping: Record<string, string>,
  ): { records: NormalisedRecord[]; errors: string[] } {
    const columnByField = new Map<string, string>();
    for (const [column, field] of Object.entries(mapping)) {
      if (field && !columnByField.has(field)) {
        columnByField.set(field, column);
      }
    }
    const records: NormalisedRecord[] = [];
    const errors: string[] = [];
    let rowNumber = 1;

    for (const row of iterateRows(table)) {
      rowNumber += 1;
      const values: Record<string, unknown> = {};
      let valid = true;

      for (const field of adapter.fields) {
        const column = columnByField.get(field.key);
        const raw =
          column === undefined ? '' : stringifyCell(row[column]).trim();
        if (raw === '') {
          if (field.required) {
            valid = false;
            if (errors.length < PACKAGE_MAX_ERRORS) {
              errors.push(`ردیف ${rowNumber}: ${field.labelFa} الزامی است.`);
            }
          }
          continue;
        }
        const { value, error } = normaliseAndValidate(field, raw);
        if (error) {
          valid = false;
          if (errors.length < PACKAGE_MAX_ERRORS) {
            errors.push(`ردیف ${rowNumber}: ${error}`);
          }
          continue;
        }
        values[field.key] = value;
      }

      if (valid) {
        records.push({ rowNumber, values });
      }
    }

    return { records, errors };
  }

  /** رد کردن تکراری‌ها بر پایهٔ کلید طبیعی موجودیت. */
  private async filterDuplicates(
    adapter: EntityImportAdapter,
    tenantId: string,
    records: NormalisedRecord[],
  ): Promise<{ unique: NormalisedRecord[]; skippedCount: number }> {
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
          `[PACKAGE-IMPORT] بررسی تکراری‌ها ناموفق بود: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const existingSet = new Set(existing);
    const seen = new Set<string>();
    const unique: NormalisedRecord[] = [];
    let skippedCount = 0;

    for (const item of keyed) {
      const duplicate =
        item.keys.length > 0 &&
        item.keys.some((key) => existingSet.has(key) || seen.has(key));
      if (duplicate) {
        skippedCount += 1;
        continue;
      }
      for (const key of item.keys) {
        seen.add(key);
      }
      unique.push(item.record);
    }

    return { unique, skippedCount };
  }
}
