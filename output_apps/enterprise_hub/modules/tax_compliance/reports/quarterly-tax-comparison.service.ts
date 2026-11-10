import { Injectable } from '@nestjs/common';
import { jalaliQuarterRange } from '../utils/jalali-quarter.util';
import {
  QuarterMetricsView,
  QuarterlyTaxComparisonView,
} from '../dto/quarterly-tax-comparison.dto';
import { TaxInspectorRepository } from './tax-inspector.repository';

@Injectable()
export class QuarterlyTaxComparisonService {
  constructor(private readonly repo: TaxInspectorRepository) {}

  async generateComparison(
    tenantId: string,
    year: number,
  ): Promise<QuarterlyTaxComparisonView> {
    const quarters: QuarterMetricsView[] = [];

    let totalInvoicedSales = 0n;
    let totalMoadianSales = 0n;
    let totalLedgerRevenue = 0n;
    let totalOutputVat = 0n;
    let totalPurchases = 0n;
    let totalLedgerExpenses = 0n;
    let totalInputVat = 0n;
    let totalNetTax = 0n;

    for (let q = 1; q <= 4; q++) {
      const qRange = jalaliQuarterRange(year, q as 1 | 2 | 3 | 4);
      const [sales, purchases, moadian, ledger] = await Promise.all([
        this.repo.getSalesSummary(tenantId, qRange.from, qRange.to),
        this.repo.getPurchasesSummary(tenantId, qRange.from, qRange.to),
        this.repo.getMoadianSummary(tenantId, qRange.from, qRange.to),
        this.repo.getLedgerSummary(tenantId, qRange.from, qRange.to),
      ]);

      const netTax = sales.vatMinor - purchases.inputVatMinor;
      const salesToLedgerDiff = sales.totalAmountMinor - ledger.revenueMinor;
      const salesToMoadianDiff = sales.totalAmountMinor - moadian.totalAmountMinor;

      quarters.push({
        quarter: q,
        labelFa: qRange.label,
        periodFrom: qRange.from.toISOString().slice(0, 10),
        periodTo: qRange.to.toISOString().slice(0, 10),
        invoicedSalesMinor: sales.totalAmountMinor.toString(),
        moadianSalesMinor: moadian.totalAmountMinor.toString(),
        ledgerRevenueMinor: ledger.revenueMinor.toString(),
        outputVatMinor: sales.vatMinor.toString(),
        invoicedPurchasesMinor: purchases.deductiblePurchasesMinor.toString(),
        ledgerExpensesMinor: ledger.expenseMinor.toString(),
        inputVatMinor: purchases.inputVatMinor.toString(),
        netTaxPayableMinor: netTax.toString(),
        salesToLedgerDiffMinor: salesToLedgerDiff.toString(),
        salesToMoadianDiffMinor: salesToMoadianDiff.toString(),
      });

      totalInvoicedSales += sales.totalAmountMinor;
      totalMoadianSales += moadian.totalAmountMinor;
      totalLedgerRevenue += ledger.revenueMinor;
      totalOutputVat += sales.vatMinor;
      totalPurchases += purchases.deductiblePurchasesMinor;
      totalLedgerExpenses += ledger.expenseMinor;
      totalInputVat += purchases.inputVatMinor;
      totalNetTax += netTax;
    }

    // Calculate quarter-over-quarter growth rates
    const trends: Array<{ quarter: number; salesGrowthPercent: number; taxGrowthPercent: number }> = [];
    for (let i = 1; i < quarters.length; i++) {
      const prev = quarters[i - 1];
      const curr = quarters[i];

      const prevSales = BigInt(prev.invoicedSalesMinor);
      const currSales = BigInt(curr.invoicedSalesMinor);
      const salesGrowth =
        prevSales > 0n ? Number(((currSales - prevSales) * 10000n) / prevSales) / 100 : 0;

      const prevTax = BigInt(prev.outputVatMinor);
      const currTax = BigInt(curr.outputVatMinor);
      const taxGrowth =
        prevTax > 0n ? Number(((currTax - prevTax) * 10000n) / prevTax) / 100 : 0;

      trends.push({
        quarter: curr.quarter,
        salesGrowthPercent: salesGrowth,
        taxGrowthPercent: taxGrowth,
      });
    }

    const yearTotal = {
      invoicedSalesMinor: totalInvoicedSales.toString(),
      moadianSalesMinor: totalMoadianSales.toString(),
      ledgerRevenueMinor: totalLedgerRevenue.toString(),
      outputVatMinor: totalOutputVat.toString(),
      invoicedPurchasesMinor: totalPurchases.toString(),
      ledgerExpensesMinor: totalLedgerExpenses.toString(),
      inputVatMinor: totalInputVat.toString(),
      netTaxPayableMinor: totalNetTax.toString(),
      salesToLedgerDiffMinor: (totalInvoicedSales - totalLedgerRevenue).toString(),
      salesToMoadianDiffMinor: (totalInvoicedSales - totalMoadianSales).toString(),
    };

    return {
      year,
      currency: 'IRR',
      tenantId,
      quarters,
      yearTotal,
      trends,
    };
  }
}
