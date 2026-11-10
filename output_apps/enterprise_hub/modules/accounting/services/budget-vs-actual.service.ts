import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { BudgetVsActualQueryDto, SetAccountBudgetDto } from '../dto/budget-report.dto';
import { DimensionKind } from '../enums/accounting.enum';
import { fromDb, fromMinor, toMinor } from '../money';
import { AccountBudgetRepository } from '../repositories/account-budget.repository';
import { FiscalYearRepository } from '../repositories/fiscal-year.repository';

export interface BudgetVsActualRow {
  accountCode: string;
  accountName: string;
  accountType: string;
  costCenterId: number | null;
  costCenterCode: string | null;
  costCenterName: string | null;
  budgetAmount: number | string;
  actualAmount: number | string;
  varianceAmount: number | string;
  variancePercent: number | null;
  utilizationPercent: number | null;
}

export interface BudgetVsActualReport {
  fiscalYearId: number;
  fiscalYearName: string;
  startDate: string;
  endDate: string;
  totalBudget: number | string;
  totalActual: number | string;
  totalVariance: number | string;
  overallUtilizationPercent: number | null;
  rows: BudgetVsActualRow[];
}

@Injectable()
export class BudgetVsActualService {
  constructor(
    private readonly scope: TenantScope,
    private readonly budgetRepo: AccountBudgetRepository,
    private readonly fiscalYearRepo: FiscalYearRepository,
  ) {}

  async setBudget(tenantId: string, dto: SetAccountBudgetDto, manager?: EntityManager) {
    const budgetAmountMinor = toMinor(dto.budgetAmount);
    return this.budgetRepo.upsertBudget(
      tenantId,
      {
        fiscalYearId: dto.fiscalYearId,
        accountCode: dto.accountCode,
        costCenterId: dto.costCenterId,
        budgetAmountMinor,
      },
      manager,
    );
  }

