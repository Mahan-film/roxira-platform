import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { EntityManager, MoreThanOrEqual, Repository } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { DataImportBatchItemEntity } from '../entities/data-import-batch-item.entity';
import { DataImportBatchEntity } from '../entities/data-import-batch.entity';

/** Canonical SHA-256 hash of a column-to-field import mapping. */
export function hashImportMapping(
  mapping?: Record<string, string | null | undefined>,
): string {
  const entries = Object.entries(mapping ?? {})
    .filter(([, field]) => typeof field === 'string' && field.trim() !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

/** Canonical SHA-256 hash of selected package tables + mappings for idempotency scoping. */
export function hashPackageSelections(
  selections: Array<{
    name: string;
    entity: string;
    mapping?: Record<string, string | null>;
    moneyToRial?: number;
  }>,
): string {
  const canonical = selections
    .map((s) => ({
      n: s.name,
      e: s.entity,
      m: Object.entries(s.mapping ?? {})
        .filter(([, v]) => v !== null && v !== '')
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      u: s.moneyToRial ?? 1,
    }))
    .sort((a, b) =>
      a.n < b.n
        ? -1
        : a.n > b.n
          ? 1
          : a.e < b.e
            ? -1
            : a.e > b.e
              ? 1
              : 0,
    );
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** ورودی یک ردیف درج‌شده برای ثبت در دسته. */
export interface ImportBatchItemInput {
  ownerId: number | string;
  rowNumber: number;
}

/**
 * لایه Repository دسته‌های ورود داده — تنها نقطه دسترسی به جداول
 * `data_import_batches` و `data_import_batch_items`.
 *
 * همه متدها `tenantId` را به‌عنوان پارامتر اول می‌گیرند و هر کوئری/نوشتن را به
 * همان مستأجر محدود می‌کنند (Rule #3 و #4 - AGENTS.md).
 */
@Injectable()
export class DataImportBatchRepository {
  constructor(
    @InjectRepository(DataImportBatchEntity)
    private readonly batches: Repository<DataImportBatchEntity>,
    @InjectRepository(DataImportBatchItemEntity)
    private readonly items: Repository<DataImportBatchItemEntity>,
    @Optional()
    private readonly scope?: TenantScope,
  ) {}

  private get tenantScope(): TenantScope | undefined {
    if (this.scope) {
      return this.scope;
    }
    const ds = this.batches?.manager?.connection ?? this.items?.manager?.connection;
    if (typeof (ds as { transaction?: unknown } | undefined)?.transaction === 'function') {
      return new TenantScope(ds);
    }
    return undefined;
  }

  /** اجرای یک عملیات درون تراکنش واحد با دامنه مستأجر (برای قفل یکتا و اتمیک بودن دسته). */
  runInTenantTransaction<T>(
    tenantId: string,
    work: (manager: EntityManager | undefined) => Promise<T>,
  ): Promise<T> {
    const scope = this.tenantScope;
    if (scope) {
      return scope.run(tenantId, (manager) => work(manager));
    }
    return work(undefined);
  }

  private withBatches<T>(
    tenantId: string,
    work: (repo: Repository<DataImportBatchEntity>) => Promise<T>,
    manager?: EntityManager,
  ): Promise<T> {
    if (manager) {
      return work(manager.getRepository(DataImportBatchEntity));
    }
    const scope = this.tenantScope;
    if (scope) {
      return scope.run(tenantId, (m) => work(m.getRepository(DataImportBatchEntity)));
    }
    return work(this.batches);
  }

  private withItems<T>(
    tenantId: string,
    work: (repo: Repository<DataImportBatchItemEntity>) => Promise<T>,
    manager?: EntityManager,
  ): Promise<T> {
    if (manager) {
      return work(manager.getRepository(DataImportBatchItemEntity));
    }
    const scope = this.tenantScope;
    if (scope) {
      return scope.run(tenantId, (m) => work(m.getRepository(DataImportBatchItemEntity)));
    }
    return work(this.items);
  }

  /**
   * رزرو اتمیک سرصفحه دسته با قفل ایندکس یکتا `(tenant_id, entity, file_hash, mapping_hash)`.
   * در صورت تلاقی همزمان با دسته فعال، `false` برمی‌گرداند تا ورود تکراری رخ ندهد.
   */
  async tryReserveBatch(
    tenantId: string,
    data: {
      id: string;
      entity: string;
      fileName: string;
      fileHash?: string | null;
      mappingHash?: string | null;
      inserted: number;
    },
    manager?: EntityManager,
  ): Promise<boolean> {
    const mappingHash = data.mappingHash ?? '';
    const execute = async (m: EntityManager): Promise<boolean> => {
      if (data.fileHash) {
        const rows = (await m.query(
          `INSERT INTO "data_import_batches"
             ("id", "tenant_id", "entity", "file_name", "file_hash", "mapping_hash", "inserted", "undone", "created_at")
           VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8)
           ON CONFLICT ("tenant_id", "entity", "file_hash", COALESCE("mapping_hash", ''))
           WHERE "file_hash" IS NOT NULL AND "undone" = false
           DO NOTHING
           RETURNING "id"`,
          [
            data.id,
            tenantId,
            data.entity,
            data.fileName,
            data.fileHash,
            mappingHash,
            data.inserted,
            new Date(),
          ],
        )) as Array<{ id: string }>;
        return rows.length > 0;
      }
      const repo = m.getRepository(DataImportBatchEntity);
      await repo.save(
        repo.create({
          id: data.id,
          tenantId,
          entity: data.entity,
          fileName: data.fileName,
          fileHash: null,
          mappingHash,
          inserted: data.inserted,
          undone: false,
          createdAt: new Date(),
        }),
      );
      return true;
    };
    if (manager) {
      return execute(manager);
    }
    const scope = this.tenantScope;
    if (scope) {
      return scope.run(tenantId, execute);
    }
    await this.createBatch(tenantId, data);
    return true;
  }

  /** ایجاد سرصفحه یک دسته ورود. */
  async createBatch(
    tenantId: string,
    data: {
      id: string;
      entity: string;
      fileName: string;
      fileHash?: string | null;
      mappingHash?: string | null;
      inserted: number;
    },
    manager?: EntityManager,
  ): Promise<void> {
    await this.withBatches(
      tenantId,
      async (repo) => {
        const entity = repo.create({
          id: data.id,
          tenantId,
          entity: data.entity,
          fileName: data.fileName,
          fileHash: data.fileHash ?? null,
          mappingHash: data.mappingHash ?? '',
          inserted: data.inserted,
          undone: false,
          createdAt: new Date(),
        });
        await repo.save(entity);
      },
      manager,
    );
  }

  /** ثبت ردیف‌های یک دسته (نگاشت به شناسه ردیف‌های ماژول مالک). */
  async addItems(
    tenantId: string,
    batchId: string,
    entityKey: string,
    rows: ImportBatchItemInput[],
    manager?: EntityManager,
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await this.withItems(
      tenantId,
      async (repo) => {
        const entities = rows.map((row) =>
          repo.create({
            tenantId,
            batchId,
            entity: entityKey,
            ownerId: String(row.ownerId),
            rowNumber: row.rowNumber,
            createdAt: new Date(),
          }),
        );
        await repo.save(entities, { chunk: 1000 }); // stay under the bind-parameter limit
      },
      manager,
    );
  }

  /** خواندن یک دسته در محدوده همان مستأجر. */
  async findBatch(
    tenantId: string,
    batchId: string,
  ): Promise<DataImportBatchEntity | null> {
    return this.withBatches(tenantId, (repo) =>
      repo.findOne({ where: { id: batchId, tenantId } }),
    );
  }

  /** جستجوی دستهٔ فعال بر اساس (مستأجر، موجودیت، هش فایل، هش نگاشت) برای ورود تکرارناپذیر. */
  async findByFileHash(
    tenantId: string,
    fileHash: string,
    entity: string,
    mappingHash: string = '',
    manager?: EntityManager,
    includePending = false,
  ): Promise<DataImportBatchEntity | null> {
    return this.withBatches(
      tenantId,
      (repo) => {
        let qb = repo
          .createQueryBuilder('b')
          .where('b.tenant_id = :tenantId', { tenantId })
          .andWhere('b.entity = :entity', { entity })
          .andWhere('b.file_hash = :fileHash', { fileHash })
          .andWhere(
            `(COALESCE(b.mapping_hash, '') = :mappingHash OR b.mapping_hash IS NULL)`,
            {
              mappingHash: mappingHash ?? '',
            },
          )
          .andWhere('b.undone = false');
        if (!includePending) {
          qb = qb.andWhere('b.inserted > 0');
        }
        return qb.getOne();
      },
      manager,
    );
  }

  /** فهرست آخرین دسته‌های ورود یک مستأجر. */
  async listBatches(
    tenantId: string,
    limit = 20,
  ): Promise<DataImportBatchEntity[]> {
    return this.withBatches(tenantId, (repo) =>
      repo.find({
        where: { tenantId },
        order: { createdAt: 'DESC' },
        take: limit,
      }),
    );
  }

  /** ردیف‌های یک دسته در محدوده همان مستأجر. */
  async findItems(
    tenantId: string,
    batchId: string,
  ): Promise<DataImportBatchItemEntity[]> {
    return this.withItems(tenantId, (repo) => repo.find({ where: { tenantId, batchId } }));
  }

  /** شمارش دسته‌های ورود ایجادشده یک مستأجر از یک زمان مشخص تا کنون. */
  async countCreatedSince(tenantId: string, since: Date): Promise<number> {
    return this.withBatches(tenantId, (repo) =>
      repo.count({
        where: { tenantId, createdAt: MoreThanOrEqual(since) },
      }),
    );
  }

  /** به‌روزرسانی تعداد ردیف‌های درج‌شدهٔ یک دسته (دستهٔ package از ابتدا ساخته می‌شود). */
  async setInserted(
    tenantId: string,
    batchId: string,
    inserted: number,
    manager?: EntityManager,
  ): Promise<void> {
    await this.withBatches(
      tenantId,
      async (repo) => {
        await repo.update({ id: batchId, tenantId }, { inserted });
      },
      manager,
    );
  }

  /** حذف سرصفحهٔ یک دستهٔ خالی (commit بدون هیچ ردیف درج‌شده). */
  async removeBatch(
    tenantId: string,
    batchId: string,
    manager?: EntityManager,
  ): Promise<void> {
    await this.withBatches(
      tenantId,
      async (repo) => {
        await repo.delete({ id: batchId, tenantId });
      },
      manager,
    );
  }

  /** علامت‌گذاری دسته به‌عنوان بازگردانی‌شده. */
  async markUndone(tenantId: string, batchId: string): Promise<void> {
    await this.withBatches(tenantId, async (repo) => {
      await repo.update({ id: batchId, tenantId }, { undone: true });
    });
  }

  /** حذف ردیف‌های یک دسته پس از undo. */
  async removeItems(tenantId: string, batchId: string): Promise<void> {
    await this.withItems(tenantId, async (repo) => {
      await repo.delete({ tenantId, batchId });
    });
  }
}
