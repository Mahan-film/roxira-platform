import 'reflect-metadata';
import { toCsv } from './reports/csv.util';
import { ExportLine, LedgerExportRepository } from './reports/ledger-export.repository';
import {
  JOURNAL_HEADERS,
  LEDGER_EXPORT_LAYOUT_STATUS,
  LEDGER_HEADERS,
  LedgerExportService,
} from './reports/ledger-export.service';
import { LedgerExportController } from './controllers/ledger-export.controller';

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

const build = (lines: ExportLine[], opening: Record<string, bigint> = {}) => {
  const repo = {
    lines: jest.fn().mockResolvedValue(lines),
    openingBalances: jest.fn().mockResolvedValue(new Map(Object.entries(opening))),
  };
  return { repo, service: new LedgerExportService(repo as unknown as LedgerExportRepository) };
};

const parse = (csv: string): string[][] =>
  csv.replace('﻿', '').trim().split('\r\n').map((row) => row.split(','));

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
    // Opening row, then the two lines: -25.00 -> -15.00 -> -65.00, then the opening-only account.
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
