import { parseCsv } from '../parsers/csv.parser';
import { normaliseAndValidate } from './field-validation';
import { AccountingAccountsRegistry } from './accounting-accounts.registry';
import { AccountingJournalLinesRegistry } from './accounting-journal-lines.registry';
import { AccountingOpeningBalancesRegistry } from './accounting-opening-balances.registry';
import {
  BankStatementRegistry,
  parseSignedRials,
  toStatementLine,
} from './bank-statement.registry';
import { CrmActivitiesRegistry } from './crm-activities.registry';
import { CrmLeadsRegistry } from './crm-leads.registry';
import {
  buildEntityFallbackMapping,
  detectEntity,
  locateHeaderRow,
} from './entity-detect';
import { HrEmployeesRegistry } from './hr-employees.registry';
import { EntityImportAdapter, NormalisedRecord } from './import-registry.types';
import { InventoryItemsRegistry } from './inventory-items.registry';
import { SalesInvoicesRegistry } from './sales-invoices.registry';

const stub = {} as never;
const bankStatement = new BankStatementRegistry(stub);
/** The real registry list, so detection is tested against every competing entity. */
const ADAPTERS: EntityImportAdapter[] = [
  new CrmLeadsRegistry(stub),
  new HrEmployeesRegistry(stub),
  new InventoryItemsRegistry(stub),
  new AccountingAccountsRegistry(stub),
  new AccountingOpeningBalancesRegistry(stub),
  new AccountingJournalLinesRegistry(stub),
  new SalesInvoicesRegistry(stub),
  new CrmActivitiesRegistry(stub),
  bankStatement,
];

/** Normalises a raw row the way EntityImportService does, using the fallback mapping. */
function recordFrom(headers: string[], row: string[]): NormalisedRecord {
  const mapping = buildEntityFallbackMapping(bankStatement.fields, headers);
  const values: Record<string, unknown> = {};
  headers.forEach((header, index) => {
    const key = mapping[header];
    const field = bankStatement.fields.find((item) => item.key === key);
    if (field && row[index]?.trim()) {
      const { value, error } = normaliseAndValidate(field, row[index].trim());
      if (error) {
        throw new Error(error);
      }
      values[field.key] = value;
    }
  });
  return { rowNumber: 2, values };
}

describe('parseSignedRials', () => {
  it.each([
    ['1,250,000', 1250000],
    ['۱٬۲۵۰٬۰۰۰', 1250000],
    ['-500,000', -500000],
    ['500,000-', -500000],
    ['(500,000)', -500000],
    ['۲۵۰٬۰۰۰ تومان', 2500000],
    ['12,000 ریال', 12000],
    [' 0 ', 0],
  ])('%s -> %d', (raw, expected) => {
    expect(parseSignedRials(raw)).toBe(expected);
  });

  it('treats empty cells and dash placeholders as missing', () => {
    expect(parseSignedRials('')).toBeNull();
    expect(parseSignedRials('-')).toBeNull();
    expect(parseSignedRials(undefined)).toBeNull();
  });

  it('flags text that is not a number', () => {
    expect(parseSignedRials('انتقال')).toBeNaN();
  });
});

