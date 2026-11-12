import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { strFromU8, unzipSync } from 'fflate';
import { LedgerExportController } from './controllers/ledger-export.controller';
import { toCsv } from './reports/csv.util';
import {
  ELECTRONIC_BOOKS_CSV_MAX_BYTES,
  ELECTRONIC_BOOKS_LAYOUT_STATUS,
  OFFICIAL_ELECTRONIC_BOOKS_HEADERS,
  RIAL_ELECTRONIC_BOOKS_HEADERS,
} from './reports/electronic-books.constants';
import {
  AccountTurnoverGroup,
  ExportLine,
  LedgerExportRepository,
} from './reports/ledger-export.repository';
import {
  JOURNAL_HEADERS,
  LEDGER_EXPORT_LAYOUT_STATUS,
  LEDGER_HEADERS,
  LedgerExportService,
} from './reports/ledger-export.service';

const line = (over: Partial<ExportLine>): ExportLine => ({
  entryNumber: 'E-1',
  date: new Date('2026-05-01T08:00:00Z'),
  lineNo: 1,
  accountCode: '1010',
  accountName: 'Cash',
  description: 'sale',
  partyCode: '',
  debitMinor: 0n,
  creditMinor: 0n,
  ...over,
});

const turnoverGroup = (over: Partial<AccountTurnoverGroup>): AccountTurnoverGroup => ({
  kolCode: '10',
  kolName: 'دارایی‌های جاری',
  moeinCode: '1010',
  moeinName: 'موجودی نقد و بانک',
  tafsiliCode: 'TF-101',
  tafsiliName: 'صندوق مرکزی',
  date: new Date('2026-05-01T08:00:00Z'),
  debitMinor: 100_000_000n,
  creditMinor: 100_000_000n,
  ...over,
});

const build = (
  lines: ExportLine[] = [],
  opening: Record<string, bigint> = {},
  turnover: AccountTurnoverGroup[] = [],
  statutoryRows: any[] = [],
  auditLogs: any[] = [],
) => {
  const repo = {
    lines: jest.fn().mockResolvedValue(lines),
    openingBalances: jest.fn().mockResolvedValue(new Map(Object.entries(opening))),
    accountTurnover: jest.fn().mockResolvedValue(turnover),
  };
  const statutory = {
    findForYear: jest.fn().mockResolvedValue(statutoryRows),
  };
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
    list: jest.fn().mockResolvedValue(auditLogs),
  };
  return {
    repo,
    statutory,
    audit,
    service: new LedgerExportService(
      repo as unknown as LedgerExportRepository,
      statutory as any,
      audit as any,
    ),
  };
};

const parse = (csv: string): string[][] =>
  csv.replace('﻿', '').trim().split('\r\n').map((row) => row.split(','));

function extractSheet1Headers(buf: Buffer): string[] {
  const zip = unzipSync(new Uint8Array(buf));
  let sharedStrings: string[] = [];
  if (zip['xl/sharedStrings.xml']) {
    const sstXml = strFromU8(zip['xl/sharedStrings.xml']);
    sharedStrings = [...sstXml.matchAll(/<si><t[^>]*>([^<]+)<\/t><\/si>/g)].map((m) => m[1]);
  }
  const sheetXml = strFromU8(zip['xl/worksheets/sheet1.xml']);
  const row1 = sheetXml.match(/<row[^>]*r="1"[^>]*>(.*?)<\/row>/)![1];
  const cellTags = [...row1.matchAll(/<c\s+([^>]+)>(.*?)<\/c>/g)];
  return cellTags.map((m) => {
    const attrs = m[1];
    const body = m[2];
    const isShared = /t="s"/.test(attrs);
    const inlineMatch = body.match(/<t[^>]*>([^<]*)<\/t>/);
    if (inlineMatch && !isShared) return inlineMatch[1];
    const valMatch = body.match(/<v>(\d+)<\/v>/);
    if (isShared && valMatch) return sharedStrings[parseInt(valMatch[1], 10)];
    return valMatch ? valMatch[1] : '';
  });
}

