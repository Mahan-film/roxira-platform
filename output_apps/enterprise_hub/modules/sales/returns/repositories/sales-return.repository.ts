import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../../access/services/tenant-scope';

/** A delivery line locked `FOR UPDATE` with the header fields a return needs. */
export interface LockedReturnLine {
  id: number;
  deliveryId: number;
  deliveryNumber: string;
  orderLineId: number;
  warehouseId: number;
  sku: string;
  /** Delivered quantity, decimal text with 2 places. */
  quantity: string;
  /** Total FIFO cost of the delivered quantity, decimal text (rials). */
  lineCost: string;
  returnedQuantity: string;
}

/** One link of the original invoice: the delivery line it bills and the quantity on that invoice. */
export interface InvoiceLinkRow {
  deliveryId: number;
  deliveryLineId: number;
  orderLineId: number;
  invoiceLineNo: number;
  quantity: string;
}

/** A link row to write for a RETURN invoice (same table as invoice-from-delivery links). */
export interface NewReturnLink extends InvoiceLinkRow {}

/**
 * Persistence of sales returns (#565 T1 slice 5). Every method takes the manager of the one
 * tenant transaction the service opened, so the invoice row lock, the delivery-line locks, the
 * RETURN invoice, its link rows and the returned-quantity bumps commit or roll back together.
 * Return links reuse `erp_sales_invoice_delivery_lines` (FORCE RLS already) with the RETURN
 * invoice as `invoice_id`, which lets a later return see how much of this invoice is still open.
 */
@Injectable()
export class SalesReturnRepository {
  constructor(private readonly scope: TenantScope) {}

  runInTransaction<T>(tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.scope.run(tenantId, work);
  }

  /** Locks the delivery lines `FOR UPDATE` in id order (the same order every return uses). */
  async lockDeliveryLines(tenantId: string, manager: EntityManager, ids: number[]): Promise<LockedReturnLine[]> {
    if (ids.length === 0) return [];
    const rows = await manager.query<Array<Record<string, unknown>>>(
      `SELECT l.id, l.delivery_id, l.order_line_id, l.sku, l.quantity, l.line_cost, l.returned_quantity,
              d.number AS delivery_number, d.warehouse_id
         FROM erp_sales_delivery_lines l
         JOIN erp_sales_deliveries d ON d.id = l.delivery_id AND d.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.id = ANY($2::int[])
        ORDER BY l.id
          FOR UPDATE OF l`,
      [tenantId, ids],
    );
    return rows.map((row) => ({
      id: Number(row.id),
      deliveryId: Number(row.delivery_id),
      deliveryNumber: String(row.delivery_number),
      orderLineId: Number(row.order_line_id),
      warehouseId: Number(row.warehouse_id),
      sku: String(row.sku),
      quantity: String(row.quantity),
      lineCost: String(row.line_cost),
      returnedQuantity: String(row.returned_quantity),
    }));
  }

  /** Link rows of one invoice: which delivery lines it bills, at which line, and how much. */
  async linksOfInvoice(tenantId: string, manager: EntityManager, invoiceId: string): Promise<InvoiceLinkRow[]> {
    const rows = await manager.query<Array<Record<string, unknown>>>(
      `SELECT delivery_id, delivery_line_id, order_line_id, invoice_line_no, quantity
         FROM erp_sales_invoice_delivery_lines
        WHERE tenant_id = $1 AND invoice_id = $2
        ORDER BY invoice_line_no, id`,
      [tenantId, invoiceId],
    );
    return rows.map((row) => ({
      deliveryId: Number(row.delivery_id),
      deliveryLineId: Number(row.delivery_line_id),
      orderLineId: Number(row.order_line_id),
      invoiceLineNo: Number(row.invoice_line_no),
      quantity: String(row.quantity),
    }));
  }

  /**
   * Quantity already returned against this invoice per delivery line: the links of its
   * non-cancelled RETURN invoices. Locked by the caller on the original invoice row.
   */
  async returnedOnInvoice(
    tenantId: string,
    manager: EntityManager,
    invoiceId: string,
    returnSubject: number,
    cancelledStatus: string,
  ): Promise<Map<number, bigint>> {
    const rows = await manager.query<Array<{ delivery_line_id: number; quantity: string }>>(
      `SELECT k.delivery_line_id, k.quantity
         FROM erp_sales_invoice_delivery_lines k
         JOIN invoices r ON r.id = k.invoice_id AND r.tenant_id = k.tenant_id
        WHERE k.tenant_id = $1 AND r.related_invoice_id = $2
          AND r.subject = $3 AND r.status <> $4`,
      [tenantId, invoiceId, returnSubject, cancelledStatus],
    );
    return rows.reduce((totals, row) => {
      const id = Number(row.delivery_line_id);
      return totals.set(id, (totals.get(id) ?? 0n) + parseQuantityText(row.quantity));
    }, new Map<number, bigint>());
  }

  /** Id of the invoice a repeated idempotency key already created, if any. */
  async findInvoiceIdByIdempotencyKey(tenantId: string, manager: EntityManager, key: string): Promise<string | null> {
    const rows = await manager.query<Array<{ id: string }>>(
      `SELECT id FROM invoices WHERE tenant_id = $1 AND idempotency_key = $2 LIMIT 1`,
      [tenantId, key],
    );
    return rows.length > 0 ? String(rows[0].id) : null;
  }

  async insertReturnLinks(tenantId: string, manager: EntityManager, returnInvoiceId: string, links: NewReturnLink[]): Promise<void> {
    if (links.length === 0) return;
    await manager.query(
      `INSERT INTO erp_sales_invoice_delivery_lines
         (tenant_id, invoice_id, delivery_id, delivery_line_id, order_line_id, invoice_line_no, quantity)
       SELECT $1, $2, v.delivery_id, v.delivery_line_id, v.order_line_id, v.invoice_line_no, v.quantity
         FROM unnest($3::int[], $4::int[], $5::int[], $6::int[], $7::numeric[])
           AS v(delivery_id, delivery_line_id, order_line_id, invoice_line_no, quantity)`,
      [
        tenantId,
        returnInvoiceId,
        links.map((link) => link.deliveryId),
        links.map((link) => link.deliveryLineId),
        links.map((link) => link.orderLineId),
        links.map((link) => link.invoiceLineNo),
        links.map((link) => link.quantity),
      ],
    );
  }

  /** Adds a returned quantity (decimal text) to a delivery line; the table CHECK is the last guard. */
  async bumpReturned(tenantId: string, manager: EntityManager, deliveryLineId: number, quantity: string): Promise<void> {
    await manager.query(
      `UPDATE erp_sales_delivery_lines
          SET returned_quantity = returned_quantity + $3
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, deliveryLineId, quantity],
    );
  }
}

/** Decimal text with at most 2 places to hundredths, without floats. */
function parseQuantityText(text: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) throw new Error(`Stored quantity is not a 2-place decimal: ${text}`);
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
}
