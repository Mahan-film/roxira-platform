import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { MONEY_SCALE, QUANTITY_SCALE } from '../constants/inventory.constants';
import { FifoBatchEntity } from '../entities/fifo-batch.entity';
import { StoreEntity } from '../entities/store.entity';
import { StockItemEntity } from '../entities/stock-item.entity';
import { WarehouseEntity } from '../entities/warehouse.entity';
import {
  InsufficientStockError,
  StockItemMissingError,
  WarehouseInactiveError,
  WarehouseMissingError,
} from '../errors/inventory.errors';

/** ورودی پرسیستنس ورود کالا در یک Transaction. */
export interface InboundPersistInput {
  sku: string;
  quantity: number;
  unitPurchaseCost: number;
  warehouseId: number | null;
  batchNumber: string;
}

/** نتیجه پرسیستنس ورود کالا. */
export interface InboundPersistResult {
  item: StockItemEntity;
  batch: FifoBatchEntity;
}

/** ورودی پرسیستنس خروج کالا در یک Transaction. */
export interface OutboundPersistInput {
  sku: string;
  quantity: number;
  warehouseId: number | null;
}

/** یک لایه FIFO که در خروج کالا مصرف شده است. */
export interface ConsumedLayer {
  batchId: number;
  batchNumber: string;
  quantity: number;
  unitPurchaseCost: number;
  warehouseId: number | null;
}

/** نتیجه پرسیستنس خروج کالا. */
export interface OutboundPersistResult {
  item: StockItemEntity;
  layers: ConsumedLayer[];
}

/** تجمیع لایه‌های FIFO باز به تفکیک کالا. */
export interface BatchAggregateRow {
  sku: string;
  batchQuantity: string;
  fifoValue: string;
  openBatchCount: string;
}

/** تجمیع موجودی یک کالا در یک انبار. */
export interface WarehouseStockRawRow {
  sku: string;
  name: string;
  quantity: string;
  fifoValue: string;
  openBatchCount: string;
}

/**
 * لایه Repository — تنها نقطه دسترسی به جداول `erp_warehouses`,
 * `erp_stock_items` و `inventory_fifo_batches` برای ماژول انبارداری.
 *
 * تمام عملیات ورود/خروج کالا در یک Transaction واحد انجام می‌شود و ردیف‌ها با
 * قفل نوشتن (pessimistic_write) خوانده می‌شوند تا در هم‌زمانی، محاسبه FIFO
 * هرگز دچار Race Condition نشود (Rule #3 - AGENTS.md: Repository Pattern).
 */
@Injectable()
export class InventoryRepository {
  constructor(
    @InjectRepository(WarehouseEntity)
    private readonly warehouses: Repository<WarehouseEntity>,
    @InjectRepository(StockItemEntity)
    private readonly stockItems: Repository<StockItemEntity>,
    @InjectRepository(FifoBatchEntity)
    private readonly batches: Repository<FifoBatchEntity>,
    private readonly dataSource: DataSource,
  ) {}

