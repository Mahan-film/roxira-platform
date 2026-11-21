import { SALES_INVOICE_A4_TEMPLATE } from '../../print-templates/sales-invoice-a4.template.ts';
import type { SalesQuotationResponseDto } from '../../types/quotation.ts';
import { renderTemplate } from './render-template.ts';
import { mapQuotationToSalesInvoiceA4Data, type QuotationPrintMeta } from './quotation.ts';

/**
 * Opens the quotation in its own window using T81 print templates and starts printing.
 */
export function printQuotation(
  quotation: SalesQuotationResponseDto,
  meta?: QuotationPrintMeta,
): void {
  const html = renderTemplate(
    SALES_INVOICE_A4_TEMPLATE,
    mapQuotationToSalesInvoiceA4Data(quotation, meta),
  );
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.onafterprint = () => printWindow.close();
  printWindow.print();
}
