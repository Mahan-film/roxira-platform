/**
 * Pure 3-way match rules for a supplier invoice (#227 T2, docs/accounting/PURCHASE_CYCLE.md).
 *
 * The order says what was bought at what price, the receipt says what arrived, the invoice says what
 * the supplier charges. No I/O here: the service loads the facts, these functions decide and value the
 * posting. All arithmetic is exact bigint (quantities in hundredths, money in minor units).
 */
import { lineValue } from './purchase-order.domain';
import { PurchaseSettings } from './purchase.types';

export type MatchStatus = 'MATCHED' | 'QTY_MISMATCH' | 'PRICE_MISMATCH' | 'QTY_AND_PRICE_MISMATCH';

export type InvoiceMatchStatus = 'MATCHED' | 'HELD';

export interface InvoiceLineInput {
  receiptLineId: string;
  /** Hundredths of a unit. */
  quantity: bigint;
  /** Minor units per whole unit, before VAT. */
  unitPrice: bigint;
}

export interface InvoiceLineFacts {
  /** PO price of the matching order line, minor units per whole unit. */
  orderUnitPrice: bigint;
  /** Quantity on the receipt line, hundredths of a unit. */
  receivedQuantity: bigint;
  /** Invoiced so far on this receipt line by other invoices, hundredths of a unit. */
  alreadyInvoicedQuantity: bigint;
  /** This invoice line, hundredths of a unit. */
  quantity: bigint;
  /** This invoice line, minor units per whole unit. */
  unitPrice: bigint;
}

export interface InvoiceLineMatch {
  status: MatchStatus;
  /** Quantity invoiced beyond what was received; 0 when there is none. */
  qtyExcess: bigint;
  /** Invoice quantity valued at the PO price, minor units. */
  orderValue: bigint;
  /** Invoice quantity valued at the invoice price, minor units. */
  invoiceValue: bigint;
  /** invoiceValue - orderValue, signed (positive means the supplier charges more). */
  priceDifference: bigint;
}

export type InvoiceTolerance = Pick<PurchaseSettings, 'priceToleranceBp' | 'priceToleranceAbs'> & {
  /** Allowed excess of the invoiced quantity over the received quantity, in basis points (100 = 1%). */
  qtyExcessToleranceBp?: number;
};

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/**
 * Matches one invoice line against the receipt and the PO price. Quantity mismatch when the invoice
 * (including other invoices for the same receipt line) exceeds what was received by more than the
 * quantity allowance. Price mismatch when the absolute difference is strictly greater than the larger
 * of the percentage and absolute tolerance.
 */
export function matchInvoiceLine(facts: InvoiceLineFacts, settings: InvoiceTolerance): InvoiceLineMatch {
  const orderValue = lineValue(facts.quantity, facts.orderUnitPrice);
  const invoiceValue = lineValue(facts.quantity, facts.unitPrice);
  const priceDifference = invoiceValue - orderValue;

  const invoicedTotal = facts.alreadyInvoicedQuantity + facts.quantity;
  const qtyExcess =
    invoicedTotal > facts.receivedQuantity ? invoicedTotal - facts.receivedQuantity : 0n;

  const toleranceBp = BigInt(Math.max(0, Math.trunc(settings.priceToleranceBp ?? 0)));
  const percentTolerance = (orderValue * toleranceBp) / 10_000n;
  const absoluteTolerance = settings.priceToleranceAbs ?? 0n;
  const allowed = percentTolerance > absoluteTolerance ? percentTolerance : absoluteTolerance;

  // A small over-invoice is allowed; the real excess is still reported so it stays visible.
  const qtyToleranceBp = BigInt(Math.max(0, Math.trunc(settings.qtyExcessToleranceBp ?? 0)));
  const allowedExcess = (facts.receivedQuantity * qtyToleranceBp) / 10_000n;

  const qtyMismatch = qtyExcess > allowedExcess;
  const priceMismatch = abs(priceDifference) > allowed;

  const status: MatchStatus = qtyMismatch
    ? priceMismatch
      ? 'QTY_AND_PRICE_MISMATCH'
      : 'QTY_MISMATCH'
    : priceMismatch
      ? 'PRICE_MISMATCH'
      : 'MATCHED';

  return { status, qtyExcess, orderValue, invoiceValue, priceDifference };
}

/** An invoice is MATCHED only when every line matched; one mismatch holds the whole invoice. */
export function matchInvoice(lines: readonly Pick<InvoiceLineMatch, 'status'>[]): InvoiceMatchStatus {
  return lines.every((line) => line.status === 'MATCHED') ? 'MATCHED' : 'HELD';
}

export interface InvoicePostingTotals {
  /** Receipt value at PO price, debit GRNI. */
  grniDebit: bigint;
  /** Sum of price differences, signed (positive = debit PRICE_VARIANCE, negative = credit). */
  varianceNet: bigint;
  vat: bigint;
  /** Supplier payable: invoice values plus VAT. */
  payable: bigint;
}

/** Amounts an invoice feeds the posting engine: GRNI clearing, price variance, VAT and payable. */
export function invoicePostingTotals(
  lines: readonly Pick<InvoiceLineMatch, 'orderValue' | 'invoiceValue' | 'priceDifference'>[],
  vat: bigint,
): InvoicePostingTotals {
  const grniDebit = lines.reduce((sum, line) => sum + line.orderValue, 0n);
  const varianceNet = lines.reduce((sum, line) => sum + line.priceDifference, 0n);
  const invoiceTotal = lines.reduce((sum, line) => sum + line.invoiceValue, 0n);
  return { grniDebit, varianceNet, vat, payable: invoiceTotal + vat };
}