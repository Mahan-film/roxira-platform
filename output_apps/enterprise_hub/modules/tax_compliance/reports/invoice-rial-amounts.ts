import { minorToDecimal, parseScaled, toMinor } from '../../accounting/money';
import { InvoiceEntity, InvoiceItem } from '../../invoicing/entities/invoice.entity';

export { minorToDecimal };

/**
 * Rial amounts of an invoice in exact minor units, identical to
 * `InvoicePostingService.computeAmounts` (the issued journal entry): receivable and
 * VAT are each converted once (amount rounded to the cent x fx rate, half-up), and sales is the plug
 * `receivable - vat`. A parity test keeps the two in step so VAT reports and GL 4010/2xxx agree.
 */
export interface InvoiceRialAmounts {
  receivableMinor: bigint;
  vatMinor: bigint;
  salesMinor: bigint;
}

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

function fxRate(invoice: InvoiceEntity): number {
  const rate = Number(invoice.fxRate);
  return Number.isFinite(rate) && rate > 0 ? rate : 1;
}

export function rialMinor(invoice: InvoiceEntity, amount: number | string | null | undefined): bigint {
  const amountMinor = toMinor(round2(Number(amount ?? 0)));
  const rate = parseScaled(fxRate(invoice).toFixed(6), 6);
  const product = amountMinor * rate;
  const divisor = 1_000_000n;
  return (product + (product < 0n ? -divisor / 2n : divisor / 2n)) / divisor;
}

export function invoiceRialAmounts(invoice: InvoiceEntity): InvoiceRialAmounts {
  const receivableMinor = rialMinor(invoice, invoice.finalPayable);
  const vatMinor = rialMinor(invoice, invoice.totalTax);
  return { receivableMinor, vatMinor, salesMinor: receivableMinor - vatMinor };
}

export interface RateLine {
  rate: number;
  baseMinor: bigint;
  vatMinor: bigint;
}

/**
 * Per-line base and VAT in rial minor units, adjusted so the lines sum EXACTLY to the invoice-level
 * `salesMinor` / `vatMinor` (FX rounding residue goes to the largest line of each column). Without
 * this the rate breakdown could differ from the ledger by a few cents.
 */
export function invoiceRateLines(invoice: InvoiceEntity, amounts: InvoiceRialAmounts): RateLine[] {
  const items: InvoiceItem[] = invoice.items ?? [];
  const lines: RateLine[] = items.map((item) => ({
    rate: Number(item.vatRate) || 0,
    baseMinor: rialMinor(
      invoice,
      Number(item.quantity) * Number(item.unitPrice) - Number(item.discount),
    ),
    vatMinor: rialMinor(invoice, item.tax),
  }));
  if (lines.length === 0) return lines;
  const adjust = (key: 'baseMinor' | 'vatMinor', target: bigint): void => {
    const sum = lines.reduce((acc, line) => acc + line[key], 0n);
    const residue = target - sum;
    if (residue === 0n) return;
    let largest = lines[0];
    for (const line of lines) if (line[key] > largest[key]) largest = line;
    largest[key] += residue;
  };
  adjust('baseMinor', amounts.salesMinor);
  adjust('vatMinor', amounts.vatMinor);
  return lines;
}
