import { BadRequestException, Injectable } from '@nestjs/common';
import { ExportableReport, ExportReportQueryDto } from '../dto/report.dto';
import { Book, bookPages, bookSheet, generalLedgerBook, journalBook } from '../reports/legal-books';
import { rowsPerPage, writePdf, writePdfs } from '../reports/pdf-writer';
import { ReportTable } from '../reports/report-table';
import {
  ageingTable,
  partyStatementTable,
  balanceSheetTable,
  cashFlowTable,
  chartOfAccountsTable,
  equityChangesTable,
  incomeStatementTable,
  jalali,
  ledgerTable,
  periodText,
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

  /** The legal books (#249) are paged here, so each page carries its totals; null for other reports. */
  private async book(tenantId: string, report: ExportableReport, query: ExportReportQueryDto): Promise<Book | null> {
    const period = { fiscalYearId: query.fiscalYearId, from: query.from, to: query.to };
    if (report === 'journal-book') {
      const data = await this.reports.journalBook(tenantId, period);
      return journalBook(data.lines, periodText(data.period), jalali);
    }
    if (report === 'general-ledger-book') {
      const data = await this.reports.generalLedgerBook(tenantId, { ...period, level: query.level });
      return generalLedgerBook(data.accounts, periodText(data.period), jalali);
    }
    return null;
  }

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
      case 'chart-of-accounts':
        return chartOfAccountsTable(await this.reports.chartOfAccounts(tenantId));
      case 'journal-book':
      case 'general-ledger-book':
        throw new Error(`${report} is a book; export() pages it`);
      case 'party-statement':
        if (!query.partyCode) {
          throw new BadRequestException('کد تفصیلی (مشتری یا تأمین‌کننده) برای صورت‌حساب لازم است.');
        }
        return partyStatementTable(
          await this.reports.partyStatement(tenantId, {
            ...period,
            partyCode: query.partyCode,
            side: query.side,
            accountCode: query.accountCode,
            edges: query.edges,
          }),
        );
      case 'ageing':
        return ageingTable(
          await this.reports.ageing(tenantId, {
            side: query.side,
            to: query.to,
            accountCode: query.accountCode,
            partyCode: query.partyCode,
            edges: query.edges,
          }),
        );
    }
  }

  async export(
    tenantId: string,
    report: ExportableReport,
    query: ExportReportQueryDto,
  ): Promise<ExportedReport> {
    const book = await this.book(tenantId, report, query);
    if (book && query.format === 'pdf') {
      const pages = bookPages(book, rowsPerPage(book.columns.length + (book.withBalance ? 3 : 2)));
      return { body: await writePdfs(pages), filename: `${report}.pdf`, contentType: 'application/pdf' };
    }
    const table = book ? bookSheet(book) : await this.table(tenantId, report, query);
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
