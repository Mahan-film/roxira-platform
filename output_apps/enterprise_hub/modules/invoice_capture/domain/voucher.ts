import { CAPTURE_ACCOUNTS } from '../constants/capture.constants';
import { DraftInvoice, Voucher, VoucherLine } from './capture.types';
import { convertMinor, minorToString, parseAmountMinor } from './normalise';

export class VoucherBuildError extends Error {}

const need = (value: string, label: string): bigint => {
  const minor = parseAmountMinor(value);
  if (minor === null) {
    throw new VoucherBuildError(`${label} is not a valid amount`);
  }
  return minor;
};

/**
 * Balanced voucher from a validated draft, computed in exact minor units.
 * Purchase: Dr expense(s) + Dr input VAT / Cr payable (or cash when paid).
 * Sales:    Dr receivable (or cash when paid) / Cr revenue(s) + Cr output VAT.
 * Input VAT is booked on 2020 (VAT payable), where it offsets output VAT: the default chart has no
 * separate input-VAT account.
 */
export function buildVoucher(draft: DraftInvoice, defaultAccount: string): Voucher {
  if (!draft.date) {
    throw new VoucherBuildError('date is required');
  }
  const rate = draft.currency === 'IRR' ? null : draft.fxRate;
  if (draft.currency !== 'IRR' && !rate) {
    throw new VoucherBuildError('exchange rate is required for a non-IRR invoice');
  }
  const toIrr = (value: bigint): bigint => (rate ? convertMinor(value, rate) : value);

  const byAccount = new Map<string, bigint>();
  for (const item of draft.items) {
    const code = item.accountCode ?? defaultAccount;
    byAccount.set(code, (byAccount.get(code) ?? 0n) + toIrr(need(item.total, 'item total')));
  }
  const taxIrr = toIrr(need(draft.tax, 'tax'));
  const goods = [...byAccount.values()].reduce((s, v) => s + v, 0n);
  const grand = goods + taxIrr;

  const label = draft.kind === 'purchase' ? 'خرید' : 'فروش';
  const party = draft.kind === 'purchase' ? draft.sellerName : draft.buyerName;
  const partyCode = (draft.kind === 'purchase' ? draft.sellerTaxId : draft.buyerTaxId) || undefined;
  const base = `${label} ${party} فاکتور ${draft.invoiceNumber || 'بدون‌شماره'}`.slice(0, 240);
  const lines: VoucherLine[] = [];
  const line = (accountCode: string, debit: bigint, credit: bigint, extra = ''): void => {
    lines.push({
      accountCode,
      debit: minorToString(debit),
      credit: minorToString(credit),
      description: `${base}${extra}`.slice(0, 255),
      partyCode,
    });
  };

  if (draft.kind === 'purchase') {
    for (const [code, amount] of byAccount) {
      line(code, amount, 0n);
    }
    if (taxIrr > 0n) {
      line(CAPTURE_ACCOUNTS.vat, taxIrr, 0n, ' - مالیات');
    }
    line(draft.paid ? CAPTURE_ACCOUNTS.cash : CAPTURE_ACCOUNTS.payable, 0n, grand);
  } else {
    line(draft.paid ? CAPTURE_ACCOUNTS.cash : CAPTURE_ACCOUNTS.receivable, grand, 0n);
    for (const [code, amount] of byAccount) {
      line(code, 0n, amount);
    }
    if (taxIrr > 0n) {
      line(CAPTURE_ACCOUNTS.vat, 0n, taxIrr, ' - مالیات');
    }
  }
  return { description: base, date: draft.date, lines: lines.filter((l) => l.debit !== '0.00' || l.credit !== '0.00') };
}
