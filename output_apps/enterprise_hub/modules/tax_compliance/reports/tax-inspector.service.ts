import { Injectable } from '@nestjs/common';
import { jalaliQuarterRange } from '../utils/jalali-quarter.util';
import {
  TaxInspectorBooksAudit,
  TaxInspectorPackageView,
  TaxInspectorPurchasesReconciliation,
  TaxInspectorSalesReconciliation,
  TaxInspectorVatSummary,
} from '../dto/tax-inspector-report.dto';
import { TaxInspectorRepository } from './tax-inspector.repository';

@Injectable()
export class TaxInspectorService {
  constructor(private readonly repo: TaxInspectorRepository) {}

  async generatePackage(tenantId: string, year: number): Promise<TaxInspectorPackageView> {
    const q1 = jalaliQuarterRange(year, 1);
    const q4 = jalaliQuarterRange(year, 4);

    const yearStart = q1.from;
    const yearEnd = q4.to;

    // Run parallel retrievals
    const [salesSummary, purchasesSummary, moadianSummary, ledgerSummary] = await Promise.all([
      this.repo.getSalesSummary(tenantId, yearStart, yearEnd),
      this.repo.getPurchasesSummary(tenantId, yearStart, yearEnd),
      this.repo.getMoadianSummary(tenantId, yearStart, yearEnd),
      this.repo.getLedgerSummary(tenantId, yearStart, yearEnd),
    ]);

    // Quarterly breakdown
    const quarterlyBreakdown = [];
    let sumOutputVatMinor = 0n;
    let sumInputVatMinor = 0n;

    for (let q = 1; q <= 4; q++) {
      const qRange = jalaliQuarterRange(year, q as 1 | 2 | 3 | 4);
      const [qSales, qPurchases] = await Promise.all([
        this.repo.getSalesSummary(tenantId, qRange.from, qRange.to),
        this.repo.getPurchasesSummary(tenantId, qRange.from, qRange.to),
      ]);

      const qNetVat = qSales.vatMinor - qPurchases.inputVatMinor;
      sumOutputVatMinor += qSales.vatMinor;
      sumInputVatMinor += qPurchases.inputVatMinor;

      quarterlyBreakdown.push({
        quarter: q,
        quarterLabel: qRange.label,
        salesMinor: qSales.totalAmountMinor.toString(),
        outputVatMinor: qSales.vatMinor.toString(),
        purchasesMinor: qPurchases.deductiblePurchasesMinor.toString(),
        inputVatMinor: qPurchases.inputVatMinor.toString(),
        netVatMinor: qNetVat.toString(),
      });
    }

    const salesToLedgerDiff = salesSummary.totalAmountMinor - ledgerSummary.revenueMinor;
    const salesToMoadianDiff = salesSummary.totalAmountMinor - moadianSummary.totalAmountMinor;
    const isConsistent = salesToLedgerDiff === 0n && salesToMoadianDiff === 0n;

    const salesReconciliation: TaxInspectorSalesReconciliation = {
      invoicedSalesCount: salesSummary.invoicedCount,
      invoicedSalesTotalMinor: salesSummary.totalAmountMinor.toString(),
      taxableSalesMinor: salesSummary.taxableAmountMinor.toString(),
      exemptSalesMinor: salesSummary.exemptAmountMinor.toString(),
      outputVatMinor: salesSummary.vatMinor.toString(),
      moadianTransmittedCount: moadianSummary.transmittedCount,
      moadianTransmittedTotalMinor: moadianSummary.totalAmountMinor.toString(),
      ledgerRevenueMinor: ledgerSummary.revenueMinor.toString(),
      salesToLedgerDiscrepancyMinor: salesToLedgerDiff.toString(),
      salesToMoadianDiscrepancyMinor: salesToMoadianDiff.toString(),
      isConsistent,
    };

    const purchasesReconciliation: TaxInspectorPurchasesReconciliation = {
      purchaseDocumentCount: purchasesSummary.purchaseCount,
      deductiblePurchasesMinor: purchasesSummary.deductiblePurchasesMinor.toString(),
      inputVatCreditMinor: purchasesSummary.inputVatMinor.toString(),
      ledgerExpenseMinor: ledgerSummary.expenseMinor.toString(),
      seasonalReportedPurchasesMinor: purchasesSummary.deductiblePurchasesMinor.toString(),
    };

    const netTaxPayable = sumOutputVatMinor - sumInputVatMinor;
    const vatSummary: TaxInspectorVatSummary = {
      outputVatMinor: sumOutputVatMinor.toString(),
      inputVatCreditMinor: sumInputVatMinor.toString(),
      netTaxPayableMinor: netTaxPayable.toString(),
      quarterlyBreakdown,
    };

    const booksAudit: TaxInspectorBooksAudit = {
      totalVouchersCount: ledgerSummary.totalVouchers,
      postedVouchersCount: ledgerSummary.postedVouchers,
      draftVouchersCount: ledgerSummary.draftVouchers,
      isBalanced: ledgerSummary.isBalanced,
      hasNumberingGaps: ledgerSummary.hasNumberingGaps,
      hasClosingVoucher: ledgerSummary.hasClosingVoucher,
      closingVoucherNumber: ledgerSummary.closingVoucherNumber,
    };

    // Construct audit alerts
    const auditAlerts: string[] = [];
    if (salesToLedgerDiff !== 0n) {
      auditAlerts.push(
        `مغایرت درآمد دفاتر با صورتحساب‌های فروش: ${salesToLedgerDiff > 0n ? '+' : ''}${salesToLedgerDiff.toString()} ریال`,
      );
    }
    if (salesToMoadianDiff !== 0n) {
      auditAlerts.push(
        `مغایرت فروش با سامانه مودیان: ${salesToMoadianDiff > 0n ? '+' : ''}${salesToMoadianDiff.toString()} ریال`,
      );
    }
    if (ledgerSummary.draftVouchers > 0) {
      auditAlerts.push(
        `تعداد ${ledgerSummary.draftVouchers} سند پیش‌نویس ثبت‌نشده در سال مالی وجود دارد.`,
      );
    }
    if (!ledgerSummary.isBalanced) {
      auditAlerts.push('دفتر کل تراز نیست (جمع بدهکار با جمع بستانکار برابر نیست).');
    }
    if (ledgerSummary.hasNumberingGaps) {
      auditAlerts.push('شکاف در توالی شماره قطعی اسناد حسابداری شناسایی شد.');
    }
    if (!ledgerSummary.hasClosingVoucher) {
      auditAlerts.push('سند اختتامیه برای پایان سال مالی ثبت نشده است.');
    }

    return {
      year,
      periodLabel: `سال مالی ${year} (${q1.label.split(' تا ')[0]} تا ${q4.label.split(' تا ')[1]})`,
      periodFrom: yearStart.toISOString().slice(0, 10),
      periodTo: yearEnd.toISOString().slice(0, 10),
      currency: 'IRR',
      tenantId,
      salesReconciliation,
      purchasesReconciliation,
      vatSummary,
      booksAudit,
      auditAlerts,
    };
  }
}
