import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateDimensionDto, DimensionBalancesQueryDto, CreateDimensionRuleDto, RenameDimensionDto } from '../dto/dimension.dto';
import { DimensionKind } from '../enums/accounting.enum';
import { DimensionRepository } from '../repositories/dimension.repository';
import { DimensionEntity } from '../entities/dimension.entity';
import { DimensionRuleEntity } from '../entities/dimension-rule.entity';
import { DimensionRuleViolationException } from '../exceptions/ledger.exceptions';

export interface ValidatableLine {
  accountCode: string;
  costCenterCode?: string | null;
  projectCode?: string | null;
  productLineCode?: string | null;
  regionCode?: string | null;
  grantCode?: string | null;
  dimensions?: Record<string, string>;
}

/** Floating details, cost centres, project centres, and analytic dimensions v2 (T181). */
@Injectable()
export class DimensionService {
  constructor(private readonly repository: DimensionRepository) {}

  list(tenantId: string, kind?: DimensionKind | string): Promise<DimensionEntity[]> {
    return this.repository.list(tenantId, kind);
  }

  findByCode(tenantId: string, kind: DimensionKind | string, code: string): Promise<DimensionEntity | null> {
    return this.repository.findByCode(tenantId, kind, code);
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

    // Seed initial label history entry so historical rename tracks cleanly from day 0
    await this.repository.addLabelHistory(tenantId, {
      dimensionId: created.id,
      code: created.code,
      name: created.name,
      effectiveFrom: '1970-01-01',
      effectiveTo: null,
    });

    return created;
  }

  balances(tenantId: string, kind: DimensionKind | string, query: DimensionBalancesQueryDto) {
    if (query.from > query.to) {
      throw new BadRequestException('تاریخ شروع بعد از تاریخ پایان است.');
    }
    return this.repository.balances(tenantId, kind, query.from, query.to);
  }

  // ------------------ Dimension Rules (T181) ------------------

  async createRule(tenantId: string, dto: CreateDimensionRuleDto): Promise<DimensionRuleEntity> {
    return this.repository.createRule(tenantId, {
      name: dto.name.trim(),
      accountType: dto.accountType?.trim() || null,
      accountCode: dto.accountCode?.trim() || null,
      whenDimensionKind: dto.whenDimensionKind || null,
      whenDimensionCode: dto.whenDimensionCode?.trim() || null,
      requiresDimensionKind: dto.requiresDimensionKind,
    });
  }

  listRules(tenantId: string): Promise<DimensionRuleEntity[]> {
    return this.repository.listRules(tenantId);
  }

  /**
   * Enforces dimension rules on lines before posting (T181).
   * E.g.: Project required when CostCenter = CC-RND, or CostCenter required on P&L accounts.
   * Throws HTTP 422 `DIMENSION_RULE_VIOLATION` if a rule is not satisfied.
   */
  async validateLineRules(
    tenantId: string,
    lines: ValidatableLine[],
    accountTypes?: Map<string, string>,
  ): Promise<void> {
    const rules = await this.repository.listRules(tenantId);
    if (!rules || rules.length === 0) {
      return;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const accType = accountTypes?.get(line.accountCode);

      for (const rule of rules) {
        if (!rule.active) continue;

        // 1. Account condition
        if (rule.accountCode && rule.accountCode !== line.accountCode) {
          continue;
        }
        if (rule.accountType) {
          const isPl = rule.accountType.toUpperCase() === 'PL';
          const matchType = isPl
            ? accType === 'EXPENSE' || accType === 'REVENUE'
            : accType === rule.accountType.toUpperCase();
          if (!matchType) {
            continue;
          }
        }

        // 2. Trigger dimension condition (e.g. when CostCenter is CC-RND)
        if (rule.whenDimensionKind) {
          const kind = rule.whenDimensionKind.toUpperCase();
          let lineDimValue: string | null = null;
          if (kind === 'COST_CENTER') lineDimValue = line.costCenterCode ?? null;
          else if (kind === 'PROJECT') lineDimValue = line.projectCode ?? null;
          else if (kind === 'PRODUCT_LINE') lineDimValue = line.productLineCode ?? null;
          else if (kind === 'REGION') lineDimValue = line.regionCode ?? null;
          else if (kind === 'GRANT') lineDimValue = line.grantCode ?? null;
          else lineDimValue = line.dimensions?.[kind] ?? line.dimensions?.[kind.toLowerCase()] ?? null;

          if (!lineDimValue) {
            continue;
          }
          if (rule.whenDimensionCode && rule.whenDimensionCode !== lineDimValue) {
            continue;
          }
        }

        // 3. Required dimension verification
        const reqKind = rule.requiresDimensionKind.toUpperCase();
        let present = false;
        if (reqKind === 'PROJECT') present = !!(line.projectCode || line.dimensions?.['PROJECT']);
        else if (reqKind === 'COST_CENTER') present = !!(line.costCenterCode || line.dimensions?.['COST_CENTER']);
        else if (reqKind === 'PRODUCT_LINE') present = !!(line.productLineCode || line.dimensions?.['PRODUCT_LINE']);
        else if (reqKind === 'REGION') present = !!(line.regionCode || line.dimensions?.['REGION']);
        else if (reqKind === 'GRANT') present = !!(line.grantCode || line.dimensions?.['GRANT']);
        else present = !!(line.dimensions?.[reqKind] || line.dimensions?.[reqKind.toLowerCase()]);

        if (!present) {
          throw new DimensionRuleViolationException(
            `Line ${i + 1} (${line.accountCode}) violates dimension rule "${rule.name}": requires ${reqKind}.`,
          );
        }
      }
    }
  }

