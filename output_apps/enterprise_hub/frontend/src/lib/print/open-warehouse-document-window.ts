import { WAREHOUSE_DOCUMENT_A4_TEMPLATE } from "../../print-templates/warehouse-document-a4.template.ts";
import type { StockDocument } from "../../types/inventory.ts";
import type { PrintTemplateDto } from "../../types/print-template.ts";

import { renderTemplate } from "./render-template.ts";
import { safeLogoUrl } from "./safe-url.ts";
import { mapStockDocumentToWarehouseA4Data } from "./warehouse-document.ts";

/** Opens the stock document in its own window and starts printing. Does nothing if a pop-up blocker stops it. */
export function printWarehouseDocument(
  doc: StockDocument,
  warehouseName: (id: number | null) => string,
  template?: Partial<PrintTemplateDto>,
): void {
  const data = mapStockDocumentToWarehouseA4Data(doc, warehouseName);
  if (template?.options?.headerTitle?.trim()) {
    data.docTitle = template.options.headerTitle.trim();
  }
  if (template?.logoUrl && template?.showLogo !== false) {
    data.logoUrl = safeLogoUrl(template.logoUrl);
  }
  if (template?.options?.footerNote) {
    data.footerText = template.options.footerNote;
  }
  const html = renderTemplate(WAREHOUSE_DOCUMENT_A4_TEMPLATE, data);
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.onafterprint = () => printWindow.close();
  printWindow.print();
}
