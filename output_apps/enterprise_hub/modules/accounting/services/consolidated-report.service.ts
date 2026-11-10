import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConsolidatedReportQueryDto } from '../dto/consolidated-report.dto';
import { FinancialReportsService, TrialBalanceReport } from './financial-reports.service';
import { fromMinor } from '../money';

export interface CompanyInfo {
  tenantId: string;
  name: string;
}

export interface ConsolidatedTenantSummary {
  tenantId: string;
  tenantName: string;
  totalDebit: number | string;
  totalCredit: number | string;
}

export interface ConsolidatedTrialBalanceRow {
  code: string;
  accountCode: string;
  name: string;
  accountName: string;
  level: string | null;
  openingDebit: number | string;
  openingCredit: number | string;
  priorDebit: number | string;
  priorCredit: number | string;
  periodDebit: number | string;
  periodCredit: number | string;
  turnoverDebit: number | string;
  turnoverCredit: number | string;
  endingDebit: number | string;
  endingCredit: number | string;
  totalDebit: number | string;
  totalCredit: number | string;
  netBalance: number | string;
  companyBreakdown: Record<
    string,
    {
      periodDebit: number | string;
      periodCredit: number | string;
      endingDebit: number | string;
      endingCredit: number | string;
    }
  >;
  companyAmounts: Record<
    string,
    {
      debit: number;
      credit: number;
      balance: number;
    }
  >;
}

export interface ConsolidatedReportResult {
  reportType: 'trial-balance' | 'income-statement';
  companies: CompanyInfo[];
  participatingTenants: ConsolidatedTenantSummary[];
  columns: number;
  asOfDate: string;
  rows: ConsolidatedTrialBalanceRow[];
  totals: {
    openingDebit: number | string;
    openingCredit: number | string;
    periodDebit: number | string;
    periodCredit: number | string;
    turnoverDebit: number | string;
    turnoverCredit: number | string;
    endingDebit: number | string;
    endingCredit: number | string;
  };
  grandTotalDebit: number | string;
  grandTotalCredit: number | string;
  grandNetBalance: number | string;
  balanced: boolean;
}

