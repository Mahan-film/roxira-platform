import {
  PurchaseDomainError,
  assertTransition,
  lineValue,
  orderTotal,
  planReceipt,
  receivableLimit,
  validateOrderLines,
} from './purchase-order.domain';
import {
  PurchaseAccountRole,
  purchasePostingLines,
  resolvePurchaseRole,
} from './purchase-posting.adapter';
import { PurchaseOrder, PurchaseOrderStatus } from './purchase.types';

const order = (overrides: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: 'po-1',
  tenantId: 't1',
  number: 'PO-0001',
  supplierCode: 'SUP-1',
  status: PurchaseOrderStatus.APPROVED,
  warehouseId: null,
  lines: [
    { id: 'l1', sku: 'A', quantity: 1000n, unitPrice: 12_345_00n, receivedQuantity: 0n },
    { id: 'l2', sku: 'B', quantity: 250n, unitPrice: 333n, receivedQuantity: 0n },
  ],
  requestId: null,
  orderDate: '2026-11-04',
  approvedBy: 'u1',
  approvedAt: new Date('2026-11-04T08:00:00Z'),
  createdAt: new Date('2026-11-04T07:00:00Z'),
  ...overrides,
});

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    return (error as PurchaseDomainError).code;
  }
  return 'NO_ERROR';
};

describe('purchase order domain (#227 T2)', () => {
  it('values a line exactly, rounding half up to the minor unit', () => {
    expect(lineValue(1000n, 12_345_00n)).toBe(123_450_00n); // 10 units
    expect(lineValue(150n, 333n)).toBe(500n); // 1.5 x 3.33 = 4.995 -> 5.00
    expect(lineValue(1n, 49n)).toBe(0n);
    expect(lineValue(1n, 50n)).toBe(1n);
    expect(orderTotal(order())).toBe(123_450_00n + 833n); // 2.5 x 3.33 = 8.325 -> 8.33
  });

  it('refuses empty, non-positive, negatively priced and duplicate lines', () => {
    expect(code(() => validateOrderLines([]))).toBe('INVALID_LINE');
    expect(code(() => validateOrderLines([{ sku: 'A', quantity: 0n, unitPrice: 1n }]))).toBe('INVALID_LINE');
    expect(code(() => validateOrderLines([{ sku: ' ', quantity: 1n, unitPrice: 1n }]))).toBe('INVALID_LINE');
    expect(code(() => validateOrderLines([{ sku: 'A', quantity: 1n, unitPrice: -1n }]))).toBe('INVALID_LINE');
    expect(
      code(() =>
        validateOrderLines([
          { sku: 'A', quantity: 1n, unitPrice: 1n },
          { sku: 'A ', quantity: 2n, unitPrice: 1n },
        ]),
      ),
    ).toBe('DUPLICATE_LINE');
    expect(code(() => validateOrderLines([{ sku: 'A', quantity: 1n, unitPrice: 0n }]))).toBe('NO_ERROR');
  });

  it('allows only the documented status transitions', () => {
    expect(code(() => assertTransition(PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.APPROVED))).toBe('NO_ERROR');
    expect(code(() => assertTransition(PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.RECEIVED))).toBe(
      'INVALID_TRANSITION',
    );
    expect(code(() => assertTransition(PurchaseOrderStatus.APPROVED, PurchaseOrderStatus.CLOSED))).toBe(
      'INVALID_TRANSITION',
    );
    for (const done of [PurchaseOrderStatus.RECEIVED, PurchaseOrderStatus.CLOSED, PurchaseOrderStatus.CANCELLED]) {
      expect(code(() => assertTransition(done, PurchaseOrderStatus.APPROVED))).toBe('INVALID_TRANSITION');
    }
  });

  it('over-receipt tolerance is basis points of the ordered quantity, rounded down', () => {
    const line = order().lines[0];
    expect(receivableLimit(line, { overReceiptToleranceBp: 0 })).toBe(1000n);
    expect(receivableLimit(line, { overReceiptToleranceBp: 500 })).toBe(1050n);
    expect(receivableLimit({ ...line, quantity: 333n }, { overReceiptToleranceBp: 50 })).toBe(334n);
  });

  it('plans a partial receipt at the PO price', () => {
    const plan = planReceipt(order(), [{ orderLineId: 'l1', quantity: 400n, weight: 12_500n }], {
      overReceiptToleranceBp: 0,
    });
    expect(plan.statusAfter).toBe(PurchaseOrderStatus.PARTIALLY_RECEIVED);
    expect(plan.lines).toEqual([
      { orderLineId: 'l1', sku: 'A', quantity: 400n, unitCost: 12_345_00n, value: 49_380_00n, weight: 12_500n },
    ]);
    expect(plan.totalValue).toBe(49_380_00n);
    expect(plan.receivedAfter.get('l1')).toBe(400n);
    expect(plan.receivedAfter.get('l2')).toBe(0n);
  });

  it('marks the order RECEIVED when every line is complete', () => {
    const partly = order({
      status: PurchaseOrderStatus.PARTIALLY_RECEIVED,
      lines: order().lines.map((line) => (line.id === 'l1' ? { ...line, receivedQuantity: 1000n } : line)),
    });
    const plan = planReceipt(partly, [{ orderLineId: 'l2', quantity: 250n }], { overReceiptToleranceBp: 0 });
    expect(plan.statusAfter).toBe(PurchaseOrderStatus.RECEIVED);
  });

  it('refuses receipts on orders that are not approved, and bad lines', () => {
    const settings = { overReceiptToleranceBp: 0 };
    const one = [{ orderLineId: 'l1', quantity: 1n }];
    for (const status of [PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.CLOSED, PurchaseOrderStatus.CANCELLED]) {
      expect(code(() => planReceipt(order({ status }), one, settings))).toBe('NOT_RECEIVABLE');
    }
    expect(code(() => planReceipt(order(), [], settings))).toBe('INVALID_LINE');
    expect(code(() => planReceipt(order(), [{ orderLineId: 'zz', quantity: 1n }], settings))).toBe(
      'UNKNOWN_ORDER_LINE',
    );
    expect(code(() => planReceipt(order(), [...one, ...one], settings))).toBe('DUPLICATE_LINE');
    expect(code(() => planReceipt(order(), [{ orderLineId: 'l1', quantity: 0n }], settings))).toBe('INVALID_LINE');
    expect(code(() => planReceipt(order(), [{ orderLineId: 'l1', quantity: 1001n }], settings))).toBe(
      'OVER_RECEIPT',
    );
    expect(
      code(() => planReceipt(order(), [{ orderLineId: 'l1', quantity: 1050n }], { overReceiptToleranceBp: 500 })),
    ).toBe('NO_ERROR');
  });
});

