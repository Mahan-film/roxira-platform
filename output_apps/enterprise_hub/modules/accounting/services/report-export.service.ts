import { BadRequestException, Injectable } from '@nestjs/common';
import { ExportableReport, ExportReportQueryDto } from '../dto/report.dto';
import { writePdf } from '../reports/pdf-writer';
import { ReportTable } from '../reports/report-table';
import {
  balanceSheetTable,
  cashFlowTable,
  equityChangesTable,
  incomeStatementTable,
  ledgerTable,
  trialBalanceTable,
} from '../reports/report-tables';
import { writeXlsx } from '../reports/xlsx-writer';
import { FinancialReportsService } from './financial-reports.service';

export interface ExportedReport {
  body: Buffer;
  filename: string;
  contentType: string;
}

/** Builds one report and renders it as XLSX or PDF. */
@Injectable()
export class ReportExportService {
  constructor(private readonly reports: FinancialReportsService) {}

  private async table(
    tenantId: string,
    report: ExportableReport,
    query: ExportReportQueryDto,
  ): Promise<ReportTable> {
    const { format: _format, ...filters } = query;
    const period = { fiscalYearId: query.fiscalYearId, from: query.from, to: query.to };
    switch (report) {
      case 'trial-balance': {
        const data = await this.reports.trialBalance(tenantId, filters);
        return trialBalanceTable(data, `تراز آزمایشی ${data.columns} ستونی`);
      }
      case 'subsidiary': {
        const data = await this.reports.subsidiary(tenantId, filters);
        return trialBalanceTable(data, `تراز تفصیلی ${data.columns} ستونی`);
      }
      case 'ledger':
        if (!query.accountCode) {
          throw new BadRequestException('کد حساب برای خروجی دفتر لازم است.');
        }
        return ledgerTable(
          await this.reports.accountLedger(tenantId, {
            ...period,
            accountCode: query.accountCode,
            partyCode: query.partyCode,
            limit: 5000,
          }),
        );
      case 'balance-sheet':
        return balanceSheetTable(await this.reports.balanceSheet(tenantId, period));
      case 'income-statement':
        return incomeStatementTable(await this.reports.incomeStatement(tenantId, period));
      case 'cash-flow':
        return cashFlowTable(await this.reports.cashFlow(tenantId, period));
      case 'equity-changes':
        return equityChangesTable(await this.reports.equityChanges(tenantId, period));
    }
  }

  async export(
    tenantId: string,
    report: ExportableReport,
    query: ExportReportQueryDto,
  ): Promise<ExportedReport> {
    const table = await this.table(tenantId, report, query);
    if (query.format === 'pdf') {
      return { body: await writePdf(table), filename: `${report}.pdf`, contentType: 'application/pdf' };
    }
    return {
      body: writeXlsx(table),
      filename: `${report}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }
}
