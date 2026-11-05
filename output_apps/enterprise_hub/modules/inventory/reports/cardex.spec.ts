import { StockMovementType } from '../enums/stock-movement-type.enum';
import { QUANTITY_UNIT } from '../constants/inventory.constants';
import { CardexMovement, cardex, cardexTable, FifoLayer, formatQty } from './cardex';

const IN = StockMovementType.INBOUND;
const OUT = StockMovementType.OUTBOUND;
const u = (n: number) => BigInt(n) * QUANTITY_UNIT;
const move = (date: string, type: StockMovementType, quantity: bigint, unitCost?: bigint, extra: Partial<CardexMovement> = {}): CardexMovement => ({
  date,
  document: `${date}-${type}`,
  type,
  quantity,
  unitCost,
  ...extra,
});
const opening: FifoLayer[] = [{ quantity: u(1000), unitCost: 100n }];

describe('formatQty', () => {
  it('always prints two decimals', () => {
    expect(formatQty(150n)).toBe('1.50');
    expect(formatQty(1000n)).toBe('10.00');
    expect(formatQty(5n)).toBe('0.05');
    expect(formatQty(0n)).toBe('0.00');
  });
});

describe('cardex', () => {
  it('keeps FIFO order across two receipts and an issue that crosses a layer', () => {
    const report = cardex(
      [move('2026-01-01', IN, u(1000), 80n), move('2026-01-02', IN, u(500), 120n), move('2026-01-03', OUT, u(1200))],
      opening,
    );
    expect(report.openingQty).toBe(u(1000));
    expect(report.openingValue).toBe(100000n);
    expect(report.rows.map((r) => [r.runningQty, r.runningValue])).toEqual([
      [u(2000), 180000n],
      [u(2500), 240000n],
      // 1000 at 100 and 200 at 80 leave: 800 at 80 and 500 at 120.
      [u(1300), 124000n],
    ]);
    expect(report.closingQty).toBe(u(1300));
    expect(report.closingValue).toBe(124000n);
    expect(report.shortageQty).toBe(0n);
  });

  it('orders by date whatever the input order', () => {
    const report = cardex([move('2026-02-01', OUT, u(100)), move('2026-01-01', IN, u(100), 50n)], []);
    expect(report.rows.map((r) => r.date)).toEqual(['2026-01-01', '2026-02-01']);
    expect(report.closingValue).toBe(0n);
  });

  it('consumes a same-day inbound before an outbound listed first in the input', () => {
    const report = cardex([move('2026-01-01', OUT, u(100)), move('2026-01-01', IN, u(100), 50n)], []);
    expect(report.shortageQty).toBe(0n);
    expect([report.closingQty, report.closingValue]).toEqual([0n, 0n]);
  });

  it('drops a transfer from the all-warehouses view and keeps it on the warehouse card', () => {
    const legs = [
      move('2026-01-05', OUT, u(200), undefined, { transfer: true }),
      move('2026-01-05', IN, u(200), 100n, { transfer: true }),
    ];
    const all = cardex(legs, opening, { allWarehouses: true });
    expect(all.rows).toEqual([]);
    expect([all.closingQty, all.closingValue]).toEqual([u(1000), 100000n]);
    expect(cardex(legs, opening).rows).toHaveLength(2);
  });

  it('reports an issue beyond the stock instead of hiding it', () => {
    const report = cardex([move('2026-01-01', OUT, u(1500))], opening);
    expect(report.rows[0].outQty).toBe(u(1500));
    expect(report.shortageQty).toBe(u(500));
    expect([report.closingQty, report.closingValue]).toEqual([0n, 0n]);
  });

  it('does not change the opening layers it was given', () => {
    const layers: FifoLayer[] = [{ quantity: u(10), unitCost: 5n }];
    cardex([move('2026-01-01', OUT, u(10))], layers);
    expect(layers[0].quantity).toBe(u(10));
  });

  it('rounds half up when valuing layers and partial takes', () => {
    // 1.50 @ 1001 -> layerValue 1502 (1501.5 rounds up).
    const report = cardex(
      [
        move('2026-01-01', IN, 150n, 1001n),
        move('2026-01-02', OUT, 50n),
        move('2026-01-03', OUT, 100n),
      ],
      [],
    );
    expect(report.rows[0].runningValue).toBe(1502n);
    // 0.50 @ 1001 -> 501 (500.5 rounds up).
    expect(report.rows[1].runningQty).toBe(100n);
    expect(report.rows[1].runningValue).toBe(1001n);
    // The last take empties the layer and uses its remaining 1001, not round(1001).
    expect(report.rows[2].runningValue).toBe(0n);
    expect([report.closingQty, report.closingValue]).toEqual([0n, 0n]);
  });

  it('takes a whole layer at its remaining value across two layers', () => {
    // Layer A: 1.50 @ 1001 -> 1502; layer B: 2.00 @ 2000 -> 4000.
    const report = cardex(
      [
        move('2026-01-01', IN, 150n, 1001n),
        move('2026-01-02', IN, 200n, 2000n),
        move('2026-01-03', OUT, 200n),
      ],
      [],
    );
    // Out takes all of A (1502) and 0.50 of B (50*2000/100 = 1000): total 2502.
    expect(report.rows[2].runningValue).toBe(3000n);
    expect([report.closingQty, report.closingValue]).toEqual([150n, 3000n]);
  });

  it('splits one layer three ways without drift and rounds a 0.01 layer up', () => {
    // 3.33 @ 100 -> 333; each third is 111; the last take empties the layer.
    const report = cardex(
      [
        move('2026-01-01', IN, 333n, 100n),
        move('2026-01-02', OUT, 111n),
        move('2026-01-03', OUT, 111n),
        move('2026-01-04', OUT, 111n),
        move('2026-01-05', IN, 1n, 150n),
      ],
      [],
    );
    expect(report.rows[0].runningValue).toBe(333n);
    expect(report.rows[3].runningValue).toBe(0n);
    // 0.01 @ 150 -> 2 (1.5 rounds up).
    expect([report.closingQty, report.closingValue]).toEqual([1n, 2n]);
  });
});

