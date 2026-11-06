import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { QUANTITY_SCALE } from '../constants/inventory.constants';
import { FifoBatchEntity } from '../entities/fifo-batch.entity';
import { StockDocumentEntity, StockDocumentLineEntity } from '../entities/stock-document.entity';
import { StockItemEntity } from '../entities/stock-item.entity';
import { StoreEntity } from '../entities/store.entity';
import { WarehouseEntity } from '../entities/warehouse.entity';
import { StockDocumentStatus, StockDocumentType } from '../enums/stock-document.enum';
import { MovementDoc } from '../reports/stock-movements';
import {
  InsufficientStockError,
  StockItemMissingError,
  WarehouseInactiveError,
  WarehouseMissingError,
} from '../errors/inventory.errors';

export interface MovedLayer {
  quantity: number;
  unitCost: number;
}

export interface DocumentFilter {
  docType?: StockDocumentType;
  warehouseId?: number;
  skip: number;
  take: number;
}

/**
 * Persistence for stores and stock documents. Every method takes `tenantId` first and scopes each
 * read and write by it (AGENTS.md hard rule); writes that must be atomic run in the caller's
 * transaction through `transaction()`.
 */
@Injectable()
export class StockDocumentsRepository {
  constructor(private readonly dataSource: DataSource) {}

  transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }

  private round(value: number): number {
    const factor = 10 ** QUANTITY_SCALE;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  // ---------------------------------------------------------------------------
  // Stores
  // ---------------------------------------------------------------------------

  createStore(
    tenantId: string,
    data: Pick<StoreEntity, 'code' | 'name'> & { address?: string | null },
  ): Promise<StoreEntity> {
    const repo = this.dataSource.getRepository(StoreEntity);
    return repo.save(repo.create({ ...data, address: data.address ?? null, isActive: true, tenantId }));
  }

  findStoreById(tenantId: string, id: number): Promise<StoreEntity | null> {
    return this.dataSource.getRepository(StoreEntity).findOne({ where: { id, tenantId } });
  }

  findStoreByCodeOrName(tenantId: string, code: string, name: string): Promise<StoreEntity[]> {
    return this.dataSource.getRepository(StoreEntity).find({
      where: [
        { tenantId, code },
        { tenantId, name },
      ],
    });
  }

  listStores(tenantId: string): Promise<StoreEntity[]> {
    return this.dataSource.getRepository(StoreEntity).find({ where: { tenantId }, order: { name: 'ASC' } });
  }

  async updateStore(
    tenantId: string,
    id: number,
    patch: Partial<Pick<StoreEntity, 'code' | 'name' | 'address' | 'isActive'>>,
  ): Promise<void> {
    await this.dataSource.getRepository(StoreEntity).update({ id, tenantId }, patch);
  }

  /** Warehouses per store, for the store list. */
  async warehouseCounts(tenantId: string): Promise<Map<number, number>> {
    const rows = await this.dataSource
      .getRepository(WarehouseEntity)
      .createQueryBuilder('w')
      .select('w.storeId', 'storeId')
      .addSelect('COUNT(*)', 'count')
      .where('w.tenantId = :tenantId', { tenantId })
      .andWhere('w.storeId IS NOT NULL')
      .groupBy('w.storeId')
      .getRawMany<{ storeId: number; count: string }>();
    return new Map(rows.map((row) => [Number(row.storeId), Number(row.count)]));
  }

  // ---------------------------------------------------------------------------
  // Documents
  // ---------------------------------------------------------------------------

  async countDocuments(tenantId: string, docType: StockDocumentType, manager: EntityManager): Promise<number> {
    return manager.count(StockDocumentEntity, { where: { tenantId, docType } });
  }

  async insertDocument(
    tenantId: string,
    data: Partial<StockDocumentEntity>,
    lines: Array<Omit<StockDocumentLineEntity, 'id' | 'tenantId' | 'documentId'>>,
    manager: EntityManager,
  ): Promise<StockDocumentEntity> {
    const document = await manager.save(
      manager.create(StockDocumentEntity, { ...data, tenantId }),
    );
    await manager.save(
      lines.map((line) =>
        manager.create(StockDocumentLineEntity, { ...line, tenantId, documentId: document.id }),
      ),
    );
    return document;
  }

  /** Draft document edits, scoped by tenant. */
  async updateDocument(
    tenantId: string,
    id: number,
    patch: Partial<StockDocumentEntity>,
    manager?: EntityManager,
  ): Promise<void> {
    await (manager ?? this.dataSource.manager).update(StockDocumentEntity, { id, tenantId }, patch);
  }

  /** Replaces all lines of a document (draft editing). */
  async replaceLines(
    tenantId: string,
    documentId: number,
    lines: Array<Omit<StockDocumentLineEntity, 'id' | 'tenantId' | 'documentId'>>,
    manager: EntityManager,
  ): Promise<void> {
    await manager.delete(StockDocumentLineEntity, { tenantId, documentId });
    if (lines.length > 0) {
      await manager.save(
        lines.map((line) => manager.create(StockDocumentLineEntity, { ...line, tenantId, documentId })),
      );
    }
  }

  async deleteDraft(tenantId: string, id: number, manager: EntityManager): Promise<void> {
    await manager.delete(StockDocumentLineEntity, { tenantId, documentId: id });
    await manager.delete(StockDocumentEntity, { tenantId, id });
  }

  /** SKUs from `skus` that exist as items of this tenant. */
  async existingSkus(tenantId: string, skus: string[]): Promise<Set<string>> {
    if (skus.length === 0) {
      return new Set();
    }
    const rows = await this.dataSource
      .getRepository(StockItemEntity)
      .createQueryBuilder('item')
      .select('item.sku', 'sku')
      .where('item.tenantId = :tenantId', { tenantId })
      .andWhere('item.sku IN (:...skus)', { skus })
      .getRawMany<{ sku: string }>();
    return new Set(rows.map((row) => row.sku));
  }

  /** SKUs that already have open stock in `warehouseId` (an opening balance on top would double count). */
  async skusWithStockIn(tenantId: string, warehouseId: number, skus: string[]): Promise<Set<string>> {
    if (skus.length === 0) {
      return new Set();
    }
    const rows = await this.dataSource
      .getRepository(FifoBatchEntity)
      .createQueryBuilder('b')
      .select('DISTINCT b.sku', 'sku')
      .where('b.tenantId = :tenantId', { tenantId })
      .andWhere('b.warehouseId = :warehouseId', { warehouseId })
      .andWhere('b.quantityRemaining > 0')
      .andWhere('b.sku IN (:...skus)', { skus })
      .getRawMany<{ sku: string }>();
    return new Set(rows.map((row) => row.sku));
  }

  /** Items with no open FIFO layer anywhere, for the opening-balance template. */
  async itemsWithoutStock(
    tenantId: string,
    limit: number,
  ): Promise<Array<{ sku: string; barcode: string; name: string }>> {
    return this.dataSource
      .getRepository(StockItemEntity)
      .createQueryBuilder('item')
      .select(['item.sku AS sku', 'item.barcode AS barcode', 'item.name AS name'])
      .where('item.tenantId = :tenantId', { tenantId })
      .andWhere(
        `NOT EXISTS (SELECT 1 FROM inventory_fifo_batches b WHERE b.tenant_id = item.tenant_id AND b.sku = item.sku AND b.quantity_remaining > 0)`,
      )
      .orderBy('item.name', 'ASC')
      .addOrderBy('item.id', 'ASC')
      .limit(limit)
      .getRawMany();
  }

  findDocument(tenantId: string, id: number): Promise<StockDocumentEntity | null> {
    return this.dataSource.getRepository(StockDocumentEntity).findOne({ where: { id, tenantId } });
  }

  findDocumentLines(tenantId: string, documentId: number): Promise<StockDocumentLineEntity[]> {
    return this.dataSource
      .getRepository(StockDocumentLineEntity)
      .find({ where: { tenantId, documentId }, order: { id: 'ASC' } });
  }

  async listDocuments(
    tenantId: string,
    filter: DocumentFilter,
  ): Promise<[StockDocumentEntity[], number]> {
    const query = this.dataSource
      .getRepository(StockDocumentEntity)
      .createQueryBuilder('d')
      .where('d.tenantId = :tenantId', { tenantId });
    if (filter.docType) {
      query.andWhere('d.docType = :docType', { docType: filter.docType });
    }
    if (filter.warehouseId) {
      query.andWhere('(d.fromWarehouseId = :w OR d.toWarehouseId = :w)', { w: filter.warehouseId });
    }
    return query
      .orderBy('d.docDate', 'DESC')
      .addOrderBy('d.id', 'DESC')
      .skip(filter.skip)
      .take(filter.take)
      .getManyAndCount();
  }

  /**
   * Posted documents with their lines, oldest first, for the reports' FIFO replay. `upTo` (a Tehran
   * day) keeps documents on or before it; `sku` keeps only that SKU's lines and the documents that
   * have one. Scoped by `tenantId`.
   */
  async findPostedDocuments(tenantId: string, upTo?: string, sku?: string): Promise<MovementDoc[]> {
    const query = this.dataSource
      .getRepository(StockDocumentEntity)
      .createQueryBuilder('d')
      .where('d.tenantId = :tenantId', { tenantId })
      .andWhere('d.status = :status', { status: StockDocumentStatus.POSTED });
    if (upTo) {
      query.andWhere('d.docDate <= :upTo', { upTo });
    }
    const documents = await query.orderBy('d.docDate', 'ASC').addOrderBy('d.id', 'ASC').getMany();
    if (documents.length === 0) {
      return [];
    }

    const lineQuery = this.dataSource
      .getRepository(StockDocumentLineEntity)
      .createQueryBuilder('l')
      .where('l.tenantId = :tenantId', { tenantId })
      .andWhere('l.documentId IN (:...ids)', { ids: documents.map((document) => document.id) })
      .orderBy('l.id', 'ASC');
    if (sku) {
      lineQuery.andWhere('l.sku = :sku', { sku });
    }
    const lines = await lineQuery.getMany();

    const byDocument = new Map<number, MovementDoc['lines']>();
    for (const line of lines) {
      const bucket = byDocument.get(line.documentId) ?? [];
      bucket.push({
        id: line.id,
        sku: line.sku,
        quantity: Number(line.quantity),
        unitCost: Number(line.unitCost),
      });
      byDocument.set(line.documentId, bucket);
    }

    const result: MovementDoc[] = [];
    for (const document of documents) {
      const documentLines = byDocument.get(document.id);
      if (!documentLines) {
        continue;
      }
      result.push({
        id: document.id,
        docType: document.docType,
        docDate: String(document.docDate).slice(0, 10),
        docNumber: document.docNumber,
        fromWarehouseId: document.fromWarehouseId ?? null,
        toWarehouseId: document.toWarehouseId ?? null,
        lines: documentLines,
      });
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Transfer
  // ---------------------------------------------------------------------------

  /** An active warehouse of this tenant, or a domain error. */
  async assertActiveWarehouse(
    tenantId: string,
    warehouseId: number,
    manager: EntityManager,
  ): Promise<void> {
    const warehouse = await manager.findOne(WarehouseEntity, { where: { id: warehouseId, tenantId } });
    if (!warehouse) {
      throw new WarehouseMissingError(warehouseId);
    }
    if (warehouse.isActive === false) {
      throw new WarehouseInactiveError(warehouseId);
    }
  }

  /**
   * Moves `quantity` of `sku` from one warehouse to another, oldest layers first. Each consumed
   * layer is re-created at the destination with the same unit cost, received date and batch
   * number, so FIFO order and value survive the move; the item total does not change.
   */
  async moveLayers(
    tenantId: string,
    input: { sku: string; quantity: number; fromWarehouseId: number; toWarehouseId: number },
    manager: EntityManager,
  ): Promise<MovedLayer[]> {
    const item = await manager.findOne(StockItemEntity, {
      where: { sku: input.sku, tenantId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!item) {
      throw new StockItemMissingError(input.sku);
    }
    const batches = await manager
      .createQueryBuilder(FifoBatchEntity, 'batch')
      .setLock('pessimistic_write')
      .where('batch.tenantId = :tenantId', { tenantId })
      .andWhere('batch.sku = :sku', { sku: input.sku })
      .andWhere('batch.warehouseId = :from', { from: input.fromWarehouseId })
      .andWhere('batch.quantityRemaining > 0')
      .orderBy('batch.receivedDate', 'ASC')
      .addOrderBy('batch.id', 'ASC')
      .getMany();

    let remaining = this.round(input.quantity);
    const moved: MovedLayer[] = [];
    for (const batch of batches) {
      if (remaining <= 0) {
        break;
      }
      const take = Math.min(batch.quantityRemaining, remaining);
      batch.quantityRemaining = this.round(batch.quantityRemaining - take);
      await manager.save(batch);
      await manager.save(
        manager.create(FifoBatchEntity, {
          tenantId,
          sku: input.sku,
          batchNumber: batch.batchNumber,
          quantityRemaining: this.round(take),
          unitPurchaseCost: batch.unitPurchaseCost,
          receivedDate: batch.receivedDate,
          warehouseId: input.toWarehouseId,
        }),
      );
      moved.push({ quantity: this.round(take), unitCost: batch.unitPurchaseCost });
      remaining = this.round(remaining - take);
    }
    if (remaining > 0) {
      throw new InsufficientStockError(input.sku, input.quantity, this.round(input.quantity - remaining));
    }
    return moved;
  }
}
