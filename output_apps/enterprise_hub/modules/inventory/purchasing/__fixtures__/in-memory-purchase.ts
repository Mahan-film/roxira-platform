/**
 * In-memory purchase store, stock-in and posting for specs. One state object backs all three
 * ports, so a failed transaction rolls back orders, receipts, FIFO layers and postings together.
 */
import {
  PurchasePostingPort,
  PurchaseStore,
  StockInPort,
  StockInRequest,
} from '../purchase-cycle.service';
import { PurchasePosting } from '../purchase-posting.adapter';
import {
  DEFAULT_PURCHASE_SETTINGS,
  GoodsReceipt,
  PurchaseOrder,
  PurchaseRequest,
  PurchaseSettings,
} from '../purchase.types';

interface State {
  requests: Record<string, PurchaseRequest>;
  orders: Record<string, PurchaseOrder>;
  receipts: Record<string, GoodsReceipt>;
  counters: Record<string, number>;
  layers: Array<StockInRequest & { tenantId: string; batchId: number }>;
  postings: Array<PurchasePosting & { tenantId: string; entryId: string }>;
}

export class InMemoryPurchase implements PurchaseStore, StockInPort, PurchasePostingPort {
  state: State = { requests: {}, orders: {}, receipts: {}, counters: {}, layers: [], postings: [] };
  readonly settingsByTenant: Record<string, PurchaseSettings> = {};

  async transaction<T>(_tenantId: string, work: (tx: unknown) => Promise<T>): Promise<T> {
    const snapshot = structuredClone(this.state);
    try {
      return await work(null);
    } catch (error) {
      this.state = snapshot;
      throw error;
    }
  }

  async nextNumber(tenantId: string, prefix: string): Promise<string> {
    const key = `${tenantId}:${prefix}`;
    this.state.counters[key] = (this.state.counters[key] ?? 0) + 1;
    return `${prefix}-${String(this.state.counters[key]).padStart(4, '0')}`;
  }

  async settings(tenantId: string): Promise<PurchaseSettings> {
    return this.settingsByTenant[tenantId] ?? DEFAULT_PURCHASE_SETTINGS;
  }

  async getRequest(tenantId: string, id: string): Promise<PurchaseRequest | null> {
    const found = this.state.requests[id];
    return found && found.tenantId === tenantId ? structuredClone(found) : null;
  }

  async saveRequest(request: PurchaseRequest): Promise<void> {
    this.state.requests[request.id] = structuredClone(request);
  }

  async getOrder(tenantId: string, id: string): Promise<PurchaseOrder | null> {
    const found = this.state.orders[id];
    return found && found.tenantId === tenantId ? structuredClone(found) : null;
  }

  async saveOrder(order: PurchaseOrder): Promise<void> {
    this.state.orders[order.id] = structuredClone(order);
  }

  async findReceiptByKey(tenantId: string, key: string): Promise<GoodsReceipt | null> {
    const found = Object.values(this.state.receipts).find(
      (receipt) => receipt.tenantId === tenantId && receipt.idempotencyKey === key,
    );
    return found ? structuredClone(found) : null;
  }

  async saveReceipt(receipt: GoodsReceipt): Promise<void> {
    this.state.receipts[receipt.id] = structuredClone(receipt);
  }

  async receive(tenantId: string, request: StockInRequest): Promise<{ batchId: number }> {
    const batchId = this.state.layers.length + 1;
    this.state.layers.push({ ...request, tenantId, batchId });
    return { batchId };
  }

  async post(tenantId: string, posting: PurchasePosting): Promise<string> {
    const entryId = `JE-${this.state.postings.length + 1}`;
    this.state.postings.push({ ...structuredClone(posting), tenantId, entryId });
    return entryId;
  }
}
