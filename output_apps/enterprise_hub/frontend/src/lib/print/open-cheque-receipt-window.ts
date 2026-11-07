import { CHEQUE_RECEIPT_A5_TEMPLATE } from "../../print-templates/cheque-receipt-a5.template.ts";
import type { Cheque } from "../../types/cheques.ts";

import { mapChequeToReceiptData } from "./cheque-receipt.ts";
import { renderTemplate } from "./render-template.ts";

/** Opens the cheque receipt in its own window and starts printing. Does nothing if a pop-up blocker stops it. */
export function printChequeReceipt(cheque: Cheque): void {
  const html = renderTemplate(CHEQUE_RECEIPT_A5_TEMPLATE, mapChequeToReceiptData(cheque));
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.onafterprint = () => printWindow.close();
  printWindow.print();
}
