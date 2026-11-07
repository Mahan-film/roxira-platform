import { WAREHOUSE_DOCUMENT_A4_TEMPLATE } from "../../print-templates/warehouse-document-a4.template.ts";
import type { StockDocument } from "../../types/inventory.ts";

import { renderTemplate } from "./render-template.ts";
import { mapStockDocumentToWarehouseA4Data } from "./warehouse-document.ts";

/** Opens the stock document in its own window and starts printing. Does nothing if a pop-up blocker stops it. */
export function printWarehouseDocument(
  doc: StockDocument,
  warehouseName: (id: number | null) => string,
): void {
  const html = renderTemplate(WAREHOUSE_DOCUMENT_A4_TEMPLATE, mapStockDocumentToWarehouseA4Data(doc, warehouseName));
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.onafterprint = () => printWindow.close();
  printWindow.print();
}
