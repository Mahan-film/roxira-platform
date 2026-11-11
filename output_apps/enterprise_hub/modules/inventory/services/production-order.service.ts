import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { PostingRulesService } from '../../posting_rules/services/posting-rules.service';
import {
  CompleteProductionOrderDto,
  CreateProductionOrderDto,
} from '../dto/bom.dto';
import {
  ProductionOrderEntity,
  ProductionOrderStatus,
} from '../entities/production-order.entity';
import { InventoryRepository } from '../repositories/inventory.repository';
import { ProductionOrderRepository } from '../repositories/production-order.repository';
import { BomService } from './bom.service';

@Injectable()
export class ProductionOrderService {
  constructor(
    private readonly ordersRepo: ProductionOrderRepository,
    private readonly bomService: BomService,
    private readonly inventoryRepo: InventoryRepository,
    private readonly postingRules: PostingRulesService,
    private readonly tenantScope: TenantScope,
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
   * Completes production order atomically and idempotently (Lesson 18):
   * 1. Acquires pessimistic write lock on the order row inside a TenantScope transaction.
   * 2. Checks order status (must be IN_PROGRESS; if already COMPLETED, returns existing order).
   * 3. Explodes multi-level BOM for the completed quantity.
   * 4. Issues raw components from inventory at FIFO cost (consuming FIFO layers).
   * 5. Fails closed if stock is missing or raw cost cannot be determined.
   * 6. Inbounds finished good to destination warehouse at the summed cost.
   * 7. Posts accounting voucher through PostingRulesService (inventory.production).
   * 8. Atomically updates order to COMPLETED.
   */
  async completeOrder(
    tenantId: string,
    id: number,
    dto: CompleteProductionOrderDto,
  ): Promise<ProductionOrderEntity> {
    return this.tenantScope.run(tenantId, async (m: EntityManager) => {
      // 1. Pessimistic write lock on order row
      const order = await m.getRepository(ProductionOrderEntity).findOne({
        where: { id, tenantId },
        lock: { mode: 'pessimistic_write' },
        relations: ['bom', 'bom.items'],
      });

      if (!order) {
        throw new NotFoundException(`Production order #${id} not found`);
      }

      // 2. Idempotency & Lifecycle validation
      if (order.status === ProductionOrderStatus.COMPLETED) {
        return order; // Idempotent replay: already completed, avoid moving stock twice
      }

      if (order.status !== ProductionOrderStatus.IN_PROGRESS) {
        throw new BadRequestException(
          `Cannot complete order in status "${order.status}". Order must be IN_PROGRESS (call startOrder first).`,
        );
      }

      if (dto.completedQuantity <= 0) {
        throw new BadRequestException('Completed quantity must be positive');
      }

      if (dto.completedQuantity > order.plannedQuantity) {
        throw new BadRequestException(
          `Completed quantity (${dto.completedQuantity}) cannot exceed planned quantity (${order.plannedQuantity})`,
        );
      }

      // 3. Explode BOM for the completed quantity
      const explosion = await this.bomService.explodeBom(
        tenantId,
        order.bomId,
        dto.completedQuantity,
      );

      // 4. Consume components via FIFO layers and calculate exact total cost in minor units
      let totalRawCostMinor = 0n;
      for (const comp of explosion.leafComponents) {
        const outboundRes = await this.inventoryRepo.persistOutbound(
          tenantId,
          {
            sku: comp.sku,
            quantity: comp.totalGrossQuantity,
            warehouseId: order.warehouseId ?? null,
          },
          m,
        );

        for (const layer of outboundRes.layers) {
          const qtyScaled = BigInt(Math.round(layer.quantity * 1000));
          const unitCost = BigInt(Math.round(layer.unitPurchaseCost));
          const layerCost = (qtyScaled * unitCost) / 1000n;
          totalRawCostMinor += layerCost;
        }
      }

      // Fail-closed check: raw materials must have real value
      if (totalRawCostMinor <= 0n) {
        throw new BadRequestException(
          'بهای تمام‌شده مواد اولیه برای سفارش تولید صفر یا نامعتبر است؛ عملیات لغو شد.',
        );
      }

      // 5. Finished good unit cost = totalRawCostMinor / completedQuantity
      const completedUnitsScaled = BigInt(Math.round(dto.completedQuantity * 1000));
      const unitCostMinor =
        completedUnitsScaled > 0n
          ? (totalRawCostMinor * 1000n) / completedUnitsScaled
          : 0n;

      // 6. Inbound finished good into warehouse at the summed cost
      const destWarehouse =
        dto.destinationWarehouseId ?? order.warehouseId ?? null;

      await this.inventoryRepo.persistInbound(
        tenantId,
        {
          sku: order.finishedSku,
          quantity: dto.completedQuantity,
          unitPurchaseCost: Number(unitCostMinor),
          batchNumber: `BATCH-PROD-${order.orderNumber}`,
          warehouseId: destWarehouse,
        },
        m,
      );

      // 7. Post accounting voucher through posting rules engine
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tehran',
      }).format(new Date());

      const result = await this.postingRules.post(
        tenantId,
        {
          docType: 'inventory.production',
          sourceType: 'production_order',
          sourceId: order.orderNumber,
          date: today,
          amounts: { amount: totalRawCostMinor },
          description: `سند بهای تمام‌شده تولید سفارش ${order.orderNumber} - کالای ${order.finishedSku}`,
        },
        m,
      );

      // 8. Atomically update order state to COMPLETED
      return this.ordersRepo.updateCompletion(
        tenantId,
        id,
        {
          completedQuantity: dto.completedQuantity,
          totalCostMinor: totalRawCostMinor,
          unitCostMinor,
          voucherId: result.entryId,
          status: ProductionOrderStatus.COMPLETED,
        },
        m,
      );
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
