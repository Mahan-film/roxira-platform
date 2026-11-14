/**
 * تعاریف تایپ و قراردادهای قالب‌های چاپی و برچسب‌های بارکد (T81).
 * منطبق با بک‌اند NestJS (`PrintTemplateController`).
 */

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
  [PrintDocType.RECEIPT_PAYMENT_VOUCHER]: 'رسید دریافت / پرداخت',
  [PrintDocType.STOCK_DOCUMENT]: 'سند انبار (ورود/خروج)',
  [PrintDocType.BARCODE_LABELS]: 'برچسب بارکد کالا',
};

export const PRINT_PAPER_SIZE_LABELS: Record<PrintPaperSize, string> = {
  [PrintPaperSize.A4]: 'کاغذ A4',
  [PrintPaperSize.A5]: 'کاغذ A5',
  [PrintPaperSize.THERMAL_80MM]: 'رول حرارتی ۸۰ میلی‌متر',
};

export interface PrintColumnConfig {
  key: string;
  label: string;
  visible: boolean;
  order: number;
  widthPercent?: number;
}

export interface PrintTemplateOptions {
  headerTitle?: string;
  barcodeColumns?: number; // 4 یا 5 ستونه
  showPrice?: boolean;
  showSku?: boolean;
  showSignatures?: boolean;
  signatures?: string[];
  headerNote?: string;
  footerNote?: string;
}

export interface PrintTemplateDto {
  id: number;
  docType: PrintDocType;
  docTypeLabel?: string;
  paperSize: PrintPaperSize;
  paperSizeLabel?: string;
  title: string;
  isDefault: boolean;
  showLogo: boolean;
  logoUrl?: string | null;
  columnsConfig: PrintColumnConfig[];
  options: PrintTemplateOptions;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePrintTemplateDto {
  docType: PrintDocType;
  paperSize: PrintPaperSize;
  title: string;
  isDefault?: boolean;
  showLogo?: boolean;
  logoUrl?: string | null;
  columnsConfig?: PrintColumnConfig[];
  options?: PrintTemplateOptions;
}

export interface UpdatePrintTemplateDto {
  title?: string;
  isDefault?: boolean;
  showLogo?: boolean;
  logoUrl?: string | null;
  columnsConfig?: PrintColumnConfig[];
  options?: PrintTemplateOptions;
}

export interface BarcodeLabelItemDto {
  sku: string;
  barcode?: string;
  title: string;
  price?: string | number;
  count?: number;
}

export interface RenderBarcodeSheetDto {
  columns: 4 | 5;
  items: BarcodeLabelItemDto[];
  showPrice?: boolean;
  showSku?: boolean;
}
