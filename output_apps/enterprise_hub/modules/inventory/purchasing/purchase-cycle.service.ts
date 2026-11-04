/**
 * Purchase request → purchase order → goods receipt (#227 T2). Persistence, stock-in and posting
 * are ports so the rules run in memory in specs; the TypeORM store, `InventoryService.receiveStock`
 * and the accounting service plug in behind them in a later PR.
 */
import { randomUUID } from 'crypto';
import { minorToDecimal, scaledToDecimal } from '../../accounting/money';
import { QUANTITY_SCALE } from '../constants/inventory.constants';
import {
  OrderLineInput,
  PurchaseDomainError,
  ReceiptLineInput,
  assertTransition,
  planReceipt,
  validateOrderLines,
} from './purchase-order.domain';
import { PurchasePosting, purchasePostingLines } from './purchase-posting.adapter';
import {
  GoodsReceipt,
  PurchaseOrder,
  PurchaseOrderStatus,
  PurchaseRequest,
  PurchaseRequestLine,
  PurchaseRequestStatus,
  PurchaseSettings,
} from './purchase.types';

/** Opaque transaction handle passed from the store to the other ports. */
export type PurchaseTx = unknown;

export interface PurchaseStore {
  transaction<T>(tenantId: string, work: (tx: PurchaseTx) => Promise<T>): Promise<T>;
  nextNumber(tenantId: string, prefix: 'PR' | 'PO' | 'GR', tx: PurchaseTx): Promise<string>;
  settings(tenantId: string, tx: PurchaseTx): Promise<PurchaseSettings>;
  /** Loads for update; null when missing or another tenant's. */
  getRequest(tenantId: string, id: string, tx: PurchaseTx): Promise<PurchaseRequest | null>;
  saveRequest(request: PurchaseRequest, tx: PurchaseTx): Promise<void>;
  getOrder(tenantId: string, id: string, tx: PurchaseTx): Promise<PurchaseOrder | null>;
  saveOrder(order: PurchaseOrder, tx: PurchaseTx): Promise<void>;
  findReceiptByKey(tenantId: string, key: string, tx: PurchaseTx): Promise<GoodsReceipt | null>;
  saveReceipt(receipt: GoodsReceipt, tx: PurchaseTx): Promise<void>;
}

export interface StockInRequest {
  sku: string;
  /** Decimal quantity, as `InventoryService.receiveStock` takes it. */
  quantity: number;
  unitPurchaseCost: number;
  warehouseId: number | null;
  batchNumber: string;
  receivedAt: Date;
}

export interface StockInPort {
  receive(tenantId: string, request: StockInRequest, tx: PurchaseTx): Promise<{ batchId: number }>;
}

export interface PurchasePostingPort {
  /** Posts a balanced role-based entry; returns the journal entry id. */
  post(tenantId: string, posting: PurchasePosting, tx: PurchaseTx): Promise<string>;
}

export interface CreateOrderInput {
  supplierCode: string;
  orderDate: string;
  warehouseId?: number | null;
  lines: OrderLineInput[];
}

export interface ReceiveInput {
  orderId: string;
  receivedAt: Date;
  idempotencyKey?: string;
  lines: ReceiptLineInput[];
}