describe('electronic journal and ledger CSV (LDG-01)', () => {
  it('the layout is declared unverified', () => {
    expect(LEDGER_EXPORT_LAYOUT_STATUS).toBe('unverified');
  });

  it('journal: header, Jalali date, exact decimals, balanced totals', async () => {
    const { service, repo } = build([
      line({ debitMinor: 110_000n }),
      line({ lineNo: 2, accountCode: '4010', accountName: 'Sales', creditMinor: 110_000n }),
    ]);
    const rows = parse(await service.journalCsv('tenant-a', 1405, 1));
    expect(rows[0]).toEqual([...JOURNAL_HEADERS]);
    expect(rows[1]).toEqual(['E-1', '1405/02/11', '1', '1010', 'Cash', 'sale', '', '1100.00', '0.00']);
    const debit = rows.slice(1).reduce((s, r) => s + Number(r[7]), 0);
    const credit = rows.slice(1).reduce((s, r) => s + Number(r[8]), 0);
    expect(debit).toBe(credit);
    // Tehran-day bounds of 1405 q1: 1 Farvardin to 1 Tir.
    expect(repo.lines).toHaveBeenCalledWith('tenant-a', '2026-03-21', '2026-06-22');
  });

  it('ledger: running balance starts from the opening balance, even a negative one', async () => {
    const { service, repo } = build(
      [
        line({ entryNumber: 'E-1', debitMinor: 1_000n }),
        line({ entryNumber: 'E-2', lineNo: 1, creditMinor: 5_000n }),
      ],
      { '1010': -2_500n, '2020': 700n },
    );
    const rows = parse(await service.ledgerCsv('tenant-a', 1405, 1, '1010'));
    expect(rows[0]).toEqual([...LEDGER_HEADERS]);
    expect(rows.map((r) => r[8]).slice(1)).toEqual(['-25.00', '-15.00', '-65.00', '7.00']);
    expect(rows[1][5]).toBe('مانده ابتدای دوره');
    expect(rows[1][8]).toBe('-25.00');
    expect(repo.lines).toHaveBeenCalledWith('tenant-a', '2026-03-21', '2026-06-22', '1010');
  });

  it('descriptions that look like formulas are neutralised but negative balances stay numeric', async () => {
    const { service } = build([line({ description: '=HYPERLINK("x")', debitMinor: 100n })], { '1010': -100n });
    const csv = await service.ledgerCsv('tenant-a', 1405, 1);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain(',-1.00\r\n');
    expect(toCsv(['a'], [['-5.00'], ['-abc']])).toBe('﻿a\r\n-5.00\r\n\'-abc\r\n');
    expect(toCsv(['h'], [['+SUM(1,2)'], ['@VLOOKUP'], ['\tcmd'], ['\rcmd']])).toBe('﻿h\r\n"\'+SUM(1,2)"\r\n\'@VLOOKUP\r\n\'\tcmd\r\n"\'\rcmd"\r\n');
  });

  it('ledger passes the season end so opening entries dated inside the season count as opening', async () => {
    const { service, repo } = build([], { '1010': 100n });
    await service.ledgerCsv('tenant-a', 1405, 1);
    expect(repo.openingBalances).toHaveBeenCalledWith('tenant-a', '2026-03-21', undefined, '2026-06-22');
  });

  it('ledger controller takes the tenant from the JWT too', async () => {
    const ledgerCsv = jest.fn().mockResolvedValue('');
    const controller = new LedgerExportController({ ledgerCsv } as never);
    const request = { user: { tenantId: 'tenant-a', tenantRole: 'ADMIN', role: 'ADMIN' } } as never;
    await controller.ledger(request, { year: 1405, quarter: 1, tenantId: 'tenant-b' } as never).catch(() => undefined);
    expect(ledgerCsv.mock.calls[0][0]).toBe('tenant-a');
  });

  it('controller takes the tenant from the JWT, never from the query', async () => {
    const journalCsv = jest.fn().mockResolvedValue('');
    const controller = new LedgerExportController({ journalCsv } as never);
    const request = { user: { tenantId: 'tenant-a', tenantRole: 'ADMIN', role: 'ADMIN' } } as never;
    await controller.journal(request, { year: 1405, quarter: 1, tenantId: 'tenant-b' } as never).catch(() => undefined);
    for (const call of journalCsv.mock.calls) expect(call[0]).toBe('tenant-a');
  });
});