  // ------------------ Label History / Effective Renaming (T181) ------------------

  async rename(
    tenantId: string,
    idOrFrom:
      | number
      | string
      | { from: string; to: string; effective: string; kind?: DimensionKind | string; name?: string },
    dto?: RenameDimensionDto,
  ): Promise<DimensionEntity> {
    let dimensionId: number;
    let renameDto: RenameDimensionDto;

    if (typeof idOrFrom === 'object') {
      const kind = idOrFrom.kind || DimensionKind.COST_CENTER;
      const existing = await this.repository.findByCode(tenantId, kind, idOrFrom.from);
      if (!existing) {
        throw new NotFoundException(`Dimension ${kind}:${idOrFrom.from} not found.`);
      }
      dimensionId = existing.id;
      renameDto = {
        newCode: idOrFrom.to,
        newName: idOrFrom.name || idOrFrom.to,
        effectiveFrom: idOrFrom.effective,
      };
    } else if (typeof idOrFrom === 'string') {
      if (!dto) {
        throw new BadRequestException('Rename payload is required.');
      }
      const existing = await this.repository.findByCode(tenantId, DimensionKind.COST_CENTER, idOrFrom);
      if (!existing) {
        throw new NotFoundException(`Dimension COST_CENTER:${idOrFrom} not found.`);
      }
      dimensionId = existing.id;
      renameDto = dto;
    } else {
      if (!dto) {
        throw new BadRequestException('Rename payload is required.');
      }
      dimensionId = idOrFrom;
      renameDto = dto;
    }

    const existing = await this.repository.findById(tenantId, dimensionId);
    if (!existing) {
      throw new NotFoundException(`Dimension ${dimensionId} not found.`);
    }

    // Close any previous open-ended label history entry up to effectiveFrom - 1 day
    const effectiveFromDate = new Date(renameDto.effectiveFrom);
    const dayBefore = new Date(effectiveFromDate.getTime() - 86400000).toISOString().slice(0, 10);

    await this.repository.closePreviousLabelHistory(tenantId, dimensionId, dayBefore);

    // Add new label history entry
    await this.repository.addLabelHistory(tenantId, {
      dimensionId,
      code: renameDto.newCode.trim(),
      name: renameDto.newName.trim(),
      effectiveFrom: renameDto.effectiveFrom,
      effectiveTo: null,
    });

    // Update current dimension entity
    return this.repository.updateDimension(tenantId, dimensionId, {
      code: renameDto.newCode.trim(),
      name: renameDto.newName.trim(),
    });
  }

  getEffectiveLabelsForKind(
    tenantId: string,
    kind: DimensionKind | string,
    asOfDate: string,
  ): Promise<Map<number, { code: string; name: string }>> {
    return this.repository.getEffectiveLabelsForKind(tenantId, kind, asOfDate);
  }
}