describe('purchase posting adapter (#227 T2)', () => {
  const event = {
    kind: 'GOODS_RECEIPT' as const,
    receiptId: 'gr-1',
    receiptNumber: 'GR-0001',
    orderNumber: 'PO-0001',
    supplierCode: 'SUP-1',
    receivedAt: new Date('2026-11-04T09:00:00Z'),
    value: 49_380_00n,
  };

  it('posts a receipt as INVENTORY debit / GRNI credit, balanced, supplier on the GRNI line', () => {
    const posting = purchasePostingLines(event)!;
    expect(posting.sourceType).toBe('GOODS_RECEIPT');
    expect(posting.lines.map((line) => [line.role, line.debit, line.credit, line.partyCode])).toEqual([
      [PurchaseAccountRole.INVENTORY, 49_380_00n, 0n, undefined],
      [PurchaseAccountRole.GRNI, 0n, 49_380_00n, 'SUP-1'],
    ]);
    const debit = posting.lines.reduce((sum, line) => sum + line.debit, 0n);
    const credit = posting.lines.reduce((sum, line) => sum + line.credit, 0n);
    expect(debit).toBe(credit);
  });

  it('posts nothing for a zero-value receipt', () => {
    expect(purchasePostingLines({ ...event, value: 0n })).toBeNull();
  });

  it('maps every role to its own account', () => {
    const roles = Object.values(PurchaseAccountRole);
    const codes = roles.map((role) => resolvePurchaseRole(role).code);
    expect(new Set(codes).size).toBe(roles.length);
  });
});
