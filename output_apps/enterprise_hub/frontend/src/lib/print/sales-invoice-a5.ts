import { formatJalaliDate, formatNumber } from "../fa-format.ts";
import { integerToPersianWords } from "../persian-words.ts";
import {
  CURRENCY_LABELS,
  EInvoiceType,
  InvoiceStatus,
  type InvoiceResponseDto,
} from "../../types/invoicing.ts";

/** The Moadian e-invoice types; any other value (there is no "none" member) is not an e-invoice. */
const MOADIAN_TYPES: readonly EInvoiceType[] = [
  EInvoiceType.WITH_BUYER,
  EInvoiceType.WITHOUT_BUYER,
  EInvoiceType.RETAIL,
];

/**
 * Data for print-templates/sales-invoice-a5. The API carries no Moadian tax id, tracking code,
 * buyer postal code, line unit of measure or settlement method, so those stay empty and are
 * filled by hand rather than guessed here. Like sales-invoice-a4, the per-line vat column
 * ({{vatAmount}}) stays empty; only the invoice-level tax total is printed.
 */
export function mapInvoiceToSalesInvoiceA5Data(
  invoice: InvoiceResponseDto,
  statusLabel: string,
): Record<string, unknown> {
  const isEinvoice = MOADIAN_TYPES.includes(invoice.einvoiceType);

  return {
    docTitle: "فاکتور فروش",
    invoiceNumber: invoice.taxInvoiceNumber,
    issueDateJalali: formatJalaliDate(invoice.issuedAt ?? invoice.createdAt),
    statusLabel,
    isDraft: invoice.status === InvoiceStatus.DRAFT,
    isEinvoice,
    taxId: "",
    trackingCode: "",
    seller: {
      name: invoice.sellerInfo?.name ?? "",
      economicCode: invoice.sellerInfo?.economicCode ?? "",
      nationalId: invoice.sellerInfo?.nationalId ?? "",
      address: invoice.sellerInfo?.address ?? "",
      phone: invoice.sellerInfo?.phone ?? "",
    },
    buyer: {
      name: invoice.buyerInfo?.name ?? "",
      economicCode: invoice.buyerInfo?.economicCode ?? "",
      nationalId: invoice.buyerInfo?.nationalId ?? "",
      postalCode: "",
      address: invoice.buyerInfo?.address ?? "",
    },
    lines: invoice.items.map((item, index) => ({
      row: formatNumber(index + 1),
      itemId: item.sku ?? "",
      description: item.description,
      quantity: formatNumber(item.quantity),
      unit: "",
      unitPrice: formatNumber(item.unitPrice),
      discount: formatNumber(item.discount),
      vatAmount: "",
      lineTotal: formatNumber(item.total),
    })),
    totals: {
      discount: formatNumber(invoice.totalDiscount),
      vat: formatNumber(invoice.totalTax),
      grand: formatNumber(invoice.finalPayable),
      grandInWords: `${integerToPersianWords(BigInt(Math.round(invoice.finalPayable)))} ریال`,
    },
    currencyLabel: CURRENCY_LABELS[invoice.currency] ?? invoice.currency,
    settlementMethod: "",
  };
}
