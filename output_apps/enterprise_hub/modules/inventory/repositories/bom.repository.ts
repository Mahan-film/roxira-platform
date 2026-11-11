import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { BomHeaderEntity } from '../entities/bom-header.entity';
import { BomItemEntity } from '../entities/bom-item.entity';
import { CreateBomDto } from '../dto/bom.dto';

@Injectable()
export class BomRepository {
  constructor(private readonly scope: TenantScope) {}

  private within<T>(tenantId: string, work: (em: EntityManager) => Promise<T>): Promise<T> {
    return this.scope.within(tenantId, undefined, work);
  }

  async createBom(tenantId: string, dto: CreateBomDto): Promise<BomHeaderEntity> {
    return this.within(tenantId, async (m) => {
      const headerRepo = m.getRepository(BomHeaderEntity);
      const itemRepo = m.getRepository(BomItemEntity);

      const header = headerRepo.create({
        tenantId,
        bomCode: dto.bomCode,
        name: dto.name,
        finishedItemSku: dto.finishedItemSku,
        outputQuantity: dto.outputQuantity ?? 1,
        version: dto.version ?? 1,
        notes: dto.notes ?? null,
        isActive: true,
      });
      const savedHeader = await headerRepo.save(header);

      const items = dto.items.map((item) =>
        itemRepo.create({
          tenantId,
          bomId: savedHeader.id,
          componentSku: item.componentSku,
          subBomId: item.subBomId ?? null,
          quantity: item.quantity,
          wastePercent: item.wastePercent ?? 0,
          notes: item.notes ?? null,
        }),
      );
      savedHeader.items = await itemRepo.save(items);
      return savedHeader;
    });
  }

  async findById(tenantId: string, id: number): Promise<BomHeaderEntity | null> {
    return this.within(tenantId, async (m) => {
      return m.getRepository(BomHeaderEntity).findOne({
        where: { id, tenantId },
        relations: ['items', 'items.subBom'],
      });
    });
  }

  async findByCode(tenantId: string, bomCode: string): Promise<BomHeaderEntity | null> {
    return this.within(tenantId, async (m) => {
      return m.getRepository(BomHeaderEntity).findOne({
        where: { bomCode, tenantId },
        relations: ['items', 'items.subBom'],
      });
    });
  }

  async list(tenantId: string, finishedItemSku?: string): Promise<BomHeaderEntity[]> {
    return this.within(tenantId, async (m) => {
      const qb = m
        .getRepository(BomHeaderEntity)
        .createQueryBuilder('bom')
        .leftJoinAndSelect('bom.items', 'items')
        .where('bom.tenantId = :tenantId', { tenantId });

      if (finishedItemSku) {
        qb.andWhere('bom.finishedItemSku = :finishedItemSku', { finishedItemSku });
      }

      qb.orderBy('bom.createdAt', 'DESC');
      return qb.getMany();
    });
  }

  async deleteById(tenantId: string, id: number): Promise<boolean> {
    return this.within(tenantId, async (m) => {
      const res = await m.getRepository(BomHeaderEntity).delete({ id, tenantId });
      return (res.affected ?? 0) > 0;
    });
  }
}
