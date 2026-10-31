import * as fs from 'fs';
import * as path from 'path';
import { detectFormat, readFormat } from './format-registry';
import { iterateRows } from '../analysis/package-analysis';
import { ParsedPackage } from '../parsers/package-source.types';

const FIX = path.join(__dirname, '..', '__fixtures__', 'formats');
const load = (name: string): Buffer => fs.readFileSync(path.join(FIX, name));

function rowsOf(pkg: ParsedPackage, table?: string): Record<string, unknown>[] {
  const t = table ? pkg.tables.find((x) => x.name === table) : pkg.tables[0];
  if (!t) throw new Error(`no table ${table}; have ${pkg.tables.map((x) => x.name).join(',')}`);
  return [...iterateRows(t)];
}

const JOURNAL_HEAD = ['شماره سند', 'تاریخ', 'کد حساب', 'بدهکار', 'بستانکار', 'شرح'];

describe('format detection is by content, not extension', () => {
  const cases: Array<[string, string, string]> = [
    ['journal.csv', 'csv', 'x.csv'],
    ['journal.csv', 'csv', 'renamed.bin'],
    ['journal.tsv', 'csv', 'x.tsv'],
    ['journal-semicolon.csv', 'csv', 'x.txt'],
    ['journal-fixed.txt', 'fixed-width', 'x.txt'],
    ['journal.json', 'json', 'x.dat'],
    ['journal.xml', 'xml', 'x.dat'],
    ['journal-table.xls', 'html-table', 'x.xls'],
    ['journal.xls', 'xls', 'x.dat'],
    ['journal.ods', 'ods', 'x.zip'],
    ['journal.xlsx', 'xlsx', 'x.zip'],
    ['journal.dbf', 'dbf', 'x.dat'],
    ['mysql-dump.sql.txt', 'sql-mysql', 'x.txt'],
    ['postgres-dump.sql.txt', 'sql-postgres', 'x.txt'],
    ['mssql-script.sql.txt', 'sql-mssql', 'x.txt'],
    ['sqlite-dump.sql.txt', 'sql', 'x.sql'],
    ['quickbooks.iif', 'iif', 'x.txt'],
    ['bank.ofx', 'ofx', 'x.txt'],
    ['stub-access.mdb', 'access', 'x.dat'],
    ['stub-sqlserver.bak.bin', 'mssql-backup', 'x.dat'],
    ['stub-pgdump-custom.dump', 'pg-custom', 'x.dat'],
  ];
  it.each(cases)('%s → %s (named %s)', (file, id, name) => {
    expect(detectFormat(load(file), name).id).toBe(id);
  });

  it('a .csv name does not turn a JSON file into CSV', () => {
    expect(detectFormat(load('journal.json'), 'trick.csv').id).toBe('json');
  });

  it('random binary is unknown', () => {
    expect(detectFormat(Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919) % 251)), 'x.csv').id).toBe('unknown');
  });
});

