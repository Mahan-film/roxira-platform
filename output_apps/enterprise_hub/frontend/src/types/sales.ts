/**
 * Types for the sales cycle (quotations, sales orders, deliveries, returns, price tiers).
 * Quantities are numbers with up to two decimals.
 * Money amounts in DTOs are string or number rials, and in responses Money objects or strings.
 */

export type SalesQuotationStatus =
  | 'DRAFT'
  | 'SENT'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'CONVERTED';

export type SalesOrderStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELLED';

export type CustomerGroup = 'CONSUMER' | 'WHOLESALE' | 'PARTNER';

export type FulfilmentStatus = 'NONE' | 'PARTIAL' | 'COMPLETE';

// ---------------------------------------------------------------- quotations

export interface SalesLineInput {
  itemId: number;
  description?: string;
  quantity: number | string;
  unitPrice: number | string;
  discount?: number | string;
}

export interface CreateSalesQuotationDto {
  partyCode: string;
  quoteDate: string;
  validUntil?: string;
  note?: string;
  lines: SalesLineInput[];
}

export interface SalesLineItem {
  id: number;
  lineNo: number;
  itemId: number;
  description: string | null;
  quantity: number;
  unitPrice: number | string;
  discount: number | string;
  lineTotal: number | string;
}

export interface SalesQuotation {
  id: number;
  number: string;
  partyCode: string;
  quoteDate: string;
  validUntil: string | null;
  status: SalesQuotationStatus;
  note: string | null;
  totalAmount: number | string;
  createdBy: string | null;
  warning?: string;
  createdAt: string;
  updatedAt: string;
  lines?: SalesLineItem[];
}

export interface SalesQuotationListResponse {
  data: SalesQuotation[];
  total: number;
}

export interface ChangeSalesQuotationStatusDto {
  status: SalesQuotationStatus;
}

export interface ConvertQuotationDto {
  warehouseId: number;
  orderDate: string;
  promisedDate?: string;
}

// ------------------------------------------------------------------- orders

export interface CreateSalesOrderDto {
  partyCode: string;
  warehouseId: number;
  orderDate: string;
  promisedDate?: string;
  note?: string;
  lines: SalesLineInput[];
}

export interface SalesOrderLineItem extends SalesLineItem {
  deliveredQuantity: number;
  invoicedQuantity: number;
}

export interface SalesOrder {
  id: number;
  number: string;
  partyCode: string;
  quotationId: number | null;
  warehouseId: number;
  orderDate: string;
  promisedDate: string | null;
  status: SalesOrderStatus;
  note: string | null;
  totalAmount: number | string;
  createdBy: string | null;
  warning?: string;
  createdAt: string;
  updatedAt: string;
  lines?: SalesOrderLineItem[];
}

export interface SalesOrderListResponse {
  data: SalesOrder[];
  total: number;
}

export interface QuerySalesOrderDto {
  partyCode?: string;
  status?: SalesOrderStatus;
  limit?: number;
  offset?: number;
}

export interface QuerySalesQuotationDto {
  partyCode?: string;
  status?: SalesQuotationStatus;
  limit?: number;
  offset?: number;
}

// --------------------------------------------------------------- deliveries

export interface DeliveryLineInput {
  orderLineId: number;
  quantity: number | string;
}

export interface CreateSalesDeliveryDto {
  deliveryDate: string;
  idempotencyKey?: string;
  note?: string;
  lines: DeliveryLineInput[];
}

export interface SalesDeliveryLineItem {
  id: number;
  lineNo: number;
  orderLineId: number;
  itemId: number;
  sku: string;
  quantity: number;
  lineCost: number | string;
  unitCost: number | string;
}

export interface SalesDelivery {
  id: number;
  number: string;
  orderId: number;
  partyCode: string;
  warehouseId: number;
  deliveryDate: string;
  status: string;
  totalCost: number | string;
  stockDocumentId: number | null;
  journalEntryId: number | null;
  createdBy: string | null;
  createdAt: string;
  lines?: SalesDeliveryLineItem[];
}

export interface SalesDeliveryListResponse {
  data: SalesDelivery[];
  total: number;
}

export interface OrderFulfilmentLine {
  orderLineId: number;
  itemId: number;
  ordered: number;
  delivered: number;
  backorder: number;
  status: FulfilmentStatus;
}

export interface OrderFulfilmentResponse {
  orderId: number;
  status: FulfilmentStatus;
  lines: OrderFulfilmentLine[];
}

// -------------------------------------------------------------- price tiers

export interface PriceTier {
  id: number;
  sku: string;
  customerGroup: CustomerGroup;
  unitPriceMinor: string;
  discountPercent: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  createdAt: string;
}

export interface CreatePriceTierDto {
  sku: string;
  customerGroup: CustomerGroup;
  unitPriceMinor: string;
  discountPercent?: number;
  effectiveFrom?: string;
  effectiveTo?: string;
}

export interface ListPriceTiersQueryDto {
  sku?: string;
  customerGroup?: CustomerGroup;
}
