import * as fs from 'node:fs';
import * as path from 'node:path';

import { README_ROW_LABELS, type SampleCompanyTotals } from './expected-totals';

/** e2e/fixtures/sample-company/ (synthetic data only). */
export const SAMPLE_COMPANY_DIR = path.resolve(__dirname, '../../fixtures/sample-company');

/** The files the M1 gate imports, in import order. */
export const SAMPLE_COMPANY_FILES = {
  chartOfAccounts: path.join(SAMPLE_COMPANY_DIR, 'chart-of-accounts.csv'),
  parties: path.join(SAMPLE_COMPANY_DIR, 'customers-suppliers.csv'),
  items: path.join(SAMPLE_COMPANY_DIR, 'items.csv'),
  openingBalances: path.join(SAMPLE_COMPANY_DIR, 'opening-balances.csv'),
  invoices: path.join(SAMPLE_COMPANY_DIR, 'invoices.csv'),
  bankStatement: path.join(SAMPLE_COMPANY_DIR, 'bank-statement.csv'),
} as const;

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** «۱۲٬۳۴۵» / «١٢,٣٤٥» / "12345" -> 12345n. Throws on anything that is not an integer. */
export function toRial(cell: string): bigint {
  const ascii = cell
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/[٬,\s]/g, '');
  if (!/^-?\d+$/.test(ascii)) throw new Error(`not an integer amount: ${JSON.stringify(cell)}`);
  return BigInt(ascii);
}

/** The fixture CSVs are UTF-8, comma-separated, without quoting (checked by the self-check). */
export function readCsv(file: string): { header: string[]; rows: string[][] } {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  if (text.includes('"')) throw new Error(`${file}: quoted CSV fields are not supported by this reader`);
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const [header, ...rows] = lines.map((line) => line.split(','));
  for (const row of rows) {
    if (row.length !== header.length) throw new Error(`${file}: row has ${row.length} cells, header ${header.length}`);
  }
  return { header, rows };
}

function column(header: string[], name: string): number {
  const index = header.indexOf(name);
  if (index < 0) throw new Error(`column ${name} not found in ${header.join(' | ')}`);
  return index;
}

/** Parse the «Expected Totals» table of README.md (the Raw Integer column) into the typed shape. */
export function readReadmeTotals(): SampleCompanyTotals {
  const readme = fs.readFileSync(path.join(SAMPLE_COMPANY_DIR, 'README.md'), 'utf8');
  const cells = readme
    .split('\n')
    .filter((line) => line.startsWith('| **'))
    .map((line) => line.split('|').map((cell) => cell.trim()));
  const entries = Object.entries(README_ROW_LABELS).map(([key, label]) => {
    const row = cells.find((c) => c[1].replace(/^\*\*/, '').startsWith(label));
    if (!row) throw new Error(`README.md has no totals row starting with ${label}`);
    return [key, toRial(row[3].replace(/`/g, ''))] as const;
  });
  return Object.fromEntries(entries) as unknown as SampleCompanyTotals;
}

const SETTLED = 'تسویه‌شده';
const SALE = 'فروش';
const PURCHASE = 'خرید';

/** Recompute every README total from the CSV files, the way an importer that drops exact duplicates must. */
export function computeTotalsFromCsv(): SampleCompanyTotals {
  const opening = readCsv(SAMPLE_COMPANY_FILES.openingBalances);
  const oAccount = column(opening.header, 'کد حساب');
  const oDebit = column(opening.header, 'بدهکار (ریال)');
  const oCredit = column(opening.header, 'بستانکار (ریال)');
  const openingOf = (account: string, side: number) =>
    opening.rows.filter((r) => r[oAccount] === account).reduce((acc, r) => acc + toRial(r[side]), 0n);

  const items = readCsv(SAMPLE_COMPANY_FILES.items);
  const iQty = column(items.header, 'موجودی');
  const iCost = column(items.header, 'بهای واحد (ریال)');

  const invoices = readCsv(SAMPLE_COMPANY_FILES.invoices);
  const vType = column(invoices.header, 'نوع صورتحساب');
  const vTotal = column(invoices.header, 'جمع نهایی (ریال)');
  const vStatus = column(invoices.header, 'وضعیت تسویه');
  const unpaid = (rows: string[][], type: string) =>
    rows.filter((r) => r[vType] === type && r[vStatus] !== SETTLED).reduce((acc, r) => acc + toRial(r[vTotal]), 0n);
  const uniqueRows = [...new Map(invoices.rows.map((r) => [r.join(','), r])).values()];

  const bank = readCsv(SAMPLE_COMPANY_FILES.bankStatement);
  const bBalance = column(bank.header, 'مانده');

  const receivablesOpening = openingOf('1201', oDebit);
  const payablesOpening = openingOf('2101', oCredit);
  return {
    openingDebit: opening.rows.reduce((acc, r) => acc + toRial(r[oDebit]), 0n),
    openingCredit: opening.rows.reduce((acc, r) => acc + toRial(r[oCredit]), 0n),
    receivablesOpening,
    receivablesClosingUnique: receivablesOpening + unpaid(uniqueRows, SALE),
    receivablesClosingRaw: receivablesOpening + unpaid(invoices.rows, SALE),
    payablesOpening,
    payablesClosingUnique: payablesOpening + unpaid(uniqueRows, PURCHASE),
    payablesClosingRaw: payablesOpening + unpaid(invoices.rows, PURCHASE),
    stockValue: items.rows.reduce((acc, r) => acc + toRial(r[iQty]) * toRial(r[iCost]), 0n),
    bankClosingBalance: toRial(bank.rows[bank.rows.length - 1][bBalance]),
  };
}

/** Bank statement running balance: opening 1101 + deposits - withdrawals must land on the last «مانده». */
export function bankStatementRollForward(): { opening: bigint; computedClosing: bigint; statedClosing: bigint } {
  const opening = readCsv(SAMPLE_COMPANY_FILES.openingBalances);
  const oAccount = column(opening.header, 'کد حساب');
  const oDebit = column(opening.header, 'بدهکار (ریال)');
  const open = opening.rows.filter((r) => r[oAccount] === '1101').reduce((acc, r) => acc + toRial(r[oDebit]), 0n);
  const bank = readCsv(SAMPLE_COMPANY_FILES.bankStatement);
  const out = column(bank.header, 'برداشت (بدهکار)');
  const inn = column(bank.header, 'واریز (بستانکار)');
  const bal = column(bank.header, 'مانده');
  const movement = bank.rows.reduce((acc, r) => acc + toRial(r[inn]) - toRial(r[out]), 0n);
  return { opening: open, computedClosing: open + movement, statedClosing: toRial(bank.rows[bank.rows.length - 1][bal]) };
}