describe('tabular readers', () => {
  it('csv with BOM', async () => {
    const pkg = await readFormat(load('journal.csv'), 'journal.csv');
    expect(pkg.tables[0].columns.map((c) => c.name)).toEqual(JOURNAL_HEAD);
    expect(rowsOf(pkg)).toHaveLength(4);
  });

  it.each(['journal.tsv', 'journal-semicolon.csv', 'journal-fixed.txt', 'journal-utf16le.csv'])(
    '%s gives the same header and 4 rows',
    async (file) => {
      const pkg = await readFormat(load(file), file);
      expect(pkg.tables[0].columns.map((c) => c.name)).toEqual(JOURNAL_HEAD);
      expect(rowsOf(pkg)).toHaveLength(4);
      expect(rowsOf(pkg)[0]['شرح']).toBe('دریافت نقدی');
    },
  );

  it('windows-1256 csv is decoded and Arabic ي/ك are unified to Persian ی/ک', async () => {
    const pkg = await readFormat(load('journal-cp1256.csv'), 'a.csv');
    const row = rowsOf(pkg)[0];
    expect(row['شرح']).toBe('دریافت نقدی کالا');
    expect(pkg.notes?.join(' ')).toMatch(/Windows-1256/);
    expect(pkg.notes?.join(' ')).toMatch(/عربی/);
  });

  it('JSON with two arrays becomes two tables', async () => {
    const pkg = await readFormat(load('journal.json'), 'j.json');
    expect(pkg.tables.map((t) => t.name).sort()).toEqual(['accounts', 'journal']);
    expect(rowsOf(pkg, 'journal')[1].credit).toBe('5000000');
  });

  it('XML repeating records become a table with attributes + children', async () => {
    const pkg = await readFormat(load('journal.xml'), 'j.xml');
    const rows = rowsOf(pkg, 'line');
    expect(rows).toHaveLength(4);
    expect(rows[0].voucher).toBe('JV-1');
    expect(rows[0].account).toBe('1101');
  });

  it('HTML-table "xls" (what many Iranian systems really export)', async () => {
    const pkg = await readFormat(load('journal-table.xls'), 'x.xls');
    expect(rowsOf(pkg)).toHaveLength(4);
    expect(rowsOf(pkg)[2]['شرح']).toBe('هزینه حمل');
  });

  it('real BIFF8 xls written by SheetJS: all sheets, values intact', async () => {
    const pkg = await readFormat(load('journal.xls'), 'journal.xls');
    expect(pkg.formatId).toBe('xls');
    expect(pkg.tables.map((t) => t.name)).toEqual(['journal', 'accounts']);
    const rows = rowsOf(pkg, 'journal');
    expect(rows).toHaveLength(4);
    expect(rows[0]['کد حساب']).toBe('1101');
    expect(rows[0]['بدهکار']).toBe('5000000');
    expect(rows[0]['شرح']).toBe('دریافت نقدی');
    expect(rowsOf(pkg, 'accounts')[2]['نام حساب']).toBe('هزینه حمل');
  });

  it('xls: title rows above the table are skipped and date cells become ISO dates', async () => {
    const pkg = await readFormat(load('dates-title.xls'), 'd.xls');
    const rows = rowsOf(pkg);
    expect(pkg.tables[0].columns.map((c) => c.name)).toEqual(['تاریخ', 'مبلغ']);
    expect(rows[0]['تاریخ']).toBe('2024-10-06');
    expect(rows[0]['مبلغ']).toBe('1234.5');
  });

  it('ods: all sheets', async () => {
    const pkg = await readFormat(load('journal.ods'), 'j.ods');
    expect(pkg.tables.map((t) => t.name)).toEqual(['journal', 'accounts']);
    expect(rowsOf(pkg, 'journal')[3]['شرح']).toBe('پرداخت نقدی');
    expect(rowsOf(pkg, 'journal')[0]['بدهکار']).toBe('5000000');
  });

  it('xlsx: a SheetJS workbook keeps both sheets', async () => {
    const pkg = await readFormat(load('journal.xlsx'), 'j.xlsx');
    expect(pkg.tables.map((t) => t.name)).toEqual(['journal', 'accounts']);
    expect(rowsOf(pkg, 'journal')).toHaveLength(4);
  });

  it('xlsx: every visible sheet becomes a table named after the sheet', async () => {
    const pkg = await readFormat(load('multi-sheet.xlsx'), 'm.xlsx');
    expect(pkg.tables.map((t) => t.name)).toEqual(['سرفصل', 'اسناد', 'کالا']);
    expect(rowsOf(pkg, 'اسناد')[1]['بستانکار']).toBe('1000');
    expect(pkg.notes?.join(' ')).toMatch(/۳|3/);
  });

  it('dbf', async () => {
    const pkg = await readFormat(load('journal.dbf'), 'j.dbf');
    const rows = rowsOf(pkg);
    expect(rows).toHaveLength(4);
    expect(rows[0].ACCOUNT).toBe('1101');
    expect(Number(rows[1].CREDIT)).toBe(5000000);
  });
});

