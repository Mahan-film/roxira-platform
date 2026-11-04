import { InMemoryPurchase } from './__fixtures__/in-memory-purchase';
import { PurchaseCycleService } from './purchase-cycle.service';
import { PurchaseDomainError } from './purchase-order.domain';
import { PurchaseAccountRole } from './purchase-posting.adapter';
import { PurchaseOrderStatus, PurchaseRequestStatus } from './purchase.types';

const T = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const AT = new Date('2026-11-04T09:00:00Z');

const rejects = async (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ name: PurchaseDomainError.name, code });

describe('PurchaseCycleService: request, order, receipts (#227 T2)', () => {
  let world: InMemoryPurchase;
  let service: PurchaseCycleService;

  beforeEach(() => {
    world = new InMemoryPurchase();
    service = new PurchaseCycleService(world, world, world, () => AT);
  });

  /** PO for 10 x A at 1,200,000.00 and 4 x B at 75,000.50, approved. */
  const approvedOrder = async (tenantId = T) => {
    const order = await service.createOrder(tenantId, {
      supplierCode: 'SUP-1',
      orderDate: '2026-11-04',
      warehouseId: 3,
      lines: [
        { sku: 'A', quantity: 1000n, unitPrice: 1_200_000_00n },
        { sku: 'B', quantity: 400n, unitPrice: 75_000_50n },
      ],
    });
    return service.approveOrder(tenantId, order.id, 'buyer');
  };

  it('converts a request into a draft order with the given prices', async () => {
    const request = await service.createRequest(T, 'clerk', [{ sku: 'A', quantity: 500n }]);
    expect(request).toMatchObject({ number: 'PR-0001', status: PurchaseRequestStatus.OPEN, requestedBy: 'clerk' });

    const order = await service.convertRequest(T, request.id, {
      supplierCode: 'SUP-1',
      orderDate: '2026-11-04',
      prices: { A: 990_000_00n },
    });
    expect(order).toMatchObject({ number: 'PO-0001', status: PurchaseOrderStatus.DRAFT, requestId: request.id });
    expect(order.lines.map((line) => [line.sku, line.quantity, line.unitPrice])).toEqual([['A', 500n, 990_000_00n]]);
    expect(world.state.requests[request.id]).toMatchObject({ status: PurchaseRequestStatus.ORDERED, orderId: order.id });

    await rejects(
      service.convertRequest(T, request.id, { supplierCode: 'SUP-1', orderDate: '2026-11-04', prices: { A: 1n } }),
      'INVALID_TRANSITION',
    );
  });

  it('refuses to convert a request without a price for every SKU', async () => {
    const request = await service.createRequest(T, 'clerk', [{ sku: 'A', quantity: 500n }]);
    await rejects(
      service.convertRequest(T, request.id, { supplierCode: 'SUP-1', orderDate: '2026-11-04', prices: {} }),
      'INVALID_LINE',
    );
    expect(world.state.requests[request.id].status).toBe(PurchaseRequestStatus.OPEN);
    expect(Object.keys(world.state.orders)).toHaveLength(0);
  });

  it('two receipts: FIFO layers at the PO price, order completes, INVENTORY/GRNI posted per receipt', async () => {
    const order = await approvedOrder();
    const [a, b] = order.lines;

    const first = await service.receive(T, 'storekeeper', {
      orderId: order.id,
      receivedAt: AT,
      lines: [
        { orderLineId: a.id, quantity: 600n, weight: 300_000n },
        { orderLineId: b.id, quantity: 400n },
      ],
    });
    expect(first.number).toBe('GR-0001');
    expect(first.totalValue).toBe(7_200_000_00n + 300_002_00n);
    expect(world.state.orders[order.id].status).toBe(PurchaseOrderStatus.PARTIALLY_RECEIVED);

    const second = await service.receive(T, 'storekeeper', {
      orderId: order.id,
      receivedAt: new Date('2026-11-06T09:00:00Z'),
      lines: [{ orderLineId: a.id, quantity: 400n }],
    });
    expect(second.totalValue).toBe(4_800_000_00n);
    const saved = world.state.orders[order.id];
    expect(saved.status).toBe(PurchaseOrderStatus.RECEIVED);
    expect(saved.lines.map((line) => line.receivedQuantity)).toEqual([1000n, 400n]);

    expect(world.state.layers.map((layer) => [layer.sku, layer.quantity, layer.unitPurchaseCost, layer.batchNumber, layer.warehouseId])).toEqual([
      ['A', 6, 1_200_000, 'GR-0001-1', 3],
      ['B', 4, 75_000.5, 'GR-0001-2', 3],
      ['A', 4, 1_200_000, 'GR-0002-1', 3],
    ]);
    expect(first.lines.map((line) => line.fifoBatchId)).toEqual([1, 2]);
    expect(first.lines[0].weight).toBe(300_000n);

    expect(world.state.postings).toHaveLength(2);
    for (const [posting, receipt] of [[world.state.postings[0], first], [world.state.postings[1], second]] as const) {
      expect(posting.sourceId).toBe(receipt.id);
      expect(receipt.journalEntryId).toBe(posting.entryId);
      expect(posting.lines.map((line) => [line.role, line.debit, line.credit])).toEqual([
        [PurchaseAccountRole.INVENTORY, receipt.totalValue, 0n],
        [PurchaseAccountRole.GRNI, 0n, receipt.totalValue],
      ]);
    }
    const posted = world.state.postings.reduce((sum, posting) => sum + posting.lines[0].debit, 0n);
    expect(posted).toBe(12_000_000_00n + 300_002_00n);
  });

  it('receives only approved orders', async () => {
    const draft = await service.createOrder(T, {
      supplierCode: 'SUP-1',
      orderDate: '2026-11-04',
      lines: [{ sku: 'A', quantity: 100n, unitPrice: 1n }],
    });
    await rejects(
      service.receive(T, 'sk', { orderId: draft.id, receivedAt: AT, lines: [{ orderLineId: draft.lines[0].id, quantity: 1n }] }),
      'NOT_RECEIVABLE',
    );
  });

  it('refuses over-receipt, and allows it inside the tenant tolerance', async () => {
    const order = await approvedOrder();
    const a = order.lines[0];
    await rejects(
      service.receive(T, 'sk', { orderId: order.id, receivedAt: AT, lines: [{ orderLineId: a.id, quantity: 1001n }] }),
      'OVER_RECEIPT',
    );
    world.settingsByTenant[T] = { overReceiptToleranceBp: 200 };
    const receipt = await service.receive(T, 'sk', {
      orderId: order.id,
      receivedAt: AT,
      lines: [{ orderLineId: a.id, quantity: 1020n }],
    });
    expect(receipt.lines[0].quantity).toBe(1020n);
  });

  it('the same idempotency key returns the first receipt and receives nothing twice', async () => {
    const order = await approvedOrder();
    const input = {
      orderId: order.id,
      receivedAt: AT,
      idempotencyKey: 'scan-77',
      lines: [{ orderLineId: order.lines[0].id, quantity: 100n }],
    };
    const first = await service.receive(T, 'sk', input);
    const again = await service.receive(T, 'sk', input);
    expect(again.id).toBe(first.id);
    expect(world.state.layers).toHaveLength(1);
    expect(world.state.postings).toHaveLength(1);
    expect(world.state.orders[order.id].lines[0].receivedQuantity).toBe(100n);
  });

  it('a failed stock-in rolls back the whole receipt', async () => {
    const order = await approvedOrder();
    const [a, b] = order.lines;
    const before = structuredClone(world.state);
    // Fail on the second line: the first layer must not survive.
    const realReceive = world.receive.bind(world);
    let calls = 0;
    world.receive = async (...args) => {
      calls += 1;
      if (calls === 2) throw new Error('stock-in failed');
      return realReceive(...args);
    };
    await expect(
      service.receive(T, 'sk', {
        orderId: order.id,
        receivedAt: AT,
        lines: [
          { orderLineId: a.id, quantity: 100n },
          { orderLineId: b.id, quantity: 100n },
        ],
      }),
    ).rejects.toThrow('stock-in failed');
    expect(world.state).toEqual(before);
  });

  it('cancels only before any receipt; a partly received order is short-closed', async () => {
    const order = await approvedOrder();
    await service.receive(T, 'sk', { orderId: order.id, receivedAt: AT, lines: [{ orderLineId: order.lines[0].id, quantity: 100n }] });
    await rejects(service.cancelOrder(T, order.id), 'INVALID_TRANSITION');
    const closed = await service.closeOrder(T, order.id);
    expect(closed.status).toBe(PurchaseOrderStatus.CLOSED);
    await rejects(
      service.receive(T, 'sk', { orderId: order.id, receivedAt: AT, lines: [{ orderLineId: order.lines[0].id, quantity: 1n }] }),
      'NOT_RECEIVABLE',
    );

    const other = await approvedOrder();
    expect((await service.cancelOrder(T, other.id)).status).toBe(PurchaseOrderStatus.CANCELLED);
  });

  it("never reads, approves or receives another tenant's order", async () => {
    const order = await approvedOrder(T);
    await rejects(service.approveOrder(T2, order.id, 'x'), 'NOT_FOUND');
    await rejects(service.cancelOrder(T2, order.id), 'NOT_FOUND');
    await rejects(
      service.receive(T2, 'x', { orderId: order.id, receivedAt: AT, lines: [{ orderLineId: order.lines[0].id, quantity: 1n }] }),
      'NOT_FOUND',
    );
    const request = await service.createRequest(T, 'clerk', [{ sku: 'A', quantity: 1n }]);
    await rejects(
      service.convertRequest(T2, request.id, { supplierCode: 'S', orderDate: '2026-11-04', prices: { A: 1n } }),
      'NOT_FOUND',
    );
    expect(world.state.layers).toHaveLength(0);
    expect(world.state.orders[order.id].status).toBe(PurchaseOrderStatus.APPROVED);
  });

  it('numbers documents per tenant', async () => {
    const one = await approvedOrder(T);
    const two = await approvedOrder(T2);
    expect([one.number, two.number]).toEqual(['PO-0001', 'PO-0001']);
  });
});
