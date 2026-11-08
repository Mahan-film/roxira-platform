import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { parseScaled } from '../../accounting/money';
import {
  assertValidQuantityScale,
  MONEY_SCALE,
  QUANTITY_SCALE,
} from '../constants/inventory.constants';
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

/**
 * Stock compared with the minimum on the "below reorder point" list (E2.1): AVAILABLE stock,
 * on-hand (`item.quantity`) minus the reserved quantity of the same item (`:rIds`/`:rQtys` carry
 * the tenant's per-item reservations as parallel arrays; an item without a reservation stays at
 * its full on-hand quantity). The arithmetic happens in SQL numeric — never in floats.
 */
export const REORDER_STOCK_SQL =
  '(item.quantity - COALESCE((SELECT x.q FROM unnest(CAST(:rIds AS int[]), CAST(:rQtys AS numeric[])) AS x(id, q) WHERE x.id = item.id), 0))';

/** ورودی پرسیستنس ورود کالا در یک Transaction. */
export interface InboundPersistInput {
  sku: string;
  quantity: number;
  unitPurchaseCost: number;
  warehouseId: number | null;
  batchNumber: string;
  /** Layer arrival time; FIFO order follows it. Defaults to now. */
  receivedDate?: Date;
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

/** لایه FIFO قفل‌شده برای تخصیص هزینه سربار؛ مقادیر دقیق صدک. */
export interface LockedFifoLayer {
  id: number;
  /** Hundredths of a unit still in the layer, exact bigint. */
  quantityRemaining: bigint;
}

/** نتیجه پرسیستنس خروج کالا. */
export interface OutboundPersistResult {
  item: StockItemEntity;
  layers: ConsumedLayer[];
  warning?: string;
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
    @Optional()
    private readonly scope?: TenantScope,
  ) {}

  private get tenantScope(): TenantScope | undefined {
    if (this.scope) {
      return this.scope;
    }
    const ds =
      this.dataSource ??
      this.warehouses?.manager?.connection ??
      this.stockItems?.manager?.connection ??
      this.batches?.manager?.connection;
    if ((ds as { isInitialized?: boolean } | undefined)?.isInitialized) {
      return new TenantScope(ds);
    }
    return undefined;
  }

  private withWarehouses<T>(
    tenantId: string,
    work: (repo: Repository<WarehouseEntity>) => Promise<T>,
  ): Promise<T> {
    const scope = this.tenantScope;
    if (scope) {
      return scope.run(tenantId, (m) => work(m.getRepository(WarehouseEntity)));
    }
    return work(this.warehouses);
  }

  private withStockItems<T>(
    tenantId: string,
    work: (repo: Repository<StockItemEntity>) => Promise<T>,
    manager?: EntityManager,
  ): Promise<T> {
    const scope = this.tenantScope;
    if (scope) {
      return scope.within(tenantId, manager, (m) => work(m.getRepository(StockItemEntity)));
    }
    const repo = manager ? manager.getRepository(StockItemEntity) : this.stockItems;
    return work(repo);
  }

