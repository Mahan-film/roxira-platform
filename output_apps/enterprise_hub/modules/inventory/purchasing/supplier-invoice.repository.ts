import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { MatchStatus } from './invoice-match.domain';

type Row = Record<string, unknown>;

export type SupplierInvoiceStatus = 'HELD' | 'MATCHED' | 'POSTED';

export interface SupplierInvoiceLine {
  id: string;
  receiptLineId: string;
  sku: string;
  quantity: bigint;
  unitPrice: bigint;
  orderValue: bigint;
  invoiceValue: bigint;
  priceDifference: bigint;
  matchStatus: MatchStatus;
}

export interface SupplierInvoice {
  id: string;
  tenantId: string;
  number: string;
  orderId: string | null;
  supplierCode: string;
  supplierRef: string;
  invoiceDate: string;
  status: SupplierInvoiceStatus;
  accepted: boolean;
  acceptedBy: string | null;
  acceptedAt: Date | null;
  acceptNote: string | null;
  createdBy: string;
  vat: bigint;
  subtotal: bigint;
  total: bigint;
  journalEntryId: string | null;
  createdAt: Date;
  lines: SupplierInvoiceLine[];
}

export interface NewSupplierInvoice {
  number: string;
  orderId: string;
  supplierCode: string;
  supplierRef: string;
  invoiceDate: string;
  status: SupplierInvoiceStatus;
  createdBy: string;
  vat: bigint;
  subtotal: bigint;
  total: bigint;
}

export interface NewSupplierInvoiceLine {
  receiptLineId: string;
  sku: string;
  quantity: bigint;
  unitPrice: bigint;
  orderValue: bigint;
  invoiceValue: bigint;
  priceDifference: bigint;
  matchStatus: MatchStatus;
}

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

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function toNullableDate(value: unknown): Date | null {
  return value === null || value === undefined ? null : toDate(value);
}

function mapLine(row: Row): SupplierInvoiceLine {
  return {
    id: text(row.id),
    receiptLineId: text(row.receipt_line_id),
    sku: text(row.sku),
    quantity: toBigInt(row.quantity),
    unitPrice: toBigInt(row.unit_price),
    orderValue: toBigInt(row.order_value),
    invoiceValue: toBigInt(row.invoice_value),
    priceDifference: toBigInt(row.price_difference),
    matchStatus: text(row.match_status) as MatchStatus,
  };
}

function mapInvoice(row: Row, lines: SupplierInvoiceLine[]): SupplierInvoice {
  return {
    id: text(row.id),
    tenantId: text(row.tenant_id),
    number: text(row.number),
    orderId: nullableText(row.order_id),
    supplierCode: text(row.supplier_code),
    supplierRef: text(row.supplier_ref),
    invoiceDate: text(row.invoice_date),
    status: text(row.status) as SupplierInvoiceStatus,
    accepted: row.accepted === true,
    acceptedBy: nullableText(row.accepted_by),
    acceptedAt: toNullableDate(row.accepted_at),
    acceptNote: nullableText(row.accept_note),
    createdBy: text(row.created_by),
    vat: toBigInt(row.vat),
    subtotal: toBigInt(row.subtotal),
    total: toBigInt(row.total),
    journalEntryId: nullableText(row.journal_entry_id),
    createdAt: toDate(row.created_at),
    lines,
  };
}

/**
 * The only access point to the two supplier-invoice tables. They have FORCE row-level security, so
 * every call runs inside a TenantScope transaction (`app.tenant_id`), and every query also filters
 * by `tenantId` itself (AGENTS.md §4). Methods take the caller's `manager` and join that transaction.
 */
@Injectable()
export class SupplierInvoiceRepository {
  constructor(private readonly scope: TenantScope) {}

  run<T>(tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.scope.run(tenantId, work);
  }

