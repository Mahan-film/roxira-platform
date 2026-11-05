/* Frozen copy of invoice-posting.service.ts before the posting rules engine (#230), only to prove identical vouchers. Do not edit. */
import { minorToDecimal, parseScaled, toMinor } from '../../accounting/money';

export interface LegacyLine {
  accountCode: string;
  debit?: string;
  credit?: string;
  description: string;
}

export interface LegacyAccounts {
  receivable: string;
  sales: string;
  vat: string;
  cash: string;
  inventory: string;
  cogs: string;
  purchases: string;
  payable: string;
  vatReceivable: string;
  posClearing: string;
}

export interface LegacyAmounts {
  receivable: bigint;
  vat: bigint;
  net: bigint;
  stock: bigint;
}

/** The slice of an invoice the old line building looked at. */
export interface LegacyInvoice {
  sale: boolean;
  taxInvoiceNumber: string;
  fxRate: number;
  payments: Array<{ method: string; amount: number }> | null;
}

const round = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const resolveFxRate = (invoice: LegacyInvoice): number => {
  const rate = Number(invoice.fxRate);
  return Number.isFinite(rate) && rate > 0 ? rate : 1;
};

/** Rial minor units: invoice-currency amount x fx rate (6 decimals), rounded half-up. */
export function legacyRialMinor(invoice: LegacyInvoice, amount: number): bigint {
  const amountMinor = toMinor(round(Number(amount ?? 0)));
  const rate = parseScaled(resolveFxRate(invoice).toFixed(6), 6);
  const product = amountMinor * rate;
  const divisor = 1_000_000n;
  return (product + (product < 0n ? -divisor / 2n : divisor / 2n)) / divisor;
}

/** Signed debits to ledger lines; zero amounts are dropped. */
function toLines(rows: Array<[string, bigint, string]>): LegacyLine[] {
  const lines: LegacyLine[] = [];
  for (const [accountCode, debit, description] of rows) {
    if (debit > 0n) {
      lines.push({ accountCode, debit: minorToDecimal(debit), description });
    } else if (debit < 0n) {
      lines.push({ accountCode, credit: minorToDecimal(-debit), description });
    }
  }
  // Debits first, then credits (stable): the order a bookkeeper reads a voucher in.
  return [
    ...lines.filter((line) => line.debit !== undefined),
    ...lines.filter((line) => line.debit === undefined),
  ];
}

export function legacyDocumentLines(
  invoice: LegacyInvoice,
  amounts: LegacyAmounts,
  accounts: LegacyAccounts,
  reverse: boolean,
): LegacyLine[] {
  const sign = reverse ? -1n : 1n;
  const rows: Array<[string, bigint, string]> = invoice.sale
    ? [
        [accounts.receivable, amounts.receivable, `صدور صورتحساب ${invoice.taxInvoiceNumber}`],
        [accounts.sales, -amounts.net, 'درآمد فروش'],
        [accounts.vat, -amounts.vat, 'مالیات بر ارزش افزوده پرداختنی'],
        [accounts.inventory, amounts.stock, 'تغییر موجودی کالا'],
        [accounts.cogs, -amounts.stock, 'بهای تمام‌شده کالای فروش‌رفته'],
      ]
    : [
        [accounts.inventory, amounts.stock, 'ورود کالا به انبار'],
        [accounts.purchases, amounts.net - amounts.stock, 'خرید کالا و خدمات'],
        [accounts.vatReceivable, amounts.vat, 'مالیات بر ارزش افزوده خرید'],
        [accounts.payable, -amounts.receivable, `بدهی بابت صورتحساب ${invoice.taxInvoiceNumber}`],
      ];
  return toLines(rows.map(([code, debit, text]) => [code, debit * sign, text]));
}

export function legacySplitPayments(invoice: LegacyInvoice, owed: bigint): Array<[string, bigint]> {
  const payments = invoice.payments ?? [];
  if (payments.length === 0) {
    return [['CASH', owed]];
  }
  const parts: Array<[string, bigint]> = [];
  let assigned = 0n;
  payments.forEach((payment, index) => {
    const amount =
      index === payments.length - 1 ? owed - assigned : legacyRialMinor(invoice, payment.amount);
    assigned += amount;
    parts.push([payment.method, amount]);
  });
  return parts;
}

export function legacySettleLines(
  invoice: LegacyInvoice,
  owed: bigint,
  accounts: LegacyAccounts,
): LegacyLine[] {
  const sale = invoice.sale;
  // Sale: cash comes in, receivable falls. Purchase: payable falls, cash goes out.
  const sign = sale ? 1n : -1n;
  const split = legacySplitPayments(invoice, owed);
  return toLines([
    ...split.map(([method, amount]): [string, bigint, string] => [
      method === 'CARD' ? accounts.posClearing : accounts.cash,
      sign * amount,
      sale
        ? method === 'CARD'
          ? 'دریافت از طریق پوز'
          : 'دریافت نقدی/بانکی بابت صورتحساب'
        : 'پرداخت نقدی/بانکی بابت صورتحساب',
    ]),
    [
      sale ? accounts.receivable : accounts.payable,
      -sign * owed,
      sale ? 'تسویه حساب‌های دریافتنی' : 'تسویه حساب‌های پرداختنی',
    ],
  ]);
}
