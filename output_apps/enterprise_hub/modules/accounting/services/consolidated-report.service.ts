import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConsolidatedReportQueryDto } from '../dto/consolidated-report.dto';
import { FinancialReportsService, TrialBalanceReport } from './financial-reports.service';
import { fromMinor } from '../money';
import { MembershipsRepository } from '../../access/repositories/memberships.repository';
import { AccessService } from '../../access/services/access.service';
import { TenantScope } from '../../access/services/tenant-scope';

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
      debit: number | string;
      credit: number | string;
      balance: number | string;
    }
  >;
}

export interface ConsolidatedReportResult {
  reportType: 'trial-balance';
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
    private readonly membershipsRepo: MembershipsRepository,
    private readonly accessService: AccessService,
    private readonly tenantScope: TenantScope,
    private readonly financialReports: FinancialReportsService,
  ) {}

  async getConsolidatedReport(
    userId: string,
    query: ConsolidatedReportQueryDto,
  ): Promise<ConsolidatedReportResult> {
    // 1. Resolve dates and validate range
    const resolvedTo = query.to ?? query.asOfDate;
    if (!resolvedTo) {
      throw new BadRequestException('تعیین تاریخ مبنای گزارش (to یا asOfDate) الزامی است.');
    }
    const resolvedFrom = query.from;
    if (resolvedFrom && resolvedFrom > resolvedTo) {
      throw new BadRequestException('تاریخ شروع (from) نمی‌تواند بعد از تاریخ پایان (to) باشد.');
    }

    // 2. Resolve user's active tenant memberships securely
    const allMemberships = await this.membershipsRepo.listForUser(userId);
    if (!allMemberships || allMemberships.length === 0) {
      throw new NotFoundException('هیچ سازمانی برای این کاربر یافت نشد.');
    }

    const activeMemberships = allMemberships.filter((m) => m.status === 'ACTIVE');
    const membershipMap = new Map(activeMemberships.map((m) => [m.tenantId, m.tenantName]));

    // 3. Determine target tenants and enforce accounting:read permission per tenant
    let targetTenantIds: string[] = [];

    if (query.tenantIds && query.tenantIds.length > 0) {
      for (const id of query.tenantIds) {
        if (!membershipMap.has(id)) {
          throw new ForbiddenException(
            `دسترسی به اطلاعات سازمان با شناسه ${id} برای کاربر مجاز نیست.`,
          );
        }
        const access = await this.accessService.resolve(userId, id);
        if (!access || !access.permissions.has('accounting:read')) {
          throw new ForbiddenException(
            `کاربر فاقد مجوز دسترسی به دفاتر مالی (accounting:read) در سازمان ${membershipMap.get(id) ?? id} است.`,
          );
        }
      }
      targetTenantIds = query.tenantIds;
    } else {
      if (activeMemberships.length === 0) {
        throw new NotFoundException('هیچ سازمان فعالی برای این کاربر یافت نشد.');
      }
      for (const m of activeMemberships) {
        const access = await this.accessService.resolve(userId, m.tenantId);
        if (access && access.permissions.has('accounting:read')) {
          targetTenantIds.push(m.tenantId);
        }
      }
      if (targetTenantIds.length === 0) {
        throw new ForbiddenException(
          'کاربر در هیچ‌یک از سازمان‌های عضو، مجوز مشاهده دفاتر مالی (accounting:read) ندارد.',
        );
      }
    }

    const companies: CompanyInfo[] = targetTenantIds.map((id) => ({
      tenantId: id,
      name: membershipMap.get(id) ?? id,
    }));

    // 4. Query trial balance for each tenant within TenantScope (enforces RLS per LESSONS 6)
    const companyReports: Array<{ tenantId: string; report: TrialBalanceReport }> = [];
    for (const tenantId of targetTenantIds) {
      const rep = await this.tenantScope.within(tenantId, undefined, async () => {
        return this.financialReports.trialBalance(tenantId, {
          columns: query.columns ?? 4,
          from: resolvedFrom,
          to: resolvedTo,
        });
      });
      companyReports.push({ tenantId, report: rep });
    }

    // 5. Consolidate rows across companies using exact BigInt minor units
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
          debit: number | string;
          credit: number | string;
          balance: number | string;
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

        const periodDeb = fromMinor(row.periodDebit);
        const periodCred = fromMinor(row.periodCredit);
        const endDeb = fromMinor(row.endingDebit);
        const endCred = fromMinor(row.endingCredit);
        const netBalMinor = row.endingDebit - row.endingCredit;
        const netBal = fromMinor(netBalMinor);

        agg.companyBreakdown[tenantId] = {
          periodDebit: periodDeb,
          periodCredit: periodCred,
          endingDebit: endDeb,
          endingCredit: endCred,
        };

        agg.companyAmounts[tenantId] = {
          debit: periodDeb,
          credit: periodCred,
          balance: netBal,
        };
      }
    }

    // Sort rows by account code
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
      reportType: 'trial-balance',
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
