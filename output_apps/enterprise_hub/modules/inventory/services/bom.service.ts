import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { BomRepository } from '../repositories/bom.repository';
import { ProductionOrderRepository } from '../repositories/production-order.repository';
import { CreateBomDto } from '../dto/bom.dto';
import { BomHeaderEntity } from '../entities/bom-header.entity';

export interface ExplodedComponent {
  componentSku: string;
  netQuantity: number;
  wastePercent: number;
  wasteQuantity: number;
  grossQuantity: number;
  subBomId: number | null;
  level: number;
}

export interface ExplodedBomTree {
  bomId: number;
  bomCode: string;
  finishedItemSku: string;
  requestedQuantity: number;
  components: Array<
    ExplodedComponent & {
      subTree?: ExplodedBomTree;
    }
  >;
}

export interface BomExplosionResult {
  bom: BomHeaderEntity;
  requestedQuantity: number;
  tree: ExplodedBomTree;
  /** Aggregated leaf raw components needed to produce the requested quantity */
  leafComponents: Array<{
    sku: string;
    totalGrossQuantity: number;
    totalNetQuantity: number;
    totalWasteQuantity: number;
  }>;
}

@Injectable()
export class BomService {
  constructor(
    private readonly bomRepo: BomRepository,
    @Optional() private readonly orderRepo?: ProductionOrderRepository,
  ) {}

  async createBom(tenantId: string, dto: CreateBomDto): Promise<BomHeaderEntity> {
    const existing = await this.bomRepo.findByCode(tenantId, dto.bomCode);
    if (existing) {
      throw new BadRequestException(`BOM with code "${dto.bomCode}" already exists`);
    }

    // Validate that sub-BOMs exist, are active, and do not create self-referencing cycles
    for (const item of dto.items) {
      if (item.subBomId) {
        const sub = await this.bomRepo.findById(tenantId, item.subBomId);
        if (!sub) {
          throw new NotFoundException(`Sub-BOM #${item.subBomId} not found`);
        }
        if (!sub.isActive) {
          throw new BadRequestException(`Sub-BOM #${item.subBomId} (${sub.bomCode}) is inactive`);
        }
        if (sub.bomCode === dto.bomCode) {
          throw new BadRequestException(`Self-referencing sub-BOM detected in BOM "${dto.bomCode}"`);
        }
      }
    }

    return this.bomRepo.createBom(tenantId, dto);
  }

  async getBom(tenantId: string, id: number): Promise<BomHeaderEntity> {
    const bom = await this.bomRepo.findById(tenantId, id);
    if (!bom) {
      throw new NotFoundException(`BOM #${id} not found`);
    }
    return bom;
  }

  async listBoms(tenantId: string, finishedItemSku?: string): Promise<BomHeaderEntity[]> {
    return this.bomRepo.list(tenantId, finishedItemSku);
  }

  async deleteBom(tenantId: string, id: number): Promise<boolean> {
    const bom = await this.getBom(tenantId, id);
    if (this.orderRepo) {
      const orders = await this.orderRepo.list(tenantId);
      if (orders.some((o) => o.bomId === id)) {
        throw new BadRequestException('امکان حذف فرمول ساخت دارای سفارش تولید فعال یا ثبت‌شده وجود ندارد.');
      }
    }
    const isUsedAsSubBom = await this.bomRepo.isUsedAsSubBom(tenantId, id);
    if (isUsedAsSubBom) {
      throw new BadRequestException('امکان حذف فرمول ساختی که به عنوان زیرمجموعه در فرمول ساخت دیگری استفاده شده است وجود ندارد.');
    }
    return this.bomRepo.deleteById(tenantId, bom.id);
  }

  /**
   * Recursively explodes a multi-level BOM for a given requested quantity,
   * taking into account waste percentages and preventing circular references.
   */
  async explodeBom(
    tenantId: string,
    bomId: number,
    requestedQuantity: number,
  ): Promise<BomExplosionResult> {
    if (requestedQuantity <= 0) {
      throw new BadRequestException('Requested quantity must be positive');
    }

    const rootBom = await this.getBom(tenantId, bomId);
    const leafMap = new Map<
      string,
      { sku: string; totalGrossQuantity: number; totalNetQuantity: number; totalWasteQuantity: number }
    >();

    const visited = new Set<number>();

    const explodeRecursive = async (
      currentBomId: number,
      multiplier: number,
      level: number,
    ): Promise<ExplodedBomTree> => {
      if (visited.has(currentBomId)) {
        throw new BadRequestException(`Circular BOM dependency detected involving BOM #${currentBomId}`);
      }
      visited.add(currentBomId);

      const currentBom = await this.getBom(tenantId, currentBomId);

      const explodedTree: ExplodedBomTree = {
        bomId: currentBom.id,
        bomCode: currentBom.bomCode,
        finishedItemSku: currentBom.finishedItemSku,
        requestedQuantity: multiplier,
        components: [],
      };

      const multMilli = BigInt(Math.round(multiplier * 1000));
      const outQtyMilli = BigInt(Math.round((currentBom.outputQuantity || 1) * 1000));

      for (const item of currentBom.items ?? []) {
        // Scaled integer arithmetic (milli-units) to eliminate float accumulation
        const itemQtyMilli = BigInt(Math.round(item.quantity * 1000));
        const netQtyMilli = (itemQtyMilli * multMilli + (outQtyMilli / 2n)) / outQtyMilli;

        const wasteBps = BigInt(Math.round((item.wastePercent ?? 0) * 100));
        const wasteQtyMilli = (netQtyMilli * wasteBps + 5000n) / 10000n;
        const grossQtyMilli = netQtyMilli + wasteQtyMilli;

        const netQty = Number(netQtyMilli) / 1000;
        const grossQty = Number(grossQtyMilli) / 1000;
        const wasteQty = Number(wasteQtyMilli) / 1000;

        const componentData: ExplodedComponent = {
          componentSku: item.componentSku,
          netQuantity: netQty,
          wastePercent: item.wastePercent ?? 0,
          wasteQuantity: wasteQty,
          grossQuantity: grossQty,
          subBomId: item.subBomId ?? null,
          level,
        };

        if (item.subBomId) {
          // Multi-level recursion: intermediate sub-assembly
          const subTree = await explodeRecursive(item.subBomId, grossQty, level + 1);
          explodedTree.components.push({
            ...componentData,
            subTree,
          });
        } else {
          // Leaf raw component: aggregate into raw requirements
          explodedTree.components.push(componentData);

          const existing = leafMap.get(item.componentSku) ?? {
            sku: item.componentSku,
            totalGrossQuantity: 0,
            totalNetQuantity: 0,
            totalWasteQuantity: 0,
          };

          const existingGrossMilli = BigInt(Math.round(existing.totalGrossQuantity * 1000));
          const existingNetMilli = BigInt(Math.round(existing.totalNetQuantity * 1000));
          const existingWasteMilli = BigInt(Math.round(existing.totalWasteQuantity * 1000));

          existing.totalGrossQuantity = Number(existingGrossMilli + grossQtyMilli) / 1000;
          existing.totalNetQuantity = Number(existingNetMilli + netQtyMilli) / 1000;
          existing.totalWasteQuantity = Number(existingWasteMilli + wasteQtyMilli) / 1000;
          leafMap.set(item.componentSku, existing);
        }
      }

      visited.delete(currentBomId);
      return explodedTree;
    };

    const tree = await explodeRecursive(bomId, requestedQuantity, 1);

    return {
      bom: rootBom,
      requestedQuantity,
      tree,
      leafComponents: Array.from(leafMap.values()),
    };
  }
}
