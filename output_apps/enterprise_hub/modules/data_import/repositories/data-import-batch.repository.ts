import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { DataImportBatchItemEntity } from '../entities/data-import-batch-item.entity';
import { DataImportBatchEntity } from '../entities/data-import-batch.entity';

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

  private withBatches<T>(
    tenantId: string,
    work: (repo: Repository<DataImportBatchEntity>) => Promise<T>,
  ): Promise<T> {
    const scope = this.tenantScope;
    if (scope) {
      return scope.run(tenantId, (m) => work(m.getRepository(DataImportBatchEntity)));
    }
    return work(this.batches);
  }

  private withItems<T>(
    tenantId: string,
    work: (repo: Repository<DataImportBatchItemEntity>) => Promise<T>,
  ): Promise<T> {
    const scope = this.tenantScope;
    if (scope) {
      return scope.run(tenantId, (m) => work(m.getRepository(DataImportBatchItemEntity)));
    }
    return work(this.items);
  }

  /** ایجاد سرصفحه یک دسته ورود. */
  async createBatch(
    tenantId: string,
    data: {
      id: string;
      entity: string;
      fileName: string;
      inserted: number;
    },
  ): Promise<void> {
    await this.withBatches(tenantId, async (repo) => {
      const entity = repo.create({
        id: data.id,
        tenantId,
        entity: data.entity,
        fileName: data.fileName,
        inserted: data.inserted,
        undone: false,
        createdAt: new Date(),
      });
      await repo.save(entity);
    });
  }

  /** ثبت ردیف‌های یک دسته (نگاشت به شناسه ردیف‌های ماژول مالک). */
  async addItems(
    tenantId: string,
    batchId: string,
    entityKey: string,
    rows: ImportBatchItemInput[],
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await this.withItems(tenantId, async (repo) => {
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
    });
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
  ): Promise<void> {
    await this.withBatches(tenantId, async (repo) => {
      await repo.update({ id: batchId, tenantId }, { inserted });
    });
  }

  /** حذف سرصفحهٔ یک دستهٔ خالی (commit بدون هیچ ردیف درج‌شده). */
  async removeBatch(tenantId: string, batchId: string): Promise<void> {
    await this.withBatches(tenantId, async (repo) => {
      await repo.delete({ id: batchId, tenantId });
    });
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
