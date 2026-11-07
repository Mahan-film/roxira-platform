import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { LandedCostBasis, LandedCostCategory } from './landed-cost.domain';

type Row = Record<string, unknown>;

export interface NewLandedCostAllocation {
  receiptLineId: string;
  sku: string;
  /** Line quantity, hundredths of a unit. */
  quantity: bigint;
  /** The basis weight the share came from (line value, quantity or weight). */
  basisValue: bigint;
  /** Allocated part of the amount, minor units. */
  share: bigint;
  /** The part still on hand in the line's FIFO layer, minor units. */
  toInventory: bigint;
  /** The part already issued from the layer, minor units. */
  toCogs: bigint;
  fifoBatchId: number | null;
}

export interface NewLandedCost {
  receiptId: string;
  category: LandedCostCategory;
  basis: LandedCostBasis;
  /** Minor units, positive. */
  amount: bigint;
  /** Cost date, YYYY-MM-DD. */
  date: string;
  supplierCode: string;
  reference: string;
  idempotencyKey: string | null;
  createdBy: string;
  inventoryAmount: bigint;
  cogsAmount: bigint;
}

export interface LandedCostAllocation {
  id: string;
  receiptLineId: string;
  sku: string;
  quantity: bigint;
  basisValue: bigint;
  share: bigint;
  toInventory: bigint;
  toCogs: bigint;
  fifoBatchId: number | null;
}

export interface LandedCost {
  id: string;
  tenantId: string;
  receiptId: string;
  category: LandedCostCategory;
  basis: LandedCostBasis;
  amount: bigint;
  date: string;
  supplierCode: string;
  reference: string;
  idempotencyKey: string | null;
  createdBy: string;
  inventoryAmount: bigint;
  cogsAmount: bigint;
  journalEntryId: string | null;
  createdAt: Date;
  allocations: LandedCostAllocation[];
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function toBigInt(value: unknown): bigint {
  if (value === null || value === undefined || value === '') return 0n;
  return BigInt(String(value));
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function mapAllocation(row: Row): LandedCostAllocation {
  return {
    id: text(row.id),
    receiptLineId: text(row.receipt_line_id),
    sku: text(row.sku),
    quantity: toBigInt(row.quantity),
    basisValue: toBigInt(row.basis_value),
    share: toBigInt(row.share),
    toInventory: toBigInt(row.to_inventory),
    toCogs: toBigInt(row.to_cogs),
    fifoBatchId: row.fifo_batch_id === null || row.fifo_batch_id === undefined ? null : Number(row.fifo_batch_id),
  };
}

function mapLandedCost(row: Row, allocations: LandedCostAllocation[]): LandedCost {
  return {
    id: text(row.id),
    tenantId: text(row.tenant_id),
    receiptId: text(row.receipt_id),
    category: text(row.category) as LandedCostCategory,
    basis: text(row.basis) as LandedCostBasis,
    amount: toBigInt(row.amount),
    date: text(row.cost_date),
    supplierCode: text(row.supplier_code),
    reference: text(row.reference),
    idempotencyKey: row.idempotency_key === null || row.idempotency_key === undefined ? null : text(row.idempotency_key),
    createdBy: text(row.created_by),
    inventoryAmount: toBigInt(row.inventory_amount),
    cogsAmount: toBigInt(row.cogs_amount),
    journalEntryId: row.journal_entry_id === null || row.journal_entry_id === undefined ? null : text(row.journal_entry_id),
    createdAt: toDate(row.created_at),
    allocations,
  };
}

/**
 * The only access point to the two landed-cost tables. They have FORCE row-level security, so
 * every call runs inside a TenantScope transaction (`app.tenant_id`), and every query also filters
 * by `tenantId` itself (AGENTS.md §4). Methods take the caller's `manager` and join that transaction.
 */
@Injectable()
export class LandedCostRepository {
  constructor(private readonly scope: TenantScope) {}

  async insertLandedCost(
    tenantId: string,
    input: NewLandedCost,
    allocations: readonly NewLandedCostAllocation[],
    manager: EntityManager,
  ): Promise<LandedCost> {
    const rows: Row[] = await manager.query(
      `INSERT INTO "erp_landed_costs"
         ("tenant_id", "receipt_id", "category", "basis", "amount", "cost_date", "supplier_code",
          "reference", "idempotency_key", "created_by", "inventory_amount", "cogs_amount")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        tenantId,
        input.receiptId,
        input.category,
        input.basis,
        input.amount.toString(),
        input.date,
        input.supplierCode,
        input.reference,
        input.idempotencyKey,
        input.createdBy,
        input.inventoryAmount.toString(),
        input.cogsAmount.toString(),
      ],
    );
    const landedCostId = text(rows[0].id);
    const stored: LandedCostAllocation[] = [];
    for (const allocation of allocations) {
      const allocationRows: Row[] = await manager.query(
        `INSERT INTO "erp_landed_cost_allocations"
           ("tenant_id", "landed_cost_id", "receipt_line_id", "sku", "quantity", "basis_value",
            "share", "to_inventory", "to_cogs", "fifo_batch_id")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          tenantId,
          landedCostId,
          allocation.receiptLineId,
          allocation.sku,
          allocation.quantity.toString(),
          allocation.basisValue.toString(),
          allocation.share.toString(),
          allocation.toInventory.toString(),
          allocation.toCogs.toString(),
          allocation.fifoBatchId,
        ],
      );
      stored.push(mapAllocation(allocationRows[0]));
    }
    return mapLandedCost(rows[0], stored);
  }

