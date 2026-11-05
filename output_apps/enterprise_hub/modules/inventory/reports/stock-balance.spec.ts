import { StockMovementType } from '../enums/stock-movement-type.enum';
import { BalanceMovement, BalanceItem, BalanceWarehouse, stockBalance, stockBalanceTable, reorderAlertTable } from './stock-balance';

function createMovement(
  itemId: string,
  warehouseId: string,
  date: string,
  type: StockMovementType,
  quantity: bigint,
  document: string,
  unitCost?: bigint,
  transfer?: boolean,
): BalanceMovement {
  return {
    date,
    document,
    type,
    quantity,
    unitCost,
    transfer,
    itemId,
    warehouseId,
  };
}

const items: BalanceItem[] = [
  { id: 'A', code: 'A1', name: 'کالای الف', reorderPoint: 500n },
  { id: 'B', code: 'B1', name: 'کالای بی', reorderPoint: null },
  { id: 'C', code: 'C1', name: 'کالای سی', reorderPoint: 20n },
  { id: 'D', code: 'D1', name: 'کالای دی', reorderPoint: null },
  { id: 'E', code: 'E1', name: 'کالای ای', reorderPoint: 100n },
];

const warehouses: BalanceWarehouse[] = [
  { id: 'W1', name: 'انبار مرکزی' },
  { id: 'W2', name: 'انبار فروشگاه' },
];

const movements: BalanceMovement[] = [
  createMovement('A', 'W1', '2026-01-01', StockMovementType.INBOUND, 1000n, 'رسید1', 80n),
  createMovement('A', 'W1', '2026-01-02', StockMovementType.INBOUND, 1000n, 'رسید2', 120n),
  createMovement('A', 'W1', '2026-01-03', StockMovementType.OUTBOUND, 1200n, 'فاکتور1'),
  createMovement('A', 'W1', '2026-01-04', StockMovementType.OUTBOUND, 300n, 'انتقال', undefined, true),
  createMovement('A', 'W2', '2026-01-04', StockMovementType.INBOUND, 300n, 'انتقال', 120n, true),
  createMovement('A', 'W1', '2026-02-01', StockMovementType.OUTBOUND, 400n, 'فاکتور2'),
  createMovement('B', 'W1', '2026-01-01', StockMovementType.INBOUND, 10n, 'رسید1', 50n),
  createMovement('D', 'W1', '2026-01-01', StockMovementType.INBOUND, 5n, 'رسید1', 10n),
  createMovement('D', 'W1', '2026-01-02', StockMovementType.OUTBOUND, 8n, 'فاکتور1'),
  createMovement('E', 'W1', '2026-01-01', StockMovementType.INBOUND, 100n, 'رسید1', 7n),
];

