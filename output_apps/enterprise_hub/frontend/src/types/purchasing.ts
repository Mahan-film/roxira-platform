/**
 * Types for the purchasing cycle (orders, receipts, 3-way matched supplier invoices,
 * landed costs, and tolerance settings).
 *
 * Quantities are integer strings of bigint hundredths ("1000" = 10.00).
 * Money amounts are integer strings of bigint minor units (rial x 100).
 */

export type PurchaseRequestStatus = 'OPEN' | 'ORDERED' | 'CANCELLED';

export type PurchaseOrderStatus =
  | 'DRAFT'
  | 'APPROVED'
  | 'PARTIALLY_RECEIVED'
  | 'FULLY_RECEIVED'
  | 'CLOSED'
  | 'CANCELLED';

export type SupplierInvoiceStatus = 'HELD' | 'MATCHED' | 'POSTED';

export type MatchStatus =
  | 'MATCHED'
  | 'QTY_MISMATCH'
  | 'PRICE_MISMATCH'
  | 'QTY_AND_PRICE_MISMATCH';

export type LandedCostCategory = 'FREIGHT' | 'CUSTOMS' | 'INSURANCE' | 'OTHER';

export type LandedCostBasis = 'VALUE' | 'QUANTITY' | 'WEIGHT';

// ----------------------------------------------------------------- requests

export interface PurchaseRequestLine {
  sku: string;
  quantity: string;
}

export interface PurchaseRequest {
  id: string;
  tenantId: string;
  number: string;
  status: PurchaseRequestStatus;
  requestedBy: string;
  lines: PurchaseRequestLine[];
  orderId: string | null;
  createdAt: string;
}

export interface CreatePurchaseRequestDto {
  lines: PurchaseRequestLine[];
}

export interface ConvertPurchaseRequestDto {
  supplierCode: string;
  warehouseId?: number;
  orderDate: string;
  prices: Record<string, string>;
}

// ------------------------------------------------------------------- orders

export interface PurchaseOrderLine {
  id: string;
  sku: string;
  quantity: string;
  unitPrice: string;
  receivedQuantity: string;
}

export interface PurchaseOrder {
  id: string;
  tenantId: string;
  number: string;
  supplierCode: string;
  status: PurchaseOrderStatus;
  warehouseId: number | null;
  lines: PurchaseOrderLine[];
  requestId: string | null;
  orderDate: string;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface CreatePurchaseOrderLineInput {
  sku: string;
  quantity: string;
  unitPrice: string;
}

export interface CreatePurchaseOrderDto {
  supplierCode: string;
  warehouseId?: number;
  orderDate: string;
  lines: CreatePurchaseOrderLineInput[];
}

export interface QueryPurchaseOrdersDto {
  status?: PurchaseOrderStatus;
}

// ----------------------------------------------------------------- receipts

export interface GoodsReceiptLine {
  id: string;
  orderLineId: string;
  sku: string;
  quantity: string;
  unitCost: string;
  value: string;
  weight: string | null;
  fifoBatchId: number | null;
}

export interface GoodsReceipt {
  id: string;
  tenantId: string;
  number: string;
  orderId: string;
  supplierCode: string;
  receivedAt: string;
  receivedBy: string;
  idempotencyKey: string | null;
  lines: GoodsReceiptLine[];
  totalValue: string;
  journalEntryId: string | null;
}

export interface CreateGoodsReceiptLineInput {
  orderLineId: string;
  quantity: string;
  weight?: string;
}

export interface CreateGoodsReceiptDto {
  lines: CreateGoodsReceiptLineInput[];
  idempotencyKey?: string;
  receivedAt?: string;
}

// -------------------------------------------------------- supplier invoices

export interface SupplierInvoiceLine {
  id: string;
  receiptLineId: string;
  sku: string;
  quantity: string;
  unitPrice: string;
  orderValue: string;
  invoiceValue: string;
  priceDifference: string;
  matchStatus: MatchStatus;
}

export interface SupplierInvoice {
  id: string;
  tenantId: string;
  number: string;
  orderId: string | null;
  supplierCode: string;
  supplierRef: string;
  invoiceDate: string;
  status: SupplierInvoiceStatus;
  accepted: boolean;
  acceptedBy: string | null;
  acceptedAt: string | null;
  acceptNote: string | null;
  acceptedByCreator: boolean;
  createdBy: string;
  vat: string;
  subtotal: string;
  total: string;
  journalEntryId: string | null;
  createdAt: string;
  lines: SupplierInvoiceLine[];
}

export interface CreateSupplierInvoiceLineInput {
  receiptLineId: string;
  quantity: string;
  unitPrice: string;
}

export interface CreateSupplierInvoiceDto {
  supplierRef: string;
  invoiceDate: string;
  vat?: string;
  lines: CreateSupplierInvoiceLineInput[];
}

export interface AcceptSupplierInvoiceDto {
  note: string;
}

// ------------------------------------------------------------- landed costs

export interface LandedCostAllocation {
  id: string;
  receiptLineId: string;
  sku: string;
  quantity: string;
  basisValue: string;
  share: string;
  toInventory: string;
  toCogs: string;
  fifoBatchId: number | null;
}

export interface LandedCost {
  id: string;
  tenantId: string;
  receiptId: string;
  category: LandedCostCategory;
  basis: LandedCostBasis;
  amount: string;
  date: string;
  supplierCode: string;
  reference: string;
  idempotencyKey: string | null;
  createdBy: string;
  inventoryAmount: string;
  cogsAmount: string;
  journalEntryId: string | null;
  createdAt: string;
  allocations: LandedCostAllocation[];
}

export interface CreateLandedCostDto {
  category: LandedCostCategory;
  amount: string;
  basis: LandedCostBasis;
  date: string;
  supplierCode: string;
  reference: string;
  idempotencyKey?: string;
}

// ----------------------------------------------------------------- settings

export interface PurchaseSettings {
  overReceiptToleranceBp: number;
  priceToleranceBp: number;
  priceToleranceAbs: string;
}

export interface UpdatePurchaseSettingsDto {
  overReceiptToleranceBp?: number;
  priceToleranceBp?: number;
  priceToleranceAbs?: string;
}
