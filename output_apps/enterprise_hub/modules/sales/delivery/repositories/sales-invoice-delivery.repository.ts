import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../../access/services/tenant-scope';

/** A delivery line locked `FOR UPDATE` together with the header fields the invoice needs. */
export interface LockedDeliveryLine {
  id: number;
  deliveryId: number;
  deliveryNumber: string;
  partyCode: string;
  orderId: number;
  warehouseId: number;
  orderLineId: number;
  itemId: number;
  sku: string;
  quantity: string;
  invoicedQuantity: string;
}

/** One order line the invoice price comes from. */
export interface OrderLinePrice {
  id: number;
  itemId: number;
  unitPrice: string;
  description: string | null;
}

/** What one link row stores: invoice line index plus the delivery line it bills. */
export interface NewInvoiceDeliveryLink {
  deliveryId: number;
  deliveryLineId: number;
  orderLineId: number;
  invoiceLineNo: number;
  quantity: string;
}

/** Row of `erp_sales_invoice_delivery_lines` joined with the delivery header, for responses. */
export interface InvoiceDeliveryLinkRow {
  deliveryId: number;
  deliveryNumber: string;
  deliveryLineId: number;
  orderLineId: number;
  itemId: number;
  sku: string;
  partyCode: string;
  invoiceLineNo: number;
  quantity: string;
}

/**
 * Persistence of invoice-from-delivery (#563 T1 slice 4). Every method takes the manager of the
 * one tenant transaction the service opened, so the delivery-line locks, the invoice row, the
 * link rows and the invoiced-quantity bumps commit or roll back together. The table itself has
 * FORCE row-level security; every query also filters by `tenant_id` (AGENTS.md §4).
 */
@Injectable()
export class SalesInvoiceDeliveryRepository {
  constructor(private readonly scope: TenantScope) {}

  runInTransaction<T>(tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.scope.run(tenantId, work);
  }

  /**
   * Locks the requested delivery lines `FOR UPDATE` (only the line rows, not the joined
   * deliveries) inside the caller's transaction. A concurrent invoice of the same line waits
   * here and then sees the committed `invoiced_quantity`.
   */
  async lockDeliveryLines(
    tenantId: string,
    manager: EntityManager,
    ids: number[],
  ): Promise<LockedDeliveryLine[]> {
    if (ids.length === 0) return [];
    const rows = await manager.query<Array<Record<string, unknown>>>(
      `SELECT l.id, l.delivery_id, l.order_line_id, l.item_id, l.sku, l.quantity, l.invoiced_quantity,
              d.number AS delivery_number, d.party_code, d.order_id, d.warehouse_id
         FROM erp_sales_delivery_lines l
         JOIN erp_sales_deliveries d ON d.id = l.delivery_id AND d.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.id = ANY($2::int[])
        FOR UPDATE OF l`,
      [tenantId, ids],
    );
    return rows.map((row) => ({
      id: Number(row.id),
      deliveryId: Number(row.delivery_id),
      deliveryNumber: String(row.delivery_number),
      partyCode: String(row.party_code),
      orderId: Number(row.order_id),
      warehouseId: Number(row.warehouse_id),
      orderLineId: Number(row.order_line_id),
      itemId: Number(row.item_id),
      sku: String(row.sku),
      quantity: String(row.quantity),
      invoicedQuantity: String(row.invoiced_quantity),
    }));
  }

  /** Unit price and item of each order line, read with the same manager. */
  async orderLinesByIds(
    tenantId: string,
    manager: EntityManager,
    ids: number[],
  ): Promise<Map<number, OrderLinePrice>> {
    if (ids.length === 0) return new Map();
    const rows = await manager.query<Array<Record<string, unknown>>>(
      `SELECT id, item_id, unit_price, description
         FROM erp_sales_order_lines
        WHERE tenant_id = $1 AND id = ANY($2::int[])`,
      [tenantId, ids],
    );
    return new Map(
      rows.map((row) => [
        Number(row.id),
        {
          id: Number(row.id),
          itemId: Number(row.item_id),
          unitPrice: String(row.unit_price),
          description: row.description === null || row.description === undefined ? null : String(row.description),
        },
      ]),
    );
  }

  /** Name of each stock item, read from `erp_stock_items` (the tenant filter is the guard). */
  async itemNamesByIds(
    tenantId: string,
    manager: EntityManager,
    itemIds: number[],
  ): Promise<Map<number, string>> {
    if (itemIds.length === 0) return new Map();
    const rows = await manager.query<Array<{ id: number; name: string }>>(
      `SELECT id, name FROM erp_stock_items WHERE tenant_id = $1 AND id = ANY($2::int[])`,
      [tenantId, itemIds],
    );
    return new Map(rows.map((row) => [Number(row.id), String(row.name)]));
  }

