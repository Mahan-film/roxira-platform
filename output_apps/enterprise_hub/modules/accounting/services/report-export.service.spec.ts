import { BadRequestException, StreamableFile } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ReportExportService } from './report-export.service';
import { FinancialReportsService } from './financial-reports.service';
import { AccountLevel, AccountType } from '../enums/accounting.enum';

jest.mock('../reports/pdf-writer', () => ({
  writePdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-table')),
  writePdfs: jest.fn().mockResolvedValue(Buffer.from('%PDF-book-pages')),
  rowsPerPage: jest.fn().mockReturnValue(30),
}));

jest.mock('../reports/xlsx-writer', () => ({
  writeXlsx: jest.fn().mockReturnValue(Buffer.from('PK-mock-xlsx')),
}));

describe('ReportExportService', () => {
  let service: ReportExportService;
  let reportsMock: jest.Mocked<Partial<FinancialReportsService>>;

  const tenantId = '00000000-0000-0000-0000-000000000001';
  const period = {
    fiscalYearId: 1,
    from: '2026-03-21',
    to: '2027-03-20',
  };

  beforeEach(async () => {
    reportsMock = {
      trialBalance: jest.fn().mockResolvedValue({
        period,
        columns: 4,
        groups: ['turnover', 'ending'],
        rows: [],
        totals: {
          openingDebit: 0n,
          openingCredit: 0n,
          priorDebit: 0n,
          priorCredit: 0n,
          periodDebit: 0n,
          periodCredit: 0n,
          turnoverDebit: 0n,
          turnoverCredit: 0n,
          endingDebit: 0n,
          endingCredit: 0n,
        },
        balanced: true,
      }),
      subsidiary: jest.fn().mockResolvedValue({
        period,
        columns: 4,
        groups: ['turnover', 'ending'],
        rows: [],
        totals: {
          openingDebit: 0n,
          openingCredit: 0n,
          priorDebit: 0n,
          priorCredit: 0n,
          periodDebit: 0n,
          periodCredit: 0n,
          turnoverDebit: 0n,
          turnoverCredit: 0n,
          endingDebit: 0n,
          endingCredit: 0n,
        },
        balanced: true,
      }),
      accountLedger: jest.fn().mockResolvedValue({
        accountCode: '101',
        accountName: 'صندوق',
        partyCode: null,
        period,
        opening: 0n,
        totalDebit: 0n,
        totalCredit: 0n,
        closing: 0n,
        lines: [],
        truncated: false,
      }),
      balanceSheet: jest.fn().mockResolvedValue({
        period,
        currentAssets: { title: 'دارایی‌های جاری', lines: [], total: 0n },
        nonCurrentAssets: { title: 'دارایی‌های غیرجاری', lines: [], total: 0n },
        totalAssets: 0n,
        currentLiabilities: { title: 'بدهی‌های جاری', lines: [], total: 0n },
        nonCurrentLiabilities: { title: 'بدهی‌های غیرجاری', lines: [], total: 0n },
        totalLiabilities: 0n,
        equity: { title: 'حقوق مالکانه', lines: [], total: 0n },
        totalLiabilitiesAndEquity: 0n,
        balanced: true,
        difference: 0n,
      }),
      incomeStatement: jest.fn().mockResolvedValue({
        period,
        revenue: { title: 'درآمدها', lines: [], total: 0n },
        costOfSales: { title: 'بهای تمام‌شده', lines: [], total: 0n },
        grossProfit: 0n,
        operatingExpenses: { title: 'هزینه‌ها', lines: [], total: 0n },
        otherOperatingIncome: { title: 'سایر درآمدها', lines: [], total: 0n },
        operatingProfit: 0n,
        financeCosts: { title: 'هزینه‌های مالی', lines: [], total: 0n },
        nonOperating: { title: 'غیرعملیاتی', lines: [], total: 0n },
        profitBeforeTax: 0n,
        incomeTax: { title: 'مالیات', lines: [], total: 0n },
        netProfit: 0n,
      }),
      cashFlow: jest.fn().mockResolvedValue({
        period,
        netProfit: 0n,
        operating: { title: 'عملیاتی', lines: [], total: 0n },
        operatingCash: 0n,
        investing: { title: 'سرمایه‌گذاری', lines: [], total: 0n },
        financing: { title: 'تأمین مالی', lines: [], total: 0n },
        netChange: 0n,
        openingCash: 0n,
        closingCash: 0n,
      }),
      equityChanges: jest.fn().mockResolvedValue({
        period,
        rows: [
          {
            key: 'closing',
            title: 'مانده پایان دوره',
            capital: 0n,
            legalReserve: 0n,
            otherReserves: 0n,
            retainedEarnings: 0n,
            total: 0n,
          },
        ],
      }),
      chartOfAccounts: jest.fn().mockResolvedValue([
        {
          code: '101',
          name: 'صندوق',
          level: AccountLevel.MOEIN,
          accountType: AccountType.ASSET,
          reportLine: null,
          parentCode: '10',
        },
      ]),
      partyStatement: jest.fn().mockResolvedValue({
        side: 'receivable',
        accountCodes: ['101'],
        ledger: {
          accountCode: '101',
          accountName: 'حساب‌های دریافتنی',
          partyCode: '1001',
          period,
          opening: 0n,
          totalDebit: 0n,
          totalCredit: 0n,
          closing: 0n,
          lines: [],
          truncated: false,
        },
        ageing: {
          asOf: '2027-03-20',
          side: 'receivable',
          buckets: [{ fromDay: 1, toDay: 30 }],
          rows: [],
          totals: { amounts: [0n], unapplied: 0n, balance: 0n },
        },
      }),
      ageing: jest.fn().mockResolvedValue({
        asOf: '2027-03-20',
        side: 'receivable',
        buckets: [{ fromDay: 1, toDay: 30 }],
        rows: [],
        totals: { amounts: [0n], unapplied: 0n, balance: 0n },
      }),
      journalBook: jest.fn().mockResolvedValue({
        period,
        lines: [
          {
            entryNumber: 1,
            permanentNumber: '1',
            day: '2026-03-21',
            accountCode: '101',
            description: 'ثبت افتتاحیه',
            debit: 1000n,
            credit: 0n,
          },
        ],
      }),
      generalLedgerBook: jest.fn().mockResolvedValue({
        period,
        accounts: [
          {
            account: { code: '101', name: 'صندوق' },
            opening: 0n,
            lines: [],
          },
        ],
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportExportService,
        { provide: FinancialReportsService, useValue: reportsMock },
      ],
    }).compile();

    service = module.get<ReportExportService>(ReportExportService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('export - standard table reports', () => {
    it('exports trial-balance as XLSX by default', async () => {
      const result = await service.export(tenantId, 'trial-balance', {
        fiscalYearId: 1,
      });

      expect(reportsMock.trialBalance).toHaveBeenCalledWith(tenantId, { fiscalYearId: 1 });
      expect(result.filename).toBe('trial-balance.xlsx');
      expect(result.contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(result.body.toString()).toBe('PK-mock-xlsx');
    });

    it('exports trial-balance as PDF when requested', async () => {
      const result = await service.export(tenantId, 'trial-balance', {
        fiscalYearId: 1,
        format: 'pdf',
      });

      expect(reportsMock.trialBalance).toHaveBeenCalledWith(tenantId, { fiscalYearId: 1 });
      expect(result.filename).toBe('trial-balance.pdf');
      expect(result.contentType).toBe('application/pdf');
      expect(result.body.toString()).toBe('%PDF-table');
    });

    it('exports subsidiary as XLSX', async () => {
      const result = await service.export(tenantId, 'subsidiary', {
        fiscalYearId: 1,
      });

      expect(reportsMock.subsidiary).toHaveBeenCalledWith(tenantId, { fiscalYearId: 1 });
      expect(result.filename).toBe('subsidiary.xlsx');
    });

    it('exports balance-sheet as XLSX', async () => {
      const result = await service.export(tenantId, 'balance-sheet', {
        fiscalYearId: 1,
      });

      expect(reportsMock.balanceSheet).toHaveBeenCalledWith(tenantId, { fiscalYearId: 1, from: undefined, to: undefined });
      expect(result.filename).toBe('balance-sheet.xlsx');
    });

    it('exports income-statement as XLSX', async () => {
      const result = await service.export(tenantId, 'income-statement', {
        fiscalYearId: 1,
      });

      expect(reportsMock.incomeStatement).toHaveBeenCalledWith(tenantId, { fiscalYearId: 1, from: undefined, to: undefined });
      expect(result.filename).toBe('income-statement.xlsx');
    });

    it('exports cash-flow as XLSX', async () => {
      const result = await service.export(tenantId, 'cash-flow', {
        fiscalYearId: 1,
      });

      expect(reportsMock.cashFlow).toHaveBeenCalledWith(tenantId, { fiscalYearId: 1, from: undefined, to: undefined });
      expect(result.filename).toBe('cash-flow.xlsx');
    });

    it('exports equity-changes as XLSX', async () => {
      const result = await service.export(tenantId, 'equity-changes', {
        fiscalYearId: 1,
      });

      expect(reportsMock.equityChanges).toHaveBeenCalledWith(tenantId, { fiscalYearId: 1, from: undefined, to: undefined });
      expect(result.filename).toBe('equity-changes.xlsx');
    });

    it('exports chart-of-accounts as XLSX', async () => {
      const result = await service.export(tenantId, 'chart-of-accounts', {});

      expect(reportsMock.chartOfAccounts).toHaveBeenCalledWith(tenantId);
      expect(result.filename).toBe('chart-of-accounts.xlsx');
    });

    it('exports ageing report as XLSX', async () => {
      const result = await service.export(tenantId, 'ageing', {
        side: 'receivable',
        to: '2027-03-20',
      });

      expect(reportsMock.ageing).toHaveBeenCalledWith(tenantId, {
        side: 'receivable',
        to: '2027-03-20',
        accountCode: undefined,
        partyCode: undefined,
        edges: undefined,
      });
      expect(result.filename).toBe('ageing.xlsx');
    });
  });

  describe('export - ledger validation and execution', () => {
    it('throws BadRequestException when accountCode is missing for ledger', async () => {
      await expect(
        service.export(tenantId, 'ledger', { fiscalYearId: 1 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('exports ledger successfully when accountCode is provided', async () => {
      const result = await service.export(tenantId, 'ledger', {
        fiscalYearId: 1,
        accountCode: '101',
        partyCode: 'P100',
      });

      expect(reportsMock.accountLedger).toHaveBeenCalledWith(tenantId, {
        fiscalYearId: 1,
        from: undefined,
        to: undefined,
        accountCode: '101',
        partyCode: 'P100',
        limit: 5000,
      });
      expect(result.filename).toBe('ledger.xlsx');
    });
  });

  describe('export - party-statement validation and execution', () => {
    it('throws BadRequestException when partyCode is missing for party-statement', async () => {
      await expect(
        service.export(tenantId, 'party-statement', { fiscalYearId: 1 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('exports party-statement successfully when partyCode is provided', async () => {
      const result = await service.export(tenantId, 'party-statement', {
        fiscalYearId: 1,
        partyCode: '1001',
        side: 'receivable',
      });

      expect(reportsMock.partyStatement).toHaveBeenCalledWith(tenantId, {
        fiscalYearId: 1,
        from: undefined,
        to: undefined,
        partyCode: '1001',
        side: 'receivable',
        accountCode: undefined,
        edges: undefined,
      });
      expect(result.filename).toBe('party-statement.xlsx');
    });
  });

  describe('export - legal books (paged PDF and sheet XLSX)', () => {
    it('exports journal-book as paged PDF', async () => {
      const result = await service.export(tenantId, 'journal-book', {
        fiscalYearId: 1,
        format: 'pdf',
      });

      expect(reportsMock.journalBook).toHaveBeenCalledWith(tenantId, {
        fiscalYearId: 1,
        from: undefined,
        to: undefined,
      });
      expect(result.filename).toBe('journal-book.pdf');
      expect(result.contentType).toBe('application/pdf');
      expect(result.body.toString()).toBe('%PDF-book-pages');
    });

    it('exports journal-book as XLSX sheet', async () => {
      const result = await service.export(tenantId, 'journal-book', {
        fiscalYearId: 1,
      });

      expect(reportsMock.journalBook).toHaveBeenCalledWith(tenantId, {
        fiscalYearId: 1,
        from: undefined,
        to: undefined,
      });
      expect(result.filename).toBe('journal-book.xlsx');
      expect(result.contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(result.body.toString()).toBe('PK-mock-xlsx');
    });

    it('exports general-ledger-book as paged PDF', async () => {
      const result = await service.export(tenantId, 'general-ledger-book', {
        fiscalYearId: 1,
        level: AccountLevel.KOL,
        format: 'pdf',
      });

      expect(reportsMock.generalLedgerBook).toHaveBeenCalledWith(tenantId, {
        fiscalYearId: 1,
        from: undefined,
        to: undefined,
        level: AccountLevel.KOL,
      });
      expect(result.filename).toBe('general-ledger-book.pdf');
      expect(result.contentType).toBe('application/pdf');
      expect(result.body.toString()).toBe('%PDF-book-pages');
    });

    it('exports general-ledger-book as XLSX sheet', async () => {
      const result = await service.export(tenantId, 'general-ledger-book', {
        fiscalYearId: 1,
      });

      expect(reportsMock.generalLedgerBook).toHaveBeenCalledWith(tenantId, {
        fiscalYearId: 1,
        from: undefined,
        to: undefined,
        level: undefined,
      });
      expect(result.filename).toBe('general-ledger-book.xlsx');
      expect(result.contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(result.body.toString()).toBe('PK-mock-xlsx');
    });
  });

  describe('render', () => {
    it('renders a report table to XLSX by default', async () => {
      const table = {
        title: 'گزارش تست',
        subtitle: 'زیرعنوان تست',
        columns: [{ title: 'ستون ۱' }],
        rows: [{ cells: ['داده ۱'] }],
      };

      const result = await service.render(table, undefined, 'custom-report');
      expect(result.filename).toBe('custom-report.xlsx');
      expect(result.contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(result.body.toString()).toBe('PK-mock-xlsx');
    });

    it('renders a report table to PDF when format is pdf', async () => {
      const table = {
        title: 'گزارش تست',
        subtitle: 'زیرعنوان تست',
        columns: [{ title: 'ستون ۱' }],
        rows: [{ cells: ['داده ۱'] }],
      };

      const result = await service.render(table, 'pdf', 'custom-report');
      expect(result.filename).toBe('custom-report.pdf');
      expect(result.contentType).toBe('application/pdf');
      expect(result.body.toString()).toBe('%PDF-table');
    });
  });

  describe('download', () => {
    it('sets Content-Type and Content-Disposition headers and returns StreamableFile', () => {
      const file = {
        body: Buffer.from('test-content'),
        filename: 'report.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };

      const setHeader = jest.fn();
      const response = { setHeader };

      const streamable = service.download(file, response);

      expect(setHeader).toHaveBeenCalledWith('Content-Type', file.contentType);
      expect(setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="report.xlsx"',
      );
      expect(streamable).toBeInstanceOf(StreamableFile);
    });
  });
});