describe('toStatementLine', () => {
  it('reads separate withdrawal/deposit columns (bank point of view)', () => {
    const result = toStatementLine({
      date: '2024-10-06',
      withdrawal: '0',
      deposit: '5,000,000',
      balance: '12,000,000',
      reference: '123456',
      description: 'واریز پایا',
    });
    expect(result).toEqual({
      ok: true,
      line: expect.objectContaining({
        txnDate: '2024-10-06',
        withdrawal: 0,
        deposit: 5000000,
        balance: 12000000,
        reference: '123456',
        description: 'واریز پایا',
      }),
    });
  });

  it('splits a signed amount column', () => {
    const out = toStatementLine({ date: '2024-10-06', amount: '-75,000' });
    expect(out.ok && out.line.withdrawal).toBe(75000);
    const inn = toStatementLine({ date: '2024-10-06', amount: '75,000' });
    expect(inn.ok && inn.line.deposit).toBe(75000);
  });

  it('keeps an overdraft (negative) balance', () => {
    const result = toStatementLine({
      date: '2024-10-06',
      withdrawal: '100',
      balance: '-2,500',
    });
    expect(result.ok && result.line.balance).toBe(-2500);
  });

  it('rejects rows without an amount (totals / brought-forward rows)', () => {
    expect(toStatementLine({ date: '2024-10-06', balance: '100' }).ok).toBe(false);
  });

  it('rejects rows with both a withdrawal and a deposit', () => {
    expect(
      toStatementLine({ date: '2024-10-06', withdrawal: '1', deposit: '2' }).ok,
    ).toBe(false);
  });

  it('gives the same dedupe key for the same transaction and a different one otherwise', () => {
    const a = toStatementLine({ date: '2024-10-06', deposit: '100', balance: '900', time: '10:01' });
    const b = toStatementLine({ date: '2024-10-06', deposit: '100', balance: '900', time: '10:01' });
    const c = toStatementLine({ date: '2024-10-06', deposit: '100', balance: '1000', time: '10:05' });
    expect(a.ok && b.ok && a.line.dedupeKey === b.line.dedupeKey).toBe(true);
    expect(a.ok && c.ok && a.line.dedupeKey !== c.line.dedupeKey).toBe(true);
  });
});

/**
 * Header sets assumed from common Iranian internet-bank exports (column names vary by bank and
 * version; see the registry docblock).
 */
const BANK_HEADERS: Record<string, string[]> = {
  mellat: ['ردیف', 'تاریخ', 'زمان', 'شرح', 'شماره پیگیری', 'بدهکار', 'بستانکار', 'مانده', 'شعبه'],
  melli: ['تاریخ', 'ساعت', 'شرح عملیات', 'شماره سند', 'برداشت', 'واریز', 'مانده', 'کد شعبه'],
  saderat: ['تاریخ', 'شرح', 'بدهکار', 'بستانکار', 'مانده', 'شماره چک'],
  tejarat: ['تاریخ تراکنش', 'شرح تراکنش', 'مبلغ برداشت', 'مبلغ واریز', 'مانده حساب', 'شماره مرجع'],
  pasargad: ['تاریخ', 'زمان', 'شرح', 'کد پیگیری', 'مبلغ بدهکار', 'مبلغ بستانکار', 'مانده'],
  saman: ['تاریخ', 'شرح', 'شماره سریال', 'برداشت', 'واریز', 'مانده'],
};

describe('bank statement detection', () => {
  it.each(Object.entries(BANK_HEADERS))('detects a %s export', (_bank, headers) => {
    const detection = detectEntity(headers, ADAPTERS);
    expect(detection.key).toBe('bank-statement');
    expect(detection.ambiguous).toBe(false);
    expect(detection.confidence).toBeGreaterThan(0.5);
  });

  it('still detects a journal-lines export that shares بدهکار/بستانکار/شرح', () => {
    const detection = detectEntity(
      ['شماره سند', 'ردیف سند', 'تاریخ سند', 'کد حساب', 'شرح', 'بدهکار', 'بستانکار'],
      ADAPTERS,
    );
    expect(detection.key).toBe('accounting-journal-lines');
  });

  it('maps a Mellat row end to end', () => {
    const headers = BANK_HEADERS.mellat;
    const record = recordFrom(headers, [
      '1', '۱۴۰۳/۰۷/۱۵', '14:22', 'انتقال به سپرده', '987654', '2,000,000', '0', '8,000,000', 'مرکزی',
    ]);
    const result = toStatementLine(record.values);
    expect(result).toEqual({
      ok: true,
      line: expect.objectContaining({
        txnDate: '2024-10-06',
        withdrawal: 2000000,
        deposit: 0,
        balance: 8000000,
        reference: '987654',
      }),
    });
  });
});

