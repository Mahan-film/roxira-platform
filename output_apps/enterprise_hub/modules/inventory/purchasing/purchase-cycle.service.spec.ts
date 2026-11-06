import { ConflictException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { PostingRequest, PostingRulesService } from '../../posting_rules/services/posting-rules.service';
import { InventoryService } from '../services/inventory.service';
import { StockDocumentsService } from '../services/stock-documents.service';
import { PurchaseCycleService } from './purchase-cycle.service';
import { PurchaseOrderResponseDto } from './purchase.dto';
import {
  NewGoodsReceipt,
  NewGoodsReceiptLine,
  NewPurchaseOrder,
  NewPurchaseRequest,
  PurchaseRepository,
} from './purchase.repository';
import {
  DEFAULT_PURCHASE_SETTINGS,
  GoodsReceipt,
  PurchaseOrder,
  PurchaseOrderStatus,
  PurchaseRequest,
  PurchaseRequestStatus,
  PurchaseSettings,
} from './purchase.types';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

interface FakeState {
  requests: PurchaseRequest[];
  orders: PurchaseOrder[];
  receipts: GoodsReceipt[];
  settings: Map<string, PurchaseSettings>;
  counters: Map<string, number>;
  inventoryCalls: number;
  journals: PostingRequest[];
  stockCalls: Array<{ quantity: number; unitPurchaseCost: number }>;
  failJournal: boolean;
}

function freshState(): FakeState {
  return {
    requests: [],
    orders: [],
    receipts: [],
    settings: new Map<string, PurchaseSettings>(),
    counters: new Map<string, number>(),
    inventoryCalls: 0,
    journals: [],
    stockCalls: [],
    failJournal: false,
  };
}

function nextId(state: FakeState, kind: string): string {
  const key = `id:${kind}`;
  const value = (state.counters.get(key) ?? 0) + 1;
  state.counters.set(key, value);
  return `${kind}-${value}`;
}

class FakeTenantScope {
  constructor(private readonly state: FakeState) {}

  async run<T>(_tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    const snapshot = structuredClone(this.state);
    try {
      return await work({} as EntityManager);
    } catch (error) {
      Object.assign(this.state, snapshot);
      throw error;
    }
  }

  async within<T>(
    tenantId: string,
    manager: EntityManager | undefined,
    work: (m: EntityManager) => Promise<T>,
  ): Promise<T> {
    if (!manager) return this.run(tenantId, work);
    return work(manager);
  }
}

class FakePurchaseRepository {
  constructor(private readonly state: FakeState) {}

  async run<T>(_tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return work({} as EntityManager);
  }

  async getSettings(tenantId: string): Promise<PurchaseSettings> {
    return { ...(this.state.settings.get(tenantId) ?? DEFAULT_PURCHASE_SETTINGS) };
  }

  async upsertSettings(
    tenantId: string,
    settings: { overReceiptToleranceBp: number; priceToleranceBp: number; priceToleranceAbs: bigint },
  ): Promise<PurchaseSettings> {
    const saved: PurchaseSettings = { ...settings };
    this.state.settings.set(tenantId, saved);
    return { ...saved };
  }

  async nextNumber(tenantId: string, prefix: 'PR' | 'PO' | 'GR'): Promise<string> {
    const key = `number:${tenantId}:${prefix}`;
    const n = (this.state.counters.get(key) ?? 0) + 1;
    this.state.counters.set(key, n);
    return `${prefix}-${String(n).padStart(6, '0')}`;
  }

  async insertRequest(tenantId: string, input: NewPurchaseRequest): Promise<PurchaseRequest> {
    const request: PurchaseRequest = {
      id: nextId(this.state, 'req'),
      tenantId,
      number: input.number,
      status: input.status,
      requestedBy: input.requestedBy,
      lines: input.lines.map((line) => ({ ...line })),
      orderId: null,
      createdAt: new Date('2026-11-05T08:00:00Z'),
    };
    this.state.requests.push(request);
    return structuredClone(request);
  }

  async findRequest(tenantId: string, id: string): Promise<PurchaseRequest | null> {
    const found = this.state.requests.find((request) => request.tenantId === tenantId && request.id === id);
    return found ? structuredClone(found) : null;
  }

  async listRequests(tenantId: string): Promise<PurchaseRequest[]> {
    return structuredClone(this.state.requests.filter((request) => request.tenantId === tenantId));
  }

  async updateRequestStatus(
    tenantId: string,
    id: string,
    status: PurchaseRequestStatus,
    _manager: EntityManager,
    orderId?: string,
  ): Promise<void> {
    const request = this.state.requests.find((row) => row.tenantId === tenantId && row.id === id);
    if (!request) return;
    request.status = status;
    if (orderId !== undefined) request.orderId = orderId;
  }

  async insertOrder(tenantId: string, input: NewPurchaseOrder): Promise<PurchaseOrder> {
    const orderId = nextId(this.state, 'order');
    const order: PurchaseOrder = {
      id: orderId,
      tenantId,
      number: input.number,
      supplierCode: input.supplierCode,
      status: input.status,
      warehouseId: input.warehouseId,
      lines: input.lines.map((line) => ({
        id: nextId(this.state, 'line'),
        sku: line.sku,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        receivedQuantity: 0n,
      })),
      requestId: input.requestId,
      orderDate: input.orderDate,
      approvedBy: null,
      approvedAt: null,
      createdAt: new Date('2026-11-05T08:00:00Z'),
    };
    this.state.orders.push(order);
    return structuredClone(order);
  }

  async findOrder(tenantId: string, id: string): Promise<PurchaseOrder | null> {
    const found = this.state.orders.find((order) => order.tenantId === tenantId && order.id === id);
    return found ? structuredClone(found) : null;
  }

  async listOrders(tenantId: string, status?: PurchaseOrderStatus): Promise<PurchaseOrder[]> {
    return structuredClone(
      this.state.orders.filter(
        (order) => order.tenantId === tenantId && (status === undefined || order.status === status),
      ),
    );
  }

  async updateOrderStatus(
    tenantId: string,
    id: string,
    status: PurchaseOrderStatus,
    _manager: EntityManager,
    approval?: { approvedBy: string; approvedAt: Date },
  ): Promise<void> {
    const order = this.state.orders.find((row) => row.tenantId === tenantId && row.id === id);
    if (!order) return;
    order.status = status;
    if (approval) {
      order.approvedBy = approval.approvedBy;
      order.approvedAt = approval.approvedAt;
    }
  }

  async updateOrderLines(
    tenantId: string,
    orderId: string,
    receivedAfter: Map<string, bigint>,
  ): Promise<void> {
    const order = this.state.orders.find((row) => row.tenantId === tenantId && row.id === orderId);
    if (!order) return;
    for (const line of order.lines) {
      const quantity = receivedAfter.get(line.id);
      if (quantity !== undefined) line.receivedQuantity = quantity;
    }
  }

  async insertReceipt(
    tenantId: string,
    input: NewGoodsReceipt,
    lines: NewGoodsReceiptLine[],
  ): Promise<GoodsReceipt> {
    const receipt: GoodsReceipt = {
      id: nextId(this.state, 'receipt'),
      tenantId,
      number: input.number,
      orderId: input.orderId,
      supplierCode: input.supplierCode,
      receivedAt: input.receivedAt,
      receivedBy: input.receivedBy,
      idempotencyKey: input.idempotencyKey,
      lines: lines.map((line) => ({ ...line, id: nextId(this.state, 'receipt-line') })),
      totalValue: input.totalValue,
      journalEntryId: input.journalEntryId,
    };
    this.state.receipts.push(receipt);
    return structuredClone(receipt);
  }

  async findReceiptByKey(tenantId: string, idempotencyKey: string): Promise<GoodsReceipt | null> {
    const found = this.state.receipts.find(
      (receipt) => receipt.tenantId === tenantId && receipt.idempotencyKey === idempotencyKey,
    );
    return found ? structuredClone(found) : null;
  }

  async findReceipt(tenantId: string, id: string): Promise<GoodsReceipt | null> {
    const found = this.state.receipts.find((receipt) => receipt.tenantId === tenantId && receipt.id === id);
    return found ? structuredClone(found) : null;
  }

  async listReceipts(tenantId: string, orderId?: string): Promise<GoodsReceipt[]> {
    return structuredClone(
      this.state.receipts.filter(
        (receipt) => receipt.tenantId === tenantId && (orderId === undefined || receipt.orderId === orderId),
      ),
    );
  }

  async updateReceiptJournalEntry(
    tenantId: string,
    id: string,
    journalEntryId: string,
  ): Promise<void> {
    const receipt = this.state.receipts.find((row) => row.tenantId === tenantId && row.id === id);
    if (receipt) receipt.journalEntryId = journalEntryId;
  }
}

class FakeInventory {
  constructor(private readonly state: FakeState) {}

  async receiveStock(
    _tenantId: string,
    dto: { quantity: number; unitPurchaseCost: number },
  ): Promise<{ layers: Array<{ batchId: number }> }> {
    this.state.inventoryCalls += 1;
    this.state.stockCalls.push({ quantity: dto.quantity, unitPurchaseCost: dto.unitPurchaseCost });
    return { layers: [{ batchId: this.state.inventoryCalls }] };
  }
}

class FakeStockDocuments {
  async resolveAccounts(): Promise<string[]> {
    return ['1301', '2013'];
  }
}

class FakePostingRules {
  constructor(private readonly state: FakeState) {}

  async describe(): Promise<never[]> {
    return [];
  }

  /** Like the engine: one voucher per (sourceType, sourceId, docType); a replay returns the first. */
  async post(_tenantId: string, request: PostingRequest): Promise<{ entryId: number; entryNumber: string; replayed: boolean }> {
    if (this.state.failJournal) throw new Error('posting failed');
    const index = this.state.journals.findIndex(
      (j) => j.sourceType === request.sourceType && j.sourceId === request.sourceId && j.docType === request.docType,
    );
    if (index >= 0) return { entryId: index + 1, entryNumber: this.state.journals[index].entryNumber ?? '', replayed: true };
    this.state.journals.push(request);
    return { entryId: this.state.journals.length, entryNumber: request.entryNumber ?? '', replayed: false };
  }
}

function makeService(state: FakeState): PurchaseCycleService {
  return new PurchaseCycleService(
    new FakeTenantScope(state) as unknown as TenantScope,
    new FakePurchaseRepository(state) as unknown as PurchaseRepository,
    new FakeInventory(state) as unknown as InventoryService,
    new FakeStockDocuments() as unknown as StockDocumentsService,
    new FakePostingRules(state) as unknown as PostingRulesService,
  );
}

describe('PurchaseCycleService (#227 T2)', () => {
  let state: FakeState;
  let service: PurchaseCycleService;

  beforeEach(() => {
    state = freshState();
    service = makeService(state);
  });

  async function approvedOrder(
    lines: Array<{ sku: string; quantity: string; unitPrice: string }>,
  ): Promise<PurchaseOrderResponseDto> {
    const order = await service.createOrder(T1, 'u1', {
      supplierCode: 'SUP',
      orderDate: '2026-11-05',
      lines,
    });
    return service.approveOrder(T1, 'u1', order.id);
  }

  it('values lines exactly and posts each receipt at the PO price (INVENTORY / GRNI)', async () => {
    const order = await service.createOrder(T1, 'u1', {
      supplierCode: 'SUP',
      orderDate: '2026-11-05',
      lines: [
        { sku: 'A', quantity: '1000', unitPrice: '5000000' },
        { sku: 'B', quantity: '500', unitPrice: '2000001' },
      ],
    });
    const approved = await service.approveOrder(T1, 'u1', order.id);
    expect(order.lines.map((line) => [line.sku, line.quantity, line.unitPrice])).toEqual([
      ['A', '1000', '5000000'],
      ['B', '500', '2000001'],
    ]);
    const lineA = approved.lines.find((line) => line.sku === 'A')!;
    const lineB = approved.lines.find((line) => line.sku === 'B')!;

    const first = await service.createReceipt(T1, 'u1', order.id, {
      lines: [{ orderLineId: lineA.id, quantity: '400' }],
    });
    expect(first.lines.map((line) => line.value)).toEqual(['20000000']);
    expect(first.totalValue).toBe('20000000');
    expect(first.journalEntryId).toBe('1');
    expect(state.journals[0]).toMatchObject({
      docType: 'purchase.receipt',
      sourceType: 'goods_receipt',
      sourceId: first.id,
      entryNumber: `GRN-${first.number}`,
      amounts: { amount: 20000000n },
      partyCode: 'SUP',
      overrides: { inventory: '1301', grni: '2013' },
    });
    expect((await service.getOrder(T1, order.id)).status).toBe(PurchaseOrderStatus.PARTIALLY_RECEIVED);

    const second = await service.createReceipt(T1, 'u1', order.id, {
      lines: [
        { orderLineId: lineA.id, quantity: '600' },
        { orderLineId: lineB.id, quantity: '500' },
      ],
    });
    expect(second.lines.map((line) => line.value)).toEqual(['30000000', '10000005']);
    expect(second.totalValue).toBe('40000005');
    expect((await service.getOrder(T1, order.id)).status).toBe(PurchaseOrderStatus.RECEIVED);
  });

  it('returns the first receipt for the same idempotency key and receives stock once', async () => {
    const order = await approvedOrder([{ sku: 'A', quantity: '100', unitPrice: '100' }]);
    const callsBefore = state.inventoryCalls;
    const payload = {
      lines: [{ orderLineId: order.lines[0].id, quantity: '100' }],
      idempotencyKey: 'same-key',
    };
    const first = await service.createReceipt(T1, 'u1', order.id, payload);
    const second = await service.createReceipt(T1, 'u1', order.id, payload);
    expect(second.id).toBe(first.id);
    expect(state.journals).toHaveLength(1);
    expect(state.inventoryCalls).toBe(callsBefore + 1);
    expect(state.receipts).toHaveLength(1);
  });

  it('refuses an over-receipt at tolerance 0 and stores nothing', async () => {
    const order = await approvedOrder([{ sku: 'A', quantity: '1000', unitPrice: '100' }]);
    await service.createReceipt(T1, 'u1', order.id, {
      lines: [{ orderLineId: order.lines[0].id, quantity: '999' }],
    });
    await expect(
      service.createReceipt(T1, 'u1', order.id, {
        lines: [{ orderLineId: order.lines[0].id, quantity: '2' }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(state.receipts).toHaveLength(1);
    expect((await service.getOrder(T1, order.id)).status).toBe(PurchaseOrderStatus.PARTIALLY_RECEIVED);
  });

  it('allows the over-receipt tolerance in basis points (100 bp = +1%)', async () => {
    await service.updateSettings(T1, { overReceiptToleranceBp: 100 });
    const accepted = await approvedOrder([{ sku: 'A', quantity: '1000', unitPrice: '100' }]);
    const receipt = await service.createReceipt(T1, 'u1', accepted.id, {
      lines: [{ orderLineId: accepted.lines[0].id, quantity: '1010' }],
    });
    expect(receipt.lines[0].quantity).toBe('1010');

    const refused = await approvedOrder([{ sku: 'A', quantity: '1000', unitPrice: '100' }]);
    await expect(
      service.createReceipt(T1, 'u1', refused.id, {
        lines: [{ orderLineId: refused.lines[0].id, quantity: '1011' }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('requires an approved order before a receipt', async () => {
    const draft = await service.createOrder(T1, 'u1', {
      supplierCode: 'SUP',
      orderDate: '2026-11-05',
      lines: [{ sku: 'A', quantity: '100', unitPrice: '100' }],
    });
    await expect(
      service.createReceipt(T1, 'u1', draft.id, {
        lines: [{ orderLineId: draft.lines[0].id, quantity: '100' }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(state.receipts).toHaveLength(0);
  });

  it('rolls back stock and receipt when the journal posting fails', async () => {
    const order = await approvedOrder([{ sku: 'A', quantity: '100', unitPrice: '100' }]);
    const callsBefore = state.inventoryCalls;
    const receiptsBefore = state.receipts.length;
    state.failJournal = true;
    await expect(
      service.createReceipt(T1, 'u1', order.id, {
        lines: [{ orderLineId: order.lines[0].id, quantity: '100' }],
      }),
    ).rejects.toThrow('posting failed');
    state.failJournal = false;
    expect(state.receipts).toHaveLength(receiptsBefore);
    expect(state.inventoryCalls).toBe(callsBefore);
    expect((await service.getOrder(T1, order.id)).status).toBe(PurchaseOrderStatus.APPROVED);
  });

  it('never shows another tenant the order', async () => {
    const order = await service.createOrder(T1, 'u1', {
      supplierCode: 'SUP',
      orderDate: '2026-11-05',
      lines: [{ sku: 'A', quantity: '100', unitPrice: '100' }],
    });
    await expect(service.getOrder(T2, order.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('converts an open request into a DRAFT order and marks the request ORDERED', async () => {
    const request = await service.createRequest(T1, 'u1', {
      lines: [{ sku: 'A', quantity: '1000' }],
    });
    const order = await service.convertRequest(T1, 'u1', request.id, {
      supplierCode: 'SUP',
      orderDate: '2026-11-05',
      prices: { A: '5000000' },
    });
    expect(order.status).toBe(PurchaseOrderStatus.DRAFT);
    expect(order.requestId).toBe(request.id);
    expect(order.lines[0].unitPrice).toBe('5000000');
    const [listed] = await service.listRequests(T1);
    expect(listed.status).toBe(PurchaseRequestStatus.ORDERED);
    expect(listed.orderId).toBe(order.id);
  });

  it('stores the three tenant settings as bigint-safe strings', async () => {
    const saved = await service.updateSettings(T1, {
      overReceiptToleranceBp: 100,
      priceToleranceBp: 250,
      priceToleranceAbs: '123456789012345678',
    });
    expect(saved).toEqual({
      overReceiptToleranceBp: 100,
      priceToleranceBp: 250,
      priceToleranceAbs: '123456789012345678',
    });
    expect(await service.getSettings(T1)).toEqual(saved);
  });

  it('keeps a 2-decimal unit cost and a large value exact between ledger and stock layer', async () => {
    const order = await approvedOrder([{ sku: 'BIG', quantity: '300', unitPrice: '1234567890123' }]);
    const receipt = await service.createReceipt(T1, 'u1', order.id, {
      lines: [{ orderLineId: order.lines[0].id, quantity: '300' }],
    });
    // 3.00 x 12,345,678,901.23 rial = 37,037,036,703.69 rial = 3703703670369 minor, exactly.
    expect(receipt.totalValue).toBe('3703703670369');
    expect(state.stockCalls).toEqual([{ quantity: 3, unitPurchaseCost: 12345678901.23 }]);
    expect(state.journals[0].amounts).toEqual({ amount: 3703703670369n });
  });

  it('refuses a cost a double cannot hold exactly instead of drifting from the ledger', async () => {
    // 2^53 + 1 minor units: Number() would round it.
    const order = await approvedOrder([{ sku: 'HUGE', quantity: '100', unitPrice: '9007199254740993' }]);
    await expect(
      service.createReceipt(T1, 'u1', order.id, { lines: [{ orderLineId: order.lines[0].id, quantity: '100' }] }),
    ).rejects.toThrow(/too large/);
    expect(state.stockCalls).toHaveLength(0);
    expect(state.journals).toHaveLength(0);
  });
});