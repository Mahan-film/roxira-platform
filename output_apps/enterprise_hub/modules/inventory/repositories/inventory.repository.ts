import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { MONEY_SCALE, QUANTITY_SCALE } from '../constants/inventory.constants';
import { FifoBatchEntity } from '../entities/fifo-batch.entity';
import { StockItemEntity } from '../entities/stock-item.entity';
import { WarehouseEntity } from '../entities/warehouse.entity';
import {
  InsufficientStockError,
  StockItemMissingError,
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

  async createWarehouse(data: {
    name: string;
    locationCode: string;
  }): Promise<WarehouseEntity> {
    const entity = this.warehouses.create({
      ...data,
      createdAt: new Date(),
    });
    return this.warehouses.save(entity);
  }

  async findAllWarehouses(): Promise<WarehouseEntity[]> {
    return this.warehouses.find({ order: { name: 'ASC' } });
  }

  async findWarehouseById(id: number): Promise<WarehouseEntity | null> {
    return this.warehouses.findOne({ where: { id } });
  }

  async findWarehouseByName(name: string): Promise<WarehouseEntity | null> {
    return this.warehouses.findOne({ where: { name } });
  }

  // ---------------------------------------------------------------------------
  // کالاها (Stock Items)
  // ---------------------------------------------------------------------------

  async createStockItem(
    data: Partial<StockItemEntity>,
  ): Promise<StockItemEntity> {
    const entity = this.stockItems.create(data);
    return this.stockItems.save(entity);
  }

  async saveStockItem(entity: StockItemEntity): Promise<StockItemEntity> {
    return this.stockItems.save(entity);
  }

  async findStockItemById(id: number): Promise<StockItemEntity | null> {
    return this.stockItems.findOne({ where: { id } });
  }

  async findStockItemBySku(sku: string): Promise<StockItemEntity | null> {
    return this.stockItems.findOne({ where: { sku } });
  }

  async findAllStockItems(): Promise<StockItemEntity[]> {
    return this.stockItems.find({ order: { name: 'ASC' } });
  }

  async findStockItemsAndCount(options: {
    search?: string;
    lowStockOnly: boolean;
    skip: number;
    take: number;
  }): Promise<[StockItemEntity[], number]> {
    const query = this.stockItems.createQueryBuilder('item');

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
    sku: string,
    warehouseId: number | null = null,
  ): Promise<FifoBatchEntity[]> {
    const query = this.batches
      .createQueryBuilder('batch')
      .where('batch.sku = :sku', { sku })
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
  async getBatchAggregates(): Promise<BatchAggregateRow[]> {
    return this.batches
      .createQueryBuilder('batch')
      .select('batch.sku', 'sku')
      .addSelect('COALESCE(SUM(batch.quantityRemaining), 0)', 'batchQuantity')
      .addSelect(
        'COALESCE(SUM(batch.quantityRemaining * batch.unitPurchaseCost), 0)',
        'fifoValue',
      )
      .addSelect('COUNT(batch.id)', 'openBatchCount')
      .where('batch.quantityRemaining > 0')
      .groupBy('batch.sku')
      .getRawMany<BatchAggregateRow>();
  }

  /**
   * موجودی یک انبار به تفکیک کالا (خروجی خام Query Builder).
   */
  async getWarehouseStock(
    warehouseId: number,
  ): Promise<WarehouseStockRawRow[]> {
    return this.batches
      .createQueryBuilder('batch')
      .innerJoin(StockItemEntity, 'item', 'item.sku = batch.sku')
      .select('batch.sku', 'sku')
      .addSelect('item.name', 'name')
      .addSelect('COALESCE(SUM(batch.quantityRemaining), 0)', 'quantity')
      .addSelect(
        'COALESCE(SUM(batch.quantityRemaining * batch.unitPurchaseCost), 0)',
        'fifoValue',
      )
      .addSelect('COUNT(batch.id)', 'openBatchCount')
      .where('batch.warehouseId = :warehouseId', { warehouseId })
      .andWhere('batch.quantityRemaining > 0')
      .groupBy('batch.sku')
      .addGroupBy('item.name')
      .orderBy('item.name', 'ASC')
      .getRawMany<WarehouseStockRawRow>();
  }

  // ---------------------------------------------------------------------------
  // تراکنش‌های اتمیک ورود/خروج کالا
  // ---------------------------------------------------------------------------

  /**
   * ورود کالا: ایجاد لایه FIFO جدید + افزایش موجودی کالا در یک Transaction.
   * در صورت نبود کالا یا انبار، کل تراکنش Rollback می‌شود.
   */
  async persistInbound(
    input: InboundPersistInput,
  ): Promise<InboundPersistResult> {
    return this.dataSource.transaction(async (manager) => {
      const item = await manager.findOne(StockItemEntity, {
        where: { sku: input.sku },
        lock: { mode: 'pessimistic_write' },
      });
      if (!item) {
        throw new StockItemMissingError(input.sku);
      }

      await this.assertWarehouseExists(manager, input.warehouseId);

      const batch = manager.create(FifoBatchEntity, {
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
    });
  }

  /**
   * خروج کالا: مصرف لایه‌های FIFO به‌ترتیب قدیمی‌ترین و کاهش موجودی کالا در
   * یک Transaction. در صورت کمبود موجودی، کل تراکنش Rollback می‌شود.
   */
  async persistOutbound(
    input: OutboundPersistInput,
  ): Promise<OutboundPersistResult> {
    return this.dataSource.transaction(async (manager) => {
      const item = await manager.findOne(StockItemEntity, {
        where: { sku: input.sku },
        lock: { mode: 'pessimistic_write' },
      });
      if (!item) {
        throw new StockItemMissingError(input.sku);
      }

      const query = manager
        .createQueryBuilder(FifoBatchEntity, 'batch')
        .setLock('pessimistic_write')
        .where('batch.sku = :sku', { sku: input.sku })
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
    });
  }

  private async assertWarehouseExists(
    manager: EntityManager,
    warehouseId: number | null,
  ): Promise<void> {
    if (warehouseId === null) {
      return;
    }
    const warehouse = await manager.findOne(WarehouseEntity, {
      where: { id: warehouseId },
    });
    if (!warehouse) {
      throw new WarehouseMissingError(warehouseId);
    }
  }
}