describe('SQL dumps are parsed, never executed', () => {
  it('MySQL: escapes, extended INSERT, NULL, FK, ignored statements', async () => {
    const pkg = await readFormat(load('mysql-dump.sql.txt'), 'x.txt');
    expect(pkg.formatId).toBe('sql-mysql');
    const acc = rowsOf(pkg, 'accounts');
    expect(acc).toHaveLength(3);
    expect(acc[1].name).toBe("فروش 'نقدی'");
    expect(acc[2].name).toBe("O'Brien; test\nline2");
    expect(acc[2].type).toBe('');
    expect(rowsOf(pkg, 'journal_lines')).toHaveLength(2);
    expect(pkg.relationships).toEqual([
      { fromTable: 'journal_lines', fromColumn: 'account_code', toTable: 'accounts', toColumn: 'code', declared: true },
    ]);
    expect(pkg.notes?.join(' ')).toMatch(/هیچ دستوری اجرا نشد/);
  });

  it('PostgreSQL: COPY block (tabs, \\t escape, \\N) + INSERT with column list + ALTER FK', async () => {
    const pkg = await readFormat(load('postgres-dump.sql.txt'), 'x.txt');
    expect(pkg.formatId).toBe('sql-postgres');
    const acc = rowsOf(pkg, 'accounts');
    expect(acc.map((r) => r.code)).toEqual(['1101', '4101', '5101']);
    expect(acc[1].name).toBe('فروش\tنقدی');
    expect(acc[2].name).toBe('');
    expect(rowsOf(pkg, 'journal_lines')[0].debit).toBe('5000000');
    expect(pkg.relationships).toHaveLength(1);
  });

  it('T-SQL script (UTF-16LE, GO, N-strings, [brackets])', async () => {
    const pkg = await readFormat(load('mssql-script.sql.txt'), 'x.txt');
    const rows = rowsOf(pkg, 'accounts');
    expect(rows).toHaveLength(2);
    expect(rows[1].name).toBe('فروش; نقدی');
  });

  it('SQLite-dialect dump still goes through the hardened path', async () => {
    const pkg = await readFormat(load('sqlite-dump.sql.txt'), 'x.sql');
    expect(rowsOf(pkg, 'accounts')).toHaveLength(2);
  });
});

describe('accounting formats', () => {
  it('QuickBooks IIF: TRNS+SPL → one balanced voucher, hint to journal lines', async () => {
    const pkg = await readFormat(load('quickbooks.iif'), 'x.iif');
    const journal = pkg.tables.find((t) => t.name === 'JOURNAL');
    expect(journal?.hint?.entity).toBe('accounting-journal-lines');
    const rows = rowsOf(pkg, 'JOURNAL');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ 'Voucher No': 'JV-1', Date: '2024-10-06', 'Account Code': 'Cash', Debit: '500' });
    expect(rows[1]).toMatchObject({ 'Account Code': 'Sales', Credit: '500' });
    expect(pkg.tables.map((t) => t.name)).toEqual(expect.arrayContaining(['ACCNT', 'TRNS', 'SPL']));
  });

  it('OFX (SGML): transactions, signed amounts, ISO dates, bank-statement hint', async () => {
    const pkg = await readFormat(load('bank.ofx'), 'x.ofx');
    const t = pkg.tables.find((x) => x.name === 'bank_transactions');
    expect(t?.hint?.entity).toBe('bank-statement');
    const rows = rowsOf(pkg, 'bank_transactions');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ Date: '2024-10-03', Amount: '-45.5', Reference: 'A1' });
    expect(rows[0].Description).toBe('Coffee shop — Card 1234');
    expect(rowsOf(pkg, 'account_info').some((r) => r.Field === 'ACCTID')).toBe(true);
  });
});

describe('guide-only formats are detected and refused with a Persian how-to', () => {
  it('Access', async () => {
    await expect(readFormat(load('stub-access.mdb'), 'x.mdb')).rejects.toThrow(/Access/);
  });
  it('SQL Server backup points to T-SQL scripts', async () => {
    await expect(readFormat(load('stub-sqlserver.bak.bin'), 'x.bak')).rejects.toThrow(/Generate Scripts/);
  });
  it('pg_dump custom', async () => {
    await expect(readFormat(load('stub-pgdump-custom.dump'), 'x.dump')).rejects.toThrow(/pg_restore/);
  });
  it('Iran System-like bytes are refused, not mangled', async () => {
    await expect(readFormat(load('iran-system-like.csv'), 'x.csv')).rejects.toThrow(/رمزگذاری/);
  });
});
