/**
 * Purchase cycle domain types (#227 T2, design: docs/accounting/PURCHASE_CYCLE.md).
 *
 * Money is integer minor units (`bigint`, rial x 100, `modules/accounting/money.ts`).
 * Quantities are integers in hundredths (QUANTITY_SCALE = 2); weights in thousandths of a kg.
 */

export enum PurchaseRequestStatus {
  OPEN = 'OPEN',
  ORDERED = 'ORDERED',
  CANCELLED = 'CANCELLED',
}

export enum PurchaseOrderStatus {
  DRAFT = 'DRAFT',
  APPROVED = 'APPROVED',
  PARTIALLY_RECEIVED = 'PARTIALLY_RECEIVED',
  RECEIVED = 'RECEIVED',
  /** Short-closed: partly received, the rest will not come. */
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
}

export interface PurchaseRequestLine {
  sku: string;
  /** Hundredths of a unit. */
  quantity: bigint;
}

export interface PurchaseRequest {
  id: string;
  tenantId: string;
  number: string;
  status: PurchaseRequestStatus;
  requestedBy: string;
  lines: PurchaseRequestLine[];
  /** The order created from this request, once converted. */
  orderId: string | null;
  createdAt: Date;
}

export interface PurchaseOrderLine {
  id: string;
  sku: string;
  /** Ordered, hundredths of a unit. */
  quantity: bigint;
  /** Minor units per whole unit, before VAT. */
  unitPrice: bigint;
  /** Received so far over all receipts, hundredths of a unit. */
  receivedQuantity: bigint;
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
  approvedAt: Date | null;
  createdAt: Date;
}

export interface GoodsReceiptLine {
  id: string;
  orderLineId: string;
  sku: string;
  /** Hundredths of a unit. */
  quantity: bigint;
  /** PO price carried onto the receipt; the FIFO layer starts at this cost. */
  unitCost: bigint;
  /** round_half_up(quantity x unitCost / 100), minor units. */
  value: bigint;
  /** Thousandths of a kg, for landed cost by weight. Null when not weighed. */
  weight: bigint | null;
  /** FIFO layer created by this line, so landed cost can find it later. */
  fifoBatchId: number | null;
}

export interface GoodsReceipt {
  id: string;
  tenantId: string;
  number: string;
  orderId: string;
  supplierCode: string;
  receivedAt: Date;
  receivedBy: string;
  idempotencyKey: string | null;
  lines: GoodsReceiptLine[];
  /** Sum of line values, minor units. */
  totalValue: bigint;
  journalEntryId: string | null;
}

/** Tenant settings the purchase cycle reads. */
export interface PurchaseSettings {
  /** Allowed over-receipt per order line, in basis points of the ordered quantity (100 = 1%). */
  overReceiptToleranceBp: number;
  /** Allowed price difference for the 3-way match, in basis points of the PO price. */
  priceToleranceBp?: number;
  /** Allowed price difference for the 3-way match, in minor units per line. */
  priceToleranceAbs?: bigint;
}

export const DEFAULT_PURCHASE_SETTINGS: PurchaseSettings = {
  overReceiptToleranceBp: 0,
  priceToleranceBp: 0,
  priceToleranceAbs: 0n,
};
