import { InvoiceEntity } from '../../invoicing/entities/invoice.entity';
import { DraftInvoice } from '../../invoice_capture/domain/capture.types';
import { convertMinor, parseAmountMinor } from '../../invoice_capture/domain/normalise';
import { CaptureDocumentEntity } from '../../invoice_capture/entities/capture.entities';
import { invoiceRialAmounts } from './invoice-rial-amounts';

/** One purchase document of the season, in exact rial minor units. */
export interface PurchaseAmounts {
  source: 'invoice' | 'capture';
  documentNumber: string;
  /** Gregorian `YYYY-MM-DD` (Tehran calendar day) used for display and ordering. */
  date: string;
  sellerName: string;
  sellerTaxId: string;
  baseMinor: bigint;
  vatMinor: bigint;
}

/** Purchase invoice (direction PURCHASE): same rial amounts as its issued journal entry. */
export function purchaseFromInvoice(invoice: InvoiceEntity, tehranDay: string): PurchaseAmounts {
  const amounts = invoiceRialAmounts(invoice);
  return {
    source: 'invoice',
    documentNumber: invoice.taxInvoiceNumber ?? '',
    date: tehranDay,
    sellerName: invoice.sellerInfo?.name ?? '',
    sellerTaxId: invoice.sellerInfo?.nationalId ?? '',
    baseMinor: amounts.salesMinor,
    vatMinor: amounts.vatMinor,
  };
}

/**
 * Posted capture document of kind purchase. Converted exactly like `buildVoucher`: each item total and
 * the tax are converted once with the draft's fx rate, so the report agrees with the posted voucher.
 * Returns null when an amount is unreadable (a posted draft was validated, so this should not happen).
 */
export function purchaseFromCapture(doc: CaptureDocumentEntity): PurchaseAmounts | null {
  const stored = doc.extracted as unknown as { draft?: DraftInvoice };
  const draft = ((doc.edited as unknown as DraftInvoice | null) ?? stored.draft) as DraftInvoice | undefined;
  if (!draft || !draft.date) return null;
  const rate = draft.currency === 'IRR' ? null : draft.fxRate;
  if (draft.currency !== 'IRR' && !rate) return null;
  try {
    const toIrr = (value: bigint): bigint => (rate ? convertMinor(value, rate) : value);
    let base = 0n;
    for (const item of draft.items) {
      const minor = parseAmountMinor(item.total);
      if (minor === null) return null;
      base += toIrr(minor);
    }
    const tax = parseAmountMinor(draft.tax);
    if (tax === null) return null;
    return {
      source: 'capture',
      documentNumber: draft.invoiceNumber ?? '',
      date: draft.date,
      sellerName: draft.sellerName ?? '',
      sellerTaxId: draft.sellerTaxId ?? '',
      baseMinor: base,
      vatMinor: toIrr(tax),
    };
  } catch {
    return null;
  }
}
