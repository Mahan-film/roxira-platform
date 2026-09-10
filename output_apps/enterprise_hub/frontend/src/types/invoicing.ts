export enum InvoiceStatus {
  DRAFT = "DRAFT",
  ISSUED = "ISSUED",
  CANCELLED = "CANCELLED",
}

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  [InvoiceStatus.DRAFT]: "پیش‌نویس",
  [InvoiceStatus.ISSUED]: "صادرشده",
  [InvoiceStatus.CANCELLED]: "ابطال‌شده",
};

/** نرخ مالیات بر ارزش افزوده (VAT) - منطبق با ثابت VAT_RATE در بک‌اند NestJS */
export const VAT_RATE = 0.09;

export interface InvoicePartyInfo {
  name: string;
  nationalId?: string;
  economicCode?: string;
  registrationNumber?: string;
  address?: string;
  phone?: string;
  email?: string;
}

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  tax: number;
  total: number;
}

export interface CreateInvoiceItemDto {
  description: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
}

export interface CreateInvoiceDto {
  taxInvoiceNumber: string;
  sellerInfo: InvoicePartyInfo;
  buyerInfo: InvoicePartyInfo;
  items: CreateInvoiceItemDto[];
  status?: InvoiceStatus;
}

export type CreateInvoiceRequest = CreateInvoiceDto;

export interface InvoiceResponseDto {
  id: string;
  taxInvoiceNumber: string;
  sellerInfo: InvoicePartyInfo;
  buyerInfo: InvoicePartyInfo;
  items: InvoiceItem[];
  totalAmount: number;
  totalDiscount: number;
  totalTax: number;
  finalPayable: number;
  status: InvoiceStatus;
  createdAt: string;
}

export type InvoiceResponse = InvoiceResponseDto;

export interface QueryInvoiceDto {
  page?: number;
  limit?: number;
  status?: InvoiceStatus;
  taxInvoiceNumber?: string;
}

export type QueryInvoiceParams = QueryInvoiceDto;

export interface PaginatedInvoiceResponse {
  data: InvoiceResponseDto[];
  total: number;
  page: number;
  limit: number;
}
