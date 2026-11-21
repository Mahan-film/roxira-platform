import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import {
  BudgetEncumbranceDecision,
  evaluateBudgetEncumbrance,
} from '../domain/budget-encumbrance';
import { fromDb, fromMinor } from '../money';
import { PolicyService } from '../../tenants/policy/policy.service';

export interface BudgetCheckInput {
  projectCode?: string | null;
  costCenterCode?: string | null;
  amountMinor: bigint;
}

export interface BudgetCheckResult {
  allowed: boolean;
  warning?: string;
  actualSpendMinor: bigint;
  budgetMinor: bigint;
}

export interface PoBudgetCheckInput {
  accountCode: string;
  costCenterCode?: string | null;
  periodKey: string;
  sourceId: string;
  sourceType?: string;
  amountMinor: bigint;
  warnAtPercent?: number;
  blockAtPercent?: number;
}

/**
 * Budget control enforcement (#584 item 7):
 * Compares actual ledger spend for a project or cost centre + new expense amount
 * against the allocated budget (from erp_projects or tenant budget setting).
 *
 * Policy `accounting.budget_warning.mode`:
 *  - 'warn' (default): returns a warning message when budget is exceeded.
 *  - 'refuse': throws BadRequestException when budget is exceeded.
 *  - 'off': no budget checks performed.
 */
@Injectable()
export class BudgetControlService {
  constructor(
    private readonly scope: TenantScope,
    private readonly policyService: PolicyService,
  ) {}

  /**
   * Evaluates project budget against current posted spend plus new commitment.
   */
  async checkBudget(
    tenantId: string,
    input: BudgetCheckInput,
    manager?: EntityManager,
  ): Promise<BudgetCheckResult> {
    const mode = (await this.policyService.get(
      tenantId,
      'accounting.budget_warning.mode',
      manager,
    )) as string;

    if (mode === 'off') {
      return { allowed: true, actualSpendMinor: 0n, budgetMinor: 0n };
    }

    if (!input.projectCode && !input.costCenterCode) {
      return { allowed: true, actualSpendMinor: 0n, budgetMinor: 0n };
    }

    return this.scope.within(tenantId, manager, async (m) => {
      let budgetMinor = 0n;
      const projectCode = input.projectCode;
      const costCenterCode = input.costCenterCode;

      // 1. If projectCode given, check erp_projects by project code
      if (projectCode) {
        const projectRows = (await m.query(
          `SELECT "budget" FROM "erp_projects" WHERE "tenant_id" = $1 AND "code" = $2 ORDER BY "id" ASC LIMIT 1`,
          [tenantId, projectCode],
        )) as Array<{ budget: string | number }>;

        if (projectRows.length > 0) {
          budgetMinor = fromDb(projectRows[0].budget);
        }
      }
      // If no budget found from project code and costCenterCode given, check by cost_centre_code
      if (budgetMinor <= 0n && costCenterCode) {
        const costCenterRows = (await m.query(
          `SELECT "budget" FROM "erp_projects" WHERE "tenant_id" = $1 AND "cost_centre_code" = $2 ORDER BY "id" ASC LIMIT 1`,
          [tenantId, costCenterCode],
        )) as Array<{ budget: string | number }>;

        if (costCenterRows.length > 0) {
          budgetMinor = fromDb(costCenterRows[0].budget);
        }
      }

      // If budget is 0 or not configured, allow without restriction
      if (budgetMinor <= 0n) {
        return { allowed: true, actualSpendMinor: 0n, budgetMinor: 0n };
      }

      // 2. Calculate actual spend from posted journal lines
      let spendRows: Array<{ spend: string | number }>;
      if (projectCode && costCenterCode) {
        spendRows = (await m.query(
          `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS spend
           FROM "fin_journal_entry_lines" l
           JOIN "fin_dimensions" d ON d.id = l.project_id AND d.tenant_id = l.tenant_id
           JOIN "fin_dimensions" cc ON cc.id = l.cost_center_id AND cc.tenant_id = l.tenant_id
           JOIN "fin_journal_entries" e ON e.id = l.journal_entry_id AND e.tenant_id = l.tenant_id
           WHERE l.tenant_id = $1
             AND d.code = $2
             AND cc.code = $3
             AND e.status = 'POSTED'`,
          [tenantId, projectCode, costCenterCode],
        )) as Array<{ spend: string | number }>;
      } else if (projectCode) {
        spendRows = (await m.query(
          `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS spend
           FROM "fin_journal_entry_lines" l
           JOIN "fin_dimensions" d ON d.id = l.project_id AND d.tenant_id = l.tenant_id
           JOIN "fin_journal_entries" e ON e.id = l.journal_entry_id AND e.tenant_id = l.tenant_id
           WHERE l.tenant_id = $1
             AND d.code = $2
             AND e.status = 'POSTED'`,
          [tenantId, projectCode],
        )) as Array<{ spend: string | number }>;
      } else {
        spendRows = (await m.query(
          `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS spend
           FROM "fin_journal_entry_lines" l
           JOIN "fin_dimensions" cc ON cc.id = l.cost_center_id AND cc.tenant_id = l.tenant_id
           JOIN "fin_journal_entries" e ON e.id = l.journal_entry_id AND e.tenant_id = l.tenant_id
           WHERE l.tenant_id = $1
             AND cc.code = $2
             AND e.status = 'POSTED'`,
          [tenantId, costCenterCode],
        )) as Array<{ spend: string | number }>;
      }

      const actualSpendMinor = fromDb(spendRows[0]?.spend ?? 0);
      const totalProjected = actualSpendMinor + input.amountMinor;
      const targetLabel = projectCode ? 'پروژه' : 'مرکز هزینه';

      if (totalProjected > budgetMinor) {
        if (mode === 'refuse') {
          throw new BadRequestException(
            `مبلغ هزینه از سقف بودجه مصوب ${targetLabel} فراتر است. سقف بودجه: ${fromMinor(budgetMinor)} ریال، مجموع هزینه‌های فعلی: ${fromMinor(actualSpendMinor)} ریال، مبلغ جدید: ${fromMinor(input.amountMinor)} ریال.`,
          );
        }
        return {
          allowed: true,
          warning: `مبلغ هزینه از سقف بودجه مصوب ${targetLabel} (${fromMinor(budgetMinor)} ریال) فراتر رفته است. مجموع هزینه با احتساب این سند: ${fromMinor(totalProjected)} ریال.`,
          actualSpendMinor,
          budgetMinor,
        };
      }

      return {
        allowed: true,
        actualSpendMinor,
        budgetMinor,
      };
    });
  }

