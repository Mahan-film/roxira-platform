import { ReportColumn, ReportRow, ReportTable } from '../../accounting/reports/report-table';
import { CardexMovement, cardex } from './cardex';

export interface BalanceMovement extends CardexMovement {
  itemId: string;
  warehouseId: string;
}

export interface BalanceItem {
  id: string;
  code: string;
  name: string;
  reorderPoint: bigint | null;
}

export interface BalanceWarehouse {
  id: string;
  name: string;
}

export interface BalanceLine {
  itemId: string;
  warehouseId: string;
  quantity: bigint;
  value: bigint;
  shortageQty: bigint;
}

export interface ItemBalance {
  itemId: string;
  quantity: bigint;
  value: bigint;
  shortageQty: bigint;
}

export interface ReorderAlert {
  itemId: string;
  quantity: bigint;
  reorderPoint: bigint;
  shortfall: bigint;
}

export interface StockBalanceReport {
  asOf: string;
  lines: BalanceLine[];
  items: ItemBalance[];
  alerts: ReorderAlert[];
}

export function stockBalance(
  asOf: string,
  items: readonly BalanceItem[],
  movements: readonly BalanceMovement[],
): StockBalanceReport {
  const itemsMap = new Map(items.map((item) => [item.id, item]));
  
  const filteredMovements: BalanceMovement[] = movements.filter(movement => {
    if (movement.date > asOf) return false;
    if (!itemsMap.has(movement.itemId)) return false;
    return true;
  });

  const movementsByItemAndWarehouse = new Map<string, Map<string, BalanceMovement[]>>();

  for (const movement of filteredMovements) {
    if (!movementsByItemAndWarehouse.has(movement.itemId)) {
      movementsByItemAndWarehouse.set(movement.itemId, new Map());
    }
    const warehouseMap = movementsByItemAndWarehouse.get(movement.itemId)!;
    if (!warehouseMap.has(movement.warehouseId)) {
      warehouseMap.set(movement.warehouseId, []);
    }
    warehouseMap.get(movement.warehouseId)!.push(movement);
  }

  const lines: BalanceLine[] = [];

  for (const [itemId, warehouseMap] of movementsByItemAndWarehouse.entries()) {
    for (const [warehouseId, warehouseMovements] of warehouseMap.entries()) {
      const result = cardex(warehouseMovements, []);
      if (result.closingQty !== 0n || result.shortageQty !== 0n) {
        lines.push({
          itemId,
          warehouseId,
          quantity: result.closingQty,
          value: result.closingValue,
          shortageQty: result.shortageQty,
        });
      }
    }
  }

  const itemsBalance: ItemBalance[] = items.map(item => {
    const itemLines = lines.filter(line => line.itemId === item.id);
    const quantity = itemLines.reduce((sum, line) => sum + line.quantity, 0n);
    const value = itemLines.reduce((sum, line) => sum + line.value, 0n);
    const shortageQty = itemLines.reduce((sum, line) => sum + line.shortageQty, 0n);
    return {
      itemId: item.id,
      quantity,
      value,
      shortageQty,
    };
  });

  const alerts: ReorderAlert[] = items
    .filter(item => item.reorderPoint !== null && item.reorderPoint > 0n)
    .map(item => {
      const itemBalance = itemsBalance.find(b => b.itemId === item.id)!;
      const quantity = itemBalance.quantity;
      const reorderPoint = item.reorderPoint!;
      const shortfall = reorderPoint > quantity ? reorderPoint - quantity : 0n;
      return {
        itemId: item.id,
        quantity,
        reorderPoint,
        shortfall,
      };
    })
    .filter(alert => alert.quantity <= alert.reorderPoint)
    .sort((a, b) => {
      const itemA = itemsMap.get(a.itemId)!;
      const itemB = itemsMap.get(b.itemId)!;
      return itemA.code.localeCompare(itemB.code);
    });

  return {
    asOf,
    lines: lines.sort((a, b) => {
      const itemA = itemsMap.get(a.itemId)!;
      const itemB = itemsMap.get(b.itemId)!;
      if (itemA.code !== itemB.code) {
        return itemA.code.localeCompare(itemB.code);
      }
      return a.warehouseId.localeCompare(b.warehouseId);
    }),
    items: itemsBalance.sort((a, b) => {
      const itemA = itemsMap.get(a.itemId)!;
      const itemB = itemsMap.get(b.itemId)!;
      return itemA.code.localeCompare(itemB.code);
    }),
    alerts,
  };
}

export function stockBalanceTable(
  report: StockBalanceReport,
  items: readonly BalanceItem[],
  warehouses: readonly BalanceWarehouse[],
  jalali: (day: string) => string,
): ReportTable {
  const itemsMap = new Map(items.map(item => [item.id, item]));
  const warehousesMap = new Map(warehouses.map(w => [w.id, w]));

  const warning = report.lines.some(line => line.shortageQty > 0n)
    ? '، خروجی بیش از موجودی؛ گردش کالا ناقص است'
    : '';

  const subtitle = `تا تاریخ ${jalali(report.asOf)}${warning}`;

  const columns: ReportColumn[] = [
    { title: 'کد کالا' },
    { title: 'نام کالا', width: 1.6 },
    { title: 'انبار', width: 1.2 },
    { title: 'مقدار' },
    { title: 'ارزش (ریال)', width: 1.2, money: true },
  ];

  const rows: ReportRow[] = [];

  for (const line of report.lines) {
    const item = itemsMap.get(line.itemId)!;
    const warehouse = warehousesMap.get(line.warehouseId);
    rows.push({
      cells: [
        item.code,
        item.name,
        warehouse?.name ?? line.warehouseId,
        String(line.quantity),
        line.value,
      ],
    });
  }

  const totalValue = report.lines.reduce((sum, line) => sum + line.value, 0n);
  rows.push({
    bold: true,
    cells: ['', 'جمع ارزش', '', null, totalValue],
  });

  return {
    title: 'موجودی کالا در تاریخ',
    subtitle,
    columns,
    rows,
  };
}

export function reorderAlertTable(
  report: StockBalanceReport,
  items: readonly BalanceItem[],
  jalali: (day: string) => string,
): ReportTable {
  const itemsMap = new Map(items.map(item => [item.id, item]));

  const subtitle = `تا تاریخ ${jalali(report.asOf)}`;

  const columns: ReportColumn[] = [
    { title: 'کد کالا' },
    { title: 'نام کالا', width: 1.6 },
    { title: 'موجودی' },
    { title: 'نقطه سفارش' },
    { title: 'کمبود' },
  ];

  const rows: ReportRow[] = [];

  for (const alert of report.alerts) {
    const item = itemsMap.get(alert.itemId)!;
    rows.push({
      cells: [
        item.code,
        item.name,
        String(alert.quantity),
        String(alert.reorderPoint),
        String(alert.shortfall),
      ],
    });
  }

  return {
    title: 'کالاهای زیر نقطه سفارش',
    subtitle,
    columns,
    rows,
  };
}