describe('stockBalance', () => {
  describe('Test 1: asOf 2026-01-31', () => {
    const report = stockBalance('2026-01-31', items, movements);

    it('lines for A', () => {
      const aLines = report.lines.filter(line => line.itemId === 'A');
      expect(aLines).toHaveLength(2);
      const w1Line = aLines.find(line => line.warehouseId === 'W1');
      const w2Line = aLines.find(line => line.warehouseId === 'W2');
      expect(w1Line).toEqual({
        itemId: 'A',
        warehouseId: 'W1',
        quantity: 500n,
        value: 60000n,
        shortageQty: 0n,
      });
      expect(w2Line).toEqual({
        itemId: 'A',
        warehouseId: 'W2',
        quantity: 300n,
        value: 36000n,
        shortageQty: 0n,
      });
    });

    it('item totals', () => {
      const aItem = report.items.find(item => item.itemId === 'A')!;
      expect(aItem).toEqual({
        itemId: 'A',
        quantity: 800n,
        value: 96000n,
        shortageQty: 0n,
      });
      const bItem = report.items.find(item => item.itemId === 'B')!;
      expect(bItem).toEqual({
        itemId: 'B',
        quantity: 10n,
        value: 500n,
        shortageQty: 0n,
      });
      const cItem = report.items.find(item => item.itemId === 'C')!;
      expect(cItem).toEqual({
        itemId: 'C',
        quantity: 0n,
        value: 0n,
        shortageQty: 0n,
      });
      const dItem = report.items.find(item => item.itemId === 'D')!;
      expect(dItem).toEqual({
        itemId: 'D',
        quantity: 0n,
        value: 0n,
        shortageQty: 3n,
      });
      const eItem = report.items.find(item => item.itemId === 'E')!;
      expect(eItem).toEqual({
        itemId: 'E',
        quantity: 100n,
        value: 700n,
        shortageQty: 0n,
      });
    });

    it('alerts', () => {
      expect(report.alerts).toHaveLength(2);
      expect(report.alerts[0]).toEqual({
        itemId: 'C',
        quantity: 0n,
        reorderPoint: 20n,
        shortfall: 20n,
      });
      expect(report.alerts[1]).toEqual({
        itemId: 'E',
        quantity: 100n,
        reorderPoint: 100n,
        shortfall: 0n,
      });
    });
  });

  describe('Test 2: asOf 2026-02-01', () => {
    const report = stockBalance('2026-02-01', items, movements);

    it('A lines', () => {
      const aLines = report.lines.filter(line => line.itemId === 'A');
      expect(aLines).toHaveLength(2);
      const w1Line = aLines.find(line => line.warehouseId === 'W1')!;
      const w2Line = aLines.find(line => line.warehouseId === 'W2')!;
      expect(w1Line).toEqual({
        itemId: 'A',
        warehouseId: 'W1',
        quantity: 100n,
        value: 12000n,
        shortageQty: 0n,
      });
      expect(w2Line).toEqual({
        itemId: 'A',
        warehouseId: 'W2',
        quantity: 300n,
        value: 36000n,
        shortageQty: 0n,
      });
    });

    it('A item total', () => {
      const aItem = report.items.find(item => item.itemId === 'A')!;
      expect(aItem).toEqual({
        itemId: 'A',
        quantity: 400n,
        value: 48000n,
        shortageQty: 0n,
      });
    });

    it('alerts', () => {
      expect(report.alerts).toHaveLength(3);
      expect(report.alerts[0]).toEqual({
        itemId: 'A',
        quantity: 400n,
        reorderPoint: 500n,
        shortfall: 100n,
      });
      expect(report.alerts[1]).toEqual({
        itemId: 'C',
        quantity: 0n,
        reorderPoint: 20n,
        shortfall: 20n,
      });
      expect(report.alerts[2]).toEqual({
        itemId: 'E',
        quantity: 100n,
        reorderPoint: 100n,
        shortfall: 0n,
      });
    });
  });

  describe('Test 3: inputs and unknown items', () => {
    it('does not reorder the movements and ignores an unknown item', () => {
      const input = [...movements].reverse();
      const before = [...input];
      const report = stockBalance('2026-01-31', items, [
        ...input,
        createMovement('Z', 'W1', '2026-01-01', StockMovementType.INBOUND, 9n, 'x', 1n),
      ]);
      expect(input).toEqual(before);
      expect(report.items).toHaveLength(items.length);
      expect(report.lines.some((l) => l.itemId === 'Z')).toBe(false);
      expect(report.items.find((i) => i.itemId === 'A')!.value).toBe(96000n);
    });
  });

  describe('Test 4: stockBalanceTable', () => {
    const report = stockBalance('2026-01-31', items, movements);
    const jalali = (day: string) => `j:${day}`;

    it('title, and a warning in the subtitle because D was issued beyond its stock', () => {
      const table = stockBalanceTable(report, items, warehouses, jalali);
      expect(table.title).toBe('موجودی کالا در تاریخ');
      expect(table.subtitle).toBe('تا تاریخ j:2026-01-31، خروجی بیش از موجودی؛ گردش کالا ناقص است');
    });

    it('has no warning when nothing is short', () => {
      const clean = stockBalance('2026-01-31', items.filter((i) => i.id !== 'D'), movements);
      expect(stockBalanceTable(clean, items, warehouses, jalali).subtitle).toBe('تا تاریخ j:2026-01-31');
    });

    it('columns', () => {
      const table = stockBalanceTable(report, items, warehouses, jalali);
      expect(table.columns).toHaveLength(5);
      expect(table.columns[0].title).toBe('کد کالا');
      expect(table.columns[1].title).toBe('نام کالا');
      expect(table.columns.filter((c) => c.money)).toHaveLength(1);
      expect(table.columns[2].title).toBe('انبار');
      expect(table.columns[4].money).toBe(true);
    });

    it('first row', () => {
      const table = stockBalanceTable(report, items, warehouses, jalali);
      const firstRow = table.rows[0];
      expect(firstRow.cells).toEqual(['A1', 'کالای الف', 'انبار مرکزی', '500', 60000n]);
    });

    it('last row', () => {
      const table = stockBalanceTable(report, items, warehouses, jalali);
      const lastRow = table.rows[table.rows.length - 1];
      expect(lastRow.bold).toBe(true);
      const totalValue = 60000n + 36000n + 500n + 0n + 700n;
      expect(lastRow.cells).toEqual(['', 'جمع ارزش', '', null, totalValue]);
    });
  });

  describe('Test 5: reorderAlertTable', () => {
    const report = stockBalance('2026-01-31', items, movements);
    const jalali = (day: string) => `j:${day}`;

    it('title and subtitle', () => {
      const table = reorderAlertTable(report, items, jalali);
      expect(table.title).toBe('کالاهای زیر نقطه سفارش');
      expect(table.subtitle).toBe('تا تاریخ j:2026-01-31');
    });

    it('columns', () => {
      const table = reorderAlertTable(report, items, jalali);
      expect(table.columns).toHaveLength(5);
      expect(table.columns[0].title).toBe('کد کالا');
      expect(table.columns[1].title).toBe('نام کالا');
    });

    it('rows', () => {
      const table = reorderAlertTable(report, items, jalali);
      expect(table.rows).toHaveLength(2);
      const firstRow = table.rows[0];
      expect(firstRow.cells).toEqual(['C1', 'کالای سی', '0', '20', '20']);
      const secondRow = table.rows[1];
      expect(secondRow.cells).toEqual(['E1', 'کالای ای', '100', '100', '0']);
    });
  });
});