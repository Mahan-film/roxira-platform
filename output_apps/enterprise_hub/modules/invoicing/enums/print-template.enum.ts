export enum PrintDocType {
  SALES_INVOICE = 'sales_invoice',
  RECEIPT_PAYMENT_VOUCHER = 'receipt_payment_voucher',
  STOCK_DOCUMENT = 'stock_document',
  BARCODE_LABELS = 'barcode_labels',
}

export enum PrintPaperSize {
  A4 = 'A4',
  A5 = 'A5',
  THERMAL_80MM = 'THERMAL_80MM',
}

export const PRINT_DOC_TYPE_LABELS: Record<PrintDocType, string> = {
  [PrintDocType.SALES_INVOICE]: 'فاکتور فروش',
  [PrintDocType.RECEIPT_PAYMENT_VOUCHER]: 'سند دریافت و پرداخت (خزانه‌داری)',
  [PrintDocType.STOCK_DOCUMENT]: 'اسناد و حواله انبار',
  [PrintDocType.BARCODE_LABELS]: 'برچسب بارکد کالا',
};

export const PRINT_PAPER_SIZE_LABELS: Record<PrintPaperSize, string> = {
  [PrintPaperSize.A4]: 'A4 (عمودی)',
  [PrintPaperSize.A5]: 'A5 (افقی / عمودی)',
  [PrintPaperSize.THERMAL_80MM]: 'حرارتی ۸۰ میلی‌متری (فیش‌پرینتر)',
};
