import { SALES_INVOICE_A4_TEMPLATE } from "../../print-templates/sales-invoice-a4.template.ts";
import { SALES_INVOICE_A5_TEMPLATE } from "../../print-templates/sales-invoice-a5.template.ts";
import type { InvoiceResponseDto } from "../../types/invoicing.ts";
import type { PrintTemplateDto } from "../../types/print-template.ts";

import { renderTemplate } from "./render-template.ts";
import { mapInvoiceToSalesInvoiceA4Data, SalesInvoicePrintCustomOptions } from "./sales-invoice.ts";

/** Opens the sales invoice in its own window and starts printing. Does nothing if a pop-up blocker stops it. */
export function printSalesInvoice(
  invoice: InvoiceResponseDto,
  statusLabel: string,
  template?: Partial<PrintTemplateDto> | SalesInvoicePrintCustomOptions,
): void {
  const options: SalesInvoicePrintCustomOptions | undefined = template
    ? "title" in template || "showLogo" in template
      ? {
          docTitle: (template as Partial<PrintTemplateDto>).title,
          logoUrl: (template as Partial<PrintTemplateDto>).logoUrl ?? undefined,
          showLogo: (template as Partial<PrintTemplateDto>).showLogo,
          footerText: (template as Partial<PrintTemplateDto>).options?.footerNote,
        }
      : (template as SalesInvoicePrintCustomOptions)
    : undefined;

  const isA5 = (template as Partial<PrintTemplateDto>)?.paperSize === "A5";
  const tpl = isA5 ? SALES_INVOICE_A5_TEMPLATE : SALES_INVOICE_A4_TEMPLATE;
  const html = renderTemplate(tpl, mapInvoiceToSalesInvoiceA4Data(invoice, statusLabel, options));
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.onafterprint = () => printWindow.close();
  printWindow.print();
}
