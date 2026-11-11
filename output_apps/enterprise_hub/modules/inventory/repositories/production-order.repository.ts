import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import {
  ProductionOrderEntity,
  ProductionOrderStatus,
} from '../entities/production-order.entity';

export interface CreateProductionOrderInput {
  orderNumber: string;
  bomId: number;
  finishedSku: string;
  warehouseId?: number;
  plannedQuantity: number;
  notes?: string;
}

@Injectable()
export class ProductionOrderRepository {
  constructor(private readonly scope: TenantScope) {}

  private within<T>(
    tenantId: string,
    work: (em: EntityManager) => Promise<T>,
    em?: EntityManager,
  ): Promise<T> {
    return this.scope.within(tenantId, em, work);
  }

  async create(
    tenantId: string,
    input: CreateProductionOrderInput,
    em?: EntityManager,
  ): Promise<ProductionOrderEntity> {
    return this.within(
      tenantId,
      async (m) => {
        const repo = m.getRepository(ProductionOrderEntity);
        const order = repo.create({
          tenantId,
          orderNumber: input.orderNumber,
          bomId: input.bomId,
          finishedSku: input.finishedSku,
          warehouseId: input.warehouseId ?? null,
          plannedQuantity: input.plannedQuantity,
          completedQuantity: 0,
          status: ProductionOrderStatus.DRAFT,
          totalCostMinor: 0n,
          unitCostMinor: 0n,
          notes: input.notes ?? null,
        });
        return repo.save(order);
      },
      em,
    );
  }

  async findById(
    tenantId: string,
    id: number,
    em?: EntityManager,
  ): Promise<ProductionOrderEntity | null> {
    return this.within(
      tenantId,
      async (m) => {
        return m.getRepository(ProductionOrderEntity).findOne({
          where: { id, tenantId },
          relations: ['bom', 'bom.items'],
        });
      },
      em,
    );
  }

  async findByNumber(
    tenantId: string,
    orderNumber: string,
    em?: EntityManager,
  ): Promise<ProductionOrderEntity | null> {
    return this.within(
      tenantId,
      async (m) => {
        return m.getRepository(ProductionOrderEntity).findOne({
          where: { orderNumber, tenantId },
          relations: ['bom', 'bom.items'],
        });
      },
      em,
    );
  }

  async list(
    tenantId: string,
    status?: ProductionOrderStatus,
  ): Promise<ProductionOrderEntity[]> {
    return this.within(tenantId, async (m) => {
      const qb = m
        .getRepository(ProductionOrderEntity)
        .createQueryBuilder('order')
        .leftJoinAndSelect('order.bom', 'bom')
        .where('order.tenantId = :tenantId', { tenantId });

      if (status) {
        qb.andWhere('order.status = :status', { status });
      }

      qb.orderBy('order.createdAt', 'DESC');
      return qb.getMany();
    });
  }

  async updateStatus(
    tenantId: string,
    id: number,
    status: ProductionOrderStatus,
    em?: EntityManager,
  ): Promise<ProductionOrderEntity> {
    return this.within(
      tenantId,
      async (m) => {
        const repo = m.getRepository(ProductionOrderEntity);
        await repo.update({ id, tenantId }, { status });
        const updated = await repo.findOne({ where: { id, tenantId } });
        if (!updated) {
          throw new Error(`Production order #${id} not found`);
        }
        return updated;
      },
      em,
    );
  }

  async updateCompletion(
    tenantId: string,
    id: number,
    data: {
      completedQuantity: number;
      totalCostMinor: bigint;
      unitCostMinor: bigint;
      voucherId?: number | null;
      status: ProductionOrderStatus;
    },
    em?: EntityManager,
  ): Promise<ProductionOrderEntity> {
    return this.within(
      tenantId,
      async (m) => {
        const repo = m.getRepository(ProductionOrderEntity);
        await repo.update(
          { id, tenantId },
          {
            completedQuantity: data.completedQuantity,
            totalCostMinor: data.totalCostMinor,
            unitCostMinor: data.unitCostMinor,
            voucherId: data.voucherId ?? null,
            status: data.status,
          },
        );
        const updated = await repo.findOne({ where: { id, tenantId } });
        if (!updated) {
          throw new Error(`Production order #${id} not found`);
        }
        return updated;
      },
      em,
    );
  }
}