  /** Name of a party (طرف حساب) by its code, read with the same manager. */
  async partyNameByCode(
    tenantId: string,
    manager: EntityManager,
    code: string,
  ): Promise<string | null> {
    const rows = await manager.query<Array<{ name: string }>>(
      `SELECT name FROM erp_parties WHERE tenant_id = $1 AND code = $2 LIMIT 1`,
      [tenantId, code],
    );
    return rows.length > 0 ? String(rows[0].name) : null;
  }

  /** Invoice id of a replayed idempotency key (the unique index is the backstop). */
  async findInvoiceIdByIdempotencyKey(
    tenantId: string,
    manager: EntityManager,
    key: string,
  ): Promise<string | null> {
    const rows = await manager.query<Array<{ id: string }>>(
      `SELECT id FROM invoices WHERE tenant_id = $1 AND idempotency_key = $2 LIMIT 1`,
      [tenantId, key],
    );
    return rows.length > 0 ? String(rows[0].id) : null;
  }

  async insertLinks(
    tenantId: string,
    manager: EntityManager,
    invoiceId: string,
    links: NewInvoiceDeliveryLink[],
  ): Promise<void> {
    if (links.length === 0) return;
    await manager.query(
      `INSERT INTO erp_sales_invoice_delivery_lines
         (tenant_id, invoice_id, delivery_id, delivery_line_id, order_line_id, invoice_line_no, quantity)
       SELECT $1, $2, v.delivery_id, v.delivery_line_id, v.order_line_id, v.invoice_line_no, v.quantity
         FROM unnest($3::int[], $4::int[], $5::int[], $6::int[], $7::numeric[])
           AS v(delivery_id, delivery_line_id, order_line_id, invoice_line_no, quantity)`,
      [
        tenantId,
        invoiceId,
        links.map((link) => link.deliveryId),
        links.map((link) => link.deliveryLineId),
        links.map((link) => link.orderLineId),
        links.map((link) => link.invoiceLineNo),
        links.map((link) => link.quantity),
      ],
    );
  }

  /** Adds an invoiced quantity (decimal text) to a delivery line; the table CHECK is the last guard. */
  async bumpDeliveryInvoiced(
    tenantId: string,
    manager: EntityManager,
    deliveryLineId: number,
    quantity: string,
  ): Promise<void> {
    await manager.query(
      `UPDATE erp_sales_delivery_lines
          SET invoiced_quantity = invoiced_quantity + $3
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, deliveryLineId, quantity],
    );
  }

  /** Adds an invoiced quantity to the order line as well, so the order view stays consistent. */
  async bumpOrderInvoiced(
    tenantId: string,
    manager: EntityManager,
    orderLineId: number,
    quantity: string,
  ): Promise<void> {
    await manager.query(
      `UPDATE erp_sales_order_lines
          SET invoiced_quantity = invoiced_quantity + $3
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, orderLineId, quantity],
    );
  }

  /** Links of one invoice with the delivery header, read inside a tenant-scoped transaction. */
  linksOfInvoice(tenantId: string, invoiceId: string): Promise<InvoiceDeliveryLinkRow[]> {
    return this.scope.run(tenantId, (manager) => this.linksOfInvoiceWith(tenantId, manager, invoiceId));
  }

  async linksOfInvoiceWith(
    tenantId: string,
    manager: EntityManager,
    invoiceId: string,
  ): Promise<InvoiceDeliveryLinkRow[]> {
    const rows = await manager.query<Array<Record<string, unknown>>>(
      `SELECT k.delivery_id, k.delivery_line_id, k.order_line_id, k.invoice_line_no, k.quantity,
              d.number AS delivery_number, d.party_code, l.item_id, l.sku
         FROM erp_sales_invoice_delivery_lines k
         JOIN erp_sales_delivery_lines l ON l.id = k.delivery_line_id AND l.tenant_id = k.tenant_id
         JOIN erp_sales_deliveries d ON d.id = k.delivery_id AND d.tenant_id = k.tenant_id
        WHERE k.tenant_id = $1 AND k.invoice_id = $2
        ORDER BY k.invoice_line_no, k.id`,
      [tenantId, invoiceId],
    );
    return rows.map((row) => ({
      deliveryId: Number(row.delivery_id),
      deliveryNumber: String(row.delivery_number),
      deliveryLineId: Number(row.delivery_line_id),
      orderLineId: Number(row.order_line_id),
      itemId: Number(row.item_id),
      sku: String(row.sku),
      partyCode: String(row.party_code),
      invoiceLineNo: Number(row.invoice_line_no),
      quantity: String(row.quantity),
    }));
  }
}
