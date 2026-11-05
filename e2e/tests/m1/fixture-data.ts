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

// --- Invoices.csv parsing and FIFO stock trace for gate steps 07 and 08 (pure, no product calls) ---

export interface FixtureInvoiceLine {
  itemCode: string;
  quantity: number;
  unitPrice: bigint;
  /** Line total excl. VAT («مبلغ»). */
  amount: bigint;
}

export interface FixtureInvoice {
  number: string;
  direction: 'SALE' | 'PURCHASE';
  date: string;
  /** «تسویه‌شده» (settled) versus «صادرشده» (issued/unpaid). */
  settled: boolean;
  lines: FixtureInvoiceLine[];
  /** Line totals incl. VAT («جمع نهایی (ریال)») over the unique rows of the invoice. */
  totalInclVat: bigint;
}

/** The 238 distinct invoices of invoices.csv: exact duplicate rows deduped, Persian digits parsed. */
export function parseFixtureInvoices(): FixtureInvoice[] {
  const { header, rows } = readCsv(SAMPLE_COMPANY_FILES.invoices);
  const west = (t: string) =>
    t
      .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  const cell = (row: string[], name: string) => west(row[header.indexOf(name)].trim());
  const unique = [...new Map(rows.map((r) => [r.join(','), r])).values()];
  const byNumber = new Map<string, FixtureInvoice>();
  for (const row of unique) {
    const number = cell(row, 'شماره صورتحساب');
    const type = cell(row, 'نوع صورتحساب');
    let invoice = byNumber.get(number);
    if (!invoice) {
      invoice = {
        number,
        direction: type === SALE ? 'SALE' : type === PURCHASE ? 'PURCHASE' : (() => {
          throw new Error(`unexpected invoice type «${type}» for ${number}`);
        })(),
        date: cell(row, 'تاریخ'),
        settled: cell(row, 'وضعیت تسویه') === SETTLED,
        lines: [],
        totalInclVat: 0n,
      };
      byNumber.set(number, invoice);
    }
    invoice.lines.push({
      itemCode: cell(row, 'کد کالا'),
      quantity: Number(cell(row, 'تعداد')),
      unitPrice: toRial(cell(row, 'بهای واحد (ریال)')),
      amount: toRial(cell(row, 'مبلغ')),
    });
    invoice.totalInclVat += toRial(cell(row, 'جمع نهایی (ریال)'));
  }
  return [...byNumber.values()];
}

/** Invoice date ascending, ties broken by invoice number (the posting order of steps 07 and 08). */
export function sortInvoices(invoices: FixtureInvoice[]): FixtureInvoice[] {
  return [...invoices].sort((a, b) => (a.date === b.date ? (a.number < b.number ? -1 : 1) : a.date < b.date ? -1 : 1));
}

export interface FifoTrace {
  /** «invoiceNumber sku xN» for every sale line that exceeds the running stock at its date. */
  oversold: string[];
  /** FIFO cost (rial) consumed by each sale invoice that did post. */
  consumedBySale: Map<string, bigint>;
  /** Remaining FIFO quantity and value per sku after every movement. */
  closingQuantityBySku: Map<string, bigint>;
  closingValueBySku: Map<string, bigint>;
  /** Sum of items.csv quantity x unitCost; must equal README_TOTALS.stockValue. */
  totalOpeningValue: bigint;
}

/** Sum of every purchase line excl. VAT («مبلغ») — the stock the purchases bring in. */
export function fifoPurchaseAmountSum(invoices: FixtureInvoice[]): bigint {
  return invoices
    .filter((i) => i.direction === 'PURCHASE')
    .reduce((acc, i) => acc + i.lines.reduce((a, l) => a + l.amount, 0n), 0n);
}

/**
 * Independent FIFO replay over the fixture: the items.csv opening batch per sku (oldest), then purchase
 * lines by invoice date ascending, consuming sale lines by invoice date ascending. A sale that exceeds
 * the running stock at its date moves no stock (its posting fails whole in the product).
 */
export function fifoStockTrace(invoices: FixtureInvoice[]): FifoTrace {
  const items = readCsv(SAMPLE_COMPANY_FILES.items);
  const iSku = items.header.indexOf('کد کالا');
  const iQty = items.header.indexOf('موجودی');
  const iCost = items.header.indexOf('بهای واحد (ریال)');
  const opening = new Map<string, { quantity: bigint; unitCost: bigint }>();
  for (const row of items.rows) opening.set(row[iSku], { quantity: toRial(row[iQty]), unitCost: toRial(row[iCost]) });

  const layers = new Map<string, Array<{ quantity: bigint; unitCost: bigint }>>();
  for (const [sku, o] of opening) layers.set(sku, [{ quantity: o.quantity, unitCost: o.unitCost }]);

  const oversold: string[] = [];
  const consumedBySale = new Map<string, bigint>();
  for (const invoice of sortInvoices(invoices)) {
    if (invoice.direction === 'PURCHASE') {
      for (const line of invoice.lines) {
        const stack = layers.get(line.itemCode) ?? [];
        stack.push({ quantity: BigInt(line.quantity), unitCost: line.unitPrice });
        layers.set(line.itemCode, stack);
      }
      continue;
    }
    const demand = new Map<string, bigint>();
    let covered = true;
    for (const line of invoice.lines) {
      let available = 0n;
      for (const layer of layers.get(line.itemCode) ?? []) available += layer.quantity;
      demand.set(line.itemCode, (demand.get(line.itemCode) ?? 0n) + BigInt(line.quantity));
      if ((demand.get(line.itemCode) ?? 0n) > available) {
        oversold.push(`${invoice.number} ${line.itemCode} x${line.quantity}`);
        covered = false;
      }
    }
    if (!covered) continue;
    let cost = 0n;
    for (const line of invoice.lines) {
      let need = BigInt(line.quantity);
      const stack = layers.get(line.itemCode)!;
      while (need > 0n) {
        const layer = stack[0];
        const take = layer.quantity < need ? layer.quantity : need;
        cost += take * layer.unitCost;
        layer.quantity -= take;
        need -= take;
        if (layer.quantity === 0n) stack.shift();
      }
    }
    consumedBySale.set(invoice.number, cost);
  }

  const closingQuantityBySku = new Map<string, bigint>();
  const closingValueBySku = new Map<string, bigint>();
  let totalOpeningValue = 0n;
  for (const [sku, stack] of layers) {
    closingQuantityBySku.set(sku, stack.reduce((acc, l) => acc + l.quantity, 0n));
    closingValueBySku.set(sku, stack.reduce((acc, l) => acc + l.quantity * l.unitCost, 0n));
    const o = opening.get(sku)!;
    totalOpeningValue += o.quantity * o.unitCost;
  }
  return { oversold, consumedBySale, closingQuantityBySku, closingValueBySku, totalOpeningValue };
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