  private withBatches<T>(
    tenantId: string,
    work: (repo: Repository<FifoBatchEntity>) => Promise<T>,
  ): Promise<T> {
    const scope = this.tenantScope;
    if (scope) {
      return scope.run(tenantId, (m) => work(m.getRepository(FifoBatchEntity)));
    }
    return work(this.batches);
  }

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
    return this.withWarehouses(tenantId, (repo) => {
      const entity = repo.create({
        storeId: null,
        isActive: true,
        ...data,
        tenantId,
        createdAt: new Date(),
      });
      return repo.save(entity);
    });
  }

  async findAllWarehouses(tenantId: string): Promise<WarehouseEntity[]> {
    return this.withWarehouses(tenantId, (repo) =>
      repo.find({
        where: { tenantId },
        order: { name: 'ASC' },
      }),
    );
  }

  async findWarehouseById(
    tenantId: string,
    id: number,
  ): Promise<WarehouseEntity | null> {
    return this.withWarehouses(tenantId, (repo) => repo.findOne({ where: { id, tenantId } }));
  }

  /** The item whose code (SKU) or barcode is exactly `code`; SKU wins when both match. */
  async findStockItemByCode(tenantId: string, code: string): Promise<StockItemEntity | null> {
    return this.withStockItems(tenantId, async (repo) => {
      return (
        (await repo.findOne({ where: { tenantId, sku: code } })) ??
        (await repo.findOne({ where: { tenantId, barcode: code }, order: { id: 'ASC' } }))
      );
    });
  }

  /** Units of `sku` available to sell: in one warehouse's layers, or the item total when none is given. */
  async availableQuantity(tenantId: string, sku: string, warehouseId: number | null): Promise<number> {
    if (warehouseId === null) {
      const item = await this.withStockItems(tenantId, (repo) =>
        repo.findOne({ where: { tenantId, sku } }),
      );
      return Number(item?.quantity ?? 0);
    }
    const row = await this.withBatches(tenantId, (repo) =>
      repo
        .createQueryBuilder('batch')
        .select('COALESCE(SUM(batch.quantityRemaining), 0)', 'total')
        .where('batch.tenantId = :tenantId', { tenantId })
        .andWhere('batch.sku = :sku', { sku })
        .andWhere('batch.warehouseId = :warehouseId', { warehouseId })
        .andWhere('batch.quantityRemaining > 0')
        .getRawOne<{ total: string }>(),
    );
    return Number(row?.total ?? 0);
  }

  /** A store of this tenant, or null (used to validate a warehouse's `storeId`). */
  async findStoreById(tenantId: string, id: number): Promise<StoreEntity | null> {
    const scope = this.tenantScope;
    if (scope) {
      return scope.run(tenantId, (m) =>
        m.getRepository(StoreEntity).findOne({ where: { id, tenantId } }),
      );
    }
    return this.dataSource.getRepository(StoreEntity).findOne({ where: { id, tenantId } });
  }

  /** Updates the editable warehouse fields, scoped by tenant. */
  async updateWarehouse(
    tenantId: string,
    id: number,
    patch: Partial<Pick<WarehouseEntity, 'name' | 'locationCode' | 'storeId' | 'isActive'>>,
  ): Promise<void> {
    await this.withWarehouses(tenantId, async (repo) => {
      await repo.update({ id, tenantId }, patch);
    });
  }

  /** Open stock quantity (sum of FIFO layers) held by one warehouse. */
  async openQuantityInWarehouse(tenantId: string, warehouseId: number): Promise<number> {
    const row = await this.withBatches(tenantId, (repo) =>
      repo
        .createQueryBuilder('batch')
        .select('COALESCE(SUM(batch.quantityRemaining), 0)', 'total')
        .where('batch.tenantId = :tenantId', { tenantId })
        .andWhere('batch.warehouseId = :warehouseId', { warehouseId })
        .andWhere('batch.quantityRemaining > 0')
        .getRawOne<{ total: string }>(),
    );
    return Number(row?.total ?? 0);
  }

  /** How many of the tenant's items have no open FIFO layer. */
  async countItemsWithoutStock(tenantId: string): Promise<number> {
    return this.withStockItems(tenantId, (repo) =>
      repo
        .createQueryBuilder('item')
        .where('item.tenantId = :tenantId', { tenantId })
        .andWhere(
          `NOT EXISTS (SELECT 1 FROM inventory_fifo_batches b WHERE b.tenant_id = item.tenant_id AND b.sku = item.sku AND b.quantity_remaining > 0)`,
        )
        .getCount(),
    );
  }

  async findWarehouseByName(
    tenantId: string,
    name: string,
  ): Promise<WarehouseEntity | null> {
    return this.withWarehouses(tenantId, (repo) => repo.findOne({ where: { name, tenantId } }));
  }

  // ---------------------------------------------------------------------------
  // کالاها (Stock Items)
  // ---------------------------------------------------------------------------

  async createStockItem(
    tenantId: string,
    data: Partial<StockItemEntity>,
    manager?: EntityManager,
  ): Promise<StockItemEntity> {
    return this.withStockItems(
      tenantId,
      (repo) => {
        const entity = repo.create({ ...data, tenantId });
        return repo.save(entity);
      },
      manager,
    );
  }

  async transaction<T>(work: (m: EntityManager) => Promise<T>, tenantId?: string): Promise<T> {
    const scope = this.tenantScope;
    if (tenantId && scope) {
      return scope.run(tenantId, work);
    }
    return this.dataSource.transaction(work);
  }

  async saveStockItem(
    tenantId: string,
    entity: StockItemEntity,
  ): Promise<StockItemEntity> {
    // به‌روزرسانی با قید مستأجر: شناسه سازمان دیگر ۰ ردیف را تغییر می‌دهد.
    await this.withStockItems(tenantId, async (repo) => {
      await repo.update(
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
    });
    entity.tenantId = tenantId;
    return entity;
  }

  async findStockItemById(
    tenantId: string,
    id: number,
  ): Promise<StockItemEntity | null> {
    return this.withStockItems(tenantId, (repo) => repo.findOne({ where: { id, tenantId } }));
  }

  async findStockItemBySku(
    tenantId: string,
    sku: string,
  ): Promise<StockItemEntity | null> {
    return this.withStockItems(tenantId, (repo) => repo.findOne({ where: { sku, tenantId } }));
  }

  /** شناسه‌های کالای موجودِ مستأجر در میان فهرست داده‌شده (تشخیص تکراری). */
  async findStockItemSkus(
    tenantId: string,
    skus: string[],
  ): Promise<string[]> {
    if (skus.length === 0) {
      return [];
    }
    const rows = await this.withStockItems(tenantId, (repo) =>
      repo.find({
        where: { tenantId, sku: In(skus) },
        select: { sku: true },
      }),
    );
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
    const items = await this.withStockItems(tenantId, (repo) =>
      repo.find({
        where: { tenantId, id: In(ids) },
        select: { id: true, sku: true },
      }),
    );
    const skus = items.map((item) => item.sku);
    if (skus.length === 0) {
      return [];
    }
    const batches = await this.withBatches(tenantId, (repo) =>
      repo.find({
        where: { tenantId, sku: In(skus) },
        select: { sku: true },
      }),
    );
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
    const result = await this.withStockItems(tenantId, (repo) =>
      repo.delete({ tenantId, id: In(ids) }),
    );
    return result.affected ?? 0;
  }

  async findAllStockItems(tenantId: string): Promise<StockItemEntity[]> {
    return this.withStockItems(tenantId, (repo) =>
      repo.find({
        where: { tenantId },
        order: { name: 'ASC' },
      }),
    );
  }

  async findStockItemsAndCount(
    tenantId: string,
    options: {
      search?: string;
      lowStockOnly: boolean;
      /** Only items with no open FIFO layer (nothing on the shelf, e.g. imported but never received). */
      noStockOnly?: boolean;
      /** Per-item reserved quantity (numeric text) subtracted from on-hand for the reorder rule. */
      reserved?: Array<{ itemId: number; quantity: string }>;
      skip: number;
      take: number;
    },
  ): Promise<[StockItemEntity[], number]> {
    return this.withStockItems(tenantId, (repo) => {
      const query = repo.createQueryBuilder('item');

      query.where('item.tenantId = :tenantId', { tenantId });

      if (options.search) {
        const pattern = `%${options.search}%`;
        query.andWhere(
          '(item.sku ILIKE :pattern OR item.barcode ILIKE :pattern OR item.name ILIKE :pattern)',
          { pattern },
        );
      }
      if (options.lowStockOnly) {
        const reserved = options.reserved ?? [];
        query
          .andWhere(`item.minQuantity > 0 AND ${REORDER_STOCK_SQL} <= item.minQuantity`)
          .setParameter('rIds', reserved.map((row) => row.itemId))
          .setParameter('rQtys', reserved.map((row) => row.quantity));
      }
      if (options.noStockOnly) {
        query.andWhere(
          `NOT EXISTS (SELECT 1 FROM inventory_fifo_batches b WHERE b.tenant_id = item.tenant_id AND b.sku = item.sku AND b.quantity_remaining > 0)`,
        );
      }

      // An exact code or barcode match comes first, so a scanned barcode is always on the first
      // page even when many other items contain the same digits.
      const exact = options.search?.trim();
      if (exact) {
        query
          .addSelect('CASE WHEN item.sku = :exact OR item.barcode = :exact THEN 0 ELSE 1 END', 'exact_rank')
          .setParameter('exact', exact)
          .orderBy('exact_rank', 'ASC')
          .addOrderBy('item.name', 'ASC');
      } else {
        query.orderBy('item.name', 'ASC');
      }
      query
        .addOrderBy('item.id', 'ASC')
        .skip(options.skip)
        .take(options.take);

      return query.getManyAndCount();
    });
  }

  // ---------------------------------------------------------------------------
  // دسته‌های FIFO (Batches)
  // ---------------------------------------------------------------------------

  async findBatchesBySku(
    tenantId: string,
    sku: string,
    warehouseId: number | null = null,
  ): Promise<FifoBatchEntity[]> {
    return this.withBatches(tenantId, (repo) => {
      const query = repo
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
    });
  }

  /**
   * تجمیع ارزش لایه‌های FIFO باز به تفکیک کالا.
   */
  async getBatchAggregates(tenantId: string): Promise<BatchAggregateRow[]> {
    return this.withBatches(tenantId, (repo) =>
      repo
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
        .getRawMany<BatchAggregateRow>(),
    );
  }

  /**
   * موجودی یک انبار به تفکیک کالا (خروجی خام Query Builder).
   */
  async getWarehouseStock(
    tenantId: string,
    warehouseId: number,
  ): Promise<WarehouseStockRawRow[]> {
    return this.withBatches(tenantId, (repo) =>
      repo
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
        .getRawMany<WarehouseStockRawRow>(),
    );
  }

  // ---------------------------------------------------------------------------
  // تراکنش‌های اتمیک ورود/خروج کالا
  // ---------------------------------------------------------------------------

  /** Runs `work` in the caller's transaction when given, otherwise in a new tenant-scoped one. */
  private runInTransaction<T>(
    tenantId: string,
    work: (manager: EntityManager) => Promise<T>,
    outerManager?: EntityManager,
  ): Promise<T> {
    const scope = this.tenantScope;
    if (scope) {
      return scope.within(tenantId, outerManager, work);
    }
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
    return this.runInTransaction(
      tenantId,
      async (manager) => {
        const item = await manager.findOne(StockItemEntity, {
          where: { sku: input.sku, tenantId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!item) {
          throw new StockItemMissingError(input.sku);
        }

        await this.assertWarehouseExists(manager, tenantId, input.warehouseId);

        assertValidQuantityScale(input.quantity, QUANTITY_SCALE, 'مقدار ورودی کالا');

        const batch = manager.create(FifoBatchEntity, {
          tenantId,
          sku: input.sku,
          batchNumber: input.batchNumber,
          quantityRemaining: this.roundQuantity(input.quantity),
          unitPurchaseCost: this.roundMoney(input.unitPurchaseCost),
          receivedDate: input.receivedDate ?? new Date(),
          warehouseId: input.warehouseId,
        });
        const savedBatch = await manager.save(batch);

        item.quantity = this.roundQuantity(item.quantity + input.quantity);
        if (!item.batchNumber) {
          item.batchNumber = input.batchNumber;
        }
        const savedItem = await manager.save(item);

        return { item: savedItem, batch: savedBatch };
      },
      outerManager,
    );
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
    return this.runInTransaction(
      tenantId,
      async (manager) => {
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

        assertValidQuantityScale(input.quantity, QUANTITY_SCALE, 'مقدار خروجی کالا');
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

        let warning: string | undefined;
        if (remaining > 0) {
          const available = this.roundQuantity(input.quantity - remaining);
          const mode = await this.getNegativeStockMode(tenantId, manager);
          if (mode === 'refuse') {
            throw new InsufficientStockError(input.sku, input.quantity, available);
          }
          layers.push({
            batchId: 0,
            batchNumber: 'NEGATIVE-STOCK',
            quantity: this.roundQuantity(remaining),
            unitPurchaseCost: 0,
            warehouseId: input.warehouseId,
          });
          if (mode === 'warn') {
            warning = `کسری موجودی کالا: موجودی انبار برای کالای ${input.sku} منفی شد (کسری: ${remaining}).`;
          }
        }

        item.quantity = this.roundQuantity(item.quantity - input.quantity);
        const savedItem = await manager.save(item);

        return { item: savedItem, layers, warning };
      },
      outerManager,
    );
  }

  private async getNegativeStockMode(
    tenantId: string,
    manager: EntityManager,
  ): Promise<string> {
    const rows = (await manager.query(
      `SELECT "value" FROM "tenant_policy_settings" WHERE "tenant_id" = $1 AND "key" = 'inventory.negative_stock.mode'`,
      [tenantId],
    )) as Array<{ value: unknown }>;
    if (rows.length > 0 && rows[0].value !== null && rows[0].value !== undefined) {
      const val = typeof rows[0].value === 'string'
        ? rows[0].value.replace(/^"|"$/g, '')
        : String(rows[0].value);
      return val;
    }
    return 'refuse';
  }

  /**
   * Locks the FIFO layers of one allocation run in id order (deadlock-free against another run
   * that locks an overlapping set) and returns their remaining quantity in exact hundredths.
   * Landed cost uses this so a late cost reads the layer it will raise atomically.
   */
  async lockFifoBatchesByIds(
    tenantId: string,
    ids: number[],
    manager?: EntityManager,
  ): Promise<Map<number, LockedFifoLayer>> {
    const result = new Map<number, LockedFifoLayer>();
    if (ids.length === 0) {
      return result;
    }
    const rows: Array<Record<string, unknown>> = await this.runInTransaction(
      tenantId,
      async (m) =>
        m.query(
          `SELECT "id", "quantity_remaining" FROM "inventory_fifo_batches"
            WHERE "tenant_id" = $1 AND "id" = ANY($2::int[])
            ORDER BY "id" ASC
            FOR UPDATE`,
          [tenantId, ids],
        ),
      manager,
    );
    for (const row of rows) {
      result.set(Number(row.id), {
        id: Number(row.id),
        quantityRemaining: parseScaled(String(row.quantity_remaining), QUANTITY_SCALE),
      });
    }
    return result;
  }

  /**
   * Raises one FIFO layer's unit cost by `deltaMinor` minor units per whole unit (= deltaMinor/100
   * rial, exactly representable in the numeric(18,2) column), tenant scoped and in the caller's
   * transaction. Landed cost is the only caller.
   */
  async raiseLayerUnitCostByMinor(
    tenantId: string,
    batchId: number,
    deltaMinor: bigint,
    manager?: EntityManager,
  ): Promise<void> {
    await this.runInTransaction(
      tenantId,
      async (m) =>
        m.query(
          `UPDATE "inventory_fifo_batches"
              SET "unit_purchase_cost" = "unit_purchase_cost" + ($3::numeric / 100)
            WHERE "tenant_id" = $1 AND "id" = $2`,
          [tenantId, batchId, deltaMinor.toString()],
        ),
      manager,
    );
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
