import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { fromDb } from '../money';
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

      // 1. If projectCode given, check erp_projects
      if (projectCode) {
        const projectRows = (await m.query(
          `SELECT "budget" FROM "erp_projects" WHERE "tenant_id" = $1 AND "code" = $2`,
          [tenantId, projectCode],
        )) as Array<{ budget: string | number }>;

        if (projectRows.length > 0) {
          budgetMinor = fromDb(projectRows[0].budget);
        }
      }

      // If budget is 0 or not configured, allow without restriction
      if (budgetMinor <= 0n) {
        return { allowed: true, actualSpendMinor: 0n, budgetMinor: 0n };
      }

      // 2. Calculate actual spend from posted journal lines
      const spendRows = (await m.query(
        `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS spend
         FROM "fin_journal_entry_lines" l
         JOIN "fin_dimensions" d ON d.id = l.project_id AND d.tenant_id = l.tenant_id
         JOIN "fin_journal_entries" e ON e.id = l.journal_entry_id AND e.tenant_id = l.tenant_id
         WHERE l.tenant_id = $1
           AND d.code = $2
           AND e.status = 'POSTED'`,
        [tenantId, projectCode],
      )) as Array<{ spend: string | number }>;

      const actualSpendMinor = fromDb(spendRows[0]?.spend ?? 0);
      const totalProjected = actualSpendMinor + input.amountMinor;

      if (totalProjected > budgetMinor) {
        if (mode === 'refuse') {
          throw new BadRequestException(
            `مبلغ هزینه از سقف بودجه مصوب پروژه فراتر است. سقف بودجه: ${budgetMinor} ریال، مجموع هزینه‌های فعلی: ${actualSpendMinor} ریال، مبلغ جدید: ${input.amountMinor} ریال.`,
          );
        }
        return {
          allowed: true,
          warning: `مبلغ هزینه از سقف بودجه مصوب پروژه (${budgetMinor} ریال) فراتر رفته است. مجموع هزینه با احتساب این سند: ${totalProjected} ریال.`,
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
}
