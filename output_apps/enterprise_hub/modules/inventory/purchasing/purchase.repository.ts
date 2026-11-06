import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import {
  DEFAULT_PURCHASE_SETTINGS,
  GoodsReceipt,
  GoodsReceiptLine,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderStatus,
  PurchaseRequest,
  PurchaseRequestStatus,
  PurchaseSettings,
} from './purchase.types';

type Row = Record<string, unknown>;

export interface NewPurchaseRequest {
  number: string;
  status: PurchaseRequestStatus;
  requestedBy: string;
  lines: Array<{ sku: string; quantity: bigint }>;
}

export interface NewPurchaseOrder {
  number: string;
  supplierCode: string;
  status: PurchaseOrderStatus;
  warehouseId: number | null;
  requestId: string | null;
  orderDate: string;
  lines: Array<{ sku: string; quantity: bigint; unitPrice: bigint }>;
}

export interface NewGoodsReceipt {
  number: string;
  orderId: string;
  supplierCode: string;
  receivedAt: Date;
  receivedBy: string;
  idempotencyKey: string | null;
  totalValue: bigint;
  journalEntryId: string | null;
}

export interface NewGoodsReceiptLine {
  orderLineId: string;
  sku: string;
  quantity: bigint;
  unitCost: bigint;
  value: bigint;
  weight: bigint | null;
  fifoBatchId: number | null;
}

const NUMBER_TABLE: Record<'PR' | 'PO' | 'GR', string> = {
  PR: 'erp_purchase_requests',
  PO: 'erp_purchase_orders',
  GR: 'erp_goods_receipts',
};

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function toBigInt(value: unknown): bigint {
  if (value === null || value === undefined || value === '') return 0n;
  return BigInt(String(value));
}

function toNullableBigInt(value: unknown): bigint | null {
  return value === null || value === undefined || value === '' ? null : BigInt(String(value));
}

function toNullableNumber(value: unknown): number | null {
  return value === null || value === undefined || value === '' ? null : Number(value);
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function toNullableDate(value: unknown): Date | null {
  return value === null || value === undefined ? null : toDate(value);
}

function requestLines(value: unknown): Array<{ sku: string; quantity: bigint }> {
  const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(parsed)) return [];
  return parsed.map((line) => {
    const item = line as { sku?: unknown; quantity?: unknown };
    return { sku: text(item.sku), quantity: toBigInt(item.quantity) };
  });
}

function mapRequest(row: Row): PurchaseRequest {
  return {
    id: text(row.id),
    tenantId: text(row.tenant_id),
    number: text(row.number),
    status: text(row.status) as PurchaseRequestStatus,
    requestedBy: text(row.requested_by),
    lines: requestLines(row.lines),
    orderId: nullableText(row.order_id),
    createdAt: toDate(row.created_at),
  };
}

function mapOrderLine(row: Row): PurchaseOrderLine {
  return {
    id: text(row.id),
    sku: text(row.sku),
    quantity: toBigInt(row.quantity),
    unitPrice: toBigInt(row.unit_price),
    receivedQuantity: toBigInt(row.received_quantity),
  };
}

function mapOrder(row: Row, lines: PurchaseOrderLine[]): PurchaseOrder {
  return {
    id: text(row.id),
    tenantId: text(row.tenant_id),
    number: text(row.number),
    supplierCode: text(row.supplier_code),
    status: text(row.status) as PurchaseOrderStatus,
    warehouseId: toNullableNumber(row.warehouse_id),
    lines,
    requestId: nullableText(row.request_id),
    orderDate: text(row.order_date),
    approvedBy: nullableText(row.approved_by),
    approvedAt: toNullableDate(row.approved_at),
    createdAt: toDate(row.created_at),
  };
}

function mapReceiptLine(row: Row): GoodsReceiptLine {
  return {
    id: text(row.id),
    orderLineId: text(row.order_line_id),
    sku: text(row.sku),
    quantity: toBigInt(row.quantity),
    unitCost: toBigInt(row.unit_cost),
    value: toBigInt(row.value),
    weight: toNullableBigInt(row.weight),
    fifoBatchId: toNullableNumber(row.fifo_batch_id),
  };
}

function mapReceipt(row: Row, lines: GoodsReceiptLine[]): GoodsReceipt {
  return {
    id: text(row.id),
    tenantId: text(row.tenant_id),
    number: text(row.number),
    orderId: text(row.order_id),
    supplierCode: text(row.supplier_code),
    receivedAt: toDate(row.received_at),
    receivedBy: text(row.received_by),
    idempotencyKey: nullableText(row.idempotency_key),
    lines,
    totalValue: toBigInt(row.total_value),
    journalEntryId: nullableText(row.journal_entry_id),
  };
}

