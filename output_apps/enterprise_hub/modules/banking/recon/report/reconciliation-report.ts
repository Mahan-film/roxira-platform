import { minorToDecimal } from '../../../accounting/money';
import { BankItem, BookItem } from '../matching/matcher';
import { rialToMinor } from '../rial';
import { buildXlsx, XlsxCell } from './xlsx-writer';

export interface ReportLine {
  date: string;
  /** Minor units (rial x 100). */
  amount: bigint;
  description: string;
  ref: string;
}

export interface ReconciliationStatement {
  bankAccountName: string;
  periodFrom: string;
  periodTo: string;
  /** Bank closing balance per the statement, minor units. */
  bankBalance: bigint;
  /** Ledger balance of the bank's GL account as of `periodTo`, minor units. */
  ledgerBalance: bigint;
  /** Book receipts not yet on the statement (deposits in transit). */
  depositsInTransit: ReportLine[];
  /** Book payments not yet on the statement (outstanding cheques / payments). */
  outstandingPayments: ReportLine[];
  /** Statement deposits not in the books. */
  bankOnlyDeposits: ReportLine[];
  /** Statement withdrawals not in the books. */
  bankOnlyWithdrawals: ReportLine[];
  adjustedBank: bigint;
  adjustedBook: bigint;
  /** adjustedBank - adjustedBook; zero when fully reconciled. */
  difference: bigint;
  unresolvedCount: number;
}

const sum = (lines: ReportLine[]) => lines.reduce((total, line) => total + line.amount, 0n);

/**
 * Bank reconciliation statement. Only *confirmed* matches clear an item; suggested groups are
 * still outstanding here, so the figures never rest on an unconfirmed guess.
 *
 *   adjusted bank = bank balance + deposits in transit - outstanding payments
 *   adjusted book = ledger balance + bank-only deposits - bank-only withdrawals
 */
export function buildReconciliationStatement(input: {
  bankAccountName: string;
  periodFrom: string;
  periodTo: string;
  bankBalance: bigint;
  ledgerBalance: bigint;
  unmatchedBank: BankItem[];
  unmatchedBook: BookItem[];
}): ReconciliationStatement {
  const fromBook = (item: BookItem): ReportLine => ({
    date: item.date,
    amount: item.amount,
    description: item.text.slice(0, 200),
    ref: item.entryNumber,
  });
  const fromBank = (item: BankItem): ReportLine => ({
    date: item.date,
    amount: item.amount,
    description: item.description.slice(0, 200),
    ref: item.reference ?? '',
  });
  const depositsInTransit = input.unmatchedBook.filter((b) => b.direction === 'in').map(fromBook);
  const outstandingPayments = input.unmatchedBook.filter((b) => b.direction === 'out').map(fromBook);
  const bankOnlyDeposits = input.unmatchedBank.filter((b) => b.direction === 'in').map(fromBank);
  const bankOnlyWithdrawals = input.unmatchedBank.filter((b) => b.direction === 'out').map(fromBank);
  const adjustedBank = input.bankBalance + sum(depositsInTransit) - sum(outstandingPayments);
  const adjustedBook = input.ledgerBalance + sum(bankOnlyDeposits) - sum(bankOnlyWithdrawals);
  return {
    bankAccountName: input.bankAccountName,
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    bankBalance: input.bankBalance,
    ledgerBalance: input.ledgerBalance,
    depositsInTransit,
    outstandingPayments,
    bankOnlyDeposits,
    bankOnlyWithdrawals,
    adjustedBank,
    adjustedBook,
    difference: adjustedBank - adjustedBook,
    unresolvedCount:
      depositsInTransit.length + outstandingPayments.length + bankOnlyDeposits.length + bankOnlyWithdrawals.length,
  };
}

/** Whole-rial text of minor units (the report is in rial; fractions only appear if present). */
export function fmt(minor: bigint): string {
  const text = minorToDecimal(minor);
  return text.endsWith('.00') ? text.slice(0, -3) : text;
}

function rows(report: ReconciliationStatement): XlsxCell[][] {
  const section = (title: string, lines: ReportLine[]): XlsxCell[][] => [
    [],
    [title, '', '', fmt(sum(lines))],
    ...lines.map((l): XlsxCell[] => [l.date, l.ref, l.description, fmt(l.amount)]),
  ];
  return [
    ['صورت مغایرت بانکی'],
    ['حساب', report.bankAccountName],
    ['دوره', `${report.periodFrom} تا ${report.periodTo}`],
    [],
    ['مانده طبق صورتحساب بانک', '', '', fmt(report.bankBalance)],
    ...section('+ واریزهای در راه (ثبت‌شده در دفتر، هنوز در بانک نیست)', report.depositsInTransit),
    ...section('- پرداخت‌های معوق (چک‌ها/پرداخت‌های ثبت‌شده در دفتر، هنوز در بانک نیست)', report.outstandingPayments),
    ['مانده تعدیل‌شده بانک', '', '', fmt(report.adjustedBank)],
    [],
    ['مانده طبق دفتر کل', '', '', fmt(report.ledgerBalance)],
    ...section('+ واریزهای بانک که در دفتر ثبت نشده', report.bankOnlyDeposits),
    ...section('- برداشت‌های بانک که در دفتر ثبت نشده', report.bankOnlyWithdrawals),
    ['مانده تعدیل‌شده دفتر', '', '', fmt(report.adjustedBook)],
    [],
    ['اختلاف', '', '', fmt(report.difference)],
  ];
}

export function reportToXlsx(report: ReconciliationStatement): Buffer {
  return buildXlsx([{ name: 'مغایرت بانکی', rows: rows(report) }]);
}

/** CSV with formula-injection guard (cells starting with = + - @ get a leading apostrophe). */
export function reportToCsv(report: ReconciliationStatement): string {
  const guard = (value: XlsxCell): string => {
    const text = value === null ? '' : String(value);
    const safe = /^[=+@\-\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text) ? `'${text}` : text;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return `﻿${rows(report).map((row) => row.map(guard).join(',')).join('\n')}\n`;
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Print-ready RTL page (the browser's «Save as PDF» produces the PDF; Persian shaping is native). */
export function reportToHtml(report: ReconciliationStatement): string {
  const table = rows(report)
    .map((row) =>
      row.length === 0
        ? '<tr><td colspan="4">&nbsp;</td></tr>'
        : `<tr>${[0, 1, 2, 3]
            .map((i) => `<td${i === 3 ? ' class="n"' : ''}>${esc(String(row[i] ?? ''))}</td>`)
            .join('')}</tr>`,
    )
    .join('');
  return (
    '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">' +
    '<title>صورت مغایرت بانکی</title><style>body{font-family:Tahoma,sans-serif;margin:24px}' +
    'table{border-collapse:collapse;width:100%}td{border-bottom:1px solid #ddd;padding:4px 8px;font-size:13px}' +
    '.n{text-align:left;direction:ltr;font-variant-numeric:tabular-nums}@media print{body{margin:0}}</style></head>' +
    `<body><table>${table}</table></body></html>`
  );
}

export { rialToMinor };
