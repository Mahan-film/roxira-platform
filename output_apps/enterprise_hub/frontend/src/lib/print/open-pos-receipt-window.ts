import { POS_RECEIPT_80MM_TEMPLATE } from "../../print-templates/pos-receipt-80mm.template.ts";
import type { InvoiceResponseDto } from "../../types/invoicing.ts";

import { mapInvoiceToPosReceiptData } from "./pos-receipt.ts";
import { renderTemplate } from "./render-template.ts";

/** Opens the POS receipt in its own window and starts printing. Does nothing if a pop-up blocker stops it. */
export function printPosReceipt(invoice: InvoiceResponseDto): void {
  const html = renderTemplate(POS_RECEIPT_80MM_TEMPLATE, mapInvoiceToPosReceiptData(invoice));
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.onafterprint = () => printWindow.close();
  printWindow.print();
}
