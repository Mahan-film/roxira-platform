import { RECEIPT_PAYMENT_VOUCHER_A5_TEMPLATE } from "../../print-templates/receipt-payment-voucher-a5.template";
import type { TreasuryDocumentDetail } from "../../types/treasury";
import { mapTreasuryDocToPrintData } from "./receipt-payment-voucher";
import { renderTemplate } from "./render-template";

/** Opens the receipt/payment voucher in its own window and starts printing. Does nothing if a pop-up blocker stops it. */
export function printReceiptPaymentVoucher(
  doc: TreasuryDocumentDetail,
  companyName = "",
): void {
  const html = renderTemplate(
    RECEIPT_PAYMENT_VOUCHER_A5_TEMPLATE,
    mapTreasuryDocToPrintData(doc, companyName),
  );
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.onafterprint = () => printWindow.close();
  printWindow.print();
}
