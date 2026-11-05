import { StockDocumentType } from '../enums/stock-document.enum';
import { StockMovementType } from '../enums/stock-movement-type.enum';
import { BalanceMovement } from './stock-balance';
import { MovementDoc, replayMovements } from './stock-movements';

const IN = StockMovementType.INBOUND;
const OUT = StockMovementType.OUTBOUND;

const doc = (
  id: number,
  docType: StockDocumentType,
  docDate: string,
  docNumber: string,
  fromWarehouseId: number | null,
  toWarehouseId: number | null,
  lines: MovementDoc['lines'],
): MovementDoc => ({ id, docType, docDate, docNumber, fromWarehouseId, toWarehouseId, lines });

const move = (
  itemId: string,
  warehouseId: string | null,
  date: string,
  document: string,
  type: StockMovementType,
  quantity: bigint,
  extra: Partial<BalanceMovement> = {},
): BalanceMovement => ({ itemId, warehouseId, date, document, type, quantity, ...extra });

describe('replayMovements', () => {
  it('replays receipts, a transfer split per consumed layer, and a same-day delivery after the transfer', () => {
    const docs: MovementDoc[] = [
      doc(1, StockDocumentType.PURCHASE_RECEIPT, '2026-05-01', 'PR-1', null, 1, [{ id: 1, sku: 'A', quantity: 10, unitCost: 100 }]),
      doc(2, StockDocumentType.PURCHASE_RECEIPT, '2026-05-02', 'PR-2', null, 1, [{ id: 1, sku: 'A', quantity: 5, unitCost: 200 }]),
      doc(3, StockDocumentType.TRANSFER, '2026-05-03', 'TR-1', 1, 2, [{ id: 1, sku: 'A', quantity: 12, unitCost: 0 }]),
      doc(4, StockDocumentType.SALES_DELIVERY, '2026-05-03', 'DEL-1', 2, null, [{ id: 1, sku: 'A', quantity: 3, unitCost: 0 }]),
    ];

    expect(replayMovements(docs)).toEqual([
      move('A', '1', '2026-05-01', 'PR-1', IN, 1000n, { unitCost: 10000n }),
      move('A', '1', '2026-05-02', 'PR-2', IN, 500n, { unitCost: 20000n }),
      // TR-1 takes the whole 10 @100 layer first...
      move('A', '1', '2026-05-03', 'TR-1', OUT, 1000n, { transfer: true }),
      move('A', '2', '2026-05-03', 'TR-1', IN, 1000n, { unitCost: 10000n, transfer: true }),
      // ...then 2 of the 5 @200 layer; each leg keeps its own cost.
      move('A', '1', '2026-05-03', 'TR-1', OUT, 200n, { transfer: true }),
      move('A', '2', '2026-05-03', 'TR-1', IN, 200n, { unitCost: 20000n, transfer: true }),
      // DEL-1 replays after TR-1 on the same day (rank 2 > 1) and takes 3 from wh2's oldest layer (10 @100).
      move('A', '2', '2026-05-03', 'DEL-1', OUT, 300n),
    ]);
  });

  it('replays a same-day receipt before a delivery that has a lower document id', () => {
    const docs: MovementDoc[] = [
      doc(1, StockDocumentType.SALES_DELIVERY, '2026-05-01', 'DEL-1', 1, null, [{ id: 1, sku: 'A', quantity: 4, unitCost: 0 }]),
      doc(2, StockDocumentType.PURCHASE_RECEIPT, '2026-05-01', 'PR-1', null, 1, [{ id: 1, sku: 'A', quantity: 10, unitCost: 100 }]),
    ];

    expect(replayMovements(docs)).toEqual([
      move('A', '1', '2026-05-01', 'PR-1', IN, 1000n, { unitCost: 10000n }),
      move('A', '1', '2026-05-01', 'DEL-1', OUT, 400n),
    ]);
  });

  it('a delivery with no warehouse consumes the oldest layer across warehouses', () => {
    const docs: MovementDoc[] = [
      doc(1, StockDocumentType.PURCHASE_RECEIPT, '2026-05-01', 'PR-W1', null, 1, [{ id: 1, sku: 'A', quantity: 5, unitCost: 100 }]),
      doc(2, StockDocumentType.PURCHASE_RECEIPT, '2026-05-01', 'PR-W2', null, 2, [{ id: 1, sku: 'A', quantity: 5, unitCost: 200 }]),
      doc(3, StockDocumentType.SALES_DELIVERY, '2026-05-02', 'DEL-1', null, null, [{ id: 1, sku: 'A', quantity: 7, unitCost: 0 }]),
    ];

    // Oldest seq is wh1's layer (document 1), then wh2's: 5 from wh1 + 2 from wh2.
    expect(replayMovements(docs)).toEqual([
      move('A', '1', '2026-05-01', 'PR-W1', IN, 500n, { unitCost: 10000n }),
      move('A', '2', '2026-05-01', 'PR-W2', IN, 500n, { unitCost: 20000n }),
      move('A', '1', '2026-05-02', 'DEL-1', OUT, 500n),
      move('A', '2', '2026-05-02', 'DEL-1', OUT, 200n),
    ]);
  });

  it('emits the unbacked remainder of an outbound so cardex() can report the shortage', () => {
    const docs: MovementDoc[] = [
      doc(1, StockDocumentType.PURCHASE_RECEIPT, '2026-05-01', 'PR-1', null, 1, [{ id: 1, sku: 'A', quantity: 2, unitCost: 100 }]),
      doc(2, StockDocumentType.SALES_DELIVERY, '2026-05-02', 'DEL-1', 1, null, [{ id: 1, sku: 'A', quantity: 5, unitCost: 0 }]),
    ];

    expect(replayMovements(docs)).toEqual([
      move('A', '1', '2026-05-01', 'PR-1', IN, 200n, { unitCost: 10000n }),
      move('A', '1', '2026-05-02', 'DEL-1', OUT, 200n),
      move('A', '1', '2026-05-02', 'DEL-1', OUT, 300n),
    ]);
  });

  it('treats a positive adjustment as inbound and a negative one as outbound', () => {
    const docs: MovementDoc[] = [
      doc(1, StockDocumentType.ADJUSTMENT, '2026-05-01', 'AJ-1', null, 1, [{ id: 1, sku: 'A', quantity: 8, unitCost: 50 }]),
      doc(2, StockDocumentType.ADJUSTMENT, '2026-05-02', 'AJ-2', null, 1, [{ id: 1, sku: 'A', quantity: -3, unitCost: 0 }]),
    ];

    expect(replayMovements(docs)).toEqual([
      move('A', '1', '2026-05-01', 'AJ-1', IN, 800n, { unitCost: 5000n }),
      move('A', '1', '2026-05-02', 'AJ-2', OUT, 300n),
    ]);
  });

  it('emits a transfer shortage only as an outbound remainder', () => {
    const docs: MovementDoc[] = [
      doc(1, StockDocumentType.PURCHASE_RECEIPT, '2026-05-01', 'PR-1', null, 1, [{ id: 1, sku: 'A', quantity: 2, unitCost: 100 }]),
      doc(2, StockDocumentType.TRANSFER, '2026-05-02', 'TR-1', 1, 2, [{ id: 1, sku: 'A', quantity: 5, unitCost: 0 }]),
    ];

    expect(replayMovements(docs)).toEqual([
      move('A', '1', '2026-05-01', 'PR-1', IN, 200n, { unitCost: 10000n }),
      move('A', '1', '2026-05-02', 'TR-1', OUT, 200n, { transfer: true }),
      move('A', '2', '2026-05-02', 'TR-1', IN, 200n, { unitCost: 10000n, transfer: true }),
      move('A', '1', '2026-05-02', 'TR-1', OUT, 300n, { transfer: true }),
    ]);
  });
});