@Injectable()
export class ConsolidatedReportService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly financialReports: FinancialReportsService,
  ) {}

  async getConsolidatedReport(
    userId: string,
    query: ConsolidatedReportQueryDto,
  ): Promise<ConsolidatedReportResult> {
    // 1. Resolve user's active tenant memberships
    const memberships = (await this.dataSource.query(
      `SELECT m."tenant_id", COALESCE(t."name", m."tenant_id"::text) AS tenant_name
       FROM "tenant_memberships" m
       LEFT JOIN "tenants" t ON t."id" = m."tenant_id"
       WHERE m."user_id" = $1 AND m."status" = 'ACTIVE'`,
      [userId],
    )) as Array<{ tenant_id: string; tenant_name: string }>;

    if (!memberships || memberships.length === 0) {
      throw new NotFoundException('هیچ سازمان فعالی برای این کاربر یافت نشد.');
    }

    const membershipMap = new Map(memberships.map((m) => [m.tenant_id, m.tenant_name]));

    // 2. Filter requested tenant IDs if specified
    let targetTenantIds: string[] = [];
    if (query.tenantIds) {
      const requested = query.tenantIds
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      for (const id of requested) {
        if (!membershipMap.has(id)) {
          throw new ForbiddenException(
            `دسترسی به اطلاعات سازمان با شناسه ${id} برای کاربر مجاز نیست.`,
          );
        }
      }
      targetTenantIds = requested;
    } else {
      targetTenantIds = memberships.map((m) => m.tenant_id);
    }

    const companies: CompanyInfo[] = targetTenantIds.map((id) => ({
      tenantId: id,
      name: membershipMap.get(id) ?? id,
    }));

    // 3. Resolve dates
    const resolvedTo = query.to ?? query.asOfDate ?? new Date().toISOString().slice(0, 10);
    const resolvedFrom = query.from;

    // 4. Query trial balance for each tenant
    const companyReports: Array<{ tenantId: string; report: TrialBalanceReport }> = [];
    for (const tenantId of targetTenantIds) {
      const rep = await this.financialReports.trialBalance(tenantId, {
        columns: query.columns ?? 4,
        from: resolvedFrom,
        to: resolvedTo,
      });
      companyReports.push({ tenantId, report: rep });
    }

    // 5. Consolidate rows across companies
    interface AggRow {
      code: string;
      name: string;
      level: string | null;
      openingDebitMinor: bigint;
      openingCreditMinor: bigint;
      priorDebitMinor: bigint;
      priorCreditMinor: bigint;
      periodDebitMinor: bigint;
      periodCreditMinor: bigint;
      turnoverDebitMinor: bigint;
      turnoverCreditMinor: bigint;
      endingDebitMinor: bigint;
      endingCreditMinor: bigint;
      companyBreakdown: Record<
        string,
        {
          periodDebit: number | string;
          periodCredit: number | string;
          endingDebit: number | string;
          endingCredit: number | string;
        }
      >;
      companyAmounts: Record<
        string,
        {
          debit: number;
          credit: number;
          balance: number;
        }
      >;
    }

    const rowMap = new Map<string, AggRow>();

    for (const { tenantId, report } of companyReports) {
      for (const row of report.rows) {
        let agg = rowMap.get(row.code);
        if (!agg) {
          agg = {
            code: row.code,
            name: row.name,
            level: row.level,
            openingDebitMinor: 0n,
            openingCreditMinor: 0n,
            priorDebitMinor: 0n,
            priorCreditMinor: 0n,
            periodDebitMinor: 0n,
            periodCreditMinor: 0n,
            turnoverDebitMinor: 0n,
            turnoverCreditMinor: 0n,
            endingDebitMinor: 0n,
            endingCreditMinor: 0n,
            companyBreakdown: {},
            companyAmounts: {},
          };
          rowMap.set(row.code, agg);
        }

        agg.openingDebitMinor += row.openingDebit;
        agg.openingCreditMinor += row.openingCredit;
        agg.priorDebitMinor += row.priorDebit;
        agg.priorCreditMinor += row.priorCredit;
        agg.periodDebitMinor += row.periodDebit;
        agg.periodCreditMinor += row.periodCredit;
        agg.turnoverDebitMinor += row.turnoverDebit;
        agg.turnoverCreditMinor += row.turnoverCredit;
        agg.endingDebitMinor += row.endingDebit;
        agg.endingCreditMinor += row.endingCredit;

        agg.companyBreakdown[tenantId] = {
          periodDebit: fromMinor(row.periodDebit),
          periodCredit: fromMinor(row.periodCredit),
          endingDebit: fromMinor(row.endingDebit),
          endingCredit: fromMinor(row.endingCredit),
        };

        const debNum = Number(fromMinor(row.periodDebit)) || 0;
        const credNum = Number(fromMinor(row.periodCredit)) || 0;
        const balNum = Number(fromMinor(row.endingDebit)) - Number(fromMinor(row.endingCredit));
        agg.companyAmounts[tenantId] = {
          debit: debNum,
          credit: credNum,
          balance: balNum,
        };
      }
    }

    // Sort rows by code
    const sorted = Array.from(rowMap.values()).sort((a, b) => a.code.localeCompare(b.code));

    let totOpeningDebit = 0n;
    let totOpeningCredit = 0n;
    let totPriorDebit = 0n;
    let totPriorCredit = 0n;
    let totPeriodDebit = 0n;
    let totPeriodCredit = 0n;
    let totTurnoverDebit = 0n;
    let totTurnoverCredit = 0n;
    let totEndingDebit = 0n;
    let totEndingCredit = 0n;

    const consolidatedRows: ConsolidatedTrialBalanceRow[] = sorted.map((r) => {
      totOpeningDebit += r.openingDebitMinor;
      totOpeningCredit += r.openingCreditMinor;
      totPriorDebit += r.priorDebitMinor;
      totPriorCredit += r.priorCreditMinor;
      totPeriodDebit += r.periodDebitMinor;
      totPeriodCredit += r.periodCreditMinor;
      totTurnoverDebit += r.turnoverDebitMinor;
      totTurnoverCredit += r.turnoverCreditMinor;
      totEndingDebit += r.endingDebitMinor;
      totEndingCredit += r.endingCreditMinor;

      const endDebit = fromMinor(r.endingDebitMinor);
      const endCredit = fromMinor(r.endingCreditMinor);
      const net = fromMinor(r.endingDebitMinor - r.endingCreditMinor);

      return {
        code: r.code,
        accountCode: r.code,
        name: r.name,
        accountName: r.name,
        level: r.level,
        openingDebit: fromMinor(r.openingDebitMinor),
        openingCredit: fromMinor(r.openingCreditMinor),
        priorDebit: fromMinor(r.priorDebitMinor),
        priorCredit: fromMinor(r.priorCreditMinor),
        periodDebit: fromMinor(r.periodDebitMinor),
        periodCredit: fromMinor(r.periodCreditMinor),
        turnoverDebit: fromMinor(r.turnoverDebitMinor),
        turnoverCredit: fromMinor(r.turnoverCreditMinor),
        endingDebit: endDebit,
        endingCredit: endCredit,
        totalDebit: endDebit,
        totalCredit: endCredit,
        netBalance: net,
        companyBreakdown: r.companyBreakdown,
        companyAmounts: r.companyAmounts,
      };
    });

    const participatingTenants: ConsolidatedTenantSummary[] = companies.map((c) => {
      const rep = companyReports.find((r) => r.tenantId === c.tenantId)?.report;
      return {
        tenantId: c.tenantId,
        tenantName: c.name,
        totalDebit: fromMinor(rep?.totals.endingDebit ?? 0n),
        totalCredit: fromMinor(rep?.totals.endingCredit ?? 0n),
      };
    });

    return {
      reportType: query.reportType ?? 'trial-balance',
      companies,
      participatingTenants,
      columns: query.columns ?? 4,
      asOfDate: resolvedTo,
      rows: consolidatedRows,
      totals: {
        openingDebit: fromMinor(totOpeningDebit),
        openingCredit: fromMinor(totOpeningCredit),
        periodDebit: fromMinor(totPeriodDebit),
        periodCredit: fromMinor(totPeriodCredit),
        turnoverDebit: fromMinor(totTurnoverDebit),
        turnoverCredit: fromMinor(totTurnoverCredit),
        endingDebit: fromMinor(totEndingDebit),
        endingCredit: fromMinor(totEndingCredit),
      },
      grandTotalDebit: fromMinor(totEndingDebit),
      grandTotalCredit: fromMinor(totEndingCredit),
      grandNetBalance: fromMinor(totEndingDebit - totEndingCredit),
      balanced: totEndingDebit === totEndingCredit,
    };
  }
}
