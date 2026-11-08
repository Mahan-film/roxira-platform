import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { parseScaled } from '../../accounting/money';
import { doubleToHundredths } from '../../sales/sales-math';
import { SalesAvailabilityService } from '../../sales/services/sales-availability.service';
import {
  assertValidQuantityScale,
  MONEY_SCALE,
  QUANTITY_SCALE,
} from '../constants/inventory.constants';
export { assertValidQuantityScale };
import { CreateStockItemDto } from '../dto/create-stock-item.dto';
import { CreateWarehouseDto, UpdateWarehouseDto } from '../dto/create-warehouse.dto';
import { FifoBatchResponseDto } from '../dto/fifo-batch-response.dto';
import {
  FifoValuationResponseDto,
  FifoValuationRowDto,
} from '../dto/inventory-valuation.dto';
import { QueryStockItemDto } from '../dto/query-stock-item.dto';
import { StockItemResponseDto } from '../dto/stock-item-response.dto';
import {
  InboundStockDto,
  OutboundStockDto,
} from '../dto/stock-movement.dto';
import {
  MovementLayerDto,
  StockMovementResultDto,
} from '../dto/stock-movement-result.dto';
import { UpdateStockItemDto } from '../dto/update-stock-item.dto';
import { WarehouseResponseDto } from '../dto/warehouse-response.dto';
import {
  WarehouseStockResponseDto,
  WarehouseStockRowDto,
} from '../dto/warehouse-stock-response.dto';
import { FifoBatchEntity } from '../entities/fifo-batch.entity';
import { StockItemEntity } from '../entities/stock-item.entity';
import { WarehouseEntity } from '../entities/warehouse.entity';
import { StockMovementType } from '../enums/stock-movement-type.enum';
import {
  InsufficientStockError,
  StockItemMissingError,
  WarehouseInactiveError,
  WarehouseMissingError,
} from '../errors/inventory.errors';
import { InventoryRepository } from '../repositories/inventory.repository';

/** ورودی درج کالا از مسیر ورود داده. */
export interface InventoryImportItemInput {
  sku: string;
  barcode: string;
  name: string;
  quantity?: number;
  minQuantity?: number;
  batchNumber?: string;
  unitCost?: number;
}

