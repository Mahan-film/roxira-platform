import { Currency, isIranianCurrency } from "@/types/currency";

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

/** حوزه قضایی/مالیاتی صورتحساب — منطبق با بک‌اند NestJS. */
export enum InvoiceJurisdiction {
  IR = "IR",
  INTL = "INTL",
}

export const INVOICE_JURISDICTION_LABELS: Record<InvoiceJurisdiction, string> = {
  [InvoiceJurisdiction.IR]: "داخلی (ایران)",
  [InvoiceJurisdiction.INTL]: "بین‌المللی",
};

/** Persian names for the currencies offered on an invoice (the code stays visible). */
export const CURRENCY_LABELS: Record<string, string> = {
  IRR: "ریال (IRR)",
  IRT: "تومان (IRT)",
  USD: "دلار آمریکا (USD)",
  EUR: "یورو (EUR)",
  GBP: "پوند (GBP)",
  AED: "درهم امارات (AED)",
  MYR: "رینگیت مالزی (MYR)",
  TRY: "لیر ترکیه (TRY)",
  CNY: "یوان چین (CNY)",
  OMR: "ریال عمان (OMR)",
};

/** ترتیب ارزهای قابل انتخاب در فرم صورتحساب. */
export const INVOICE_CURRENCIES: Currency[] = [
  Currency.IRR,
  Currency.IRT,
  Currency.USD,
  Currency.EUR,
  Currency.AED,
  Currency.TRY,
  Currency.CNY,
  Currency.OMR,
];

/** جهت صورتحساب: فروش (ما صادر می‌کنیم) یا خرید (تأمین‌کننده برای ما صادر کرده). */
export enum InvoiceDirection {
  SALE = "SALE",
  PURCHASE = "PURCHASE",
}

export const INVOICE_DIRECTION_LABELS: Record<InvoiceDirection, string> = {
  [InvoiceDirection.SALE]: "فروش",
  [InvoiceDirection.PURCHASE]: "خرید",
};

/** نوع صورتحساب الکترونیکی (سامانه مودیان). */
export enum EInvoiceType {
  WITH_BUYER = 1,
  WITHOUT_BUYER = 2,
  RETAIL = 3,
}

export const EINVOICE_TYPE_LABELS: Record<EInvoiceType, string> = {
  [EInvoiceType.WITH_BUYER]: "نوع اول (با مشخصات خریدار)",
  [EInvoiceType.WITHOUT_BUYER]: "نوع دوم (بدون مشخصات خریدار)",
  [EInvoiceType.RETAIL]: "نوع سوم (فروشگاهی)",
};

/** موضوع صورتحساب الکترونیکی. */
export enum InvoiceSubject {
  ORIGINAL = 1,
  CORRECTIVE = 2,
  CANCEL = 3,
  RETURN = 4,
}

export const INVOICE_SUBJECT_LABELS: Record<InvoiceSubject, string> = {
  [InvoiceSubject.ORIGINAL]: "اصلی",
  [InvoiceSubject.CORRECTIVE]: "اصلاحی",
  [InvoiceSubject.CANCEL]: "ابطالی",
  [InvoiceSubject.RETURN]: "برگشتی",
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
  /** The line's own discount only. */
  discount: number;
  /** Read-only share of the invoice-level discount spread onto this line; never sent back. */
  invoiceDiscountShare?: number;
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
  /** Left out, the server generates a unique number. */
  taxInvoiceNumber?: string;
  direction?: InvoiceDirection;
  einvoiceType?: EInvoiceType;
  subject?: InvoiceSubject;
  relatedInvoiceId?: string;
  warehouseId?: number;
  sellerInfo: InvoicePartyInfo;
  buyerInfo?: InvoicePartyInfo;
  customerId?: number;
  items: CreateInvoiceItemDto[];
  status?: InvoiceStatus;
  currency?: Currency;
  jurisdiction?: InvoiceJurisdiction;
  fxRate?: number;
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
  jurisdiction: InvoiceJurisdiction;
  exchangeRate: number;
  fxRate: number;
  amountFx: number | null;
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
  direction: InvoiceDirection;
  einvoiceType: EInvoiceType;
  subject: InvoiceSubject;
  relatedInvoiceId: string | null;
  warehouseId: number | null;
  moadianStatus?: 'QUEUED' | 'SENT' | 'SUCCESS' | 'FAILED' | 'ERROR' | null;
  moadianErrorText?: string | null;
  moadianTaxId?: string | null;
}

export type InvoiceResponse = InvoiceResponseDto;

export interface QueryInvoiceDto {
  page?: number;
  limit?: number;
  status?: InvoiceStatus;
  taxInvoiceNumber?: string;
  search?: string;
  currency?: Currency;
  direction?: InvoiceDirection;
}

export type QueryInvoiceParams = QueryInvoiceDto;

export interface PaginatedInvoiceResponse {
  data: InvoiceResponseDto[];
  total: number;
  page: number;
  limit: number;
}

/**
 * آیا صورتحساب با ارز خارجی (غیر ریالی/تومانی) یا حوزه بین‌المللی است؟
 * چنین صورتحساب‌هایی با ارز خودشان و تاریخ میلادی نمایش داده می‌شوند.
 */
export function isForeignInvoice(
  invoice: Pick<InvoiceResponseDto, "currency" | "jurisdiction">,
): boolean {
  return (
    invoice.jurisdiction === InvoiceJurisdiction.INTL ||
    !isIranianCurrency(invoice.currency)
  );
}

/** معادل ریالی صورتحساب: amount_fx × fx_rate. */
export function invoiceRialEquivalent(
  invoice: Pick<InvoiceResponseDto, "amountFx" | "finalPayable" | "fxRate">,
): number {
  const amount = invoice.amountFx ?? invoice.finalPayable;
  return amount * (invoice.fxRate || 0);
}

export type PaymentMethod = "CASH" | "CARD" | "BANK_TRANSFER";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "نقد",
  CARD: "کارتخوان (پوز)",
  BANK_TRANSFER: "کارت‌به‌کارت / واریز",
};

export interface CreatePosSaleDto {
  idempotencyKey: string;
  customer?: { phone?: string; name?: string };
  lines: Array<{
    code?: string;
    description?: string;
    quantity: number;
    unitPrice: number;
    discount?: number;
    vatRate?: number;
  }>;
  payments: Array<{ method: PaymentMethod; amount: number }>;
  warehouseId?: number;
  currency?: Currency;
  fxRate?: number;
}

export interface PosSaleResponse {
  invoice: InvoiceResponseDto;
  replayed: boolean;
  customerLevel: "anonymous" | "phone" | "name_phone";
  customerCreated: boolean;
}
