import { StockDocumentType } from '../enums/stock-document.enum';
import { StockMovementType } from '../enums/stock-movement-type.enum';
import { QUANTITY_UNIT } from '../constants/inventory.constants';
import { toMinor } from '../../accounting/money';
import { BalanceMovement } from './stock-balance';

/**
 * A posted stock document ready for replay: its header (warehouses, date, number) and its lines.
 * `quantity` is in decimal units and is signed for ADJUSTMENT lines; `unitCost` is rial decimal.
 */
export interface MovementDoc {
  id: number;
  docType: StockDocumentType;
  /** `YYYY-MM-DD`. */
  docDate: string;
  docNumber: string;
  fromWarehouseId: number | null;
  toWarehouseId: number | null;
  lines: Array<{ id: number; sku: string; quantity: number; unitCost: number }>;
}

/** FIFO layer carried through the replay. `seq` orders layers oldest-first and survives a transfer. */
interface Layer {
  quantity: bigint;
  unitCost: bigint;
  seq: number;
}

/** Processing class of a line: 0 inbound, 1 transfer, 2 outbound. */
type Rank = 0 | 1 | 2;

interface LineTask {
  doc: MovementDoc;
  line: MovementDoc['lines'][number];
  rank: Rank;
}

/** A transfer stores one blended line, so its legs are rebuilt from the layers its out-leg consumed. */
function lineRank(docType: StockDocumentType, quantity: number): Rank {
  if (docType === StockDocumentType.TRANSFER) return 1;
  if (docType === StockDocumentType.SALES_DELIVERY) return 2;
  if (docType === StockDocumentType.ADJUSTMENT) return quantity > 0 ? 0 : 2;
  return 0;
}

/** `String(id)` for a real warehouse, `null` when it is unset (its own FIFO queue). */
function warehouseKey(id: number | null): string | null {
  return id === null ? null : String(id);
}

/**
 * Rebuilds per-warehouse FIFO movements from posted stock documents by replaying them oldest first:
 * `docDate` ascending, then inbound before transfer before outbound on one day, then document id,
 * then line id. Quantities are hundredths of a unit and costs are rial minor units; the only
 * floating arithmetic is the two conversions at the edge. Pure, no I/O.
 */
export function replayMovements(docs: readonly MovementDoc[]): BalanceMovement[] {
  const tasks: LineTask[] = [];
  for (const doc of docs) {
    for (const line of doc.lines) {
      tasks.push({ doc, line, rank: lineRank(doc.docType, line.quantity) });
    }
  }
  tasks.sort((a, b) => {
    if (a.doc.docDate !== b.doc.docDate) return a.doc.docDate < b.doc.docDate ? -1 : 1;
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.doc.id !== b.doc.id) return a.doc.id - b.doc.id;
    return a.line.id - b.line.id;
  });

  // sku -> warehouse key -> FIFO queue (oldest layer first).
  const queues = new Map<string, Map<string | null, Layer[]>>();
  let seq = 0;
  const movements: BalanceMovement[] = [];

  const queueFor = (sku: string, key: string | null): Layer[] => {
    let byWarehouse = queues.get(sku);
    if (!byWarehouse) {
      byWarehouse = new Map();
      queues.set(sku, byWarehouse);
    }
    let queue = byWarehouse.get(key);
    if (!queue) {
      queue = [];
      byWarehouse.set(key, queue);
    }
    return queue;
  };

  /** Index of the oldest-seq layer: a transfer may put an older layer behind a newer one. */
  const oldestIndex = (queue: Layer[]): number => {
    let oldest = 0;
    for (let index = 1; index < queue.length; index += 1) {
      if (queue[index].seq < queue[oldest].seq) oldest = index;
    }
    return oldest;
  };

  for (const { doc, line, rank } of tasks) {
    const quantity = BigInt(Math.round(Math.abs(line.quantity) * Number(QUANTITY_UNIT)));
    const base = { itemId: line.sku, date: doc.docDate, document: doc.docNumber } as const;

    if (rank === 0) {
      const key = warehouseKey(doc.toWarehouseId ?? doc.fromWarehouseId);
      const unitCost = toMinor(line.unitCost);
      queueFor(line.sku, key).push({ quantity, unitCost, seq: seq++ });
      movements.push({ ...base, warehouseId: key, type: StockMovementType.INBOUND, quantity, unitCost });
      continue;
    }

    if (rank === 1) {
      const fromKey = warehouseKey(doc.fromWarehouseId);
      const toKey = warehouseKey(doc.toWarehouseId);
      const source = queueFor(line.sku, fromKey);
      let remaining = quantity;
      while (remaining > 0n && source.length > 0) {
        const index = oldestIndex(source);
        const layer = source[index];
        const take = remaining < layer.quantity ? remaining : layer.quantity;
        movements.push({ ...base, warehouseId: fromKey, type: StockMovementType.OUTBOUND, quantity: take, transfer: true });
        movements.push({
          ...base,
          warehouseId: toKey,
          type: StockMovementType.INBOUND,
          quantity: take,
          unitCost: layer.unitCost,
          transfer: true,
        });
        queueFor(line.sku, toKey).push({ quantity: take, unitCost: layer.unitCost, seq: layer.seq });
        layer.quantity -= take;
        remaining -= take;
        if (layer.quantity === 0n) source.splice(index, 1);
      }
      if (remaining > 0n) {
        movements.push({ ...base, warehouseId: fromKey, type: StockMovementType.OUTBOUND, quantity: remaining, transfer: true });
      }
      continue;
    }

    // Outbound: a named warehouse consumes only its own queue, otherwise oldest across all queues.
    const docKey = warehouseKey(doc.fromWarehouseId ?? doc.toWarehouseId);
    let remaining = quantity;
    if (docKey !== null) {
      const queue = queueFor(line.sku, docKey);
      while (remaining > 0n && queue.length > 0) {
        const index = oldestIndex(queue);
        const layer = queue[index];
        const take = remaining < layer.quantity ? remaining : layer.quantity;
        movements.push({ ...base, warehouseId: docKey, type: StockMovementType.OUTBOUND, quantity: take });
        layer.quantity -= take;
        remaining -= take;
        if (layer.quantity === 0n) queue.splice(index, 1);
      }
    } else {
      const byWarehouse = queues.get(line.sku);
      while (remaining > 0n && byWarehouse && byWarehouse.size > 0) {
        let oldest: Layer | undefined;
        let oldestKey: string | null = null;
        let oldestAt = -1;
        for (const [key, queue] of byWarehouse) {
          if (queue.length === 0) continue;
          const index = oldestIndex(queue);
          if (!oldest || queue[index].seq < oldest.seq) {
            oldest = queue[index];
            oldestKey = key;
            oldestAt = index;
          }
        }
        if (!oldest) break;
        const take = remaining < oldest.quantity ? remaining : oldest.quantity;
        movements.push({ ...base, warehouseId: oldestKey, type: StockMovementType.OUTBOUND, quantity: take });
        oldest.quantity -= take;
        remaining -= take;
        if (oldest.quantity === 0n) byWarehouse.get(oldestKey)!.splice(oldestAt, 1);
      }
    }
    if (remaining > 0n) {
      movements.push({ ...base, warehouseId: docKey, type: StockMovementType.OUTBOUND, quantity: remaining });
    }
  }

  return movements;
}