/**
 * سرویس انبارداری سازمانی چند‌انباره و قیمت‌گذاری FIFO.
 *
 * تمام منطق کسب‌وکار (کنترل یکتایی SKU، هشدار کسری، مصرف FIFO و ارزش‌گذاری
 * موجودی) اینجا قرار دارد؛ Controller فقط مسیریابی می‌کند و Repository تنها
 * لایه دسترسی به پایگاه‌داده است (Rule #3 - AGENTS.md).
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly inventoryRepository: InventoryRepository,
    /** Sales reservations (#527 T1). Optional so existing constructors keep working: without it reserved is 0. */
    @Optional() private readonly reservations?: SalesAvailabilityService,
  ) {}

  private roundMoney(value: number): number {
    const factor = 10 ** MONEY_SCALE;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  private roundQuantity(value: number): number {
    const factor = 10 ** QUANTITY_SCALE;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  /** Same rule as `REORDER_STOCK_SQL` in the repository (available stock = on-hand minus reserved). */
  private isLowStock(quantity: number, minQuantity: number): boolean {
    return minQuantity > 0 && quantity <= minQuantity;
  }

  /** Reserved hundredths per item id; empty when the sales module is not wired in. */
  private async reservedHundredths(
    tenantId: string,
    itemIds?: number[],
  ): Promise<Map<number, bigint>> {
    if (!this.reservations) return new Map();
    const raw = await this.reservations.reservedMap(tenantId, itemIds);
    const map = new Map<number, bigint>();
    for (const [id, text] of raw) {
      map.set(id, parseScaled(text, 2));
    }
    return map;
  }

  private generateBatchNumber(sku: string): string {
    const serial = Date.now().toString(36).toUpperCase();
    const random = Math.floor(Math.random() * 46656)
      .toString(36)
      .toUpperCase()
      .padStart(3, '0');
    return `B-${sku}-${serial}${random}`.slice(0, 100);
  }

  private toWarehouseResponse(entity: WarehouseEntity): WarehouseResponseDto {
    return {
      id: entity.id,
      name: entity.name,
      locationCode: entity.locationCode,
      storeId: entity.storeId ?? null,
      isActive: entity.isActive ?? true,
      createdAt: entity.createdAt,
    };
  }

  private toStockItemResponse(
    entity: StockItemEntity,
    fifoValuation: number,
    reservedH = 0n,
  ): StockItemResponseDto {
    // مقادیر در صدک (bigint) کم/زیاد می‌شوند تا هیچ تفاضل اعشاری شناور ذخیره یا مقایسه نشود.
    const onHand = doubleToHundredths(entity.quantity);
    const available = onHand - reservedH;
    return {
      id: entity.id,
      sku: entity.sku,
      barcode: entity.barcode,
      name: entity.name,
      quantity: Number(onHand) / 100,
      reservedQuantity: Number(reservedH) / 100,
      availableQuantity: Number(available) / 100,
      minQuantity: this.roundQuantity(Number(entity.minQuantity)),
      isLowStock: this.isLowStock(Number(available) / 100, Number(entity.minQuantity)),
      batchNumber: entity.batchNumber,
      fifoValuation: this.roundMoney(fifoValuation),
    };
  }

  private toBatchResponse(
    entity: FifoBatchEntity,
    warehouseName: string | null,
  ): FifoBatchResponseDto {
    const remainingValue =
      Number(entity.quantityRemaining) * Number(entity.unitPurchaseCost);
    return {
      id: entity.id,
      sku: entity.sku,
      batchNumber: entity.batchNumber,
      quantityRemaining: this.roundQuantity(Number(entity.quantityRemaining)),
      unitPurchaseCost: this.roundMoney(Number(entity.unitPurchaseCost)),
      remainingValue: this.roundMoney(remainingValue),
      receivedDate: entity.receivedDate,
      warehouseId: entity.warehouseId,
      warehouseName,
    };
  }

  // ---------------------------------------------------------------------------
  // انبارها
  // ---------------------------------------------------------------------------

  async createWarehouse(
    tenantId: string,
    dto: CreateWarehouseDto,
  ): Promise<WarehouseResponseDto> {
    const existing = await this.inventoryRepository.findWarehouseByName(
      tenantId,
      dto.name,
    );
    if (existing) {
      throw new ConflictException(`انباری با نام ${dto.name} قبلاً ثبت شده است.`);
    }

    if (dto.storeId !== undefined) {
      await this.assertStoreExists(tenantId, dto.storeId);
    }

    const created = await this.inventoryRepository.createWarehouse(tenantId, {
      name: dto.name,
      locationCode: dto.locationCode,
      storeId: dto.storeId ?? null,
    });
    return this.toWarehouseResponse(created);
  }

  private async assertStoreExists(tenantId: string, storeId: number): Promise<void> {
    if (!(await this.inventoryRepository.findStoreById(tenantId, storeId))) {
      throw new NotFoundException(`فروشگاه با شناسه ${storeId} یافت نشد.`);
    }
  }

  /** Renames, regroups or (de)activates a warehouse. A warehouse that still holds stock cannot be deactivated. */
  async updateWarehouse(
    tenantId: string,
    id: number,
    dto: UpdateWarehouseDto,
  ): Promise<WarehouseResponseDto> {
    const warehouse = await this.inventoryRepository.findWarehouseById(tenantId, id);
    if (!warehouse) {
      throw new NotFoundException(`انبار با شناسه ${id} یافت نشد.`);
    }
    if (dto.name !== undefined && dto.name !== warehouse.name) {
      const clash = await this.inventoryRepository.findWarehouseByName(tenantId, dto.name);
      if (clash && clash.id !== id) {
        throw new ConflictException(`انباری با نام ${dto.name} قبلاً ثبت شده است.`);
      }
    }
    if (dto.storeId !== undefined) {
      await this.assertStoreExists(tenantId, dto.storeId);
    }
    if (dto.isActive === false && warehouse.isActive !== false) {
      const open = await this.inventoryRepository.openQuantityInWarehouse(tenantId, id);
      if (open > 0) {
        throw new ConflictException(
          'این انبار هنوز موجودی دارد؛ ابتدا موجودی را به انبار دیگری منتقل کنید.',
        );
      }
    }
    await this.inventoryRepository.updateWarehouse(tenantId, id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.locationCode !== undefined ? { locationCode: dto.locationCode } : {}),
      ...(dto.storeId !== undefined ? { storeId: dto.storeId } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
    });
    const updated = await this.inventoryRepository.findWarehouseById(tenantId, id);
    return this.toWarehouseResponse(updated as WarehouseEntity);
  }

  async listWarehouses(tenantId: string): Promise<WarehouseResponseDto[]> {
    const warehouses =
      await this.inventoryRepository.findAllWarehouses(tenantId);
    return warehouses.map((warehouse) => this.toWarehouseResponse(warehouse));
  }

  async getWarehouseStock(
    tenantId: string,
    id: number,
  ): Promise<WarehouseStockResponseDto> {
    const warehouse = await this.inventoryRepository.findWarehouseById(
      tenantId,
      id,
    );
    if (!warehouse) {
      throw new NotFoundException(`انبار با شناسه ${id} یافت نشد.`);
    }

    const rawRows = await this.inventoryRepository.getWarehouseStock(
      tenantId,
      id,
    );
    const rows: WarehouseStockRowDto[] = rawRows.map((row) => ({
      sku: row.sku,
      name: row.name,
      quantity: this.roundQuantity(Number(row.quantity)),
      fifoValue: this.roundMoney(Number(row.fifoValue)),
      openBatchCount: Number(row.openBatchCount),
    }));

    const totalValue = rows.reduce((sum, row) => sum + row.fifoValue, 0);

    return {
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      locationCode: warehouse.locationCode,
      totalValue: this.roundMoney(totalValue),
      itemCount: rows.length,
      rows,
    };
  }

  // ---------------------------------------------------------------------------
  // کالاها
  // ---------------------------------------------------------------------------

  async createStockItem(
    tenantId: string,
    dto: CreateStockItemDto,
  ): Promise<StockItemResponseDto> {
    const existing = await this.inventoryRepository.findStockItemBySku(
      tenantId,
      dto.sku,
    );
    if (existing) {
      throw new ConflictException(
        `کالایی با شناسه ${dto.sku} قبلاً در فهرست انبار ثبت شده است.`,
      );
    }

    const created = await this.inventoryRepository.createStockItem(tenantId, {
      sku: dto.sku,
      barcode: dto.barcode,
      name: dto.name,
      quantity: this.roundQuantity(dto.quantity ?? 0),
      minQuantity: this.roundQuantity(dto.minQuantity ?? 0),
      batchNumber: dto.batchNumber ?? null,
    });

    return this.toStockItemResponse(created, 0);
  }

  /**
   * Imports one item. With quantity > 0 the item and its opening FIFO layer (cost per unit,
   * the tenant's lowest-id active warehouse or none, batch = file batch or OPEN-<sku>) are created
   * in one transaction. Posts NO journal entry: the opening-balances import posts 1301 itself.
   * SKU duplicates are filtered earlier by the import layer; here they throw ConflictException.
   */
  async importStockItemWithOpeningStock(
    tenantId: string,
    input: InventoryImportItemInput,
  ): Promise<number> {
    const existing = await this.inventoryRepository.findStockItemBySku(
      tenantId,
      input.sku,
    );
    if (existing) {
      throw new ConflictException(
        `کالایی با شناسه ${input.sku} قبلاً در فهرست انبار ثبت شده است.`,
      );
    }

    const q = input.quantity ?? 0;
    const unitCost = input.unitCost;

    assertValidQuantityScale(q, QUANTITY_SCALE, 'موجودی اولیه');
    if (input.minQuantity !== undefined) {
      assertValidQuantityScale(input.minQuantity, QUANTITY_SCALE, 'حداقل موجودی');
    }
    if (q > 0 && unitCost === undefined) {
      throw new BadRequestException('بهای واحد در صورت وجود موجودی اولیه الزامی است.');
    }
    // Amounts are whole rials; a cost on a row without quantity is not stored (no layer exists to hold it).
    if (unitCost !== undefined && (!Number.isInteger(unitCost) || unitCost < 0)) {
      throw new BadRequestException('بهای واحد باید یک عدد صحیح ریال و غیرمنفی باشد.');
    }

    const warehouses = await this.inventoryRepository.findAllWarehouses(tenantId);
    const activeWarehouses = warehouses.filter((w) => w.isActive !== false);
    const warehouseId =
      activeWarehouses.length > 0
        ? Math.min(...activeWarehouses.map((w) => w.id))
        : null;

    return this.inventoryRepository.transaction(async (manager) => {
      const item = await this.inventoryRepository.createStockItem(
        tenantId,
        {
          sku: input.sku,
          barcode: input.barcode,
          name: input.name,
          quantity: 0,
          minQuantity: this.roundQuantity(input.minQuantity ?? 0),
          batchNumber: input.batchNumber ?? null,
        },
        manager,
      );

      if (q > 0) {
        await this.receiveStock(
          tenantId,
          {
            sku: input.sku,
            quantity: q,
            unitPurchaseCost: unitCost!,
            ...(warehouseId !== null ? { warehouseId } : {}),
            batchNumber: input.batchNumber ?? `OPEN-${input.sku}`,
          },
          manager,
        );
      }
      return item.id;
    });
  }

  /** SKU‌های موجودِ مستأجر در میان فهرست داده‌شده (تشخیص تکراری ورود). */
  async findExistingSkus(
    tenantId: string,
    skus: string[],
  ): Promise<string[]> {
    return this.inventoryRepository.findStockItemSkus(tenantId, skus);
  }

  /**
   * حذف کالاهای یک دسته ورود داده.
   * کالایی که گردش/FIFO دارد «ارجاع‌شده» است و حذف نمی‌شود.
   */
  async removeImportedItems(
    tenantId: string,
    ids: number[],
  ): Promise<{ removed: number; refused: number[] }> {
    if (ids.length === 0) {
      return { removed: 0, refused: [] };
    }
    const referenced = new Set(
      await this.inventoryRepository.findReferencedStockItemIds(tenantId, ids),
    );
    const deletable = ids.filter((id) => !referenced.has(id));
    const removed = await this.inventoryRepository.deleteStockItemsByIds(
      tenantId,
      deletable,
    );
    return { removed, refused: Array.from(referenced) };
  }

  async updateStockItem(
    tenantId: string,
    id: number,
    dto: UpdateStockItemDto,
  ): Promise<StockItemResponseDto> {
    const entity = await this.inventoryRepository.findStockItemById(
      tenantId,
      id,
    );
    if (!entity) {
      throw new NotFoundException(`کالای با شناسه ${id} یافت نشد.`);
    }

    if (dto.barcode !== undefined) {
      entity.barcode = dto.barcode;
    }
    if (dto.name !== undefined) {
      entity.name = dto.name;
    }
    if (dto.batchNumber !== undefined) {
      entity.batchNumber = dto.batchNumber;
    }
    if (dto.minQuantity !== undefined) {
      assertValidQuantityScale(dto.minQuantity, QUANTITY_SCALE, 'حداقل موجودی');
      entity.minQuantity = this.roundQuantity(dto.minQuantity);
    }

    const saved = await this.inventoryRepository.saveStockItem(tenantId, entity);
    const valuation = await this.computeItemValuationMap(tenantId);
    const reserved = await this.reservedHundredths(tenantId, [saved.id]);
    return this.toStockItemResponse(
      saved,
      valuation.get(saved.sku) ?? 0,
      reserved.get(saved.id) ?? 0n,
    );
  }

  async getStockItem(
    tenantId: string,
    id: number,
  ): Promise<StockItemResponseDto> {
    const entity = await this.inventoryRepository.findStockItemById(
      tenantId,
      id,
    );
    if (!entity) {
      throw new NotFoundException(`کالای با شناسه ${id} یافت نشد.`);
    }
    const valuation = await this.computeItemValuationMap(tenantId);
    const reserved = await this.reservedHundredths(tenantId, [entity.id]);
    return this.toStockItemResponse(
      entity,
      valuation.get(entity.sku) ?? 0,
      reserved.get(entity.id) ?? 0n,
    );
  }

  async getStockItemBySku(
    tenantId: string,
    sku: string,
  ): Promise<StockItemResponseDto> {
    const entity = await this.inventoryRepository.findStockItemBySku(
      tenantId,
      sku,
    );
    if (!entity) {
      throw new NotFoundException(`کالایی با شناسه ${sku} یافت نشد.`);
    }
    const valuation = await this.computeItemValuationMap(tenantId);
    const reserved = await this.reservedHundredths(tenantId, [entity.id]);
    return this.toStockItemResponse(
      entity,
      valuation.get(entity.sku) ?? 0,
      reserved.get(entity.id) ?? 0n,
    );
  }

  async listStockItems(
    tenantId: string,
    query: QueryStockItemDto,
  ): Promise<{
    data: StockItemResponseDto[];
    total: number;
    page: number;
    limit: number;
    lowStockCount: number;
    noStockCount: number;
  }> {
    // رزرو همه کالاهای مستأجر، پیش از پرس‌وجوی صفحه: قانون نقطه سفارش دوباره روی موجودی در
    // دسترس (on-hand منهای رزرو) اعمال می‌شود، نه روی موجودی فیزیکی.
    const reservedMap = await this.reservedHundredths(tenantId);
    const [entities, total] =
      await this.inventoryRepository.findStockItemsAndCount(tenantId, {
        search: query.search,
        lowStockOnly: query.lowStockOnly ?? false,
        noStockOnly: query.noStockOnly ?? false,
        reserved: [...reservedMap].map(([itemId, hundredths]) => ({
          itemId,
          quantity: (Number(hundredths) / 100).toFixed(2),
        })),
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });

    const valuation = await this.computeItemValuationMap(tenantId);
    const data = entities.map((entity) =>
      this.toStockItemResponse(entity, valuation.get(entity.sku) ?? 0, reservedMap.get(entity.id) ?? 0n),
    );

    return {
      data,
      total,
      page: query.page,
      limit: query.limit,
      lowStockCount: data.filter((item) => item.isLowStock).length,
      noStockCount: await this.inventoryRepository.countItemsWithoutStock(tenantId),
    };
  }

  async getStockItemBatches(
    tenantId: string,
    sku: string,
  ): Promise<FifoBatchResponseDto[]> {
    const item = await this.inventoryRepository.findStockItemBySku(
      tenantId,
      sku,
    );
    if (!item) {
      throw new NotFoundException(`کالایی با شناسه ${sku} یافت نشد.`);
    }

    const [batches, warehouses] = await Promise.all([
      this.inventoryRepository.findBatchesBySku(tenantId, sku),
      this.inventoryRepository.findAllWarehouses(tenantId),
    ]);
    const warehouseNames = new Map(
      warehouses.map((warehouse) => [warehouse.id, warehouse.name]),
    );

    return batches.map((batch) =>
      this.toBatchResponse(
        batch,
        batch.warehouseId !== null
          ? warehouseNames.get(batch.warehouseId) ?? null
          : null,
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // گردش کالا (ورود/خروج)
  // ---------------------------------------------------------------------------

  async receiveStock(
    tenantId: string,
    dto: InboundStockDto,
    manager?: EntityManager,
  ): Promise<StockMovementResultDto> {
    assertValidQuantityScale(dto.quantity, QUANTITY_SCALE, 'مقدار ورودی کالا');
    const batchNumber = dto.batchNumber ?? this.generateBatchNumber(dto.sku);

    try {
      const result = await this.inventoryRepository.persistInbound(tenantId, {
        sku: dto.sku,
        quantity: dto.quantity,
        unitPurchaseCost: dto.unitPurchaseCost,
        warehouseId: dto.warehouseId ?? null,
        batchNumber,
        receivedDate: dto.receivedAt ? new Date(dto.receivedAt) : undefined,
      }, manager);

      const layer: MovementLayerDto = {
        batchId: result.batch.id,
        batchNumber: result.batch.batchNumber,
        quantity: this.roundQuantity(Number(result.batch.quantityRemaining)),
        unitPurchaseCost: this.roundMoney(
          Number(result.batch.unitPurchaseCost),
        ),
        value: this.roundMoney(
          Number(result.batch.quantityRemaining) *
            Number(result.batch.unitPurchaseCost),
        ),
        warehouseId: result.batch.warehouseId,
      };

      return {
        type: StockMovementType.INBOUND,
        sku: result.item.sku,
        quantity: this.roundQuantity(dto.quantity),
        quantityAfter: this.roundQuantity(Number(result.item.quantity)),
        totalCost: layer.value,
        layers: [layer],
        processedAt: new Date(),
      };
    } catch (error) {
      this.rethrowDomainError(error);
      throw error;
    }
  }

  async issueStock(
    tenantId: string,
    dto: OutboundStockDto,
    manager?: EntityManager,
  ): Promise<StockMovementResultDto> {
    assertValidQuantityScale(dto.quantity, QUANTITY_SCALE, 'مقدار خروجی کالا');
    try {
      const result = await this.inventoryRepository.persistOutbound(tenantId, {
        sku: dto.sku,
        quantity: dto.quantity,
        warehouseId: dto.warehouseId ?? null,
      }, manager);

      const layers: MovementLayerDto[] = result.layers.map((layer) => ({
        batchId: layer.batchId,
        batchNumber: layer.batchNumber,
        quantity: this.roundQuantity(layer.quantity),
        unitPurchaseCost: this.roundMoney(layer.unitPurchaseCost),
        value: this.roundMoney(layer.quantity * layer.unitPurchaseCost),
        warehouseId: layer.warehouseId,
      }));

      const totalCost = layers.reduce((sum, layer) => sum + layer.value, 0);

      return {
        type: StockMovementType.OUTBOUND,
        sku: result.item.sku,
        quantity: this.roundQuantity(dto.quantity),
        quantityAfter: this.roundQuantity(Number(result.item.quantity)),
        totalCost: this.roundMoney(totalCost),
        layers,
        processedAt: new Date(),
        warning: result.warning,
      };
    } catch (error) {
      this.rethrowDomainError(error);
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // ارزش‌گذاری موجودی بر پایه FIFO
  // ---------------------------------------------------------------------------

  async getFifoValuation(
    tenantId: string,
  ): Promise<FifoValuationResponseDto> {
    const [items, aggregates] = await Promise.all([
      this.inventoryRepository.findAllStockItems(tenantId),
      this.inventoryRepository.getBatchAggregates(tenantId),
    ]);
    const reservedMap = await this.reservedHundredths(tenantId);

    const aggregateBySku = new Map(
      aggregates.map((row) => [row.sku, row]),
    );

    const rows: FifoValuationRowDto[] = items.map((item) => {
      const aggregate = aggregateBySku.get(item.sku);
      const batchQuantity = aggregate ? Number(aggregate.batchQuantity) : 0;
      const fifoValue = aggregate ? Number(aggregate.fifoValue) : 0;
      const openBatchCount = aggregate ? Number(aggregate.openBatchCount) : 0;
      const onHand = doubleToHundredths(item.quantity);
      const reserved = reservedMap.get(item.id) ?? 0n;
      const available = onHand - reserved;

      return {
        sku: item.sku,
        name: item.name,
        quantity: Number(onHand) / 100,
        reservedQuantity: Number(reserved) / 100,
        availableQuantity: Number(available) / 100,
        batchQuantity: this.roundQuantity(batchQuantity),
        fifoValue: this.roundMoney(fifoValue),
        weightedAverageUnitCost:
          batchQuantity > 0
            ? this.roundMoney(fifoValue / batchQuantity)
            : 0,
        openBatchCount,
        isLowStock: this.isLowStock(Number(available) / 100, Number(item.minQuantity)),
      };
    });

    const totalInventoryValue = rows.reduce(
      (sum, row) => sum + row.fifoValue,
      0,
    );
    const totalOpenBatches = rows.reduce(
      (sum, row) => sum + row.openBatchCount,
      0,
    );

    return {
      itemCount: rows.length,
      lowStockCount: rows.filter((row) => row.isLowStock).length,
      totalInventoryValue: this.roundMoney(totalInventoryValue),
      totalOpenBatches,
      rows,
    };
  }

  /** نگاشت SKU به ارزش موجودی FIFO برای غنی‌سازی خروجی کالاها. */
  private async computeItemValuationMap(
    tenantId: string,
  ): Promise<Map<string, number>> {
    const aggregates =
      await this.inventoryRepository.getBatchAggregates(tenantId);
    return new Map(
      aggregates.map((row) => [row.sku, Number(row.fifoValue)]),
    );
  }

  /** نگاشت خطاهای دامنه به استثناهای معنایی HTTP. */
  private rethrowDomainError(error: unknown): void {
    if (error instanceof StockItemMissingError) {
      throw new NotFoundException(error.message);
    }
    if (error instanceof WarehouseMissingError) {
      throw new NotFoundException(error.message);
    }
    if (error instanceof WarehouseInactiveError) {
      throw new BadRequestException(error.message);
    }
    if (error instanceof InsufficientStockError) {
      throw new BadRequestException(error.message);
    }
  }
}