  async findByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
    manager: EntityManager,
  ): Promise<LandedCost | null> {
    const rows: Row[] = await manager.query(
      `SELECT * FROM "erp_landed_costs" WHERE "tenant_id" = $1 AND "idempotency_key" = $2`,
      [tenantId, idempotencyKey],
    );
    return rows[0] ? this.withAllocations(tenantId, rows[0], manager) : null;
  }

  async findLandedCost(tenantId: string, id: string, manager: EntityManager): Promise<LandedCost | null> {
    const rows: Row[] = await manager.query(
      `SELECT * FROM "erp_landed_costs" WHERE "tenant_id" = $1 AND "id" = $2`,
      [tenantId, id],
    );
    return rows[0] ? this.withAllocations(tenantId, rows[0], manager) : null;
  }

  async listByReceipt(tenantId: string, receiptId: string, manager: EntityManager): Promise<LandedCost[]> {
    const rows: Row[] = await manager.query(
      `SELECT * FROM "erp_landed_costs" WHERE "tenant_id" = $1 AND "receipt_id" = $2 ORDER BY "created_at" ASC, "id" ASC`,
      [tenantId, receiptId],
    );
    if (rows.length === 0) return [];
    const ids = rows.map((row) => text(row.id));
    const allocationRows: Row[] = await manager.query(
      `SELECT * FROM "erp_landed_cost_allocations"
        WHERE "tenant_id" = $1 AND "landed_cost_id" = ANY($2::uuid[])
        ORDER BY "receipt_line_id" ASC`,
      [tenantId, ids],
    );
    const byCost = new Map<string, LandedCostAllocation[]>();
    for (const row of allocationRows) {
      const key = text(row.landed_cost_id);
      const list = byCost.get(key) ?? [];
      list.push(mapAllocation(row));
      byCost.set(key, list);
    }
    return rows.map((row) => mapLandedCost(row, byCost.get(text(row.id)) ?? []));
  }

  async markPosted(
    tenantId: string,
    id: string,
    journalEntryId: string,
    manager: EntityManager,
  ): Promise<void> {
    await manager.query(
      `UPDATE "erp_landed_costs" SET "journal_entry_id" = $1 WHERE "tenant_id" = $2 AND "id" = $3`,
      [journalEntryId, tenantId, id],
    );
  }

  private async withAllocations(
    tenantId: string,
    row: Row,
    manager: EntityManager,
  ): Promise<LandedCost> {
    const allocations: Row[] = await manager.query(
      `SELECT * FROM "erp_landed_cost_allocations"
        WHERE "tenant_id" = $1 AND "landed_cost_id" = $2
        ORDER BY "receipt_line_id" ASC`,
      [tenantId, text(row.id)],
    );
    return mapLandedCost(row, allocations.map(mapAllocation));
  }
}
