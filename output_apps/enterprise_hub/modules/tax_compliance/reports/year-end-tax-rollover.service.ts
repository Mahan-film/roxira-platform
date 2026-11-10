import { BadRequestException, Injectable } from '@nestjs/common';
import { parseMinor } from '../../accounting/money';
import { isoDate, jalaliMonthEnd } from '../../hr/services/jalali-period';
import { isValidStatutoryValue } from '../../hr/statutory/statutory-catalogue';
import { StatutoryRepository } from '../../hr/statutory/statutory.repository';
import { IRAN, resolveParameters } from '../../hr/statutory/statutory.service';
import { jalaliQuarterRange } from '../utils/jalali-quarter.util';
import {
  QueryYearEndRolloverDto,
  TaxReconciliationView,
  YearEndReadinessChecklistView,
  YearEndTaxRolloverView,
} from '../dto/year-end-tax-rollover.dto';
import { TaxInspectorRepository } from './tax-inspector.repository';

const RATE_SCALE = 1_000_000n;

function applyRate(amountMinor: bigint, rate: string): bigint {
  const [whole, fraction = ''] = rate.split('.');
  const scaled = BigInt(whole + fraction.padEnd(6, '0'));
  return (amountMinor * scaled + RATE_SCALE / 2n) / RATE_SCALE;
}

@Injectable()
export class YearEndTaxRolloverService {
  constructor(
    private readonly repo: TaxInspectorRepository,
    private readonly statutory: StatutoryRepository,
  ) {}

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
      ? parseMinor(query.nonDeductibleExpensesMinor)
      : 0n;
    const exemptIncomeMinor = query.taxExemptIncomeMinor
      ? parseMinor(query.taxExemptIncomeMinor)
      : 0n;

    const taxableProfitMinor = profitBeforeTaxMinor + nonDeductibleMinor - exemptIncomeMinor;

    // Corporate tax rate dynamically fetched from statutory parameters store
    const statutoryRows = await this.statutory.findForYear(tenantId, IRAN, query.year);
    const resolved = resolveParameters(statutoryRows, isoDate(jalaliMonthEnd(query.year, 12)));
    const rateRow = resolved.get('corporate_tax_rate');
    if (!rateRow || !isValidStatutoryValue('corporate_tax_rate', rateRow.value)) {
      throw new BadRequestException(
        `پارامتر قانونی «corporate_tax_rate» برای سال ${query.year} تعریف نشده یا نامعتبر است؛ منبع قانونی تأییدشده لازم است.`,
      );
    }

    const rateStr = String(rateRow.value);
    const [rateWhole, rateFrac = ''] = rateStr.split('.');
    const taxRatePercent = Number(BigInt(rateWhole || '0') * 100n + BigInt((rateFrac + '00').slice(0, 2)));

    const floorRow = resolved.get('corporate_tax_effective_floor');
    const floorStr = floorRow && isValidStatutoryValue('corporate_tax_effective_floor', floorRow.value)
      ? String(floorRow.value)
      : null;

    const byRate = taxableProfitMinor > 0n ? applyRate(taxableProfitMinor, rateStr) : 0n;
    const floorTax = profitBeforeTaxMinor > 0n && floorStr ? applyRate(profitBeforeTaxMinor, floorStr) : 0n;
    const estimatedTaxMinor = byRate > floorTax ? byRate : floorTax;

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