function mapSettings(row: Row): PurchaseSettings {
  return {
    overReceiptToleranceBp: Number(row.over_receipt_tolerance_bp),
    priceToleranceBp: Number(row.price_tolerance_bp),
    priceToleranceAbs: toBigInt(row.price_tolerance_abs),
  };
}

/**
 * The only access point to the six purchase-cycle tables. They have FORCE row-level security, so
 * every call runs inside a TenantScope transaction (`app.tenant_id`), and every query also filters
 * by `tenantId` itself (AGENTS.md §4). Methods take the caller's `manager` and join that transaction.
 */
@Injectable()
export class PurchaseRepository {
  constructor(private readonly scope: TenantScope) {}

  /** Runs `work` in a new TenantScope transaction (every repository method then joins it). */
  run<T>(tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.scope.run(tenantId, work);
  }

  /** Joins the caller's transaction when there is one, otherwise opens a new TenantScope. */
  within<T>(tenantId: string, manager: EntityManager | undefined, work: (m: EntityManager) => Promise<T>): Promise<T> {
    return this.scope.within(tenantId, manager, work);
  }

  // ---------------------------------------------------------------- settings

  async getSettings(tenantId: string, manager: EntityManager): Promise<PurchaseSettings> {
    const rows: Row[] = await manager.query(
      `SELECT * FROM "erp_purchase_settings" WHERE "tenant_id" = $1`,
      [tenantId],
    );
    return rows[0] ? mapSettings(rows[0]) : { ...DEFAULT_PURCHASE_SETTINGS };
  }

  async upsertSettings(
    tenantId: string,
    settings: Required<Pick<PurchaseSettings, 'overReceiptToleranceBp'>> & {
      priceToleranceBp: number;
      priceToleranceAbs: bigint;
    },
    manager: EntityManager,
  ): Promise<PurchaseSettings> {
    const rows: Row[] = await manager.query(
      `INSERT INTO "erp_purchase_settings"
         ("tenant_id", "over_receipt_tolerance_bp", "price_tolerance_bp", "price_tolerance_abs", "updated_at")
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT ("tenant_id") DO UPDATE SET
         "over_receipt_tolerance_bp" = EXCLUDED."over_receipt_tolerance_bp",
         "price_tolerance_bp" = EXCLUDED."price_tolerance_bp",
         "price_tolerance_abs" = EXCLUDED."price_tolerance_abs",
         "updated_at" = now()
       RETURNING *`,
      [tenantId, settings.overReceiptToleranceBp, settings.priceToleranceBp, settings.priceToleranceAbs.toString()],
    );
    return mapSettings(rows[0]);
  }

  // ---------------------------------------------------------------- numbering

