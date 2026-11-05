import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ReportTable } from '../../accounting/reports/report-table';
import { jalali } from '../../accounting/reports/report-tables';
import { moneyJson } from '../../accounting/services/financial-reports.service';
import { QUANTITY_UNIT } from '../constants/inventory.constants';
import { CardexQueryDto, StockBalanceQueryDto } from '../dto/stock-report.dto';
import { CardexReport, cardex, cardexTable, formatQty } from '../reports/cardex';
import {
  BalanceItem,
  BalanceMovement,
  BalanceWarehouse,
  reorderAlertTable,
  stockBalance,
  stockBalanceTable,
} from '../reports/stock-balance';
import { replayMovements } from '../reports/stock-movements';
import { InventoryRepository } from '../repositories/inventory.repository';
import { StockDocumentsRepository } from '../repositories/stock-documents.repository';

/** Today's day in Tehran, `YYYY-MM-DD`; stock reports are kept on Iran calendar days. */
const tehranToday = (): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

/**
 * Stock reports of the JWT tenant (#243 family). The documents are replayed into per-warehouse FIFO
 * movements (see `replayMovements`) and fed to the pure report cores; controllers return JSON or a file.
 */
@Injectable()
export class StockReportService {
  constructor(
    private readonly documents: StockDocumentsRepository,
    private readonly inventory: InventoryRepository,
  ) {}

  /** Cardex of one SKU (optionally one warehouse) over its whole history, sliced to the day range. */
  async cardexReport(
    tenantId: string,
    query: CardexQueryDto,
  ): Promise<{ json: unknown; table: ReportTable }> {
    if (query.from && query.to && query.from > query.to) {
      throw new BadRequestException('تاریخ شروع باید پیش از تاریخ پایان باشد.');
    }
    const item = await this.inventory.findStockItemBySku(tenantId, query.sku);
    if (!item) {
      throw new NotFoundException(`کالایی با شناسه ${query.sku} یافت نشد.`);
    }

    const docs = await this.documents.findPostedDocuments(tenantId, undefined, query.sku);
    let movements: BalanceMovement[] = replayMovements(docs);
    if (query.warehouseId !== undefined) {
      movements = movements.filter((movement) => movement.warehouseId === String(query.warehouseId));
    }

    // The whole history is replayed so the opening balance below `from` is exact; only then is it sliced.
    const report = cardex(movements, [], { allWarehouses: query.warehouseId === undefined });
    const before = query.from ? report.rows.filter((row) => row.date < query.from!) : [];
    const openingRow = before[before.length - 1];
    const openingQty = openingRow ? openingRow.runningQty : 0n;
    const openingValue = openingRow ? openingRow.runningValue : 0n;
    const rows = report.rows.filter(
      (row) => (!query.from || row.date >= query.from) && (!query.to || row.date <= query.to),
    );
    const closingRow = rows[rows.length - 1];
    const closingQty = closingRow ? closingRow.runningQty : openingQty;
    const closingValue = closingRow ? closingRow.runningValue : openingValue;

    const sliced: CardexReport = {
      openingQty,
      openingValue,
      rows,
      closingQty,
      closingValue,
      shortageQty: report.shortageQty,
    };

    const warehouseName =
      query.warehouseId !== undefined
        ? (await this.inventory.findWarehouseById(tenantId, query.warehouseId))?.name
        : undefined;
    const subtitle = [
      `کالا: ${item.name} (${item.sku})`,
      query.warehouseId !== undefined ? `انبار: ${warehouseName ?? query.warehouseId}` : 'همه انبارها',
      query.from ? `از ${jalali(query.from)}` : '',
      query.to ? `تا ${jalali(query.to)}` : '',
      '(مقدار در واحد کالا، مبلغ به ریال)',
    ]
      .filter(Boolean)
      .join('، ');

    return {
      table: cardexTable(sliced, jalali, 'کاردکس کالا', subtitle),
      json: moneyJson({
        sku: query.sku,
        itemName: item.name,
        warehouseId: query.warehouseId ?? null,
        from: query.from ?? null,
        to: query.to ?? null,
        opening: { quantity: formatQty(openingQty), value: openingValue },
        rows: rows.map((row) => ({
          date: row.date,
          document: row.document,
          inQty: formatQty(row.inQty),
          outQty: formatQty(row.outQty),
          unitCost: row.unitCost,
          runningQty: formatQty(row.runningQty),
          runningValue: row.runningValue,
        })),
        closing: { quantity: formatQty(closingQty), value: closingValue },
        shortageQty: formatQty(report.shortageQty),
      }),
    };
  }

  /** Stock balance (or reorder alerts) of the tenant's items as of a day. */
  async stockBalanceReport(
    tenantId: string,
    query: StockBalanceQueryDto,
  ): Promise<{ json: unknown; table: ReportTable }> {
    const asOf = query.asOf ?? tehranToday();
    const docs = await this.documents.findPostedDocuments(tenantId, asOf);
    const movements = replayMovements(docs);
    const [stockItems, warehouseEntities] = await Promise.all([
      this.inventory.findAllStockItems(tenantId),
      this.inventory.findAllWarehouses(tenantId),
    ]);

    const items: BalanceItem[] = stockItems.map((stockItem) => ({
      id: stockItem.sku,
      code: stockItem.sku,
      name: stockItem.name,
      reorderPoint:
        stockItem.minQuantity > 0
          ? BigInt(Math.round(stockItem.minQuantity * Number(QUANTITY_UNIT)))
          : null,
    }));
    const warehouses: BalanceWarehouse[] = warehouseEntities.map((warehouse) => ({
      id: String(warehouse.id),
      name: warehouse.name,
    }));

    const report = stockBalance(asOf, items, movements);

    return {
      table:
        query.view === 'reorder'
          ? reorderAlertTable(report, items, jalali)
          : stockBalanceTable(report, items, warehouses, jalali),
      json: moneyJson({
        asOf,
        lines: report.lines.map((line) => ({
          itemId: line.itemId,
          warehouseId: line.warehouseId,
          quantity: formatQty(line.quantity),
          value: line.value,
          shortageQty: formatQty(line.shortageQty),
        })),
        items: report.items.map((item) => ({
          itemId: item.itemId,
          quantity: formatQty(item.quantity),
          value: item.value,
          shortageQty: formatQty(item.shortageQty),
        })),
        alerts: report.alerts.map((alert) => ({
          itemId: alert.itemId,
          quantity: formatQty(alert.quantity),
          reorderPoint: formatQty(alert.reorderPoint),
          shortfall: formatQty(alert.shortfall),
        })),
      }),
    };
  }
}
