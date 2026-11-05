import { Injectable, NotFoundException } from '@nestjs/common';
import { CostCentreTrialBalanceQueryDto } from '../dto/report.dto';
import { DimensionKind } from '../enums/accounting.enum';
import { DimensionRepository } from '../repositories/dimension.repository';
import { AccountBucketRow, LedgerReportRepository } from '../repositories/ledger-report.repository';
import { costCentreTree } from '../reports/cost-centres';
import { ReportAccount, TrialBalanceRow, trialBalanceRows } from '../reports/statements';
import { FinancialReportsService, TrialBalanceReport } from './financial-reports.service';

export interface CostCentreSection {
  /** Null for the lines that carry no cost centre. */
  code: string | null;
  name: string;
  parentCode: string | null;
  depth: number;
  /** Per account, over this centre and every centre under it. */
  rows: TrialBalanceRow[];
  totals: TrialBalanceReport['totals'];
}

export interface CostCentreTrialBalanceReport {
  period: TrialBalanceReport['period'];
  columns: TrialBalanceReport['columns'];
  groups: TrialBalanceReport['groups'];
  costCenterCode: string | null;
  centres: CostCentreSection[];
  /** Each line counted once (a parent's section repeats its children's lines, the totals do not). */
  totals: TrialBalanceReport['totals'];
  /** Whole-ledger check without a filter; null for one centre's subtree, whose sides need not match. */
  balanced: boolean | null;
}

export const UNASSIGNED_CENTRE_NAME = 'بدون مرکز هزینه';

/**
 * Trial balance by cost centre (E3.2): the same buckets as the trial balance, split by the cost
 * centre on each POSTED line. A parent centre's section rolls up the centres under it.
 */
@Injectable()
export class CostCentreReportService {
  constructor(
    private readonly reports: FinancialReportsService,
    private readonly ledger: LedgerReportRepository,
    private readonly dimensions: DimensionRepository,
  ) {}

  async trialBalance(tenantId: string, query: CostCentreTrialBalanceQueryDto): Promise<CostCentreTrialBalanceReport> {
    const period = await this.reports.resolvePeriod(tenantId, query);
    const [accounts, buckets, centres] = await Promise.all([
      this.reports.accounts(tenantId),
      this.ledger.accountBuckets(tenantId, { ...period, byCostCenter: true }),
      this.dimensions.list(tenantId, DimensionKind.COST_CENTER),
    ]);
    const tree = costCentreTree(
      centres.map(({ id, code, name, parentId }) => ({ id, code, name, parentId: parentId ?? null })),
      query.costCenterCode,
    );
    if (!tree) {
      throw new NotFoundException(`مرکز هزینه با کد ${query.costCenterCode} یافت نشد.`);
    }
    const columns = query.columns ?? 6;
    const byId = new Map(accounts.map((account) => [account.id, account]));
    const options = { level: query.level, includeClosing: query.includeClosing };
    const centreOf = (row: AccountBucketRow) => (row.costCenterId == null ? null : Number(row.costCenterId));
    const section = (rows: AccountBucketRow[]) => {
      const balances = rows.map((row) => this.reports.toBalance(row, byId.get(Number(row.accountId)) as ReportAccount));
      const summary = this.reports.summarize(period, columns, trialBalanceRows(balances, accounts, options));
      return { rows: summary.rows, totals: summary.totals };
    };

    const sections: CostCentreSection[] = tree.map((centre) => {
      const members = new Set(centre.memberIds);
      const rows = buckets.filter((row) => members.has(centreOf(row) ?? -1));
      return { code: centre.code, name: centre.name, parentCode: centre.parentCode, depth: centre.depth, ...section(rows) };
    });
    const filtered = query.costCenterCode !== undefined;
    const inScope = filtered ? new Set(tree[0].memberIds) : null;
    if (!filtered) {
      const untagged = buckets.filter((row) => centreOf(row) === null);
      if (untagged.length > 0) {
        sections.push({ code: null, name: UNASSIGNED_CENTRE_NAME, parentCode: null, depth: 0, ...section(untagged) });
      }
    }
    const all = section(inScope ? buckets.filter((row) => inScope.has(centreOf(row) ?? -1)) : buckets);
    const report = this.reports.summarize(period, columns, all.rows);
    return {
      period,
      columns,
      groups: report.groups,
      costCenterCode: query.costCenterCode ?? null,
      centres: sections,
      totals: report.totals,
      balanced: filtered ? null : report.balanced,
    };
  }
}
