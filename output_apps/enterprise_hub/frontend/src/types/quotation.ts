import type { InvoiceResponseDto } from './invoicing';

export type SalesQuotationStatus =
  | 'DRAFT'
  | 'SENT'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'CONVERTED'
  | 'EXPIRED';

export const QUOTATION_STATUS_LABELS: Record<SalesQuotationStatus, string> = {
  DRAFT: 'پیش‌نویس',
  SENT: 'ارسال‌شده',
  ACCEPTED: 'پذیرفته‌شده',
  REJECTED: 'رد شده',
  CONVERTED: 'تبدیل‌شده به فاکتور',
  EXPIRED: 'منقضی‌شده',
};

export interface QuotationLineDto {
  id?: number;
  lineNo: number;
  itemId: number;
  description: string | null;
  quantity: number;
  unitPrice: string | number;
  discount: string | number;
  lineTotal: string | number;
}

export interface SalesQuotationResponseDto {
  id: number;
  number: string;
  partyCode: string;
  quoteDate: string;
  validUntil: string | null;
  status: SalesQuotationStatus;
  note: string | null;
  totalAmount: string | number;
  createdBy: string | null;
  convertedInvoiceId?: string | null;
  createdAt: string;
  updatedAt: string;
  lines?: QuotationLineDto[];
}

export interface QuotationListResponseDto {
  data: SalesQuotationResponseDto[];
  total: number;
}

export interface CreateQuotationDto {
  partyCode: string;
  quoteDate: string;
  validUntil?: string;
  note?: string;
  lines: Array<{
    lineNo: number;
    itemId: number;
    quantity: number;
    unitPrice: string | number;
    discount?: number;
    description?: string;
  }>;
}

export interface ConvertQuotationToInvoiceDto {
  invoiceDate?: string;
  taxInvoiceNumber?: string;
  idempotencyKey?: string;
  warehouseId?: number;
}

export interface ConvertQuotationToInvoiceResponseDto {
  quotationId: number;
  quotationNumber: string;
  invoiceId: string;
  taxInvoiceNumber: string;
  status: string;
  partyCode: string;
  invoiceDate: string;
  totalAmount: string | number;
  totalTax: string | number;
  finalPayable: string | number;
  replayed: boolean;
  invoice: InvoiceResponseDto;
}
