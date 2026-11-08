import { TaxInspectorService } from './reports/tax-inspector.service';
import { QuarterlyTaxComparisonService } from './reports/quarterly-tax-comparison.service';
import { YearEndTaxRolloverService } from './reports/year-end-tax-rollover.service';
import {
  RawInvoiceSalesSummary,
  RawLedgerSummary,
  RawMoadianSummary,
  RawPurchasesSummary,
  TaxInspectorRepository,
} from './reports/tax-inspector.repository';

describe('Tax Compliance Reports Services', () => {
  let repo: Partial<TaxInspectorRepository>;
  let inspectorService: TaxInspectorService;
  let comparisonService: QuarterlyTaxComparisonService;
  let rolloverService: YearEndTaxRolloverService;

  const mockSales: RawInvoiceSalesSummary = {
    invoicedCount: 10,
    totalAmountMinor: 10000000000n, // 100,000,000.00
    taxableAmountMinor: 9000000000n,
    exemptAmountMinor: 1000000000n,
    vatMinor: 900000000n, // 9,000,000.00
  };

  const mockPurchases: RawPurchasesSummary = {
    purchaseCount: 5,
    deductiblePurchasesMinor: 4000000000n, // 40,000,000.00
    inputVatMinor: 400000000n, // 4,000,000.00
  };

  const mockMoadian: RawMoadianSummary = {
    transmittedCount: 10,
    totalAmountMinor: 10000000000n,
  };

  const mockLedger: RawLedgerSummary = {
    revenueMinor: 10000000000n,
    expenseMinor: 4000000000n,
    totalVouchers: 25,
    postedVouchers: 25,
    draftVouchers: 0,
    isBalanced: true,
    hasNumberingGaps: false,
    hasClosingVoucher: true,
    closingVoucherNumber: 'FC-1404-1',
  };

  beforeEach(() => {
    repo = {
      getSalesSummary: jest.fn().mockResolvedValue(mockSales),
      getPurchasesSummary: jest.fn().mockResolvedValue(mockPurchases),
      getMoadianSummary: jest.fn().mockResolvedValue(mockMoadian),
      getLedgerSummary: jest.fn().mockResolvedValue(mockLedger),
    };

    inspectorService = new TaxInspectorService(repo as TaxInspectorRepository);
    comparisonService = new QuarterlyTaxComparisonService(repo as TaxInspectorRepository);
    rolloverService = new YearEndTaxRolloverService(repo as TaxInspectorRepository);
  });

  describe('TaxInspectorService', () => {
    it('compiles statutory tax inspector package and validates consistency', async () => {
      const pkg = await inspectorService.generatePackage('tenant-1', 1404);

      expect(pkg.year).toBe(1404);
      expect(pkg.salesReconciliation.isConsistent).toBe(true);
      expect(pkg.salesReconciliation.salesToLedgerDiscrepancyMinor).toBe('0');
      expect(pkg.salesReconciliation.salesToMoadianDiscrepancyMinor).toBe('0');
      expect(pkg.vatSummary.netTaxPayableMinor).toBe((900000000n * 4n - 400000000n * 4n).toString());
      expect(pkg.booksAudit.isBalanced).toBe(true);
      expect(pkg.booksAudit.hasClosingVoucher).toBe(true);
      expect(pkg.auditAlerts.length).toBe(0);
    });

    it('generates audit alerts when sales and ledger diverge or drafts exist', async () => {
      (repo.getLedgerSummary as jest.Mock).mockResolvedValueOnce({
        ...mockLedger,
        revenueMinor: 9500000000n, // 5,000,000.00 difference
        draftVouchers: 3,
        isBalanced: false,
        hasClosingVoucher: false,
      });

      const pkg = await inspectorService.generatePackage('tenant-1', 1404);

      expect(pkg.salesReconciliation.isConsistent).toBe(false);
      expect(pkg.salesReconciliation.salesToLedgerDiscrepancyMinor).toBe('500000000');
      expect(pkg.auditAlerts.length).toBeGreaterThanOrEqual(3);
      expect(pkg.auditAlerts.some((a) => a.includes('مغایرت درآمد دفاتر'))).toBe(true);
      expect(pkg.auditAlerts.some((a) => a.includes('سند پیش‌نویس'))).toBe(true);
      expect(pkg.auditAlerts.some((a) => a.includes('دفتر کل تراز نیست'))).toBe(true);
    });
  });

  describe('QuarterlyTaxComparisonService', () => {
    it('compares metrics across 4 quarters and aggregates year totals', async () => {
      const comp = await comparisonService.generateComparison('tenant-1', 1404);

      expect(comp.quarters.length).toBe(4);
      expect(comp.quarters[0].quarter).toBe(1);
      expect(comp.quarters[3].quarter).toBe(4);

      expect(comp.yearTotal.invoicedSalesMinor).toBe((mockSales.totalAmountMinor * 4n).toString());
      expect(comp.yearTotal.outputVatMinor).toBe((mockSales.vatMinor * 4n).toString());
      expect(comp.yearTotal.ledgerRevenueMinor).toBe((mockLedger.revenueMinor * 4n).toString());
    });
  });

  describe('YearEndTaxRolloverService', () => {
    it('calculates taxable profit adjustments under Direct Taxes Act Art 105 & 147', async () => {
      const rollover = await rolloverService.assessRollover('tenant-1', {
        year: 1404,
        nonDeductibleExpensesMinor: '1000000000', // 10,000,000.00 non-deductible addback
        taxExemptIncomeMinor: '500000000', // 5,000,000.00 exemption deduction
      });

      const accountingProfit = mockLedger.revenueMinor - mockLedger.expenseMinor; // 60,000,000.00
      const taxableProfit = accountingProfit + 1000000000n - 500000000n; // 65,000,000.00
      const expectedTax = (taxableProfit * 25n) / 100n; // 25% tax

      expect(rollover.taxReconciliation.accountingProfitBeforeTaxMinor).toBe(accountingProfit.toString());
      expect(rollover.taxReconciliation.taxableProfitMinor).toBe(taxableProfit.toString());
      expect(rollover.taxReconciliation.estimatedCorporateTaxMinor).toBe(expectedTax.toString());
      expect(rollover.readinessChecklist.isReadyToClose).toBe(true);
      expect(rollover.readinessChecklist.blockingReasons.length).toBe(0);
    });

    it('blocks closing when draft vouchers or balance issues exist', async () => {
      (repo.getLedgerSummary as jest.Mock).mockResolvedValueOnce({
        ...mockLedger,
        draftVouchers: 2,
        isBalanced: false,
      });

      const rollover = await rolloverService.assessRollover('tenant-1', { year: 1404 });

      expect(rollover.readinessChecklist.isReadyToClose).toBe(false);
      expect(rollover.readinessChecklist.blockingReasons.length).toBe(2);
    });
  });
});
