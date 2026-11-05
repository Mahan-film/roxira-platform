import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { CreateDimensionDto, DimensionBalancesQueryDto } from '../dto/dimension.dto';
import { DimensionKind } from '../enums/accounting.enum';
import { DimensionRepository } from '../repositories/dimension.repository';
import { DimensionEntity } from '../entities/dimension.entity';

/** Floating details, cost centres and project centres, plus their balances from posted lines. */
@Injectable()
export class DimensionService {
  constructor(private readonly repository: DimensionRepository) {}

  list(tenantId: string, kind?: DimensionKind): Promise<DimensionEntity[]> {
    return this.repository.list(tenantId, kind);
  }

  async create(tenantId: string, dto: CreateDimensionDto): Promise<DimensionEntity> {
    let parentId: number | null = null;
    if (dto.parentCode) {
      if (dto.kind !== DimensionKind.COST_CENTER) {
        throw new BadRequestException('فقط مرکز هزینه می‌تواند مرکز بالادست داشته باشد.');
      }
      const parent = await this.repository.findByCode(tenantId, DimensionKind.COST_CENTER, dto.parentCode);
      if (!parent) {
        throw new BadRequestException(`مرکز هزینهٔ بالادست ${dto.parentCode} تعریف نشده است.`);
      }
      parentId = parent.id;
    }
    const created = await this.repository.create(tenantId, {
      kind: dto.kind,
      code: dto.code,
      name: dto.name.trim(),
      parentId,
    });
    if (!created) {
      throw new ConflictException(`کد ${dto.code} برای این نوع قبلاً ثبت شده است.`);
    }
    return created;
  }

  balances(tenantId: string, kind: DimensionKind, query: DimensionBalancesQueryDto) {
    if (query.from > query.to) {
      throw new BadRequestException('تاریخ شروع بعد از تاریخ پایان است.');
    }
    return this.repository.balances(tenantId, kind, query.from, query.to);
  }
}