describe('locateHeaderRow', () => {
  const titleRows = [
    ['صورتحساب سپرده بانک ملت'],
    ['شماره حساب: 1234567890', '', 'از تاریخ 1403/07/01 تا 1403/07/30'],
    [],
  ];

  it('skips title rows above a bank statement table', () => {
    const rows = [...titleRows.filter((row) => row.length), BANK_HEADERS.melli, ['1403/07/15']];
    expect(locateHeaderRow(rows, ADAPTERS)).toBe(2);
  });

  it('keeps row 0 for an ordinary file', () => {
    const rows = [BANK_HEADERS.saman, ['1403/07/15', 'x', '1', '0', '100', '100']];
    expect(locateHeaderRow(rows, ADAPTERS)).toBe(0);
  });

  it('works through parseCsv, including delimiter detection past a title line', () => {
    const csv = [
      'صورتحساب سپرده بانک ملی',
      'تاریخ,ساعت,شرح عملیات,شماره سند,برداشت,واریز,مانده',
      '1403/07/15,09:10,"کارمزد",111,"5,000",,"995,000"',
      '1403/07/16,11:00,واریز,222,,"1,000,000","1,995,000"',
    ].join('\n');
    const parsed = parseCsv(csv, 100, (rows) => locateHeaderRow(rows, ADAPTERS));
    expect(parsed.headers).toEqual(['تاریخ', 'ساعت', 'شرح عملیات', 'شماره سند', 'برداشت', 'واریز', 'مانده']);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0][4]).toBe('5,000');
  });

  it('parseCsv without a locator keeps the first row as header (old behaviour)', () => {
    const parsed = parseCsv('a,b\n1,2', 100);
    expect(parsed.headers).toEqual(['a', 'b']);
  });
});

describe('BankStatementRegistry adapter', () => {
  const record = (rowNumber: number, values: Record<string, unknown>): NormalisedRecord => ({
    rowNumber,
    values,
  });

  it('passes the chosen bank account to BankingService and reports bad rows', async () => {
    const banking = {
      importStatementLines: jest.fn(async (_t: string, _a: number, lines: unknown[]) =>
        lines.map((_line, index) => 100 + index),
      ),
    };
    const registry = new BankStatementRegistry(banking as never);
    const result = await registry.commit(
      'tenant-a',
      [
        record(2, { date: '2024-10-06', deposit: '100' }),
        record(3, { date: '2024-10-06' }),
        record(4, { date: '2024-10-07', withdrawal: '50' }),
      ],
      { bankAccountId: 7 },
    );
    expect(banking.importStatementLines).toHaveBeenCalledWith('tenant-a', 7, expect.any(Array));
    expect(result.inserted).toEqual([
      { rowNumber: 2, ownerId: 100 },
      { rowNumber: 4, ownerId: 101 },
    ]);
    expect(result.failed.map((row) => row.rowNumber)).toEqual([3]);
  });

  it('fails every row with the service message when no bank account can be chosen', async () => {
    const banking = {
      importStatementLines: jest.fn(async () => {
        throw new Error('حساب بانکی مقصد این صورتحساب را انتخاب کنید.');
      }),
    };
    const registry = new BankStatementRegistry(banking as never);
    const result = await registry.commit('tenant-a', [record(2, { date: '2024-10-06', deposit: '1' })]);
    expect(result.inserted).toEqual([]);
    expect(result.failed[0].message).toContain('حساب بانکی');
  });

  it('undo refuses matched lines', async () => {
    const banking = {
      removeImportedLines: jest.fn(async () => ({ removed: 1, refused: [9] })),
    };
    const registry = new BankStatementRegistry(banking as never);
    const outcome = await registry.undo('tenant-a', [8, '9']);
    expect(banking.removeImportedLines).toHaveBeenCalledWith('tenant-a', [8, 9]);
    expect(outcome.removed).toBe(1);
    expect(outcome.refused).toEqual([{ ownerId: 9, message: expect.any(String) }]);
  });
});
