import { RECEIPT_PAYMENT_VOUCHER_A5_TEMPLATE } from "../../print-templates/receipt-payment-voucher-a5.template";
import type { TreasuryDocumentDetail } from "../../types/treasury";
import type { PrintTemplateDto } from "../../types/print-template";
import { mapTreasuryDocToPrintData } from "./receipt-payment-voucher";
import { safeLogoUrl } from "./safe-url";
import { renderTemplate } from "./render-template";

/** Opens the receipt/payment voucher in its own window and starts printing. Does nothing if a pop-up blocker stops it. */
export function printReceiptPaymentVoucher(
  doc: TreasuryDocumentDetail,
  companyName = "",
  template?: Partial<PrintTemplateDto>,
): void {
  const data = mapTreasuryDocToPrintData(doc, companyName);
  if (template?.options?.headerTitle) {
    data.docTitle = template.options.headerTitle;
  }
  if (template?.logoUrl && template?.showLogo !== false) {
    data.logoUrl = safeLogoUrl(template.logoUrl);
  }
  if (template?.options?.footerNote) {
    data.footerText = template.options.footerNote;
  }
  const html = renderTemplate(
    RECEIPT_PAYMENT_VOUCHER_A5_TEMPLATE,
    data,
  );
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.onafterprint = () => printWindow.close();
  printWindow.print();
}