export class PurchaseCycleService {
  constructor(
    private readonly store: PurchaseStore,
    private readonly stock: StockInPort,
    private readonly posting: PurchasePostingPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  createRequest(tenantId: string, userId: string, lines: PurchaseRequestLine[]): Promise<PurchaseRequest> {
    validateOrderLines(lines.map((line) => ({ ...line, unitPrice: 0n })));
    return this.store.transaction(tenantId, async (tx) => {
      const request: PurchaseRequest = {
        id: randomUUID(),
        tenantId,
        number: await this.store.nextNumber(tenantId, 'PR', tx),
        status: PurchaseRequestStatus.OPEN,
        requestedBy: userId,
        lines: lines.map((line) => ({ sku: line.sku.trim(), quantity: line.quantity })),
        orderId: null,
        createdAt: this.now(),
      };
      await this.store.saveRequest(request, tx);
      return request;
    });
  }

  /** Turns an open request into a DRAFT order; `prices` gives the unit price per SKU. */
  convertRequest(
    tenantId: string,
    requestId: string,
    order: Omit<CreateOrderInput, 'lines'> & { prices: Record<string, bigint> },
  ): Promise<PurchaseOrder> {
    return this.store.transaction(tenantId, async (tx) => {
      const request = await this.store.getRequest(tenantId, requestId, tx);
      if (!request) throw new PurchaseDomainError('NOT_FOUND', 'Purchase request not found.');
      if (request.status !== PurchaseRequestStatus.OPEN) {
        throw new PurchaseDomainError('INVALID_TRANSITION', `Request ${request.number} is ${request.status}.`);
      }
      const lines = request.lines.map((line) => {
        const unitPrice = order.prices[line.sku];
        if (unitPrice === undefined) {
          throw new PurchaseDomainError('INVALID_LINE', `No price for ${line.sku}.`);
        }
        return { sku: line.sku, quantity: line.quantity, unitPrice };
      });
      const created = await this.newOrder(tenantId, { ...order, lines }, request.id, tx);
      await this.store.saveRequest({ ...request, status: PurchaseRequestStatus.ORDERED, orderId: created.id }, tx);
      return created;
    });
  }

  createOrder(tenantId: string, input: CreateOrderInput): Promise<PurchaseOrder> {
    return this.store.transaction(tenantId, (tx) => this.newOrder(tenantId, input, null, tx));
  }

  approveOrder(tenantId: string, orderId: string, userId: string): Promise<PurchaseOrder> {
    return this.changeStatus(tenantId, orderId, PurchaseOrderStatus.APPROVED, (order) => ({
      ...order,
      approvedBy: userId,
      approvedAt: this.now(),
    }));
  }

  cancelOrder(tenantId: string, orderId: string): Promise<PurchaseOrder> {
    return this.changeStatus(tenantId, orderId, PurchaseOrderStatus.CANCELLED);
  }

  /** Short-closes a partly received order: the rest will not be delivered. */
  closeOrder(tenantId: string, orderId: string): Promise<PurchaseOrder> {
    return this.changeStatus(tenantId, orderId, PurchaseOrderStatus.CLOSED);
  }

  /**
   * Receives goods against an approved order in one transaction: one FIFO layer per line at the
   * PO price, the order's received quantities and status, and the INVENTORY / GRNI entry.
   */
  receive(tenantId: string, userId: string, input: ReceiveInput): Promise<GoodsReceipt> {
    return this.store.transaction(tenantId, async (tx) => {
      if (input.idempotencyKey) {
        const existing = await this.store.findReceiptByKey(tenantId, input.idempotencyKey, tx);
        if (existing) return existing;
      }
      const order = await this.store.getOrder(tenantId, input.orderId, tx);
      if (!order) throw new PurchaseDomainError('NOT_FOUND', 'Purchase order not found.');
      const plan = planReceipt(order, input.lines, await this.store.settings(tenantId, tx));
      const number = await this.store.nextNumber(tenantId, 'GR', tx);

      const lines: GoodsReceipt['lines'] = [];
      for (const [index, line] of plan.lines.entries()) {
        const { batchId } = await this.stock.receive(
          tenantId,
          {
            sku: line.sku,
            quantity: Number(scaledToDecimal(line.quantity, QUANTITY_SCALE)),
            unitPurchaseCost: Number(minorToDecimal(line.unitCost)),
            warehouseId: order.warehouseId,
            batchNumber: `${number}-${index + 1}`,
            receivedAt: input.receivedAt,
          },
          tx,
        );
        lines.push({ ...line, id: randomUUID(), fifoBatchId: batchId });
      }

      const receipt: GoodsReceipt = {
        id: randomUUID(),
        tenantId,
        number,
        orderId: order.id,
        supplierCode: order.supplierCode,
        receivedAt: input.receivedAt,
        receivedBy: userId,
        idempotencyKey: input.idempotencyKey ?? null,
        lines,
        totalValue: plan.totalValue,
        journalEntryId: null,
      };
      const posting = purchasePostingLines({
        kind: 'GOODS_RECEIPT',
        receiptId: receipt.id,
        receiptNumber: number,
        orderNumber: order.number,
        supplierCode: order.supplierCode,
        receivedAt: input.receivedAt,
        value: plan.totalValue,
      });
      if (posting) {
        receipt.journalEntryId = await this.posting.post(tenantId, posting, tx);
      }

      await this.store.saveOrder(
        {
          ...order,
          status: plan.statusAfter,
          lines: order.lines.map((line) => ({
            ...line,
            receivedQuantity: plan.receivedAfter.get(line.id) ?? line.receivedQuantity,
          })),
        },
        tx,
      );
      await this.store.saveReceipt(receipt, tx);
      return receipt;
    });
  }

  private async newOrder(
    tenantId: string,
    input: CreateOrderInput,
    requestId: string | null,
    tx: PurchaseTx,
  ): Promise<PurchaseOrder> {
    validateOrderLines(input.lines);
    const supplierCode = input.supplierCode.trim();
    if (!supplierCode) {
      throw new PurchaseDomainError('INVALID_LINE', 'An order needs a supplier.');
    }
    const order: PurchaseOrder = {
      id: randomUUID(),
      tenantId,
      number: await this.store.nextNumber(tenantId, 'PO', tx),
      supplierCode,
      status: PurchaseOrderStatus.DRAFT,
      warehouseId: input.warehouseId ?? null,
      lines: input.lines.map((line) => ({
        id: randomUUID(),
        sku: line.sku.trim(),
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        receivedQuantity: 0n,
      })),
      requestId,
      orderDate: input.orderDate,
      approvedBy: null,
      approvedAt: null,
      createdAt: this.now(),
    };
    await this.store.saveOrder(order, tx);
    return order;
  }

  private changeStatus(
    tenantId: string,
    orderId: string,
    to: PurchaseOrderStatus,
    patch: (order: PurchaseOrder) => PurchaseOrder = (order) => order,
  ): Promise<PurchaseOrder> {
    return this.store.transaction(tenantId, async (tx) => {
      const order = await this.store.getOrder(tenantId, orderId, tx);
      if (!order) throw new PurchaseDomainError('NOT_FOUND', 'Purchase order not found.');
      assertTransition(order.status, to);
      if (to === PurchaseOrderStatus.CANCELLED && order.lines.some((line) => line.receivedQuantity > 0n)) {
        throw new PurchaseDomainError('INVALID_TRANSITION', `Order ${order.number} has receipts; close it instead.`);
      }
      const updated = { ...patch(order), status: to };
      await this.store.saveOrder(updated, tx);
      return updated;
    });
  }
}