describe('T80: Statutory electronic commercial books export (دفاتر تجاری الکترونیکی)', () => {
  const officialTemplatePath = path.resolve(
    __dirname,
    '../../../../docs/tax/official/electronic-books-template.xlsx',
  );

  it('layout is declared unverified until live portal upload confirms rounding and unit rules', () => {
    expect(ELECTRONIC_BOOKS_LAYOUT_STATUS).toBe('unverified');
  });

  it('official template file exists and matches the 9 official headers', () => {
    expect(fs.existsSync(officialTemplatePath)).toBe(true);
    const templateBuf = fs.readFileSync(officialTemplatePath);
    const templateHeaders = extractSheet1Headers(templateBuf);
    expect(templateHeaders).toEqual([...OFFICIAL_ELECTRONIC_BOOKS_HEADERS]);
  });

  it('exported XLSX header row 1 compares exactly against official template file header row', async () => {
    const { service } = build([], {}, [
      turnoverGroup({
        kolCode: '10',
        kolName: 'دارایی‌های جاری',
        moeinCode: '1010',
        moeinName: 'موجودی نقد و بانک',
        tafsiliCode: '101001',
        tafsiliName: 'بانک ملی',
        date: new Date('2026-04-10T10:00:00Z'),
        debitMinor: 500_000_000n, // 5 million rials
        creditMinor: 500_000_000n,
      }),
    ]);

    const exportedXlsxBuffer = await service.electronicBooksXlsx('tenant-a', { year: 1405, quarter: 1 });
    const exportedHeaders = extractSheet1Headers(exportedXlsxBuffer);

    const templateBuf = fs.readFileSync(officialTemplatePath);
    const templateHeaders = extractSheet1Headers(templateBuf);

    expect(exportedHeaders).toEqual(templateHeaders);
    expect(exportedHeaders).toEqual([
      'کد حساب کل',
      'عنوان حساب کل',
      'کد حساب معین',
      'عنوان حساب معین',
      'کد حساب تفصیلی',
      'عنوان حساب تفصیلی',
      'گردش بدهکار (میلیون ریال)',
      'گردش بستانکار (میلیون ریال)',
      'تاریخ گردش حساب',
    ]);
  });

  it('account turnover: amounts in million rials, Jalali date, balanced totals', async () => {
    const { service, repo } = build([], {}, [
      turnoverGroup({
        kolCode: '10',
        kolName: 'دارایی‌های جاری',
        moeinCode: '1010',
        moeinName: 'موجودی نقد',
        tafsiliCode: 'TF-1',
        tafsiliName: 'صندوق',
        date: new Date('2026-05-01T08:00:00Z'),
        debitMinor: 200_000_000n, // 2 million rials
        creditMinor: 0n,
      }),
      turnoverGroup({
        kolCode: '40',
        kolName: 'فروش',
        moeinCode: '4010',
        moeinName: 'درآمد فروش',
        tafsiliCode: '',
        tafsiliName: '',
        date: new Date('2026-05-01T08:00:00Z'),
        debitMinor: 0n,
        creditMinor: 200_000_000n, // 2 million rials
      }),
    ]);

    const csv = await service.electronicBooksCsv('tenant-a', { year: 1405, quarter: 1 });
    const rows = parse(csv);

    expect(rows[0]).toEqual([...OFFICIAL_ELECTRONIC_BOOKS_HEADERS]);
    expect(rows[1]).toEqual([
      '10',
      'دارایی‌های جاری',
      '1010',
      'موجودی نقد',
      'TF-1',
      'صندوق',
      '2',
      '0',
      '1405/02/11',
    ]);
    expect(rows[2]).toEqual([
      '40',
      'فروش',
      '4010',
      'درآمد فروش',
      '',
      '',
      '0',
      '2',
      '1405/02/11',
    ]);

    // Debit and credit balance check
    const totalDebit = Number(rows[1][6]) + Number(rows[2][6]);
    const totalCredit = Number(rows[1][7]) + Number(rows[2][7]);
    expect(totalDebit).toBe(totalCredit);
    expect(repo.accountTurnover).toHaveBeenCalledWith('tenant-a', '2026-03-21', '2026-06-22');
  });

  it('refuses export when debit and credit turnover are unbalanced', async () => {
    const { service } = build([], {}, [
      turnoverGroup({
        debitMinor: 100_000_000n,
        creditMinor: 0n,
      }),
    ]);

    await expect(service.electronicBooksXlsx('tenant-a', { year: 1405, quarter: 1 })).rejects.toThrow(
      /تراز دفاتر تجاری برقرار نیست/,
    );
  });

  it('covers the full Jalali year when sub-period is omitted regardless of periodicity and builds matching presets', async () => {
    const { service, repo, statutory } = build([], {}, [], [
      {
        paramKey: 'commercial_books_periodicity',
        value: 6, // 6-month periodicity
        effectiveFrom: '2026-03-21',
        version: 1,
        tenantId: null,
      },
    ]);

    await service.electronicBooksCsv('tenant-a', { year: 1405 });
    expect(statutory.findForYear).toHaveBeenCalledWith('tenant-a', 'IR', 1405);
    expect(repo.accountTurnover).toHaveBeenCalledWith('tenant-a', '2026-03-21', '2027-03-21');

    const presets1405Override = await service.getElectronicBooksPresets('tenant-a', 1405);
    expect(presets1405Override.periodicityMonths).toBe(6);
    expect(presets1405Override.presets.map((p) => p.key)).toEqual(['1405-H1', '1405-H2']);

    // Also verify default periodicity per year when statutory override is absent: 1404=6m, 1405=3m, 1406=1m
    const defaults = build([], {}, [], []);
    expect((await defaults.service.getElectronicBooksPresets('tenant-a', 1404)).presets).toHaveLength(2);
    expect((await defaults.service.getElectronicBooksPresets('tenant-a', 1405)).presets).toHaveLength(4);
    expect((await defaults.service.getElectronicBooksPresets('tenant-a', 1406)).presets).toHaveLength(12);
  });

  it('propagates statutory repository errors instead of silently ignoring them', async () => {
    const { service, statutory } = build([], {}, []);
    statutory.findForYear.mockRejectedValue(new Error('DB down'));

    await expect(service.electronicBooksXlsx('tenant-a', { year: 1405 })).rejects.toThrow('DB down');
  });

  it('rejects mutually exclusive period parameters (e.g. quarter + month)', async () => {
    const { service } = build([], {}, []);
    await expect(
      service.getTurnoverData('tenant-a', { year: 1405, quarter: 1, month: 2 }),
    ).rejects.toThrow(/تنها یکی از پارامترهای/);
  });

  it('splits groups with both debit and credit into separate single-side rows', async () => {
    const { service } = build([], {}, [
      turnoverGroup({
        debitMinor: 300_000_000n,
        creditMinor: 300_000_000n,
      }),
    ]);

    const csv = await service.electronicBooksCsv('tenant-a', { year: 1405, quarter: 1 });
    const rows = parse(csv);
    expect(rows).toHaveLength(3); // 1 header + 2 rows (debit only + credit only)
    expect(rows[1][6]).toBe('3');
    expect(rows[1][7]).toBe('0');
    expect(rows[2][6]).toBe('0');
    expect(rows[2][7]).toBe('3');
  });

  it('emits exact decimals in both units without rounding or synthetic 9999 adjustment rows (preserving <0.5M accounts)', async () => {
    const groups = [
      turnoverGroup({
        moeinCode: '1010',
        debitMinor: 140_000_040n, // 1.4000004M rials = 1400000.4 rials
        creditMinor: 0n,
      }),
      turnoverGroup({
        moeinCode: '1020',
        debitMinor: 20_000_000n, // 0.2M rials (< 0.5M threshold, must NOT round to 0)
        creditMinor: 0n,
      }),
      turnoverGroup({
        kolCode: '40',
        moeinCode: '4010',
        debitMinor: 0n,
        creditMinor: 160_000_040n, // 1.6000004M rials = 1600000.4 rials
      }),
    ];

    const millionResult = await build([], {}, groups).service.getTurnoverData('tenant-a', {
      year: 1405,
      quarter: 1,
      unit: 'million_rial',
    });
    expect(millionResult.headers).toEqual([...OFFICIAL_ELECTRONIC_BOOKS_HEADERS]);
    expect(millionResult.roundingDifference).toBe(0n);
    expect(millionResult.rows).toHaveLength(3);
    expect(millionResult.rows.find((r) => r[2] === '9999')).toBeUndefined();
    expect(millionResult.rows.find((r) => r[2] === '1010')?.[6]).toBe('1.4000004');
    expect(millionResult.rows.find((r) => r[2] === '1020')?.[6]).toBe('0.2');
    expect(millionResult.rows.find((r) => r[2] === '4010')?.[7]).toBe('1.6000004');

    const rialResult = await build([], {}, groups).service.getTurnoverData('tenant-a', {
      year: 1405,
      quarter: 1,
      unit: 'rial',
    });
    expect(rialResult.headers).toEqual([...RIAL_ELECTRONIC_BOOKS_HEADERS]);
    expect(rialResult.roundingDifference).toBe(0n);
    expect(rialResult.rows).toHaveLength(3);
    expect(rialResult.rows.find((r) => r[2] === '9999')).toBeUndefined();
    expect(rialResult.rows.find((r) => r[2] === '1010')?.[6]).toBe('1400000.4');
    expect(rialResult.rows.find((r) => r[2] === '1020')?.[6]).toBe('200000');
    expect(rialResult.rows.find((r) => r[2] === '4010')?.[7]).toBe('1600000.4');
  });

  it('rejects CSV exports exceeding 100 MB (ELECTRONIC_BOOKS_CSV_MAX_BYTES)', async () => {
    const { service } = build([], {}, [
      turnoverGroup({ debitMinor: 100_000_000n, creditMinor: 100_000_000n }),
    ]);
    const spy = jest.spyOn(Buffer, 'byteLength').mockReturnValueOnce(ELECTRONIC_BOOKS_CSV_MAX_BYTES + 1);
    try {
      await expect(service.electronicBooksCsv('tenant-a', { year: 1405, quarter: 1 })).rejects.toThrow(
        /۱۰۰ مگابایت/,
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('auto-selects XLSX for <= 1,000 rows and CSV for > 1,000 rows', async () => {
    const small = build([], {}, [turnoverGroup({ debitMinor: 100_000_000n, creditMinor: 100_000_000n })]);
    const smallFile = await small.service.electronicBooksAuto('tenant-a', { year: 1405, quarter: 1 });
    expect(smallFile.format).toBe('xlsx');
    expect(Buffer.isBuffer(smallFile.data)).toBe(true);

    const manyGroups = Array.from({ length: 600 }, (_, idx) =>
      turnoverGroup({
        moeinCode: String(1000 + idx),
        debitMinor: 100_000_000n,
        creditMinor: 100_000_000n,
      }),
    ); // 600 groups * 2 sides = 1,200 rows > 1,000
    const large = build([], {}, manyGroups);
    const largeFile = await large.service.electronicBooksAuto('tenant-a', { year: 1405, quarter: 1 });
    expect(largeFile.format).toBe('csv');
    expect(typeof largeFile.data).toBe('string');
  });

  it('passes separate voucherScope filters and aggregates monthly per moein dated last day of month', async () => {
    const { service, repo } = build([], {}, [
      turnoverGroup({
        kolCode: '10',
        moeinCode: '1010',
        tafsiliCode: 'TF-1',
        date: new Date('2026-04-05T08:00:00Z'), // 1405/01/16
        debitMinor: 100_000_000n,
        creditMinor: 0n,
      }),
      turnoverGroup({
        kolCode: '10',
        moeinCode: '1010',
        tafsiliCode: 'TF-2',
        date: new Date('2026-04-12T08:00:00Z'), // 1405/01/23
        debitMinor: 200_000_000n,
        creditMinor: 0n,
      }),
      turnoverGroup({
        kolCode: '40',
        moeinCode: '4010',
        tafsiliCode: '',
        date: new Date('2026-04-12T08:00:00Z'),
        debitMinor: 0n,
        creditMinor: 300_000_000n,
      }),
    ]);

    const res = await service.getTurnoverData('tenant-a', {
      year: 1405,
      quarter: 1,
      voucherScope: 'closing_temp',
      monthlyAggregate: true,
    });
    expect(repo.accountTurnover).toHaveBeenCalledWith('tenant-a', '2026-03-21', '2026-06-22', {
      voucherScope: 'closing_temp',
      monthlyAggregate: true,
    });
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0][2]).toBe('1010');
    expect(res.rows[0][4]).toBe(''); // blank tafsili when monthly-aggregated at moein level
    expect(res.rows[0][6]).toBe('3');
    expect(res.rows[0][8]).toBe('1405/01/31'); // last day of Farvardin 1405

    await service.getTurnoverData('tenant-a', { year: 1405, quarter: 1, voucherScope: 'opening' });
    await service.getTurnoverData('tenant-a', { year: 1405, quarter: 1, voucherScope: 'closing_perm' });
    expect(repo.accountTurnover).toHaveBeenCalledWith('tenant-a', '2026-03-21', '2026-06-22', {
      voucherScope: 'opening',
      monthlyAggregate: false,
    });
    expect(repo.accountTurnover).toHaveBeenCalledWith('tenant-a', '2026-03-21', '2026-06-22', {
      voucherScope: 'closing_perm',
      monthlyAggregate: false,
    });
  });

  it('warns on presets and export preview when a period was already exported', async () => {
    const priorLogs = [
      {
        createdAt: new Date('2026-07-01T10:00:00Z'),
        metadata: {
          label: '1405-Q1',
          fromDay: '2026-03-21',
          toDay: '2026-06-22',
          endDateJalali: '1405/03/31',
        },
      },
    ];
    const { service } = build([], {}, [], [], priorLogs);
    const presets = await service.getElectronicBooksPresets('tenant-a', 1405);
    expect(presets.lastExportedEndDate).toBe('1405/03/31');
    expect(presets.presets[0].alreadyExported).toBe(true);
    expect(presets.presets[1].alreadyExported).toBe(false);

    const turnover = await service.getTurnoverData('tenant-a', { year: 1405, quarter: 1 });
    expect(turnover.alreadyExported).toBe(true);
    expect(turnover.lastExportedEndDate).toBe('1405/03/31');
    expect(turnover.warnings.some((w) => w.includes('1405/03/31'))).toBe(true);
  });

  it('supports explicit month and half parameters', async () => {
    const { service, repo } = build([], {}, []);

    // Month 2 (Ordibehesht: 2026-04-21 to 2026-05-22)
    await service.electronicBooksCsv('tenant-a', { year: 1405, month: 2 });
    expect(repo.accountTurnover).toHaveBeenCalledWith('tenant-a', '2026-04-21', '2026-05-22');

    // Half 2 (Mehr to Farvardin: 2026-09-23 to 2027-03-21)
    await service.electronicBooksCsv('tenant-a', { year: 1405, half: 2 });
    expect(repo.accountTurnover).toHaveBeenCalledWith('tenant-a', '2026-09-23', '2027-03-21');
  });

  it('controller enforces tenant isolation and forwards actorUserId from JWT for electronic commercial books', async () => {
    const electronicBooksXlsx = jest.fn().mockResolvedValue(Buffer.from('fake'));
    const electronicBooksCsv = jest.fn().mockResolvedValue('fake-csv');
    const getElectronicBooksPresets = jest.fn().mockResolvedValue({ year: 1405, presets: [] });
    const controller = new LedgerExportController({
      electronicBooksXlsx,
      electronicBooksCsv,
      getElectronicBooksPresets,
    } as never);

    const request = {
      user: { sub: 'user-jwt', tenantId: 'tenant-jwt', tenantRole: 'ADMIN', role: 'ADMIN' },
    } as never;
    const response = { setHeader: jest.fn() };

    await controller.electronicBooksXlsx(request, { year: 1405, quarter: 1, tenantId: 'tenant-evil' } as never, response);
    expect(electronicBooksXlsx).toHaveBeenCalledWith('tenant-jwt', expect.anything(), 'user-jwt');

    await controller.electronicBooksCsv(request, { year: 1405, quarter: 1, tenantId: 'tenant-evil' } as never, response);
    expect(electronicBooksCsv).toHaveBeenCalledWith('tenant-jwt', expect.anything(), 'user-jwt');

    await controller.electronicBooksPresets(request, { year: 1405 } as never);
    expect(getElectronicBooksPresets).toHaveBeenCalledWith('tenant-jwt', 1405);

    const { service, audit } = build([], {}, [turnoverGroup({})]);
    await service.electronicBooksXlsx('tenant-jwt', { year: 1405, quarter: 1 }, 'user-jwt');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-jwt',
        actorUserId: 'user-jwt',
      }),
    );
  });
});
