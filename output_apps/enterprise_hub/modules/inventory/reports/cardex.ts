import { StockMovementType } from '../enums/stock-movement-type.enum';
import { ReportColumn, ReportRow, ReportTable } from '../../accounting/reports/report-table';

/** FIFO layer used for valuation */
export interface FifoLayer {
  quantity: bigint;
  unitCost: bigint;
}

/** Movement input for the cardex report */
export interface CardexMovement {
  /** ISO date string YYYY-MM-DD */
  date: string;
  /** Document identifier (e.g., receipt number) */
  document: string;
  /** INBOUND adds a FIFO layer, OUTBOUND consumes FIFO */
  type: StockMovementType;
  /** Quantity (always positive) */
  quantity: bigint;
  /** Unit cost for inbound movements, rial minor units; ignored for outbound */
  unitCost?: bigint;
  /** One leg of a warehouse transfer. Left out when viewing all warehouses, where a transfer moves nothing. */
  transfer?: boolean;
}

/** One row of the cardex report */
export interface CardexRow {
  date: string;
  document: string;
  inQty: bigint;
  outQty: bigint;
  unitCost: bigint | null;
  runningQty: bigint;
  runningValue: bigint;
}

/** Result of the cardex calculation */
export interface CardexReport {
  openingQty: bigint;
  openingValue: bigint;
  rows: CardexRow[];
  closingQty: bigint;
  closingValue: bigint;
  /** Quantity issued beyond the stock on the card. Non-zero means the history is incomplete. */
  shortageQty: bigint;
}

/**
 * Compute a cardex (stock card) for a single SKU (optionally aggregated across warehouses).
 * FIFO consumption mirrors the existing inventory valuation logic.
 */
export function cardex(
  movements: readonly CardexMovement[],
  opening: readonly FifoLayer[],
  options: { allWarehouses?: boolean } = {},
): CardexReport {
  // Clone FIFO queue
  const fifo: FifoLayer[] = opening.map((l) => ({ quantity: l.quantity, unitCost: l.unitCost }));

  const openingQty = fifo.reduce((sum, l) => sum + l.quantity, 0n);
  const openingValue = fifo.reduce((sum, l) => sum + l.quantity * l.unitCost, 0n);

  let runningQty = openingQty;
  let runningValue = openingValue;

  const rows: CardexRow[] = [];

  // Sort movements chronologically (ISO date strings sort lexicographically)
  const sorted = movements
    .filter((m) => !(options.allWarehouses && m.transfer))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let shortageQty = 0n;

  for (const m of sorted) {
    if (m.type === StockMovementType.INBOUND) {
      const qty = m.quantity;
      const cost = m.unitCost ?? 0n;
      fifo.push({ quantity: qty, unitCost: cost });
      runningQty += qty;
      runningValue += qty * cost;
      rows.push({
        date: m.date,
        document: m.document,
        inQty: qty,
        outQty: 0n,
        unitCost: cost,
        runningQty,
        runningValue,
      });
    } else {
      // OUTBOUND – consume FIFO layers oldest first
      let remaining = m.quantity;
      const outQty = remaining;
      while (remaining > 0n && fifo.length > 0) {
        const layer = fifo[0];
        const take = remaining < layer.quantity ? remaining : layer.quantity;
        layer.quantity -= take;
        runningQty -= take;
        runningValue -= take * layer.unitCost;
        remaining -= take;
        if (layer.quantity === 0n) {
          fifo.shift();
        }
      }
      shortageQty += remaining;
      rows.push({
        date: m.date,
        document: m.document,
        inQty: 0n,
        outQty,
        unitCost: null,
        runningQty,
        runningValue,
      });
    }
  }

  const closingQty = runningQty;
  const closingValue = runningValue;

  return { openingQty, openingValue, rows, closingQty, closingValue, shortageQty };
}

/** ReportTable for the PDF and XLSX writers. `jalali` formats a YYYY-MM-DD day, as in reports/legal-books.ts. */
export function cardexTable(
  report: CardexReport,
  jalali: (day: string) => string,
  title = 'کاردکس کالا',
  subtitle = '',
): ReportTable {
  const columns: ReportColumn[] = [
    { title: 'تاریخ' },
    { title: 'سند', width: 1.4 },
    { title: 'ورودی', width: 0.8 },
    { title: 'خروجی', width: 0.8 },
    { title: 'بهای واحد (ریال)', width: 1.2, money: true },
    { title: 'مانده', width: 0.8 },
    { title: 'ارزش مانده (ریال)', width: 1.2, money: true },
  ];
  const openingRow: ReportRow = {
    bold: true,
    cells: ['', 'موجودی ابتدای دوره', '', '', null, String(report.openingQty), report.openingValue],
  };
  const dataRows: ReportRow[] = report.rows.map((r) => ({
    cells: [
      jalali(r.date),
      r.document,
      r.inQty ? String(r.inQty) : '',
      r.outQty ? String(r.outQty) : '',
      r.unitCost,
      String(r.runningQty),
      r.runningValue,
    ],
  }));
  const closingRow: ReportRow = {
    bold: true,
    cells: ['', 'موجودی پایان دوره', '', '', null, String(report.closingQty), report.closingValue],
  };
  const warning = report.shortageQty > 0n ? `خروجی بیش از موجودی به مقدار ${report.shortageQty}؛ گردش کالا ناقص است` : '';
  return {
    title,
    subtitle: [subtitle, warning].filter(Boolean).join('، '),
    columns,
    rows: [openingRow, ...dataRows, closingRow],
  };
}
