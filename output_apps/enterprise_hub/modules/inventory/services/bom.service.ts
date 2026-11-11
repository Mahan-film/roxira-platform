import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BomRepository } from '../repositories/bom.repository';
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
  constructor(private readonly bomRepo: BomRepository) {}

  async createBom(tenantId: string, dto: CreateBomDto): Promise<BomHeaderEntity> {
    const existing = await this.bomRepo.findByCode(tenantId, dto.bomCode);
    if (existing) {
      throw new BadRequestException(`BOM with code "${dto.bomCode}" already exists`);
    }

    // Validate that sub-BOMs exist and do not create immediate self-cycles
    for (const item of dto.items) {
      if (item.subBomId) {
        const sub = await this.bomRepo.findById(tenantId, item.subBomId);
        if (!sub) {
          throw new NotFoundException(`Sub-BOM #${item.subBomId} not found`);
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
      const ratio = multiplier / (currentBom.outputQuantity || 1);

      const explodedTree: ExplodedBomTree = {
        bomId: currentBom.id,
        bomCode: currentBom.bomCode,
        finishedItemSku: currentBom.finishedItemSku,
        requestedQuantity: multiplier,
        components: [],
      };

      for (const item of currentBom.items ?? []) {
        const netQty = Number((item.quantity * ratio).toFixed(3));
        const wasteRate = (item.wastePercent ?? 0) / 100;
        const grossQty = Number((netQty * (1 + wasteRate)).toFixed(3));
        const wasteQty = Number((grossQty - netQty).toFixed(3));

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

          existing.totalGrossQuantity = Number((existing.totalGrossQuantity + grossQty).toFixed(3));
          existing.totalNetQuantity = Number((existing.totalNetQuantity + netQty).toFixed(3));
          existing.totalWasteQuantity = Number((existing.totalWasteQuantity + wasteQty).toFixed(3));
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
