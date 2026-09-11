import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MONEY_SCALE, QUANTITY_SCALE } from '../constants/inventory.constants';
import { CreateStockItemDto } from '../dto/create-stock-item.dto';
import { CreateWarehouseDto } from '../dto/create-warehouse.dto';
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
  WarehouseMissingError,
} from '../errors/inventory.errors';
import { InventoryRepository } from '../repositories/inventory.repository';

/**
 * سرویس انبارداری سازمانی چند‌انباره و قیمت‌گذاری FIFO.
 *
 * تمام منطق کسب‌وکار (کنترل یکتایی SKU، هشدار کسری، مصرف FIFO و ارزش‌گذاری
 * موجودی) اینجا قرار دارد؛ Controller فقط مسیریابی می‌کند و Repository تنها
 * لایه دسترسی به پایگاه‌داده است (Rule #3 - AGENTS.md).
 */
@Injectable()
export class InventoryService {
  constructor(private readonly inventoryRepository: InventoryRepository) {}

  private roundMoney(value: number): number {
    const factor = 10 ** MONEY_SCALE;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  private roundQuantity(value: number): number {
    const factor = 10 ** QUANTITY_SCALE;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  private isLowStock(quantity: number, minQuantity: number): boolean {
    return minQuantity > 0 && quantity <= minQuantity;
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
      createdAt: entity.createdAt,
    };
  }

  private toStockItemResponse(
    entity: StockItemEntity,
    fifoValuation: number,
  ): StockItemResponseDto {
    return {
      id: entity.id,
      sku: entity.sku,
      barcode: entity.barcode,
      name: entity.name,
      quantity: this.roundQuantity(Number(entity.quantity)),
      minQuantity: this.roundQuantity(Number(entity.minQuantity)),
      isLowStock: this.isLowStock(
        Number(entity.quantity),
        Number(entity.minQuantity),
      ),
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
    dto: CreateWarehouseDto,
  ): Promise<WarehouseResponseDto> {
    const existing = await this.inventoryRepository.findWarehouseByName(
      dto.name,
    );
    if (existing) {
      throw new ConflictException(`انباری با نام ${dto.name} قبلاً ثبت شده است.`);
    }

    const created = await this.inventoryRepository.createWarehouse({
      name: dto.name,
      locationCode: dto.locationCode,
    });
    return this.toWarehouseResponse(created);
  }

  async listWarehouses(): Promise<WarehouseResponseDto[]> {
    const warehouses = await this.inventoryRepository.findAllWarehouses();
    return warehouses.map((warehouse) => this.toWarehouseResponse(warehouse));
  }

  async getWarehouseStock(id: number): Promise<WarehouseStockResponseDto> {
    const warehouse = await this.inventoryRepository.findWarehouseById(id);
    if (!warehouse) {
      throw new NotFoundException(`انبار با شناسه ${id} یافت نشد.`);
    }

    const rawRows = await this.inventoryRepository.getWarehouseStock(id);
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
    dto: CreateStockItemDto,
  ): Promise<StockItemResponseDto> {
    const existing = await this.inventoryRepository.findStockItemBySku(dto.sku);
    if (existing) {
      throw new ConflictException(
        `کالایی با شناسه ${dto.sku} قبلاً در فهرست انبار ثبت شده است.`,
      );
    }

    const created = await this.inventoryRepository.createStockItem({
      sku: dto.sku,
      barcode: dto.barcode,
      name: dto.name,
      quantity: this.roundQuantity(dto.quantity ?? 0),
      minQuantity: this.roundQuantity(dto.minQuantity ?? 0),
      batchNumber: dto.batchNumber ?? null,
    });

    return this.toStockItemResponse(created, 0);
  }

  async updateStockItem(
    id: number,
    dto: UpdateStockItemDto,
  ): Promise<StockItemResponseDto> {
    const entity = await this.inventoryRepository.findStockItemById(id);
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
      entity.minQuantity = this.roundQuantity(dto.minQuantity);
    }

    const saved = await this.inventoryRepository.saveStockItem(entity);
    const valuation = await this.computeItemValuationMap();
    return this.toStockItemResponse(saved, valuation.get(saved.sku) ?? 0);
  }

  async getStockItem(id: number): Promise<StockItemResponseDto> {
    const entity = await this.inventoryRepository.findStockItemById(id);
    if (!entity) {
      throw new NotFoundException(`کالای با شناسه ${id} یافت نشد.`);
    }
    const valuation = await this.computeItemValuationMap();
    return this.toStockItemResponse(entity, valuation.get(entity.sku) ?? 0);
  }

  async getStockItemBySku(sku: string): Promise<StockItemResponseDto> {
    const entity = await this.inventoryRepository.findStockItemBySku(sku);
    if (!entity) {
      throw new NotFoundException(`کالایی با شناسه ${sku} یافت نشد.`);
    }
    const valuation = await this.computeItemValuationMap();
    return this.toStockItemResponse(entity, valuation.get(entity.sku) ?? 0);
  }

  async listStockItems(query: QueryStockItemDto): Promise<{
    data: StockItemResponseDto[];
    total: number;
    page: number;
    limit: number;
    lowStockCount: number;
  }> {
    const [entities, total] = await this.inventoryRepository.findStockItemsAndCount({
      search: query.search,
      lowStockOnly: query.lowStockOnly ?? false,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    const valuation = await this.computeItemValuationMap();
    const data = entities.map((entity) =>
      this.toStockItemResponse(entity, valuation.get(entity.sku) ?? 0),
    );

    return {
      data,
      total,
      page: query.page,
      limit: query.limit,
      lowStockCount: data.filter((item) => item.isLowStock).length,
    };
  }

  async getStockItemBatches(sku: string): Promise<FifoBatchResponseDto[]> {
    const item = await this.inventoryRepository.findStockItemBySku(sku);
    if (!item) {
      throw new NotFoundException(`کالایی با شناسه ${sku} یافت نشد.`);
    }

    const [batches, warehouses] = await Promise.all([
      this.inventoryRepository.findBatchesBySku(sku),
      this.inventoryRepository.findAllWarehouses(),
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
    dto: InboundStockDto,
  ): Promise<StockMovementResultDto> {
    const batchNumber = dto.batchNumber ?? this.generateBatchNumber(dto.sku);

    try {
      const result = await this.inventoryRepository.persistInbound({
        sku: dto.sku,
        quantity: dto.quantity,
        unitPurchaseCost: dto.unitPurchaseCost,
        warehouseId: dto.warehouseId ?? null,
        batchNumber,
      });

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

  async issueStock(dto: OutboundStockDto): Promise<StockMovementResultDto> {
    try {
      const result = await this.inventoryRepository.persistOutbound({
        sku: dto.sku,
        quantity: dto.quantity,
        warehouseId: dto.warehouseId ?? null,
      });

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
      };
    } catch (error) {
      this.rethrowDomainError(error);
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // ارزش‌گذاری موجودی بر پایه FIFO
  // ---------------------------------------------------------------------------

  async getFifoValuation(): Promise<FifoValuationResponseDto> {
    const [items, aggregates] = await Promise.all([
      this.inventoryRepository.findAllStockItems(),
      this.inventoryRepository.getBatchAggregates(),
    ]);

    const aggregateBySku = new Map(
      aggregates.map((row) => [row.sku, row]),
    );

    const rows: FifoValuationRowDto[] = items.map((item) => {
      const aggregate = aggregateBySku.get(item.sku);
      const batchQuantity = aggregate ? Number(aggregate.batchQuantity) : 0;
      const fifoValue = aggregate ? Number(aggregate.fifoValue) : 0;
      const openBatchCount = aggregate ? Number(aggregate.openBatchCount) : 0;
      const quantity = Number(item.quantity);

      return {
        sku: item.sku,
        name: item.name,
        quantity: this.roundQuantity(quantity),
        batchQuantity: this.roundQuantity(batchQuantity),
        fifoValue: this.roundMoney(fifoValue),
        weightedAverageUnitCost:
          batchQuantity > 0
            ? this.roundMoney(fifoValue / batchQuantity)
            : 0,
        openBatchCount,
        isLowStock: this.isLowStock(quantity, Number(item.minQuantity)),
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
  private async computeItemValuationMap(): Promise<Map<string, number>> {
    const aggregates = await this.inventoryRepository.getBatchAggregates();
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
    if (error instanceof InsufficientStockError) {
      throw new BadRequestException(error.message);
    }
  }
}
