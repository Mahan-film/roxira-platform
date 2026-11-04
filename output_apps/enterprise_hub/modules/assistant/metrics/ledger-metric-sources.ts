import { Injectable } from '@nestjs/common';
import { FinancialReportsService } from '../../accounting/services/financial-reports.service';
import { fromMinor, toMinor } from '../../accounting/money';
import { ChequesService } from '../../cheques/services/cheques.service';
import { PayrollRunStatus } from '../../hr/enums/hr.enum';
import { PayrollRunService } from '../../hr/services/payroll-run.service';
import { InventoryService } from '../../inventory/services/inventory.service';
import { InvoiceStatus } from '../../invoicing/enums/invoice-status.enum';
import { InvoicingService } from '../../invoicing/services/invoicing.service';
import { VatReturnService } from '../../tax_compliance/reports/vat-return.service';
import { MetricSide, MetricSources } from './metric.types';

/**
 * پیاده‌سازی واقعی درگاه‌های متریک: فقط سرویس‌های گزارش موجود را (خواندنی، با
 * شناسهٔ مستأجر) صدا می‌زند. ریاضی دفتر کل اینجا تکرار نمی‌شود و هیچ نوشتنی
 * در دفتر یا جدولی انجام نمی‌شود.
 */
@Injectable()
export class LedgerMetricSources implements MetricSources {
  constructor(
    private readonly reports: FinancialReportsService,
    private readonly invoicing: InvoicingService,
    private readonly inventory: InventoryService,
    private readonly cheques: ChequesService,
    private readonly payroll: PayrollRunService,
    private readonly vat: VatReturnService,
  ) {}

  async dashboard(tenantId: string, asOf: string) {
    const d = await this.reports.dashboard(tenantId, { to: asOf });
    return {
      cash: fromMinor(d.cash),
      bank: fromMinor(d.bank),
      receivables: fromMinor(d.receivables),
      payables: fromMinor(d.payables),
      taxDue: fromMinor(d.taxDue),
      inventory: fromMinor(d.inventory),
    };
  }

  async incomeStatement(tenantId: string, asOf: string) {
    const s = await this.reports.incomeStatement(tenantId, { to: asOf });
    return {
      revenue: fromMinor(s.revenue.total),
      grossProfit: fromMinor(s.grossProfit),
      operatingExpenses: fromMinor(s.operatingExpenses.total),
      netProfit: fromMinor(s.netProfit),
    };
  }

  async balanceSheet(tenantId: string, asOf: string) {
    const b = await this.reports.balanceSheet(tenantId, { to: asOf });
    return {
      totalAssets: fromMinor(b.totalAssets),
      totalLiabilities: fromMinor(b.totalLiabilities),
      totalEquity: fromMinor(b.totalEquity),
    };
  }

  async ageing(tenantId: string, side: MetricSide, asOf: string) {
    const report = await this.reports.ageing(tenantId, { side, to: asOf });
    return {
      buckets: report.buckets.map((bucket) => ({ fromDay: bucket.fromDay })),
      amounts: report.totals.amounts.map((amount) => fromMinor(amount)),
    };
  }

  async salesTotals(tenantId: string, range: { from: Date; to: Date }) {
    const rows = await this.invoicing.summarize(tenantId, {
      statuses: [InvoiceStatus.ISSUED, InvoiceStatus.PAID],
      from: range.from,
      to: range.to,
    });
    // Only rial invoices: a foreign-currency total is never added to rials.
    const irr = rows.filter((row) => row.currency === 'IRR');
    return {
      count: irr.reduce((sum, row) => sum + row.count, 0),
      payable: fromMinor(irr.reduce((sum, row) => sum + toMinor(row.total), 0n)),
      vat: fromMinor(irr.reduce((sum, row) => sum + toMinor(row.tax), 0n)),
    };
  }

  async stock(tenantId: string) {
    const valuation = await this.inventory.getFifoValuation(tenantId);
    return {
      fifoValue: valuation.totalInventoryValue,
      lowStockCount: valuation.lowStockCount,
    };
  }

  async chequesDue(tenantId: string, days: number, asOf: string) {
    const due = await this.cheques.listDue(tenantId, { days, asOf });
    return {
      receivedTotal: due.receivedTotal,
      issuedTotal: due.issuedTotal,
      overdueCount: due.items.filter((item) => item.overdue).length,
    };
  }

  async payrollRun(tenantId: string, jy: number, jm: number) {
    const runs = await this.payroll.listRuns(tenantId);
    // Only a posted run is certified; a draft is still a proposal.
    const run = runs
      .filter(
        (entry) =>
          entry.periodYear === jy &&
          entry.periodMonth === jm &&
          entry.status === PayrollRunStatus.POSTED,
      )
      .sort((a, b) => b.id - a.id)[0];
    return run
      ? {
          employeeCount: run.employeeCount,
          totalGross: run.totalGross,
          totalEmployerInsurance: run.totalEmployerInsurance,
          totalUnemploymentInsurance: run.totalUnemploymentInsurance,
        }
      : null;
  }

  async vatSeason(tenantId: string, year: number, quarter: number) {
    const draft = await this.vat.vatReturn(tenantId, year, quarter);
    return { payable: draft.payable, reconciled: draft.ledger.reconciled };
  }
}
