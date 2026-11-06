import { SALES_INVOICE_A4_TEMPLATE } from "../../print-templates/sales-invoice-a4.template.ts";
import type { InvoiceResponseDto } from "../../types/invoicing.ts";

import { renderTemplate } from "./render-template.ts";
import { mapInvoiceToSalesInvoiceA4Data } from "./sales-invoice.ts";

/** Opens the sales invoice in its own window and starts printing. Does nothing if a pop-up blocker stops it. */
export function printSalesInvoice(invoice: InvoiceResponseDto, statusLabel: string): void {
  const html = renderTemplate(SALES_INVOICE_A4_TEMPLATE, mapInvoiceToSalesInvoiceA4Data(invoice, statusLabel));
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.onafterprint = () => printWindow.close();
  printWindow.print();
}
