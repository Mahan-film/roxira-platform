import { StockMovementType } from '../enums/stock-movement-type.enum';
import { QUANTITY_UNIT } from '../constants/inventory.constants';
import { BalanceMovement, BalanceItem, BalanceWarehouse, stockBalance, stockBalanceTable, reorderAlertTable } from './stock-balance';

const u = (n: number) => BigInt(n) * QUANTITY_UNIT;

function createMovement(
  itemId: string,
  warehouseId: string | null,
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
  { id: 'A', code: 'A1', name: 'کالای الف', reorderPoint: u(500) },
  { id: 'B', code: 'B1', name: 'کالای بی', reorderPoint: null },
  { id: 'C', code: 'C1', name: 'کالای سی', reorderPoint: u(20) },
  { id: 'D', code: 'D1', name: 'کالای دی', reorderPoint: null },
  { id: 'E', code: 'E1', name: 'کالای ای', reorderPoint: u(100) },
];

const warehouses: BalanceWarehouse[] = [
  { id: 'W1', name: 'انبار مرکزی' },
  { id: 'W2', name: 'انبار فروشگاه' },
];

const movements: BalanceMovement[] = [
  createMovement('A', 'W1', '2026-01-01', StockMovementType.INBOUND, u(1000), 'رسید1', 80n),
  createMovement('A', 'W1', '2026-01-02', StockMovementType.INBOUND, u(1000), 'رسید2', 120n),
  createMovement('A', 'W1', '2026-01-03', StockMovementType.OUTBOUND, u(1200), 'فاکتور1'),
  createMovement('A', 'W1', '2026-01-04', StockMovementType.OUTBOUND, u(300), 'انتقال', undefined, true),
  createMovement('A', 'W2', '2026-01-04', StockMovementType.INBOUND, u(300), 'انتقال', 120n, true),
  createMovement('A', 'W1', '2026-02-01', StockMovementType.OUTBOUND, u(400), 'فاکتور2'),
  createMovement('B', 'W1', '2026-01-01', StockMovementType.INBOUND, u(10), 'رسید1', 50n),
  createMovement('D', 'W1', '2026-01-01', StockMovementType.INBOUND, u(5), 'رسید1', 10n),
  createMovement('D', 'W1', '2026-01-02', StockMovementType.OUTBOUND, u(8), 'فاکتور1'),
  createMovement('E', 'W1', '2026-01-01', StockMovementType.INBOUND, u(100), 'رسید1', 7n),
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
        quantity: u(500),
        value: 60000n,
        shortageQty: 0n,
      });
      expect(w2Line).toEqual({
        itemId: 'A',
        warehouseId: 'W2',
        quantity: u(300),
        value: 36000n,
        shortageQty: 0n,
      });
    });

    it('item totals', () => {
      const aItem = report.items.find(item => item.itemId === 'A')!;
      expect(aItem).toEqual({
        itemId: 'A',
        quantity: u(800),
        value: 96000n,
        shortageQty: 0n,
      });
      const bItem = report.items.find(item => item.itemId === 'B')!;
      expect(bItem).toEqual({
        itemId: 'B',
        quantity: u(10),
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
        shortageQty: u(3),
      });
      const eItem = report.items.find(item => item.itemId === 'E')!;
      expect(eItem).toEqual({
        itemId: 'E',
        quantity: u(100),
        value: 700n,
        shortageQty: 0n,
      });
    });

    it('alerts', () => {
      expect(report.alerts).toHaveLength(2);
      expect(report.alerts[0]).toEqual({
        itemId: 'C',
        quantity: 0n,
        reorderPoint: u(20),
        shortfall: u(20),
      });
      expect(report.alerts[1]).toEqual({
        itemId: 'E',
        quantity: u(100),
        reorderPoint: u(100),
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
        quantity: u(100),
        value: 12000n,
        shortageQty: 0n,
      });
      expect(w2Line).toEqual({
        itemId: 'A',
        warehouseId: 'W2',
        quantity: u(300),
        value: 36000n,
        shortageQty: 0n,
      });
    });

    it('A item total', () => {
      const aItem = report.items.find(item => item.itemId === 'A')!;
      expect(aItem).toEqual({
        itemId: 'A',
        quantity: u(400),
        value: 48000n,
        shortageQty: 0n,
      });
    });

    it('alerts', () => {
      expect(report.alerts).toHaveLength(3);
      expect(report.alerts[0]).toEqual({
        itemId: 'A',
        quantity: u(400),
        reorderPoint: u(500),
        shortfall: u(100),
      });
      expect(report.alerts[1]).toEqual({
        itemId: 'C',
        quantity: 0n,
        reorderPoint: u(20),
        shortfall: u(20),
      });
      expect(report.alerts[2]).toEqual({
        itemId: 'E',
        quantity: u(100),
        reorderPoint: u(100),
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
        createMovement('Z', 'W1', '2026-01-01', StockMovementType.INBOUND, u(9), 'x', 1n),
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
      expect(table.columns).toHaveLength(6);
      expect(table.columns[5].title).toBe('کسری');
      expect(table.columns[0].title).toBe('کد کالا');
      expect(table.columns[1].title).toBe('نام کالا');
      expect(table.columns.filter((c) => c.money)).toHaveLength(1);
      expect(table.columns[2].title).toBe('انبار');
      expect(table.columns[4].money).toBe(true);
    });

    it('first row', () => {
      const table = stockBalanceTable(report, items, warehouses, jalali);
      const firstRow = table.rows[0];
      expect(firstRow.cells).toEqual(['A1', 'کالای الف', 'انبار مرکزی', '500.00', 60000n, '']);
    });

    it('last row', () => {
      const table = stockBalanceTable(report, items, warehouses, jalali);
      const lastRow = table.rows[table.rows.length - 1];
      expect(lastRow.bold).toBe(true);
      const totalValue = 60000n + 36000n + 500n + 0n + 700n;
      expect(lastRow.cells).toEqual(['', 'جمع ارزش', '', null, totalValue, '']);
    });

    it('names the short item on its own row', () => {
      const table = stockBalanceTable(report, items, warehouses, jalali);
      const short = table.rows.find((r) => r.cells[0] === 'D1')!;
      expect(short.cells).toEqual(['D1', 'کالای دی', 'انبار مرکزی', '0.00', 0n, '3.00']);
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
      expect(firstRow.cells).toEqual(['C1', 'کالای سی', '0.00', '20.00', '20.00']);
      const secondRow = table.rows[1];
      expect(secondRow.cells).toEqual(['E1', 'کالای ای', '100.00', '100.00', '0.00']);
    });
  });

  describe('Test 6: fractional quantities and a null warehouse', () => {
    const jalali = (day: string) => `j:${day}`;

    it('values fractional quantities with round half up and prints two decimals', () => {
      const fractionalItems: BalanceItem[] = [{ id: 'F', code: 'F1', name: 'کالای فو', reorderPoint: u(2) }];
      const fractionalMovements = [
        createMovement('F', 'W1', '2026-01-01', StockMovementType.INBOUND, 250n, 'رسید1', 1001n),
        createMovement('F', 'W1', '2026-01-02', StockMovementType.OUTBOUND, 100n, 'فاکتور1'),
      ];
      const report = stockBalance('2026-01-31', fractionalItems, fractionalMovements);
      // 2.50 @ 1001 -> 2503 (2502.5 rounds up); 1.00 out -> 1001; 1.50 left worth 1502.
      expect(report.lines[0]).toEqual({
        itemId: 'F',
        warehouseId: 'W1',
        quantity: 150n,
        value: 1502n,
        shortageQty: 0n,
      });
      const table = stockBalanceTable(report, fractionalItems, warehouses, jalali);
      expect(table.rows[0].cells).toEqual(['F1', 'کالای فو', 'انبار مرکزی', '1.50', 1502n, '']);
      expect(reorderAlertTable(report, fractionalItems, jalali).rows[0].cells).toEqual(['F1', 'کالای فو', '1.50', '2.00', '0.50']);
    });

    it('groups a movement without a warehouse under its own line', () => {
      const nullWarehouseItems: BalanceItem[] = [{ id: 'G', code: 'G1', name: 'کالای گو', reorderPoint: null }];
      const nullWarehouseMovements = [
        createMovement('G', null, '2026-01-01', StockMovementType.INBOUND, 300n, 'رسید1', 10n),
      ];
      const report = stockBalance('2026-01-31', nullWarehouseItems, nullWarehouseMovements);
      expect(report.lines).toEqual([
        { itemId: 'G', warehouseId: null, quantity: 300n, value: 30n, shortageQty: 0n },
      ]);
      const table = stockBalanceTable(report, nullWarehouseItems, warehouses, jalali);
      expect(table.rows[0].cells[2]).toBe('بدون انبار');
    });
  });
});
