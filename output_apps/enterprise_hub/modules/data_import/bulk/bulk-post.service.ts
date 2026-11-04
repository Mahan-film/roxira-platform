import { Injectable, Logger } from '@nestjs/common';
import { buildRecords, concreteMapping } from '../analysis/record-builder';
import { PACKAGE_ENTITY_ORDER, PACKAGE_MAX_ERRORS } from '../constants/package-import.constants';
import { InMemoryTableReader } from '../parsers/package-source.types';
import { EntityRegistryService } from '../registry/entity-registry.service';
import { NormalisedRecord } from '../registry/import-registry.types';
import { DataImportBatchRepository } from '../repositories/data-import-batch.repository';
import { BulkImportRepository } from './bulk-import.repository';
import { BulkPostProgress } from './bulk-import.types';
import { BulkImportService } from './bulk-import.service';

export interface BulkPostTable {
  idx: number;
  entity: string;
  mapping: Record<string, string | null>;
  skip?: boolean;
  moneyToRial?: number;
}

const PAGE = 2000;
const HOLD_BACK_LIMIT = 20_000;

/**
 * Posts reviewed, staged rows into the owning modules (CRM, accounting, inventory…) through the same
 * adapters and validation as the small import, but page by page, so the table size never matters. One
 * import batch is created before the first write, so the whole job can be undone with the existing endpoint.
 */
@Injectable()
export class BulkPostService {
  private readonly logger = new Logger(BulkPostService.name);

  constructor(
    private readonly repo: BulkImportRepository,
    private readonly registry: EntityRegistryService,
    private readonly batches: DataImportBatchRepository,
    private readonly jobs: BulkImportService,
  ) {}