  async getBudgetVsActual(
    tenantId: string,
    query: BudgetVsActualQueryDto,
    manager?: EntityManager,
  ): Promise<BudgetVsActualReport> {
    const fy = await this.fiscalYearRepo.find(tenantId, query.fiscalYearId, manager);
    if (!fy) {
      throw new NotFoundException(`سال مالی با شناسه ${query.fiscalYearId} یافت نشد.`);
    }

    return this.scope.within(tenantId, manager, async (m) => {
      let resolvedCostCenterId = query.costCenterId ?? null;

      if (!resolvedCostCenterId && query.costCenterCode) {
        const dimRows = (await m.query(
          `SELECT "id" FROM "fin_dimensions" WHERE "tenant_id" = $1 AND "kind" = $2 AND "code" = $3`,
          [tenantId, DimensionKind.COST_CENTER, query.costCenterCode],
        )) as Array<{ id: number }>;
        if (dimRows.length > 0) {
          resolvedCostCenterId = dimRows[0].id;
        }
      }

      // 1. Fetch budgets for this fiscal year
      const budgetRows = (await m.query(
        `SELECT b."id", b."account_code", b."cost_center_id", b."budget_amount",
                COALESCE(cc."code", '') AS cost_center_code,
                COALESCE(cc."name", '') AS cost_center_name
         FROM "fin_account_budgets" b
         LEFT JOIN "fin_dimensions" cc ON cc."id" = b."cost_center_id" AND cc."tenant_id" = b."tenant_id"
         WHERE b."tenant_id" = $1 AND b."fiscal_year_id" = $2
           ${resolvedCostCenterId ? 'AND b."cost_center_id" = $3' : ''}`,
        resolvedCostCenterId ? [tenantId, fy.id, resolvedCostCenterId] : [tenantId, fy.id],
      )) as Array<{
        account_code: string;
        cost_center_id: number | null;
        budget_amount: string | number;
        cost_center_code: string;
        cost_center_name: string;
      }>;

      // 2. Fetch actual posted transactions for this fiscal year date range
      const actualRows = (await m.query(
        `SELECT a."code" AS account_code, l."cost_center_id",
                COALESCE(SUM(l."debit"), 0) AS total_debit,
                COALESCE(SUM(l."credit"), 0) AS total_credit,
                COALESCE(cc."code", '') AS cost_center_code,
                COALESCE(cc."name", '') AS cost_center_name
         FROM "fin_journal_entry_lines" l
         JOIN "fin_journal_entries" e ON e."id" = l."journal_entry_id" AND e."tenant_id" = l."tenant_id"
         JOIN "fin_chart_of_accounts" a ON a."id" = l."account_id" AND a."tenant_id" = l."tenant_id"
         LEFT JOIN "fin_dimensions" cc ON cc."id" = l."cost_center_id" AND cc."tenant_id" = l."tenant_id"
         WHERE l."tenant_id" = $1
           AND e."status" = 'POSTED'
           AND e."date" >= $2 AND e."date" <= $3
           ${resolvedCostCenterId ? 'AND l."cost_center_id" = $4' : ''}
         GROUP BY a."code", l."cost_center_id", cc."code", cc."name"`,
        resolvedCostCenterId
          ? [tenantId, fy.startDate, fy.endDate, resolvedCostCenterId]
          : [tenantId, fy.startDate, fy.endDate],
      )) as Array<{
        account_code: string;
        cost_center_id: number | null;
        total_debit: string | number;
        total_credit: string | number;
        cost_center_code: string;
        cost_center_name: string;
      }>;

      // 3. Fetch chart of accounts details
      const chartRows = (await m.query(
        `SELECT "code", "name", "account_type" FROM "fin_chart_of_accounts" WHERE "tenant_id" = $1`,
        [tenantId],
      )) as Array<{ code: string; name: string; account_type: string }>;
      const chartMap = new Map(chartRows.map((c) => [c.code, c]));

      // Merge budgets and actuals by account_code + cost_center_id
      type Key = string;
      const makeKey = (acc: string, ccId: number | null) => `${acc}:${ccId ?? 0}`;

      interface Agg {
        accountCode: string;
        costCenterId: number | null;
        costCenterCode: string | null;
        costCenterName: string | null;
        budgetMinor: bigint;
        actualDebitMinor: bigint;
        actualCreditMinor: bigint;
      }

      const map = new Map<Key, Agg>();

      for (const b of budgetRows) {
        const k = makeKey(b.account_code, b.cost_center_id);
        map.set(k, {
          accountCode: b.account_code,
          costCenterId: b.cost_center_id,
          costCenterCode: b.cost_center_code || null,
          costCenterName: b.cost_center_name || null,
          budgetMinor: fromDb(b.budget_amount),
          actualDebitMinor: 0n,
          actualCreditMinor: 0n,
        });
      }

      for (const a of actualRows) {
        const k = makeKey(a.account_code, a.cost_center_id);
        const existing = map.get(k);
        if (existing) {
          existing.actualDebitMinor = fromDb(a.total_debit);
          existing.actualCreditMinor = fromDb(a.total_credit);
          if (!existing.costCenterCode && a.cost_center_code) {
            existing.costCenterCode = a.cost_center_code;
            existing.costCenterName = a.cost_center_name;
          }
        }
      }

      let totalBudgetMinor = 0n;
      let totalActualMinor = 0n;

      const rows: BudgetVsActualRow[] = [];

      for (const agg of Array.from(map.values()).sort((a, b) =>
        a.accountCode.localeCompare(b.accountCode),
      )) {
        const accInfo = chartMap.get(agg.accountCode);
        const accountType = accInfo?.account_type ?? 'EXPENSE';
        const accountName = accInfo?.name ?? agg.accountCode;

        // Actual spend / amount
        let actualMinor = 0n;
        if (accountType === 'REVENUE' || accountType === 'LIABILITY' || accountType === 'EQUITY') {
          actualMinor = agg.actualCreditMinor - agg.actualDebitMinor;
        } else {
          actualMinor = agg.actualDebitMinor - agg.actualCreditMinor;
        }

        const varianceMinor = agg.budgetMinor - actualMinor;

        let variancePercent: number | null = null;
        let utilizationPercent: number | null = null;

        if (agg.budgetMinor !== 0n) {
          variancePercent = Number((varianceMinor * 10000n) / agg.budgetMinor) / 100;
          utilizationPercent = Number((actualMinor * 10000n) / agg.budgetMinor) / 100;
        }

        totalBudgetMinor += agg.budgetMinor;
        totalActualMinor += actualMinor;

        rows.push({
          accountCode: agg.accountCode,
          accountName,
          accountType,
          costCenterId: agg.costCenterId,
          costCenterCode: agg.costCenterCode,
          costCenterName: agg.costCenterName,
          budgetAmount: fromMinor(agg.budgetMinor),
          actualAmount: fromMinor(actualMinor),
          varianceAmount: fromMinor(varianceMinor),
          variancePercent,
          utilizationPercent,
        });
      }

      const totalVarianceMinor = totalBudgetMinor - totalActualMinor;
      let overallUtilizationPercent: number | null = null;
      if (totalBudgetMinor !== 0n) {
        overallUtilizationPercent =
          Number((totalActualMinor * 10000n) / totalBudgetMinor) / 100;
      }

      return {
        fiscalYearId: fy.id,
        fiscalYearName: fy.name,
        startDate: fy.startDate,
        endDate: fy.endDate,
        totalBudget: fromMinor(totalBudgetMinor),
        totalActual: fromMinor(totalActualMinor),
        totalVariance: fromMinor(totalVarianceMinor),
        overallUtilizationPercent,
        rows,
      };
    });
  }
}
