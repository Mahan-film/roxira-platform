import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountType } from '../../accounting/enums/accounting.enum';
import { fromDb, fromMinor } from '../../accounting/money';
import { CostCentreReportService } from '../../accounting/services/cost-centre-report.service';
import { FinancialReportsService } from '../../accounting/services/financial-reports.service';
import { ProfitabilityQueryDto } from '../dto/profitability.dto';
import { ProjectEntity } from '../entities/project.entity';
import { ProjectRepository } from '../repositories/project.repository';
import { StatementRepository } from '../repositories/statement.repository';
import { profitability } from '../statements/profitability';

type Money = number | string;
export interface ProjectProfitabilityRow {
  projectId: number;
  code: string;
  name: string;
  costCentreCode: string | null;
  budget: Money;
  billed: Money;
  actual: { subcontracts: Money; ledger: Money | null; total: Money };
  budgetRemaining: Money;
  margin: Money;
  /** False when the project has no usable cost centre: the ledger part is then unknown, not zero. */
  ledgerLinked: boolean;
}

/**
 * Project profitability: budget against actual cost against billed.
 *  - billed = posted contractor-side statements (period amounts, VAT excluded);
 *  - actual = posted employer-side statements + expense posted in the ledger on the project's cost centre.
 * Employer-side statements are not tagged with the cost centre, so the two actual parts do not overlap.
 */
@Injectable()
export class ProfitabilityService {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly statements: StatementRepository,
    private readonly costCentres: CostCentreReportService,
    private readonly reports: FinancialReportsService,
  ) {}

  async report(tenantId: string, query: ProfitabilityQueryDto): Promise<{ from: string | null; to: string | null; projects: ProjectProfitabilityRow[] }> {
    if (query.from && query.to && query.from > query.to) throw new BadRequestException('تاریخ شروع بعد از تاریخ پایان است.');
    let list: ProjectEntity[];
    if (query.projectId !== undefined) {
      const one = await this.projects.findById(tenantId, query.projectId);
      if (!one) throw new NotFoundException('پروژه یافت نشد.');
      list = [one];
    } else {
      list = (await this.projects.list(tenantId, { limit: 200, offset: 0 })).rows;
    }
    const totals = await this.statements.postedTotalsByProject(tenantId, query);
    const accounts = list.some((p) => p.costCentreCode) ? await this.reports.accounts(tenantId) : [];
    const expenseCodes = new Set(accounts.filter((a) => a.accountType === AccountType.EXPENSE).map((a) => a.code));
    const rows: ProjectProfitabilityRow[] = [];
    for (const p of list) {
      const t = totals.get(p.id) ?? { billed: 0n, subcontracts: 0n };
      const result = profitability({ budget: fromDb(p.budget), billed: t.billed, subcontracts: t.subcontracts, ledgerExpense: await this.ledgerExpense(tenantId, p, expenseCodes, query) });
      rows.push({
        projectId: p.id,
        code: p.code,
        name: p.name,
        costCentreCode: p.costCentreCode ?? null,
        budget: fromMinor(result.budget),
        billed: fromMinor(result.billed),
        actual: { subcontracts: fromMinor(result.actual.subcontracts), ledger: result.actual.ledger === null ? null : fromMinor(result.actual.ledger), total: fromMinor(result.actual.total) },
        budgetRemaining: fromMinor(result.budgetRemaining),
        margin: fromMinor(result.margin),
        ledgerLinked: result.ledgerLinked,
      });
    }
    return { from: query.from ?? null, to: query.to ?? null, projects: rows };
  }

  /** Net expense (debit - credit) on the project's cost centre and the centres under it; null without a valid centre. */
  private async ledgerExpense(tenantId: string, project: ProjectEntity, expenseCodes: Set<string>, range: { from?: string; to?: string }): Promise<bigint | null> {
    if (!project.costCentreCode) return null;
    try {
      const report = await this.costCentres.trialBalance(tenantId, { costCenterCode: project.costCentreCode, from: range.from, to: range.to, columns: 10 } as never);
      const section = report.centres.find((c) => c.code === project.costCentreCode);
      if (!section) return 0n;
      return section.rows.filter((r) => expenseCodes.has(r.code)).reduce((sum, r) => sum + r.periodDebit - r.periodCredit, 0n);
    } catch (error) {
      if (error instanceof NotFoundException) return null;
      throw error;
    }
  }
}
