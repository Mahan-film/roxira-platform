import { Injectable } from '@nestjs/common';
import { jalaliQuarterRange } from '../utils/jalali-quarter.util';
import {
  QueryYearEndRolloverDto,
  TaxReconciliationView,
  YearEndReadinessChecklistView,
  YearEndTaxRolloverView,
} from '../dto/year-end-tax-rollover.dto';
import { TaxInspectorRepository } from './tax-inspector.repository';

@Injectable()
export class YearEndTaxRolloverService {
  constructor(private readonly repo: TaxInspectorRepository) {}

  async assessRollover(
    tenantId: string,
    query: QueryYearEndRolloverDto,
  ): Promise<YearEndTaxRolloverView> {
    const q1 = jalaliQuarterRange(query.year, 1);
    const q4 = jalaliQuarterRange(query.year, 4);

    const yearStart = q1.from;
    const yearEnd = q4.to;

    const ledger = await this.repo.getLedgerSummary(tenantId, yearStart, yearEnd);

    const revenueMinor = ledger.revenueMinor;
    const expensesMinor = ledger.expenseMinor;
    const profitBeforeTaxMinor = revenueMinor - expensesMinor;

    const nonDeductibleMinor = query.nonDeductibleExpensesMinor
      ? BigInt(query.nonDeductibleExpensesMinor)
      : 0n;
    const exemptIncomeMinor = query.taxExemptIncomeMinor
      ? BigInt(query.taxExemptIncomeMinor)
      : 0n;

    const taxableProfitMinor = profitBeforeTaxMinor + nonDeductibleMinor - exemptIncomeMinor;
    const taxRatePercent = 25; // 25% corporate tax under Art. 105 Direct Taxes Act
    const estimatedTaxMinor =
      taxableProfitMinor > 0n ? (taxableProfitMinor * 25n) / 100n : 0n;

    const taxReconciliation: TaxReconciliationView = {
      accountingRevenueMinor: revenueMinor.toString(),
      accountingExpensesMinor: expensesMinor.toString(),
      accountingProfitBeforeTaxMinor: profitBeforeTaxMinor.toString(),
      nonDeductibleExpensesMinor: nonDeductibleMinor.toString(),
      taxExemptIncomeMinor: exemptIncomeMinor.toString(),
      taxableProfitMinor: taxableProfitMinor.toString(),
      taxRatePercent,
      estimatedCorporateTaxMinor: estimatedTaxMinor.toString(),
    };

    const hasUnpostedDrafts = ledger.draftVouchers > 0;
    const hasNumberingGaps = ledger.hasNumberingGaps;
    const isLedgerBalanced = ledger.isBalanced;
    const hasClosingVoucher = ledger.hasClosingVoucher;

    const blockingReasons: string[] = [];
    if (hasUnpostedDrafts) {
      blockingReasons.push(
        `تعداد ${ledger.draftVouchers} سند حسابداری پیش‌نویس وجود دارد که قبل از بستن سال باید تعیین تکلیف شوند.`,
      );
    }
    if (!isLedgerBalanced) {
      blockingReasons.push('دفتر کل متوازن نیست (جمع بدهکار و بستانکار برابر نیست).');
    }
    if (hasNumberingGaps) {
      blockingReasons.push('در شماره‌گذاری قطعی اسناد شکاف وجود دارد.');
    }

    const isReadyToClose = blockingReasons.length === 0;

    const readinessChecklist: YearEndReadinessChecklistView = {
      hasUnpostedDrafts,
      draftVouchersCount: ledger.draftVouchers,
      hasNumberingGaps,
      isLedgerBalanced,
      hasClosingVoucher,
      temporaryAccountsClosed: hasClosingVoucher,
      isReadyToClose,
      blockingReasons,
    };

    return {
      year: query.year,
      currency: 'IRR',
      tenantId,
      taxReconciliation,
      readinessChecklist,
    };
  }
}