  async insertInvoice(
    tenantId: string,
    input: NewSupplierInvoice,
    lines: readonly NewSupplierInvoiceLine[],
    manager: EntityManager,
  ): Promise<SupplierInvoice> {
    const rows: Row[] = await manager.query(
      `INSERT INTO "erp_supplier_invoices"
         ("tenant_id", "number", "order_id", "supplier_code", "supplier_ref", "invoice_date",
          "status", "created_by", "vat", "subtotal", "total")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        tenantId,
        input.number,
        input.orderId,
        input.supplierCode,
        input.supplierRef,
        input.invoiceDate,
        input.status,
        input.createdBy,
        input.vat.toString(),
        input.subtotal.toString(),
        input.total.toString(),
      ],
    );
    const invoiceId = text(rows[0].id);
    const storedLines: SupplierInvoiceLine[] = [];
    for (const line of lines) {
      const lineRows: Row[] = await manager.query(
        `INSERT INTO "erp_supplier_invoice_lines"
           ("tenant_id", "invoice_id", "receipt_line_id", "sku", "quantity", "unit_price",
            "order_value", "invoice_value", "price_difference", "match_status")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          tenantId,
          invoiceId,
          line.receiptLineId,
          line.sku,
          line.quantity.toString(),
          line.unitPrice.toString(),
          line.orderValue.toString(),
          line.invoiceValue.toString(),
          line.priceDifference.toString(),
          line.matchStatus,
        ],
      );
      storedLines.push(mapLine(lineRows[0]));
    }
    return mapInvoice(rows[0], storedLines);
  }

  async findIdBySupplierRef(
    tenantId: string,
    supplierCode: string,
    supplierRef: string,
    manager: EntityManager,
  ): Promise<string | null> {
    const rows: Row[] = await manager.query(
      `SELECT "id" FROM "erp_supplier_invoices"
        WHERE "tenant_id" = $1 AND "supplier_code" = $2 AND "supplier_ref" = $3`,
      [tenantId, supplierCode, supplierRef],
    );
    return rows[0] ? text(rows[0].id) : null;
  }

  async findInvoice(
    tenantId: string,
    id: string,
    manager: EntityManager,
    forUpdate = false,
  ): Promise<SupplierInvoice | null> {
    const rows: Row[] = await manager.query(
      `SELECT * FROM "erp_supplier_invoices" WHERE "tenant_id" = $1 AND "id" = $2${forUpdate ? ' FOR UPDATE' : ''}`,
      [tenantId, id],
    );
    return rows[0] ? this.withLines(tenantId, rows[0], manager) : null;
  }

  async listInvoices(tenantId: string, manager: EntityManager): Promise<SupplierInvoice[]> {
    const rows: Row[] = await manager.query(
      `SELECT * FROM "erp_supplier_invoices" WHERE "tenant_id" = $1 ORDER BY "created_at" DESC, "number" DESC`,
      [tenantId],
    );
    if (rows.length === 0) return [];
    const ids = rows.map((row) => text(row.id));
    const lineRows: Row[] = await manager.query(
      `SELECT * FROM "erp_supplier_invoice_lines"
        WHERE "tenant_id" = $1 AND "invoice_id" = ANY($2::uuid[])
        ORDER BY "receipt_line_id" ASC`,
      [tenantId, ids],
    );
    const byInvoice = new Map<string, SupplierInvoiceLine[]>();
    for (const row of lineRows) {
      const key = text(row.invoice_id);
      const list = byInvoice.get(key) ?? [];
      list.push(mapLine(row));
      byInvoice.set(key, list);
    }
    return rows.map((row) => mapInvoice(row, byInvoice.get(text(row.id)) ?? []));
  }

  /** Quantity already invoiced on a receipt line by every invoice of the tenant, any status. */
  async sumInvoicedQuantity(
    tenantId: string,
    receiptLineId: string,
    manager: EntityManager,
  ): Promise<bigint> {
    const rows: Row[] = await manager.query(
      `SELECT COALESCE(SUM("quantity"), 0)::text AS total
         FROM "erp_supplier_invoice_lines"
        WHERE "tenant_id" = $1 AND "receipt_line_id" = $2`,
      [tenantId, receiptLineId],
    );
    return toBigInt(rows[0]?.total);
  }

  async acceptInvoice(
    tenantId: string,
    id: string,
    acceptedBy: string,
    acceptedAt: Date,
    note: string,
    manager: EntityManager,
  ): Promise<void> {
    await manager.query(
      `UPDATE "erp_supplier_invoices"
          SET "accepted" = true, "accepted_by" = $1, "accepted_at" = $2,
              "accept_note" = $3, "status" = 'MATCHED'
        WHERE "tenant_id" = $4 AND "id" = $5`,
      [acceptedBy, acceptedAt, note, tenantId, id],
    );
  }

  async markPosted(
    tenantId: string,
    id: string,
    journalEntryId: string,
    manager: EntityManager,
  ): Promise<void> {
    await manager.query(
      `UPDATE "erp_supplier_invoices"
          SET "status" = 'POSTED', "journal_entry_id" = $1
        WHERE "tenant_id" = $2 AND "id" = $3`,
      [journalEntryId, tenantId, id],
    );
  }

  private async withLines(
    tenantId: string,
    row: Row,
    manager: EntityManager,
  ): Promise<SupplierInvoice> {
    const lines: Row[] = await manager.query(
      `SELECT * FROM "erp_supplier_invoice_lines"
        WHERE "tenant_id" = $1 AND "invoice_id" = $2
        ORDER BY "receipt_line_id" ASC`,
      [tenantId, text(row.id)],
    );
    return mapInvoice(row, lines.map(mapLine));
  }
}