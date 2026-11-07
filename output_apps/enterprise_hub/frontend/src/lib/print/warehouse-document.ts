import { formatJalaliDate, formatNumber } from "../fa-format.ts";
import type { StockDocument, StockDocumentType } from "../../types/inventory.ts";

/** Persian print title per document type, matching the template's `docTitle` list. */
const DOC_TITLES: Record<StockDocumentType, string> = {
  OPENING: "رسید انبار",
  PURCHASE_RECEIPT: "رسید انبار",
  SALES_DELIVERY: "حواله انبار",
  ADJUSTMENT: "سند تعدیل انبار",
  TRANSFER: "حواله انتقال بین انبارها",
};

/** The other side of the document, matching the template's `counterpartyLabel` list. */
const COUNTERPARTY_LABELS: Record<StockDocumentType, string> = {
  OPENING: "تأمین‌کننده",
  PURCHASE_RECEIPT: "تأمین‌کننده",
  SALES_DELIVERY: "مشتری",
  ADJUSTMENT: "واحد درخواست‌کننده",
  TRANSFER: "انبار مقصد",
};

/** Middle signature block: the party that hands the goods over or takes delivery of them. */
const RECEIVER_LABELS: Record<StockDocumentType, string> = {
  OPENING: "تحویل‌دهنده",
  PURCHASE_RECEIPT: "تحویل‌دهنده",
  SALES_DELIVERY: "تحویل‌گیرنده",
  ADJUSTMENT: "شمارنده",
  TRANSFER: "تحویل‌گیرنده",
};

/** Receipts, openings and adjustments book the goods into `toWarehouseId`; issues and transfers leave `fromWarehouseId`. */
function mainWarehouseId(doc: StockDocument): number | null {
  return doc.docType === "SALES_DELIVERY" || doc.docType === "TRANSFER" ? doc.fromWarehouseId : doc.toWarehouseId;
}

/**
 * Data for print-templates/warehouse-document-a4. The stock document API carries no company name,
 * accounting voucher number, carrier, item name, unit or line description, so those stay empty and
 * are filled by hand rather than guessed here. `warehouseName` resolves a warehouse id (the page
 * already holds the warehouse list); a transfer also fills `destinationWarehouse` and `counterparty`
 * from the destination id.
 */
export function mapStockDocumentToWarehouseA4Data(
  doc: StockDocument,
  warehouseName: (id: number | null) => string,
): Record<string, unknown> {
  const isTransfer = doc.docType === "TRANSFER";
  const lines = doc.lines ?? [];

  return {
    docTitle: DOC_TITLES[doc.docType],
    documentNumber: doc.docNumber,
    dateJalali: formatJalaliDate(doc.docDate),
    isDraft: doc.status === "DRAFT",
    hideCost: false,
    company: { name: "" },
    warehouse: { name: warehouseName(mainWarehouseId(doc)) },
    destinationWarehouse: isTransfer ? { name: warehouseName(doc.toWarehouseId) } : undefined,
    counterpartyLabel: COUNTERPARTY_LABELS[doc.docType],
    counterparty: { name: isTransfer ? warehouseName(doc.toWarehouseId) : "" },
    referenceNumber: doc.reference ?? "",
    voucherNumber: "",
    carrier: "",
    lines: lines.map((line, index) => ({
      row: formatNumber(index + 1),
      itemCode: line.sku,
      itemName: "",
      unit: "",
      quantity: formatNumber(line.quantity),
      unitCost: formatNumber(line.unitCost),
      amount: formatNumber(line.value),
      description: "",
    })),
    totals: {
      quantity: formatNumber(lines.reduce((sum, line) => sum + line.quantity, 0)),
      amount: formatNumber(doc.totalValue),
    },
    notes: doc.note ?? "",
    receiverLabel: RECEIVER_LABELS[doc.docType],
  };
}