describe('cardexTable', () => {
  it('has Persian labels, Jalali dates and bold opening and closing rows', () => {
    const report = cardex([move('2026-01-01', IN, u(1000), 80n), move('2026-01-03', OUT, u(1200))], opening);
    const table = cardexTable(report, (day) => `j:${day}`, 'کاردکس کالا', 'انبار مرکزی');
    expect(table.title).toBe('کاردکس کالا');
    expect(table.subtitle).toBe('انبار مرکزی');
    expect(table.columns.filter((c) => c.money).map((c) => c.title)).toEqual(['بهای واحد (ریال)', 'ارزش مانده (ریال)']);
    expect(table.rows[0]).toEqual({ bold: true, cells: ['', 'موجودی ابتدای دوره', '', '', null, '1000.00', 100000n] });
    expect(table.rows[1].cells).toEqual(['j:2026-01-01', '2026-01-01-INBOUND', '1000.00', '', 80n, '2000.00', 180000n]);
    expect(table.rows[2].cells).toEqual(['j:2026-01-03', '2026-01-03-OUTBOUND', '', '1200.00', null, '800.00', 64000n]);
    expect(table.rows[3]).toEqual({ bold: true, cells: ['', 'موجودی پایان دوره', '', '', null, '800.00', 64000n] });
  });

  it('warns in the subtitle when the card is short', () => {
    const table = cardexTable(cardex([move('2026-01-01', OUT, u(1500))], opening), (day) => day);
    expect(table.subtitle).toContain('500');
  });

  it('prints fractional quantities with two decimals', () => {
    const report = cardex([move('2026-01-01', IN, 150n, 100n)], []);
    const table = cardexTable(report, (day) => day);
    expect(table.rows[1].cells[2]).toBe('1.50');
    expect(table.rows[1].cells[5]).toBe('1.50');
  });
});
