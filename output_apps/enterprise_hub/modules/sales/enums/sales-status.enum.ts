/** Lifecycle of a sales quotation. CONVERTED is terminal: a quotation converts into one order only. */
export enum SalesQuotationStatus {
  DRAFT = 'DRAFT',
  SENT = 'SENT',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  CONVERTED = 'CONVERTED',
}

/** Lifecycle of a sales order. CANCELLED is terminal. */
export enum SalesOrderStatus {
  DRAFT = 'DRAFT',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
}

/** Document-number prefix of a quotation. */
export const SALES_QUOTATION_PREFIX = 'QT';

/** Document-number prefix of a sales order. */
export const SALES_ORDER_PREFIX = 'SO';

/** Allowed quotation transitions; anything not listed here is a 409. */
export const QUOTATION_TRANSITIONS: Readonly<Record<SalesQuotationStatus, readonly SalesQuotationStatus[]>> = {
  [SalesQuotationStatus.DRAFT]: [SalesQuotationStatus.SENT],
  [SalesQuotationStatus.SENT]: [SalesQuotationStatus.ACCEPTED, SalesQuotationStatus.REJECTED],
  [SalesQuotationStatus.ACCEPTED]: [SalesQuotationStatus.REJECTED],
  [SalesQuotationStatus.REJECTED]: [],
  [SalesQuotationStatus.CONVERTED]: [],
};

/** States a quotation must be in to convert into an order. */
export const QUOTATION_CONVERTIBLE: readonly SalesQuotationStatus[] = [
  SalesQuotationStatus.SENT,
  SalesQuotationStatus.ACCEPTED,
];
