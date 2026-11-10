import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { AccountBudgetEntity } from '../entities/account-budget.entity';
import { minorToDecimal } from '../money';

export interface SetBudgetInput {
  fiscalYearId: number;
  accountCode: string;
  costCenterId?: number | null;
  budgetAmountMinor: bigint;
}

@Injectable()
export class AccountBudgetRepository {
  constructor(private readonly scope: TenantScope) {}

  async upsertBudget(
    tenantId: string,
    input: SetBudgetInput,
    manager?: EntityManager,
  ): Promise<AccountBudgetEntity> {
    return this.scope.within(tenantId, manager, async (m) => {
      const costCenterId = input.costCenterId ?? null;
      const amountDecimal = minorToDecimal(input.budgetAmountMinor);

      const existing = await m
        .getRepository(AccountBudgetEntity)
        .createQueryBuilder('b')
        .where('b.tenant_id = :tenantId', { tenantId })
        .andWhere('b.fiscal_year_id = :fiscalYearId', { fiscalYearId: input.fiscalYearId })
        .andWhere('b.account_code = :accountCode', { accountCode: input.accountCode })
        .andWhere(
          costCenterId === null
            ? 'b.cost_center_id IS NULL'
            : 'b.cost_center_id = :costCenterId',
          { costCenterId },
        )
        .getOne();

      if (existing) {
        existing.budgetAmount = amountDecimal;
        return m.save(AccountBudgetEntity, existing);
      }

      const budget = m.create(AccountBudgetEntity, {
        tenantId,
        fiscalYearId: input.fiscalYearId,
        costCenterId,
        accountCode: input.accountCode,
        budgetAmount: amountDecimal,
      });
      return m.save(AccountBudgetEntity, budget);
    });
  }

  async findByFiscalYear(
    tenantId: string,
    fiscalYearId: number,
    costCenterId?: number | null,
    manager?: EntityManager,
  ): Promise<AccountBudgetEntity[]> {
    return this.scope.within(tenantId, manager, async (m) => {
      const qb = m
        .getRepository(AccountBudgetEntity)
        .createQueryBuilder('b')
        .where('b.tenant_id = :tenantId', { tenantId })
        .andWhere('b.fiscal_year_id = :fiscalYearId', { fiscalYearId });

      if (costCenterId !== undefined) {
        if (costCenterId === null) {
          qb.andWhere('b.cost_center_id IS NULL');
        } else {
          qb.andWhere('b.cost_center_id = :costCenterId', { costCenterId });
        }
      }

      return qb.getMany();
    });
  }
}
