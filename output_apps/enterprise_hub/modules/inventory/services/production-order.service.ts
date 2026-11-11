import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ProductionOrderRepository } from '../repositories/production-order.repository';
import { BomService } from './bom.service';
import { InventoryRepository } from '../repositories/inventory.repository';
import { PostingRulesService } from '../../posting_rules/services/posting-rules.service';
import {
  CompleteProductionOrderDto,
  CreateProductionOrderDto,
} from '../dto/bom.dto';
import {
  ProductionOrderEntity,
  ProductionOrderStatus,
} from '../entities/production-order.entity';

@Injectable()
export class ProductionOrderService {
  constructor(
    private readonly ordersRepo: ProductionOrderRepository,
    private readonly bomService: BomService,
    private readonly inventoryRepo: InventoryRepository,
    @Optional() private readonly postingRules?: PostingRulesService,
  ) {}

  async createOrder(
    tenantId: string,
    dto: CreateProductionOrderDto,
  ): Promise<ProductionOrderEntity> {
    const existing = await this.ordersRepo.findByNumber(tenantId, dto.orderNumber);
    if (existing) {
      throw new BadRequestException(
        `Production order "${dto.orderNumber}" already exists`,
      );
    }

    const bom = await this.bomService.getBom(tenantId, dto.bomId);
    if (!bom.isActive) {
      throw new BadRequestException(`BOM "${bom.bomCode}" is inactive`);
    }

    return this.ordersRepo.create(tenantId, {
      orderNumber: dto.orderNumber,
      bomId: bom.id,
      finishedSku: bom.finishedItemSku,
      warehouseId: dto.warehouseId,
      plannedQuantity: dto.plannedQuantity,
      notes: dto.notes,
    });
  }

  async getOrder(tenantId: string, id: number): Promise<ProductionOrderEntity> {
    const order = await this.ordersRepo.findById(tenantId, id);
    if (!order) {
      throw new NotFoundException(`Production order #${id} not found`);
    }
    return order;
  }

  async listOrders(
    tenantId: string,
    status?: ProductionOrderStatus,
  ): Promise<ProductionOrderEntity[]> {
    return this.ordersRepo.list(tenantId, status);
  }

  async startOrder(tenantId: string, id: number): Promise<ProductionOrderEntity> {
    const order = await this.getOrder(tenantId, id);
    if (order.status !== ProductionOrderStatus.DRAFT) {
      throw new BadRequestException(
        `Cannot start order in status "${order.status}"`,
      );
    }
    return this.ordersRepo.updateStatus(
      tenantId,
      id,
      ProductionOrderStatus.IN_PROGRESS,
    );
  }

  /**
   * Completes production order:
   * 1. Multi-level BOM explosion for completed quantity.
   * 2. Issues raw components from inventory at FIFO cost (consuming FIFO layers).
   * 3. Calculates total cost in minor units and finished good unit cost.
   * 4. Inbounds finished good to destination warehouse at the summed cost.
   * 5. Posts accounting voucher through PostingRulesService (inventory.production).
   */
  async completeOrder(
    tenantId: string,
    id: number,
    dto: CompleteProductionOrderDto,
  ): Promise<ProductionOrderEntity> {
    const order = await this.getOrder(tenantId, id);
    if (
      order.status === ProductionOrderStatus.COMPLETED ||
      order.status === ProductionOrderStatus.CANCELLED
    ) {
      throw new BadRequestException(
        `Cannot complete order in status "${order.status}"`,
      );
    }

    if (dto.completedQuantity <= 0) {
      throw new BadRequestException('Completed quantity must be positive');
    }

    // 1. Explode BOM for the completed quantity
    const explosion = await this.bomService.explodeBom(
      tenantId,
      order.bomId,
      dto.completedQuantity,
    );

    // 2. Consume components via FIFO layers and calculate exact total cost
    let totalRawCostMinor = 0n;
    for (const comp of explosion.leafComponents) {
      const { layers } = await this.inventoryRepo.persistOutbound(tenantId, {
        sku: comp.sku,
        quantity: comp.totalGrossQuantity,
        warehouseId: order.warehouseId ?? null,
      });

      for (const layer of layers) {
        // layer.quantity (scale 3) * unitPurchaseCost
        const qtyScaled = BigInt(Math.round(layer.quantity * 1000));
        const unitCost = BigInt(Math.round(layer.unitPurchaseCost));
        totalRawCostMinor += (qtyScaled * unitCost) / 1000n;
      }
    }

    // 3. Finished good unit cost = totalRawCostMinor / completedQuantity
    const completedUnitsScaled = BigInt(Math.round(dto.completedQuantity * 1000));
    const unitCostMinor =
      completedUnitsScaled > 0n
        ? (totalRawCostMinor * 1000n) / completedUnitsScaled
        : 0n;

    // 4. Inbound finished good into warehouse at the summed cost
    const destWarehouse =
      dto.destinationWarehouseId ?? order.warehouseId ?? null;

    await this.inventoryRepo.persistInbound(tenantId, {
      sku: order.finishedSku,
      quantity: dto.completedQuantity,
      unitPurchaseCost: Number(unitCostMinor),
      batchNumber: `BATCH-PROD-${order.orderNumber}`,
      warehouseId: destWarehouse,
    });

    // 5. Post accounting voucher through posting rules engine
    let voucherId: number | null = null;
    if (this.postingRules && totalRawCostMinor > 0n) {
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tehran',
      }).format(new Date());

      const result = await this.postingRules.post(tenantId, {
        docType: 'inventory.production',
        sourceType: 'production_order',
        sourceId: order.orderNumber,
        date: today,
        amounts: { amount: totalRawCostMinor },
        description: `سند بهای تمام‌شده تولید سفارش ${order.orderNumber} - کالای ${order.finishedSku}`,
      });
      voucherId = result.entryId;
    }

    // 6. Update order state to COMPLETED
    return this.ordersRepo.updateCompletion(tenantId, id, {
      completedQuantity: dto.completedQuantity,
      totalCostMinor: totalRawCostMinor,
      unitCostMinor,
      voucherId,
      status: ProductionOrderStatus.COMPLETED,
    });
  }

  async cancelOrder(
    tenantId: string,
    id: number,
  ): Promise<ProductionOrderEntity> {
    const order = await this.getOrder(tenantId, id);
    if (order.status === ProductionOrderStatus.COMPLETED) {
      throw new BadRequestException('Cannot cancel completed order');
    }
    return this.ordersRepo.updateStatus(
      tenantId,
      id,
      ProductionOrderStatus.CANCELLED,
    );
  }
}
