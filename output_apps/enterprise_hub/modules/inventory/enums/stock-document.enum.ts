/** What a stock document records. */
export enum StockDocumentType {
  OPENING = 'OPENING',
  PURCHASE_RECEIPT = 'PURCHASE_RECEIPT',
  SALES_DELIVERY = 'SALES_DELIVERY',
  ADJUSTMENT = 'ADJUSTMENT',
  TRANSFER = 'TRANSFER',
}

export enum StockDocumentStatus {
  DRAFT = 'DRAFT',
  POSTED = 'POSTED',
}

export const STOCK_DOCUMENT_TYPE_LABELS: Record<StockDocumentType, string> = {
  [StockDocumentType.OPENING]: 'رسید افتتاحیه',
  [StockDocumentType.PURCHASE_RECEIPT]: 'رسید خرید',
  [StockDocumentType.SALES_DELIVERY]: 'حواله فروش',
  [StockDocumentType.ADJUSTMENT]: 'تعدیل موجودی',
  [StockDocumentType.TRANSFER]: 'انتقال بین انبارها',
};

/** Prefix of the generated document number, per type. */
export const STOCK_DOCUMENT_PREFIX: Record<StockDocumentType, string> = {
  [StockDocumentType.OPENING]: 'OP',
  [StockDocumentType.PURCHASE_RECEIPT]: 'PR',
  [StockDocumentType.SALES_DELIVERY]: 'SD',
  [StockDocumentType.ADJUSTMENT]: 'AJ',
  [StockDocumentType.TRANSFER]: 'TR',
};