  async post(tenantId: string, jobId: string, tables: BulkPostTable[], batchId: string): Promise<void> {
    const job = await this.repo.getJob(tenantId, jobId);
    if (!job || job.status !== 'posting') return;
    const selections = tables.filter((t) => !t.skip);
    const total = selections.reduce((sum, s) => sum + (job.tables.find((t) => t.idx === s.idx)?.rows ?? 0), 0);
    const progress: BulkPostProgress = { phase: 'posting', done: 0, total, inserted: {}, skipped: {}, errors: [] };
    const errorsPerEntity = new Map<string, number>();
    const addError = (entity: string, message: string): void => {
      const n = errorsPerEntity.get(entity) ?? 0;
      if (n < 10 && progress.errors.length < PACKAGE_MAX_ERRORS * 2) progress.errors.push(`[${entity}] ${message}`);
      errorsPerEntity.set(entity, n + 1);
    };
    let totalInserted = 0;
    await this.batches.createBatch(tenantId, { id: batchId, entity: 'package', fileName: job.fileName, inserted: 0 });
    await this.repo.update(tenantId, jobId, { batchId, postProgress: progress });

    try {
      const ordered = [...selections].sort((a, b) => order(a.entity) - order(b.entity));
      for (const selection of ordered) {
        const adapter = this.registry.get(selection.entity);
        const table = job.tables.find((t) => t.idx === selection.idx);
        if (!adapter || !table) {
          progress.errors.push(`آداپتور یا جدول «${selection.entity}» یافت نشد.`);
          continue;
        }
        const analysed = (Array.isArray(job.review) ? (job.review as { name: string; mapping: Record<string, string | null> }[]) : []).find((a) => a.name === table.name);
        const mapping = concreteMapping(adapter, selection.mapping, analysed?.mapping ?? {});
        let after = 0;
        let offset = 0;
        let held: NormalisedRecord[] = [];
        for (;;) {
          const page = await this.repo.readRows(tenantId, jobId, table.idx, after, PAGE);
          if (page.length === 0 && held.length === 0) break;
          let records: NormalisedRecord[] = held;
          held = [];
          if (page.length > 0) {
            after = page[page.length - 1].rowNo;
            const reader = new InMemoryTableReader(table.name, table.columns, page.map((r) => table.columns.map((_c, i) => r.cells[i] ?? '')));
            const built = buildRecords(adapter, reader, mapping, { moneyToRial: selection.moneyToRial, rowOffset: offset });
            built.errors.forEach((m) => addError(selection.entity, m));
            records = records.concat(built.records);
            offset += page.length;
            progress.done += page.length;
          }
          // Journal lines of one voucher must reach the adapter together: hold the last voucher back.
          const last = page.length === PAGE;
          if (last && selection.entity === 'accounting-journal-lines' && records.length > 0) {
            const key = (r: NormalisedRecord) => String(r.values.voucherNo ?? '').trim();
            const tail = key(records[records.length - 1]);
            if (tail) {
              let cut = records.length;
              while (cut > 0 && key(records[cut - 1]) === tail) cut -= 1;
              if (cut > 0 && records.length - cut <= HOLD_BACK_LIMIT) {
                held = records.slice(cut);
                records = records.slice(0, cut);
              }
            }
          }
          if (records.length > 0) {
            const { unique, skippedCount } = await this.dedupe(selection.entity, tenantId, records);
            progress.skipped[selection.entity] = (progress.skipped[selection.entity] ?? 0) + skippedCount;
            const result = await adapter.commit(tenantId, unique);
            const items = result.inserted.map((r) => ({ ownerId: r.ownerId, rowNumber: r.rowNumber }));
            for (let s = 0; s < items.length; s += 1000) await this.batches.addItems(tenantId, batchId, selection.entity, items.slice(s, s + 1000));
            totalInserted += items.length;
            progress.inserted[selection.entity] = (progress.inserted[selection.entity] ?? 0) + items.length;
            for (const f of result.failed) addError(selection.entity, `ردیف ${f.rowNumber}: ${f.message}`);
          }
          await this.repo.update(tenantId, jobId, { postProgress: { ...progress } });
          if (page.length < PAGE && held.length === 0) break;
        }
      }
    } catch (error) {
      await this.batches.setInserted(tenantId, batchId, totalInserted);
      progress.phase = 'failed';
      progress.errors.unshift('ثبت با خطا متوقف شد؛ ردیف‌های ثبت‌شده تا اینجا را می‌توانید بازگردانی کنید.');
      await this.repo.update(tenantId, jobId, { status: 'ready', postProgress: progress, error: 'ثبت ناقص ماند؛ بازگردانی یا تلاش دوباره ممکن است.' });
      this.logger.error(`[BULK-IMPORT] post ${jobId} failed: ${(error as Error).message}`);
      throw error;
    }

    if (totalInserted > 0) await this.batches.setInserted(tenantId, batchId, totalInserted);
    else await this.batches.removeBatch(tenantId, batchId);
    progress.phase = 'posted';
    await this.repo.update(tenantId, jobId, { status: 'posted', postProgress: progress, finishedAt: new Date() });
    await this.jobs.cleanup(tenantId, jobId);
  }

  private async dedupe(entity: string, tenantId: string, records: NormalisedRecord[]) {
    const adapter = this.registry.get(entity)!;
    const keyed = records.map((record) => ({ record, keys: adapter.duplicateKeys(record) }));
    const all = Array.from(new Set(keyed.flatMap((k) => k.keys)));
    let existing: string[] = [];
    if (all.length > 0) {
      try {
        existing = await adapter.findExistingDuplicateKeys(tenantId, all);
      } catch (error) {
        this.logger.warn(`[BULK-IMPORT] duplicate check failed: ${(error as Error).message}`);
      }
    }
    const existingSet = new Set(existing);
    const seen = new Set<string>();
    const unique: NormalisedRecord[] = [];
    let skippedCount = 0;
    for (const item of keyed) {
      if (item.keys.length > 0 && item.keys.some((k) => existingSet.has(k) || seen.has(k))) {
        skippedCount += 1;
        continue;
      }
      item.keys.forEach((k) => seen.add(k));
      unique.push(item.record);
    }
    return { unique, skippedCount };
  }
}

function order(entity: string): number {
  const i = (PACKAGE_ENTITY_ORDER as readonly string[]).indexOf(entity);
  return i === -1 ? 999 : i;
}