  /**
   * Checks a purchase order (or commitment) against the account + cost-centre budget,
   * including existing posted spend and open encumbrances. Warns at 80% (default), blocks above 100%,
   * and records/updates the OPEN encumbrance when allowed.
   */
  async checkAndEncumberPo(
    tenantId: string,
    input: PoBudgetCheckInput,
    manager?: EntityManager,
  ): Promise<BudgetEncumbranceDecision> {
    const sourceType = input.sourceType ?? 'purchase_order';
    const costCenterKey = input.costCenterCode?.trim() || '';

    return this.scope.within(tenantId, manager, async (m) => {
      // Serialise check-and-write per (tenant, account, cost centre, period) so concurrent
      // postings cannot both pass the check and overspend. Released at transaction end.
      await m.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `budget-encumbrance|${tenantId}|${input.accountCode}|${costCenterKey}|${input.periodKey}`,
      ]);
      const budgetRows = (await m.query(
        `SELECT b."budget_amount"
         FROM "fin_account_budgets" b
         LEFT JOIN "fin_dimensions" cc ON cc."id" = b."cost_center_id" AND cc."tenant_id" = b."tenant_id"
         WHERE b."tenant_id" = $1
           AND b."account_code" = $2
           AND (($3 = '' AND b."cost_center_id" IS NULL) OR cc."code" = $3)
         ORDER BY b."updated_at" DESC
         LIMIT 1`,
        [tenantId, input.accountCode, costCenterKey],
      )) as Array<{ budget_amount: string | number }>;

      const budgetMinor =
        budgetRows.length > 0 ? fromDb(budgetRows[0].budget_amount) : 0n;

      if (budgetMinor <= 0n) {
        // Fail closed: a missing budget must not read as unlimited.
        throw new BadRequestException({
          code: 'BUDGET_MISSING',
          message: `برای حساب ${input.accountCode} در دوره ${input.periodKey} بودجه‌ای تعریف نشده است؛ ثبت تعهد مجاز نیست.`,
        });
      }

      const spendRows = (await m.query(
        `SELECT COALESCE(SUM(l."debit" - l."credit"), 0) AS spend
         FROM "fin_journal_entry_lines" l
         JOIN "fin_journal_entries" e ON e."id" = l."journal_entry_id" AND e."tenant_id" = l."tenant_id"
         JOIN "fin_chart_of_accounts" a ON a."id" = l."account_id" AND a."tenant_id" = l."tenant_id"
         LEFT JOIN "fin_dimensions" cc ON cc."id" = l."cost_center_id" AND cc."tenant_id" = l."tenant_id"
         WHERE l."tenant_id" = $1
           AND a."code" = $2
           AND e."status" = 'POSTED'
           AND to_char(e."date", 'YYYY-MM') = $3
           AND ($4 = '' OR cc."code" = $4)`,
        [tenantId, input.accountCode, input.periodKey, costCenterKey],
      )) as Array<{ spend: string | number }>;

      const actualSpendMinor = fromDb(spendRows[0]?.spend ?? 0);

      const committedRows = (await m.query(
        `SELECT COALESCE(SUM("amount_minor"), 0) AS committed
         FROM "fin_budget_encumbrances"
         WHERE "tenant_id" = $1
           AND "account_code" = $2
           AND "cost_center_code" = $3
           AND "period_key" = $4
           AND "status" = 'OPEN'
           AND NOT ("source_type" = $5 AND "source_id" = $6)`,
        [tenantId, input.accountCode, costCenterKey, input.periodKey, sourceType, input.sourceId],
      )) as Array<{ committed: string | number }>;

      const committedMinor = BigInt(committedRows[0]?.committed ?? 0);

      const decision = evaluateBudgetEncumbrance({
        budgetMinor,
        actualSpendMinor,
        committedMinor,
        newAmountMinor: input.amountMinor,
        warnAtPercent: input.warnAtPercent,
        blockAtPercent: input.blockAtPercent,
      });

      if (decision.status === 'BLOCK') {
        throw new BadRequestException({
          code: 'BUDGET_EXCEEDED',
          message: `مبلغ سفارش خرید از سقف بودجه حساب ${input.accountCode} فراتر است (${decision.utilizationPercent}% از سقف ${fromMinor(budgetMinor)}).`,
          utilizationPercent: decision.utilizationPercent,
          budgetMinor: budgetMinor.toString(),
          projectedMinor: decision.projectedMinor.toString(),
        });
      }

      await m.query(
        `INSERT INTO "fin_budget_encumbrances"
           ("tenant_id", "account_code", "cost_center_code", "period_key", "source_type", "source_id", "amount_minor", "status")
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'OPEN')
         ON CONFLICT ("tenant_id", "source_type", "source_id")
         DO UPDATE SET
           "account_code" = EXCLUDED."account_code",
           "cost_center_code" = EXCLUDED."cost_center_code",
           "period_key" = EXCLUDED."period_key",
           "amount_minor" = EXCLUDED."amount_minor",
           "status" = 'OPEN',
           "updated_at" = now()`,
        [
          tenantId,
          input.accountCode,
          costCenterKey,
          input.periodKey,
          sourceType,
          input.sourceId,
          input.amountMinor.toString(),
        ],
      );

      return decision;
    });
  }

  /**
   * Releases an open encumbrance (e.g. when a PO is cancelled, closed, or fully received).
   */
  async releaseEncumbrance(
    tenantId: string,
    sourceType: string,
    sourceId: string,
    manager?: EntityManager,
  ): Promise<void> {
    await this.scope.within(tenantId, manager, async (m) => {
      await m.query(
        `UPDATE "fin_budget_encumbrances"
         SET "status" = 'RELEASED', "updated_at" = now()
         WHERE "tenant_id" = $1
           AND "source_type" = $2
           AND "source_id" = $3
           AND "status" = 'OPEN'`,
        [tenantId, sourceType, sourceId],
      );
    });
  }
}
