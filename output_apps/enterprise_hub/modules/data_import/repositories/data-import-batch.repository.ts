import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { DataImportBatchItemEntity } from '../entities/data-import-batch-item.entity';
import { DataImportBatchEntity } from '../entities/data-import-batch.entity';

/** ورودی یک ردیف درج‌شده برای ثبت در دسته. */
export interface ImportBatchItemInput {
  ownerId: number;
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
  ) {}

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
    const entity = this.batches.create({
      id: data.id,
      tenantId,
      entity: data.entity,
      fileName: data.fileName,
      inserted: data.inserted,
      undone: false,
      createdAt: new Date(),
    });
    await this.batches.save(entity);
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
    const entities = rows.map((row) =>
      this.items.create({
        tenantId,
        batchId,
        entity: entityKey,
        ownerId: row.ownerId,
        rowNumber: row.rowNumber,
        createdAt: new Date(),
      }),
    );
    await this.items.save(entities);
  }

  /** خواندن یک دسته در محدوده همان مستأجر. */
  async findBatch(
    tenantId: string,
    batchId: string,
  ): Promise<DataImportBatchEntity | null> {
    return this.batches.findOne({ where: { id: batchId, tenantId } });
  }

  /** فهرست آخرین دسته‌های ورود یک مستأجر. */
  async listBatches(
    tenantId: string,
    limit = 20,
  ): Promise<DataImportBatchEntity[]> {
    return this.batches.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /** ردیف‌های یک دسته در محدوده همان مستأجر. */
  async findItems(
    tenantId: string,
    batchId: string,
  ): Promise<DataImportBatchItemEntity[]> {
    return this.items.find({ where: { tenantId, batchId } });
  }

  /** شمارش دسته‌های ورود ایجادشده یک مستأجر از یک زمان مشخص تا کنون. */
  async countCreatedSince(tenantId: string, since: Date): Promise<number> {
    return this.batches.count({
      where: { tenantId, createdAt: MoreThanOrEqual(since) },
    });
  }

  /** علامت‌گذاری دسته به‌عنوان بازگردانی‌شده. */
  async markUndone(tenantId: string, batchId: string): Promise<void> {
    await this.batches.update({ id: batchId, tenantId }, { undone: true });
  }

  /** حذف ردیف‌های یک دسته پس از undo. */
  async removeItems(tenantId: string, batchId: string): Promise<void> {
    await this.items.delete({ tenantId, batchId });
  }
}
