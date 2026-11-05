import { StockMovementType } from '../enums/stock-movement-type.enum';
import { CardexMovement, cardex, cardexTable, FifoLayer } from './cardex';

const IN = StockMovementType.INBOUND;
const OUT = StockMovementType.OUTBOUND;
const move = (date: string, type: StockMovementType, quantity: bigint, unitCost?: bigint, extra: Partial<CardexMovement> = {}): CardexMovement => ({
  date,
  document: `${date}-${type}`,
  type,
  quantity,
  unitCost,
  ...extra,
});
const opening: FifoLayer[] = [{ quantity: 1000n, unitCost: 100n }];

describe('cardex', () => {
  it('keeps FIFO order across two receipts and an issue that crosses a layer', () => {
    const report = cardex(
      [move('2026-01-01', IN, 1000n, 80n), move('2026-01-02', IN, 500n, 120n), move('2026-01-03', OUT, 1200n)],
      opening,
    );
    expect(report.openingQty).toBe(1000n);
    expect(report.openingValue).toBe(100000n);
    expect(report.rows.map((r) => [r.runningQty, r.runningValue])).toEqual([
      [2000n, 180000n],
      [2500n, 240000n],
      // 1000 at 100 and 200 at 80 leave: 800 at 80 and 500 at 120.
      [1300n, 124000n],
    ]);
    expect(report.closingQty).toBe(1300n);
    expect(report.closingValue).toBe(124000n);
    expect(report.shortageQty).toBe(0n);
  });

  it('orders by date whatever the input order', () => {
    const report = cardex([move('2026-02-01', OUT, 100n), move('2026-01-01', IN, 100n, 50n)], []);
    expect(report.rows.map((r) => r.date)).toEqual(['2026-01-01', '2026-02-01']);
    expect(report.closingValue).toBe(0n);
  });

  it('drops a transfer from the all-warehouses view and keeps it on the warehouse card', () => {
    const legs = [
      move('2026-01-05', OUT, 200n, undefined, { transfer: true }),
      move('2026-01-05', IN, 200n, 100n, { transfer: true }),
    ];
    const all = cardex(legs, opening, { allWarehouses: true });
    expect(all.rows).toEqual([]);
    expect([all.closingQty, all.closingValue]).toEqual([1000n, 100000n]);
    expect(cardex(legs, opening).rows).toHaveLength(2);
  });

  it('reports an issue beyond the stock instead of hiding it', () => {
    const report = cardex([move('2026-01-01', OUT, 1500n)], opening);
    expect(report.rows[0].outQty).toBe(1500n);
    expect(report.shortageQty).toBe(500n);
    expect([report.closingQty, report.closingValue]).toEqual([0n, 0n]);
  });

  it('does not change the opening layers it was given', () => {
    const layers: FifoLayer[] = [{ quantity: 10n, unitCost: 5n }];
    cardex([move('2026-01-01', OUT, 10n)], layers);
    expect(layers[0].quantity).toBe(10n);
  });
});

describe('cardexTable', () => {
  it('has Persian labels, Jalali dates and bold opening and closing rows', () => {
    const report = cardex([move('2026-01-01', IN, 1000n, 80n), move('2026-01-03', OUT, 1200n)], opening);
    const table = cardexTable(report, (day) => `j:${day}`, 'کاردکس کالا', 'انبار مرکزی');
    expect(table.title).toBe('کاردکس کالا');
    expect(table.subtitle).toBe('انبار مرکزی');
    expect(table.columns.filter((c) => c.money).map((c) => c.title)).toEqual(['بهای واحد (ریال)', 'ارزش مانده (ریال)']);
    expect(table.rows[0]).toEqual({ bold: true, cells: ['', 'موجودی ابتدای دوره', '', '', null, '1000', 100000n] });
    expect(table.rows[1].cells).toEqual(['j:2026-01-01', '2026-01-01-INBOUND', '1000', '', 80n, '2000', 180000n]);
    expect(table.rows[2].cells).toEqual(['j:2026-01-03', '2026-01-03-OUTBOUND', '', '1200', null, '800', 64000n]);
    expect(table.rows[3]).toEqual({ bold: true, cells: ['', 'موجودی پایان دوره', '', '', null, '800', 64000n] });
  });

  it('warns in the subtitle when the card is short', () => {
    const table = cardexTable(cardex([move('2026-01-01', OUT, 1500n)], opening), (day) => day);
    expect(table.subtitle).toContain('500');
  });
});
