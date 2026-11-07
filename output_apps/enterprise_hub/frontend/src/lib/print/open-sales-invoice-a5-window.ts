import { SALES_INVOICE_A5_TEMPLATE } from "../../print-templates/sales-invoice-a5.template.ts";
import type { InvoiceResponseDto } from "../../types/invoicing.ts";

import { renderTemplate } from "./render-template.ts";
import { mapInvoiceToSalesInvoiceA5Data } from "./sales-invoice-a5.ts";

/** Opens the sales invoice in its own window and starts printing. Does nothing if a pop-up blocker stops it. */
export function printSalesInvoiceA5(invoice: InvoiceResponseDto, statusLabel: string): void {
  const html = renderTemplate(SALES_INVOICE_A5_TEMPLATE, mapInvoiceToSalesInvoiceA5Data(invoice, statusLabel));
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.onafterprint = () => printWindow.close();
  printWindow.print();
}
