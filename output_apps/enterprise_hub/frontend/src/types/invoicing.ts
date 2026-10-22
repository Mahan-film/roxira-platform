import { Currency } from "@/types/currency";

export enum InvoiceStatus {
  DRAFT = "DRAFT",
  ISSUED = "ISSUED",
  PAID = "PAID",
  CANCELLED = "CANCELLED",
}

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  [InvoiceStatus.DRAFT]: "پیش‌نویس",
  [InvoiceStatus.ISSUED]: "صادرشده",
  [InvoiceStatus.PAID]: "پرداخت‌شده",
  [InvoiceStatus.CANCELLED]: "ابطال‌شده",
};

/** نرخ پیش‌فرض مالیات بر ارزش افزوده (VAT) — منطبق با بک‌اند NestJS */
export const VAT_RATE = 0.1;

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
  itemId?: number | null;
  sku?: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  vatRate: number;
  tax: number;
  total: number;
}

export interface CreateInvoiceItemDto {
  itemId?: number;
  sku?: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  vatRate?: number;
}

export interface CreateInvoiceDto {
  taxInvoiceNumber: string;
  sellerInfo: InvoicePartyInfo;
  buyerInfo?: InvoicePartyInfo;
  customerId?: number;
  items: CreateInvoiceItemDto[];
  status?: InvoiceStatus;
  currency?: Currency;
}

export type CreateInvoiceRequest = CreateInvoiceDto;

export type UpdateInvoiceDto = Partial<CreateInvoiceDto>;

export interface InvoiceResponseDto {
  id: string;
  taxInvoiceNumber: string;
  customerId: number | null;
  sellerInfo: InvoicePartyInfo;
  buyerInfo: InvoicePartyInfo;
  items: InvoiceItem[];
  currency: Currency;
  exchangeRate: number;
  baseCurrency: Currency;
  totalAmount: number;
  totalDiscount: number;
  totalTax: number;
  finalPayable: number;
  baseTotalAmount: number;
  baseTotalTax: number;
  baseFinalPayable: number;
  status: InvoiceStatus;
  issuedAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

export type InvoiceResponse = InvoiceResponseDto;

export interface QueryInvoiceDto {
  page?: number;
  limit?: number;
  status?: InvoiceStatus;
  taxInvoiceNumber?: string;
  search?: string;
  currency?: Currency;
}

export type QueryInvoiceParams = QueryInvoiceDto;

export interface PaginatedInvoiceResponse {
  data: InvoiceResponseDto[];
  total: number;
  page: number;
  limit: number;
}
