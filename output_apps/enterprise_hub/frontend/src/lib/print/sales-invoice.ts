import { formatJalaliDate, formatMoneyRial, formatNumber } from "../fa-format.ts";
import { integerToPersianWords } from "../persian-words.ts";
import {
  CURRENCY_LABELS,
  EInvoiceType,
  EINVOICE_TYPE_LABELS,
  InvoiceStatus,
  invoiceRialEquivalent,
  isForeignInvoice,
  type InvoiceResponseDto,
} from "../../types/invoicing.ts";

import { safeLogoUrl } from "./safe-url.ts";
import type { PrintColumnConfig } from "../../types/print-template.ts";

/** The Moadian e-invoice types; any other value (there is no "none" member) is not an e-invoice. */
const MOADIAN_TYPES: readonly EInvoiceType[] = [
  EInvoiceType.WITH_BUYER,
  EInvoiceType.WITHOUT_BUYER,
  EInvoiceType.RETAIL,
];

export interface SalesInvoicePrintCustomOptions {
  docTitle?: string;
  logoUrl?: string;
  footerText?: string;
  notes?: string;
  showLogo?: boolean;
  columnsConfig?: PrintColumnConfig[];
}

/**
 * Data for print-templates/sales-invoice-a4. The API carries no Moadian tax id, tracking code,
 * send status, pattern, reference id, QR, logo, footer, notes, settlement split or postal codes,
 * so those stay empty and are filled by hand rather than guessed here.
 */
export function mapInvoiceToSalesInvoiceA4Data(
  invoice: InvoiceResponseDto,
  statusLabel: string,
  options?: SalesInvoicePrintCustomOptions,
): Record<string, unknown> {
  const foreign = isForeignInvoice(invoice);
  const isEinvoice = MOADIAN_TYPES.includes(invoice.einvoiceType);
  const logo = options?.showLogo === false ? "" : safeLogoUrl(options?.logoUrl);

  return {
    docTitle: options?.docTitle || "فاکتور فروش",
    invoiceNumber: invoice.taxInvoiceNumber,
    issueDateJalali: formatJalaliDate(invoice.issuedAt ?? invoice.createdAt),
    issueTime: "",
    statusLabel,
    isDraft: invoice.status === InvoiceStatus.DRAFT,
    isEinvoice,
    einvoiceType: isEinvoice ? EINVOICE_TYPE_LABELS[invoice.einvoiceType] : "",
    taxId: "",
    trackingCode: "",
    sendStatusText: "",
    pattern: "",
    relatedTaxId: "",
    qrSvg: "",
    showQr: false,
    logoUrl: logo,
    footerText: options?.footerText ?? "",
    notes: options?.notes ?? "",
    settlementMethod: "",
    cashAmount: "",
    creditAmount: "",
    seller: {
      name: invoice.sellerInfo?.name ?? "",
      economicCode: invoice.sellerInfo?.economicCode ?? "",
      nationalId: invoice.sellerInfo?.nationalId ?? "",
      registrationNumber: invoice.sellerInfo?.registrationNumber ?? "",
      postalCode: "",
      address: invoice.sellerInfo?.address ?? "",
      phone: invoice.sellerInfo?.phone ?? "",
      branchCode: "",
    },
    buyer: {
      name: invoice.buyerInfo?.name ?? "",
      economicCode: invoice.buyerInfo?.economicCode ?? "",
      nationalId: invoice.buyerInfo?.nationalId ?? "",
      registrationNumber: invoice.buyerInfo?.registrationNumber ?? "",
      postalCode: "",
      address: invoice.buyerInfo?.address ?? "",
      phone: invoice.buyerInfo?.phone ?? "",
    },
    extraHeaderFacts: "",
    lines: invoice.items.map((item, index) => ({
      row: formatNumber(index + 1),
      itemId: item.sku ?? "",
      description: item.description,
      quantity: formatNumber(item.quantity),
      unit: "",
      unitPrice: formatNumber(item.unitPrice),
      amountBeforeDiscount: "",
      discount: formatNumber(item.discount),
      amountAfterDiscount: "",
      vatRate: formatNumber(item.vatRate * 100) + "٪",
      vatAmount: "",
      lineTotal: formatNumber(item.total),
    })),
    totals: {
      beforeDiscount: formatNumber(invoice.totalAmount),
      discount: formatNumber(invoice.totalDiscount),
      afterDiscount: formatNumber(invoice.totalAmount - invoice.totalDiscount),
      vat: formatNumber(invoice.totalTax),
      otherTaxes: "",
      grand: formatNumber(invoice.finalPayable),
      grandInWords: `${integerToPersianWords(BigInt(Math.round(invoice.finalPayable)))} ریال`,
    },
    currencyLabel: CURRENCY_LABELS[invoice.currency] ?? invoice.currency,
    isForeign: foreign,
    foreignTotalText: foreign ? `${formatNumber(invoice.amountFx ?? 0)} ${invoice.currency}` : "",
    rialEquivalentText: foreign ? formatMoneyRial(invoiceRialEquivalent(invoice)) : "",
  };
}
