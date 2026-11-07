import { formatJalaliDate, formatNumber } from "../fa-format.ts";
import type { InvoiceResponseDto } from "../../types/invoicing.ts";

const amount = (value: number): string => (value ? formatNumber(value) : "");

/**
 * Data for print-templates/pos-receipt-80mm. The POS sale response carries the invoice only, so
 * these fields stay empty rather than guessed: the separate clock time, the cashier, the payment
 * split (the response has no payment lines), the change, the Moadian tax id and tracking code, and
 * the footer text. A POS sale stores only the tenant name in sellerInfo, so the shop address,
 * phone and economic code are empty too. A zero discount is left empty so the template hides it.
 */
export function mapInvoiceToPosReceiptData(invoice: InvoiceResponseDto): Record<string, unknown> {
  return {
    shop: {
      name: invoice.sellerInfo?.name ?? "",
      address: invoice.sellerInfo?.address ?? "",
      phone: invoice.sellerInfo?.phone ?? "",
      economicCode: invoice.sellerInfo?.economicCode ?? "",
    },
    receiptNumber: invoice.taxInvoiceNumber,
    dateJalali: formatJalaliDate(invoice.issuedAt ?? invoice.createdAt),
    time: "",
    cashier: "",
    lines: invoice.items.map((item) => ({
      name: item.description,
      quantity: formatNumber(item.quantity),
      unitPrice: formatNumber(item.unitPrice),
      lineTotal: formatNumber(item.total),
    })),
    subtotal: formatNumber(invoice.totalAmount),
    discount: amount(invoice.totalDiscount),
    vat: formatNumber(invoice.totalTax),
    total: formatNumber(invoice.finalPayable),
    payments: [],
    change: "",
    taxId: "",
    trackingCode: "",
    footerText: "",
  };
}