  /** گرد کردن مقادیر فیزیکی به دقت تعیین‌شده. */
  private roundQuantity(value: number): number {
    const factor = 10 ** QUANTITY_SCALE;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  /** گرد کردن مبالغ ریالی به دقت تعیین‌شده. */
  private roundMoney(value: number): number {
    const factor = 10 ** MONEY_SCALE;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  // ---------------------------------------------------------------------------
  // انبارها (Warehouses)
  // ---------------------------------------------------------------------------

  async createWarehouse(
    tenantId: string,
    data: {
      name: string;
      locationCode: string;
      storeId?: number | null;
    },
  ): Promise<WarehouseEntity> {
    const entity = this.warehouses.create({
      storeId: null,
      isActive: true,
      ...data,
      tenantId,
      createdAt: new Date(),
    });
    return this.warehouses.save(entity);
  }

  async findAllWarehouses(tenantId: string): Promise<WarehouseEntity[]> {
    return this.warehouses.find({
      where: { tenantId },
      order: { name: 'ASC' },
    });
  }

  async findWarehouseById(
    tenantId: string,
    id: number,
  ): Promise<WarehouseEntity | null> {
    return this.warehouses.findOne({ where: { id, tenantId } });
  }

  /** The item whose code (SKU) or barcode is exactly `code`; SKU wins when both match. */
  async findStockItemByCode(tenantId: string, code: string): Promise<StockItemEntity | null> {
    return (
      (await this.stockItems.findOne({ where: { tenantId, sku: code } })) ??
      (await this.stockItems.findOne({ where: { tenantId, barcode: code }, order: { id: 'ASC' } }))
    );
  }

  /** Units of `sku` available to sell: in one warehouse's layers, or the item total when none is given. */
  async availableQuantity(tenantId: string, sku: string, warehouseId: number | null): Promise<number> {
    if (warehouseId === null) {
      const item = await this.stockItems.findOne({ where: { tenantId, sku } });
      return Number(item?.quantity ?? 0);
    }
    const row = await this.batches
      .createQueryBuilder('batch')
      .select('COALESCE(SUM(batch.quantityRemaining), 0)', 'total')
      .where('batch.tenantId = :tenantId', { tenantId })
      .andWhere('batch.sku = :sku', { sku })
      .andWhere('batch.warehouseId = :warehouseId', { warehouseId })
      .andWhere('batch.quantityRemaining > 0')
      .getRawOne<{ total: string }>();
    return Number(row?.total ?? 0);
  }

  /** A store of this tenant, or null (used to validate a warehouse's `storeId`). */
  async findStoreById(tenantId: string, id: number): Promise<StoreEntity | null> {
    return this.dataSource.getRepository(StoreEntity).findOne({ where: { id, tenantId } });
  }

  /** Updates the editable warehouse fields, scoped by tenant. */
  async updateWarehouse(
    tenantId: string,
    id: number,
    patch: Partial<Pick<WarehouseEntity, 'name' | 'locationCode' | 'storeId' | 'isActive'>>,
  ): Promise<void> {
    await this.warehouses.update({ id, tenantId }, patch);
  }

  /** Open stock quantity (sum of FIFO layers) held by one warehouse. */
  async openQuantityInWarehouse(tenantId: string, warehouseId: number): Promise<number> {
    const row = await this.batches
      .createQueryBuilder('batch')
      .select('COALESCE(SUM(batch.quantityRemaining), 0)', 'total')
      .where('batch.tenantId = :tenantId', { tenantId })
      .andWhere('batch.warehouseId = :warehouseId', { warehouseId })
      .andWhere('batch.quantityRemaining > 0')
      .getRawOne<{ total: string }>();
    return Number(row?.total ?? 0);
  }

  async findWarehouseByName(
    tenantId: string,
    name: string,
  ): Promise<WarehouseEntity | null> {
    return this.warehouses.findOne({ where: { name, tenantId } });
  }

  // ---------------------------------------------------------------------------
  // کالاها (Stock Items)
  // ---------------------------------------------------------------------------

  async createStockItem(
    tenantId: string,
    data: Partial<StockItemEntity>,
  ): Promise<StockItemEntity> {
    const entity = this.stockItems.create({ ...data, tenantId });
    return this.stockItems.save(entity);
  }

  async saveStockItem(
    tenantId: string,
    entity: StockItemEntity,
  ): Promise<StockItemEntity> {
    // به‌روزرسانی با قید مستأجر: شناسه سازمان دیگر ۰ ردیف را تغییر می‌دهد.
    await this.stockItems.update(
      { id: entity.id, tenantId },
      {
        sku: entity.sku,
        barcode: entity.barcode,
        name: entity.name,
        quantity: entity.quantity,
        minQuantity: entity.minQuantity,
        batchNumber: entity.batchNumber,
      },
    );
    entity.tenantId = tenantId;
    return entity;
  }

  async findStockItemById(
    tenantId: string,
    id: number,
  ): Promise<StockItemEntity | null> {
    return this.stockItems.findOne({ where: { id, tenantId } });
  }

  async findStockItemBySku(
    tenantId: string,
    sku: string,
  ): Promise<StockItemEntity | null> {
    return this.stockItems.findOne({ where: { sku, tenantId } });
  }

  /** شناسه‌های کالای موجودِ مستأجر در میان فهرست داده‌شده (تشخیص تکراری). */
  async findStockItemSkus(
    tenantId: string,
    skus: string[],
  ): Promise<string[]> {
    if (skus.length === 0) {
      return [];
    }
    const rows = await this.stockItems.find({
      where: { tenantId, sku: In(skus) },
      select: { sku: true },
    });
    return rows.map((row) => row.sku);
  }

  /** شناسه کالاهایی که لایه FIFO (گردش) دارند (ارجاع‌شده؛ undo ممنوع). */
  async findReferencedStockItemIds(
    tenantId: string,
    ids: number[],
  ): Promise<number[]> {
    if (ids.length === 0) {
      return [];
    }
    const items = await this.stockItems.find({
      where: { tenantId, id: In(ids) },
      select: { id: true, sku: true },
    });
    const skus = items.map((item) => item.sku);
    if (skus.length === 0) {
      return [];
    }
    const batches = await this.batches.find({
      where: { tenantId, sku: In(skus) },
      select: { sku: true },
    });
    const referencedSkus = new Set(batches.map((batch) => batch.sku));
    return items
      .filter((item) => referencedSkus.has(item.sku))
      .map((item) => item.id);
  }

  /** حذف کالاهای یک دسته ورود داده با قید مستأجر (برای undo). */
  async deleteStockItemsByIds(
    tenantId: string,
    ids: number[],
  ): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    const result = await this.stockItems.delete({ tenantId, id: In(ids) });
    return result.affected ?? 0;
  }

  async findAllStockItems(tenantId: string): Promise<StockItemEntity[]> {
    return this.stockItems.find({
      where: { tenantId },
      order: { name: 'ASC' },
    });
  }

  async findStockItemsAndCount(
    tenantId: string,
    options: {
      search?: string;
      lowStockOnly: boolean;
      skip: number;
      take: number;
    },
  ): Promise<[StockItemEntity[], number]> {
    const query = this.stockItems.createQueryBuilder('item');

    query.where('item.tenantId = :tenantId', { tenantId });

    if (options.search) {
      const pattern = `%${options.search}%`;
      query.andWhere(
        '(item.sku ILIKE :pattern OR item.barcode ILIKE :pattern OR item.name ILIKE :pattern)',
        { pattern },
      );
    }
    if (options.lowStockOnly) {
      query.andWhere('item.minQuantity > 0 AND item.quantity <= item.minQuantity');
    }

    query
      .orderBy('item.name', 'ASC')
      .addOrderBy('item.id', 'ASC')
      .skip(options.skip)
      .take(options.take);

    return query.getManyAndCount();
  }

  // ---------------------------------------------------------------------------
  // دسته‌های FIFO (Batches)
  // ---------------------------------------------------------------------------

  async findBatchesBySku(
    tenantId: string,
    sku: string,
    warehouseId: number | null = null,
  ): Promise<FifoBatchEntity[]> {
    const query = this.batches
      .createQueryBuilder('batch')
      .where('batch.tenantId = :tenantId', { tenantId })
      .andWhere('batch.sku = :sku', { sku })
      .andWhere('batch.quantityRemaining > 0')
      .orderBy('batch.receivedDate', 'ASC')
      .addOrderBy('batch.id', 'ASC');

    if (warehouseId !== null) {
      query.andWhere('batch.warehouseId = :warehouseId', { warehouseId });
    }

    return query.getMany();
  }

  /**
   * تجمیع ارزش لایه‌های FIFO باز به تفکیک کالا.
   */
  async getBatchAggregates(tenantId: string): Promise<BatchAggregateRow[]> {
    return this.batches
      .createQueryBuilder('batch')
      .select('batch.sku', 'sku')
      .addSelect('COALESCE(SUM(batch.quantityRemaining), 0)', 'batchQuantity')
      .addSelect(
        'COALESCE(SUM(batch.quantityRemaining * batch.unitPurchaseCost), 0)',
        'fifoValue',
      )
      .addSelect('COUNT(batch.id)', 'openBatchCount')
      .where('batch.tenantId = :tenantId', { tenantId })
      .andWhere('batch.quantityRemaining > 0')
      .groupBy('batch.sku')
      .getRawMany<BatchAggregateRow>();
  }

  /**
   * موجودی یک انبار به تفکیک کالا (خروجی خام Query Builder).
   */
  async getWarehouseStock(
    tenantId: string,
    warehouseId: number,
  ): Promise<WarehouseStockRawRow[]> {
    return this.batches
      .createQueryBuilder('batch')
      .innerJoin(
        StockItemEntity,
        'item',
        'item.sku = batch.sku AND item.tenantId = batch.tenantId',
      )
      .select('batch.sku', 'sku')
      .addSelect('item.name', 'name')
      .addSelect('COALESCE(SUM(batch.quantityRemaining), 0)', 'quantity')
      .addSelect(
        'COALESCE(SUM(batch.quantityRemaining * batch.unitPurchaseCost), 0)',
        'fifoValue',
      )
      .addSelect('COUNT(batch.id)', 'openBatchCount')
      .where('batch.tenantId = :tenantId', { tenantId })
      .andWhere('batch.warehouseId = :warehouseId', { warehouseId })
      .andWhere('batch.quantityRemaining > 0')
      .groupBy('batch.sku')
      .addGroupBy('item.name')
      .orderBy('item.name', 'ASC')
      .getRawMany<WarehouseStockRawRow>();
  }

  // ---------------------------------------------------------------------------
  // تراکنش‌های اتمیک ورود/خروج کالا
  // ---------------------------------------------------------------------------

  /** Runs `work` in the caller's transaction when given, otherwise in a new one. */
  private runInTransaction<T>(
    work: (manager: EntityManager) => Promise<T>,
    outerManager?: EntityManager,
  ): Promise<T> {
    return outerManager ? work(outerManager) : this.dataSource.transaction(work);
  }

  /**
   * ورود کالا: ایجاد لایه FIFO جدید + افزایش موجودی کالا در یک Transaction.
   * در صورت نبود کالا یا انبار، کل تراکنش Rollback می‌شود.
   */
  async persistInbound(
    tenantId: string,
    input: InboundPersistInput,
    outerManager?: EntityManager,
  ): Promise<InboundPersistResult> {
    return this.runInTransaction(async (manager) => {
      const item = await manager.findOne(StockItemEntity, {
        where: { sku: input.sku, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!item) {
        throw new StockItemMissingError(input.sku);
      }

      await this.assertWarehouseExists(manager, tenantId, input.warehouseId);

      const batch = manager.create(FifoBatchEntity, {
        tenantId,
        sku: input.sku,
        batchNumber: input.batchNumber,
        quantityRemaining: this.roundQuantity(input.quantity),
        unitPurchaseCost: this.roundMoney(input.unitPurchaseCost),
        receivedDate: new Date(),
        warehouseId: input.warehouseId,
      });
      const savedBatch = await manager.save(batch);

      item.quantity = this.roundQuantity(item.quantity + input.quantity);
      if (!item.batchNumber) {
        item.batchNumber = input.batchNumber;
      }
      const savedItem = await manager.save(item);

      return { item: savedItem, batch: savedBatch };
    }, outerManager);
  }

  /**
   * خروج کالا: مصرف لایه‌های FIFO به‌ترتیب قدیمی‌ترین و کاهش موجودی کالا در
   * یک Transaction. در صورت کمبود موجودی، کل تراکنش Rollback می‌شود.
   */
  async persistOutbound(
    tenantId: string,
    input: OutboundPersistInput,
    outerManager?: EntityManager,
  ): Promise<OutboundPersistResult> {
    return this.runInTransaction(async (manager) => {
      const item = await manager.findOne(StockItemEntity, {
        where: { sku: input.sku, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!item) {
        throw new StockItemMissingError(input.sku);
      }

      await this.assertWarehouseExists(manager, tenantId, input.warehouseId);

      const query = manager
        .createQueryBuilder(FifoBatchEntity, 'batch')
        .setLock('pessimistic_write')
        .where('batch.tenantId = :tenantId', { tenantId })
        .andWhere('batch.sku = :sku', { sku: input.sku })
        .andWhere('batch.quantityRemaining > 0')
        .orderBy('batch.receivedDate', 'ASC')
        .addOrderBy('batch.id', 'ASC');

      if (input.warehouseId !== null) {
        query.andWhere('batch.warehouseId = :warehouseId', {
          warehouseId: input.warehouseId,
        });
      }

      const availableBatches = await query.getMany();

      let remaining = this.roundQuantity(input.quantity);
      const layers: ConsumedLayer[] = [];

      for (const batch of availableBatches) {
        if (remaining <= 0) {
          break;
        }
        const take = Math.min(batch.quantityRemaining, remaining);
        if (take <= 0) {
          continue;
        }

        batch.quantityRemaining = this.roundQuantity(
          batch.quantityRemaining - take,
        );
        await manager.save(batch);

        layers.push({
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          quantity: this.roundQuantity(take),
          unitPurchaseCost: batch.unitPurchaseCost,
          warehouseId: batch.warehouseId,
        });

        remaining = this.roundQuantity(remaining - take);
      }

      if (remaining > 0) {
        const available = this.roundQuantity(input.quantity - remaining);
        throw new InsufficientStockError(input.sku, input.quantity, available);
      }

      item.quantity = this.roundQuantity(item.quantity - input.quantity);
      const savedItem = await manager.save(item);

      return { item: savedItem, layers };
    }, outerManager);
  }

  private async assertWarehouseExists(
    manager: EntityManager,
    tenantId: string,
    warehouseId: number | null,
  ): Promise<void> {
    if (warehouseId === null) {
      return;
    }
    const warehouse = await manager.findOne(WarehouseEntity, {
      where: { id: warehouseId, tenantId },
    });
    if (!warehouse) {
      throw new WarehouseMissingError(warehouseId);
    }
    if (warehouse.isActive === false) {
      throw new WarehouseInactiveError(warehouseId);
    }
  }
}
