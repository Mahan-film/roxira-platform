/**
 * Pure rules of the purchase order and goods receipt (#227 T2). No I/O: the service loads and saves,
 * these functions decide. All arithmetic is exact bigint.
 */
import {
  GoodsReceiptLine,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderStatus,
  PurchaseSettings,
} from './purchase.types';

export type PurchaseErrorCode =
  | 'INVALID_LINE'
  | 'DUPLICATE_LINE'
  | 'INVALID_TRANSITION'
  | 'NOT_RECEIVABLE'
  | 'UNKNOWN_ORDER_LINE'
  | 'OVER_RECEIPT'
  | 'NOT_FOUND';

export class PurchaseDomainError extends Error {
  constructor(
    readonly code: PurchaseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PurchaseDomainError';
  }
}

/** Value of `quantity` (hundredths) at `unitPrice` (minor units per unit), rounded half up. */
export function lineValue(quantity: bigint, unitPrice: bigint): bigint {
  if (quantity < 0n || unitPrice < 0n) {
    throw new PurchaseDomainError('INVALID_LINE', 'Quantity and price must not be negative.');
  }
  return (quantity * unitPrice + 50n) / 100n;
}

export interface OrderLineInput {
  sku: string;
  quantity: bigint;
  unitPrice: bigint;
}

/** Checks order lines: a SKU, a positive quantity, a price of zero or more, each SKU once. */
export function validateOrderLines(lines: readonly OrderLineInput[]): void {
  if (lines.length === 0) {
    throw new PurchaseDomainError('INVALID_LINE', 'An order needs at least one line.');
  }
  const seen = new Set<string>();
  for (const line of lines) {
    const sku = line.sku.trim();
    if (!sku || line.quantity <= 0n || line.unitPrice < 0n) {
      throw new PurchaseDomainError(
        'INVALID_LINE',
        `Line "${line.sku}" needs a SKU, a positive quantity and a price of zero or more.`,
      );
    }
    if (seen.has(sku)) {
      throw new PurchaseDomainError('DUPLICATE_LINE', `SKU "${sku}" appears twice on the order.`);
    }
    seen.add(sku);
  }
}

/** Order total before VAT, minor units. */
export function orderTotal(order: Pick<PurchaseOrder, 'lines'>): bigint {
  return order.lines.reduce((sum, line) => sum + lineValue(line.quantity, line.unitPrice), 0n);
}

const TRANSITIONS: Record<PurchaseOrderStatus, readonly PurchaseOrderStatus[]> = {
  [PurchaseOrderStatus.DRAFT]: [PurchaseOrderStatus.APPROVED, PurchaseOrderStatus.CANCELLED],
  [PurchaseOrderStatus.APPROVED]: [
    PurchaseOrderStatus.PARTIALLY_RECEIVED,
    PurchaseOrderStatus.RECEIVED,
    PurchaseOrderStatus.CANCELLED,
  ],
  [PurchaseOrderStatus.PARTIALLY_RECEIVED]: [
    PurchaseOrderStatus.PARTIALLY_RECEIVED,
    PurchaseOrderStatus.RECEIVED,
    PurchaseOrderStatus.CLOSED,
  ],
  [PurchaseOrderStatus.RECEIVED]: [],
  [PurchaseOrderStatus.CLOSED]: [],
  [PurchaseOrderStatus.CANCELLED]: [],
};

export function assertTransition(from: PurchaseOrderStatus, to: PurchaseOrderStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new PurchaseDomainError('INVALID_TRANSITION', `An order cannot go from ${from} to ${to}.`);
  }
}

/** Most that may be received on a line: ordered plus the tolerance, rounded down. */
export function receivableLimit(line: PurchaseOrderLine, settings: PurchaseSettings): bigint {
  const bp = BigInt(Math.max(0, Math.trunc(settings.overReceiptToleranceBp)));
  return (line.quantity * (10_000n + bp)) / 10_000n;
}

export interface ReceiptLineInput {
  orderLineId: string;
  quantity: bigint;
  weight?: bigint | null;
}

export interface ReceiptPlan {
  /** Receipt lines without ids and FIFO batch ids; the service fills those in. */
  lines: Array<Omit<GoodsReceiptLine, 'id' | 'fifoBatchId'>>;
  totalValue: bigint;
  /** Received quantity per order line after this receipt. */
  receivedAfter: Map<string, bigint>;
  statusAfter: PurchaseOrderStatus;
}

/**
 * Decides what a receipt does to an order: validates every line against the order and the
 * over-receipt tolerance, values it at the PO price and works out the order's next status.
 */
export function planReceipt(
  order: PurchaseOrder,
  input: readonly ReceiptLineInput[],
  settings: PurchaseSettings,
): ReceiptPlan {
  if (
    order.status !== PurchaseOrderStatus.APPROVED &&
    order.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED
  ) {
    throw new PurchaseDomainError('NOT_RECEIVABLE', `Order ${order.number} is ${order.status}.`);
  }
  if (input.length === 0) {
    throw new PurchaseDomainError('INVALID_LINE', 'A receipt needs at least one line.');
  }
  const byId = new Map(order.lines.map((line) => [line.id, line]));
  const receivedAfter = new Map(order.lines.map((line) => [line.id, line.receivedQuantity]));
  const seen = new Set<string>();
  const lines: ReceiptPlan['lines'] = [];

  for (const item of input) {
    const orderLine = byId.get(item.orderLineId);
    if (!orderLine) {
      throw new PurchaseDomainError('UNKNOWN_ORDER_LINE', `Line ${item.orderLineId} is not on order ${order.number}.`);
    }
    if (seen.has(item.orderLineId)) {
      throw new PurchaseDomainError('DUPLICATE_LINE', `Order line ${item.orderLineId} appears twice on the receipt.`);
    }
    seen.add(item.orderLineId);
    if (item.quantity <= 0n || (item.weight != null && item.weight < 0n)) {
      throw new PurchaseDomainError('INVALID_LINE', `Receipt line for ${orderLine.sku} needs a positive quantity.`);
    }
    const after = orderLine.receivedQuantity + item.quantity;
    if (after > receivableLimit(orderLine, settings)) {
      throw new PurchaseDomainError(
        'OVER_RECEIPT',
        `Receiving ${orderLine.sku} would exceed the ordered quantity beyond the tolerance.`,
      );
    }
    receivedAfter.set(orderLine.id, after);
    lines.push({
      orderLineId: orderLine.id,
      sku: orderLine.sku,
      quantity: item.quantity,
      unitCost: orderLine.unitPrice,
      value: lineValue(item.quantity, orderLine.unitPrice),
      weight: item.weight ?? null,
    });
  }

  const complete = order.lines.every((line) => (receivedAfter.get(line.id) ?? 0n) >= line.quantity);
  const statusAfter = complete ? PurchaseOrderStatus.RECEIVED : PurchaseOrderStatus.PARTIALLY_RECEIVED;
  assertTransition(order.status, statusAfter);

  return {
    lines,
    totalValue: lines.reduce((sum, line) => sum + line.value, 0n),
    receivedAfter,
    statusAfter,
  };
}