  /**
   * Next document number for the tenant and prefix. The transaction-scoped advisory lock serialises
   * concurrent callers for the same tenant/prefix, so `count(*) + 1` cannot hand out the same number.
   */
  async nextNumber(tenantId: string, prefix: 'PR' | 'PO' | 'GR', manager: EntityManager): Promise<string> {
    await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${tenantId}:${prefix}`]);
    const table = NUMBER_TABLE[prefix];
    const rows: Row[] = await manager.query(
      `SELECT count(*)::text AS count FROM "${table}" WHERE "tenant_id" = $1`,
      [tenantId],
    );
    const n = BigInt(text(rows[0]?.count)) + 1n;
    return `${prefix}-${n.toString().padStart(6, '0')}`;
  }

  // ---------------------------------------------------------------- requests

  async insertRequest(tenantId: string, input: NewPurchaseRequest, manager: EntityManager): Promise<PurchaseRequest> {
    const lines = JSON.stringify(
      input.lines.map((line) => ({ sku: line.sku, quantity: line.quantity.toString() })),
    );
    const rows: Row[] = await manager.query(
      `INSERT INTO "erp_purchase_requests"
         ("tenant_id", "number", "status", "requested_by", "lines")
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING *`,
      [tenantId, input.number, input.status, input.requestedBy, lines],
    );
    return mapRequest(rows[0]);
  }

  async findRequest(
    tenantId: string,
    id: string,
    manager: EntityManager,
    forUpdate = false,
  ): Promise<PurchaseRequest | null> {
    const rows: Row[] = await manager.query(
      `SELECT * FROM "erp_purchase_requests" WHERE "tenant_id" = $1 AND "id" = $2${forUpdate ? ' FOR UPDATE' : ''}`,
      [tenantId, id],
    );
    return rows[0] ? mapRequest(rows[0]) : null;
  }

  async listRequests(tenantId: string, manager: EntityManager): Promise<PurchaseRequest[]> {
    const rows: Row[] = await manager.query(
      `SELECT * FROM "erp_purchase_requests" WHERE "tenant_id" = $1 ORDER BY "created_at" DESC, "number" DESC`,
      [tenantId],
    );
    return rows.map(mapRequest);
  }

  async updateRequestStatus(
    tenantId: string,
    id: string,
    status: PurchaseRequestStatus,
    manager: EntityManager,
    orderId?: string,
  ): Promise<void> {
    if (orderId === undefined) {
      await manager.query(
        `UPDATE "erp_purchase_requests" SET "status" = $1 WHERE "tenant_id" = $2 AND "id" = $3`,
        [status, tenantId, id],
      );
      return;
    }
    await manager.query(
      `UPDATE "erp_purchase_requests" SET "status" = $1, "order_id" = $2 WHERE "tenant_id" = $3 AND "id" = $4`,
      [status, orderId, tenantId, id],
    );
  }

  // ------------------------------------------------------------------ orders

  async insertOrder(tenantId: string, input: NewPurchaseOrder, manager: EntityManager): Promise<PurchaseOrder> {
    const rows: Row[] = await manager.query(
      `INSERT INTO "erp_purchase_orders"
         ("tenant_id", "number", "supplier_code", "status", "warehouse_id", "request_id", "order_date")
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        tenantId,
        input.number,
        input.supplierCode,
        input.status,
        input.warehouseId,
        input.requestId,
        input.orderDate,
      ],
    );
    const order = rows[0];
    const orderId = text(order.id);
    const lines: PurchaseOrderLine[] = [];
    for (let index = 0; index < input.lines.length; index += 1) {
      const line = input.lines[index];
      const lineRows: Row[] = await manager.query(
        `INSERT INTO "erp_purchase_order_lines"
           ("tenant_id", "order_id", "line_no", "sku", "quantity", "unit_price")
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [tenantId, orderId, index + 1, line.sku, line.quantity.toString(), line.unitPrice.toString()],
      );
      lines.push(mapOrderLine(lineRows[0]));
    }
    return mapOrder(order, lines);
  }

  async findOrder(
    tenantId: string,
    id: string,
    manager: EntityManager,
    forUpdate = false,
  ): Promise<PurchaseOrder | null> {
    const rows: Row[] = await manager.query(
      `SELECT * FROM "erp_purchase_orders" WHERE "tenant_id" = $1 AND "id" = $2${forUpdate ? ' FOR UPDATE' : ''}`,
      [tenantId, id],
    );
    if (!rows[0]) return null;
    const lines: Row[] = await manager.query(
      `SELECT * FROM "erp_purchase_order_lines" WHERE "tenant_id" = $1 AND "order_id" = $2 ORDER BY "line_no" ASC`,
      [tenantId, id],
    );
    return mapOrder(rows[0], lines.map(mapOrderLine));
  }

  async listOrders(
    tenantId: string,
    status: PurchaseOrderStatus | undefined,
    manager: EntityManager,
  ): Promise<PurchaseOrder[]> {
    const params: unknown[] = [tenantId];
    let where = `"tenant_id" = $1`;
    if (status) {
      params.push(status);
      where += ` AND "status" = $2`;
    }
    const rows: Row[] = await manager.query(
      `SELECT * FROM "erp_purchase_orders" WHERE ${where} ORDER BY "created_at" DESC, "number" DESC`,
      params,
    );
    if (rows.length === 0) return [];
    const ids = rows.map((row) => text(row.id));
    const lineRows: Row[] = await manager.query(
      `SELECT * FROM "erp_purchase_order_lines" WHERE "tenant_id" = $1 AND "order_id" = ANY($2::uuid[]) ORDER BY "line_no" ASC`,
      [tenantId, ids],
    );
    const byOrder = new Map<string, PurchaseOrderLine[]>();
    for (const row of lineRows) {
      const key = text(row.order_id);
      const list = byOrder.get(key) ?? [];
      list.push(mapOrderLine(row));
      byOrder.set(key, list);
    }
    return rows.map((row) => mapOrder(row, byOrder.get(text(row.id)) ?? []));
  }

  async updateOrderStatus(
    tenantId: string,
    id: string,
    status: PurchaseOrderStatus,
    manager: EntityManager,
    approval?: { approvedBy: string; approvedAt: Date },
  ): Promise<void> {
    if (approval) {
      await manager.query(
        `UPDATE "erp_purchase_orders"
            SET "status" = $1, "approved_by" = $2, "approved_at" = $3
          WHERE "tenant_id" = $4 AND "id" = $5`,
        [status, approval.approvedBy, approval.approvedAt, tenantId, id],
      );
      return;
    }
    await manager.query(
      `UPDATE "erp_purchase_orders" SET "status" = $1 WHERE "tenant_id" = $2 AND "id" = $3`,
      [status, tenantId, id],
    );
  }

  async updateOrderLines(
    tenantId: string,
    orderId: string,
    receivedAfter: Map<string, bigint>,
    manager: EntityManager,
  ): Promise<void> {
    for (const [lineId, quantity] of receivedAfter) {
      await manager.query(
        `UPDATE "erp_purchase_order_lines"
            SET "received_quantity" = $1
          WHERE "tenant_id" = $2 AND "order_id" = $3 AND "id" = $4`,
        [quantity.toString(), tenantId, orderId, lineId],
      );
    }
  }

  // ---------------------------------------------------------------- receipts

  async insertReceipt(
    tenantId: string,
    input: NewGoodsReceipt,
    lines: NewGoodsReceiptLine[],
    manager: EntityManager,
  ): Promise<GoodsReceipt> {
    const rows: Row[] = await manager.query(
      `INSERT INTO "erp_goods_receipts"
         ("tenant_id", "number", "order_id", "supplier_code", "received_at", "received_by",
          "idempotency_key", "total_value", "journal_entry_id")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        tenantId,
        input.number,
        input.orderId,
        input.supplierCode,
        input.receivedAt,
        input.receivedBy,
        input.idempotencyKey,
        input.totalValue.toString(),
        input.journalEntryId,
      ],
    );
    const receiptId = text(rows[0].id);
    const storedLines: GoodsReceiptLine[] = [];
    for (const line of lines) {
      const lineRows: Row[] = await manager.query(
        `INSERT INTO "erp_goods_receipt_lines"
           ("tenant_id", "receipt_id", "order_line_id", "sku", "quantity", "unit_cost", "value", "weight", "fifo_batch_id")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          tenantId,
          receiptId,
          line.orderLineId,
          line.sku,
          line.quantity.toString(),
          line.unitCost.toString(),
          line.value.toString(),
          line.weight === null ? null : line.weight.toString(),
          line.fifoBatchId,
        ],
      );
      storedLines.push(mapReceiptLine(lineRows[0]));
    }
    return mapReceipt(rows[0], storedLines);
  }

  async findReceiptByKey(
    tenantId: string,
    idempotencyKey: string,
    manager: EntityManager,
  ): Promise<GoodsReceipt | null> {
    const rows: Row[] = await manager.query(
      `SELECT * FROM "erp_goods_receipts" WHERE "tenant_id" = $1 AND "idempotency_key" = $2`,
      [tenantId, idempotencyKey],
    );
    return rows[0] ? this.withLines(tenantId, rows[0], manager) : null;
  }

  async findReceipt(tenantId: string, id: string, manager: EntityManager): Promise<GoodsReceipt | null> {
    const rows: Row[] = await manager.query(
      `SELECT * FROM "erp_goods_receipts" WHERE "tenant_id" = $1 AND "id" = $2`,
      [tenantId, id],
    );
    return rows[0] ? this.withLines(tenantId, rows[0], manager) : null;
  }

  async listReceipts(
    tenantId: string,
    orderId: string | undefined,
    manager: EntityManager,
  ): Promise<GoodsReceipt[]> {
    const params: unknown[] = [tenantId];
    let where = `"tenant_id" = $1`;
    if (orderId) {
      params.push(orderId);
      where += ` AND "order_id" = $2`;
    }
    const rows: Row[] = await manager.query(
      `SELECT * FROM "erp_goods_receipts" WHERE ${where} ORDER BY "received_at" DESC, "number" DESC`,
      params,
    );
    if (rows.length === 0) return [];
    const ids = rows.map((row) => text(row.id));
    const lineRows: Row[] = await manager.query(
      `SELECT * FROM "erp_goods_receipt_lines" WHERE "tenant_id" = $1 AND "receipt_id" = ANY($2::uuid[]) ORDER BY "sku" ASC`,
      [tenantId, ids],
    );
    const byReceipt = new Map<string, GoodsReceiptLine[]>();
    for (const row of lineRows) {
      const key = text(row.receipt_id);
      const list = byReceipt.get(key) ?? [];
      list.push(mapReceiptLine(row));
      byReceipt.set(key, list);
    }
    return rows.map((row) => mapReceipt(row, byReceipt.get(text(row.id)) ?? []));
  }

  async updateReceiptJournalEntry(
    tenantId: string,
    id: string,
    journalEntryId: string,
    manager: EntityManager,
  ): Promise<void> {
    await manager.query(
      `UPDATE "erp_goods_receipts" SET "journal_entry_id" = $1 WHERE "tenant_id" = $2 AND "id" = $3`,
      [journalEntryId, tenantId, id],
    );
  }

  private async withLines(tenantId: string, row: Row, manager: EntityManager): Promise<GoodsReceipt> {
    const lines: Row[] = await manager.query(
      `SELECT * FROM "erp_goods_receipt_lines" WHERE "tenant_id" = $1 AND "receipt_id" = $2 ORDER BY "sku" ASC`,
      [tenantId, text(row.id)],
    );
    return mapReceipt(row, lines.map(mapReceiptLine));
  }
}