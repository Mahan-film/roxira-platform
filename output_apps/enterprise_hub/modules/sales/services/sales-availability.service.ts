import { Injectable } from '@nestjs/common';
import { parseScaled } from '../../accounting/money';
import { doubleToHundredths } from '../sales-math';
import { SalesRepository } from '../repositories/sales.repository';

/** Available stock of one item: on hand minus reserved (موجودی آزاد). */
export interface ItemAvailability {
  itemId: number;
  sku: string;
  name: string;
  onHand: number;
  reserved: number;
  available: number;
}

const HUNDREDTHS = 100n;

/** Hundredths bigint of a numeric(12,2) column value (never floats for the compared value). */
function hundredths(value: string | number): bigint {
  return parseScaled(String(value), 2);
}

/** JSON number of a hundredths bigint; exact for every 2-decimal quantity. */
function toNumber(hundredthsValue: bigint): number {
  return Number(hundredthsValue) / 100;
}

/**
 * Derived quantities for the sales cycle (#527 T1 slice 2): how much of an item is reserved by
 * confirmed sales orders and how much is therefore available. Reservation never changes on-hand;
 * DRAFT and CANCELLED orders reserve nothing. All reservation maths runs through TenantScope on
 * the sales tables; on-hand comes from `erp_stock_items` read with an explicit tenant filter
 * inside the same scoped transaction (that table has no RLS, so the filter is the guard).
 */
@Injectable()
export class SalesAvailabilityService {
  constructor(private readonly sales: SalesRepository) {}

  /** Reserved quantity per item id as numeric text; empty map when nothing is reserved. */
  reservedMap(tenantId: string, itemIds?: number[]): Promise<Map<number, string>> {
    return this.sales.reservedByItem(tenantId, itemIds);
  }

  /**
   * Availability rows for the given items, in the order asked. Items that do not exist for the
   * tenant are omitted. `available` may be negative (shows as backorder).
   */
  async availability(tenantId: string, itemIds: number[]): Promise<ItemAvailability[]> {
    if (itemIds.length === 0) return [];
    return this.sales.runInTransaction(tenantId, async (m) => {
      const [reserved, stockRows] = await Promise.all([
        this.sales.reservedByItem(tenantId, itemIds, m),
        m.query(
          `SELECT id, sku, name, quantity FROM erp_stock_items
            WHERE tenant_id = $1 AND id = ANY($2::int[])`,
          [tenantId, itemIds],
        ),
      ]);
      const stockById = new Map(
        (stockRows as Array<{ id: number; sku: string; name: string; quantity: string }>).map((row) => [
          Number(row.id),
          row,
        ]),
      );
      const result: ItemAvailability[] = [];
      for (const itemId of itemIds) {
        const item = stockById.get(itemId);
        if (!item) continue;
        const onHand = doubleToHundredths(item.quantity);
        const reservedQuantity = hundredths(reserved.get(itemId) ?? '0');
        result.push({
          itemId,
          sku: item.sku,
          name: item.name,
          onHand: toNumber(onHand),
          reserved: toNumber(reservedQuantity),
          available: toNumber(onHand - reservedQuantity),
        });
      }
      return result;
    });
  }
}
