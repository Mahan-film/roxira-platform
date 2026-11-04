import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { TreasuryAllocationEntity } from '../entities/treasury-allocation.entity';
import { TreasuryDocumentLineEntity } from '../entities/treasury-document-line.entity';
import { TreasuryDocumentEntity } from '../entities/treasury-document.entity';
import { TreasurySettingsEntity } from '../entities/treasury-settings.entity';
import { AllocationTargetType, TreasuryDocKind, TreasuryMethod } from '../enums/treasury.enum';

export interface DocumentInput {
  kind: TreasuryDocKind;
  docNumber: string;
  docDate: string;
  partyType: TreasuryDocumentEntity['partyType'];
  partyCode: string;
  partyName: string;
  total: string;
  writeoffTotal: string;
  advanceRemaining: string;
  description: string | null;
}

export interface LineInput {
  method: TreasuryMethod;
  amount: string;
  bankAccountId: number | null;
  cashBoxId: number | null;
  chequeId: number | null;
  reference: string | null;
}

export interface AllocationInput {
  targetId: string;
  targetNumber: string | null;
  amount: string;
  writeoff: string;
  allocatedDate: string;
  journalEntryId: number | null;
}

export interface DocumentFilter {
  kind?: TreasuryDocKind;
  partyCode?: string;
  from?: string;
  to?: string;
}

export interface AllocationRow {
  documentId: number;
  docNumber: string;
  kind: TreasuryDocKind;
  partyCode: string;
  targetId: string;
  targetNumber: string | null;
  amount: string;
  writeoff: string;
  allocatedDate: string;
}

/**
 * The only access point to the `fin_treasury_*` tables. All four have FORCE row-level security, so
 * every call runs in a TenantScope transaction (`app.tenant_id`), and every query also filters by
 * `tenantId` itself (AGENTS.md §4). Methods taking a `manager` join the transaction opened by
 * `runInTransaction`.
 */
@Injectable()
export class TreasuryRepository {
  constructor(private readonly scope: TenantScope) {}

  runInTransaction<T>(tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.scope.run(tenantId, work);
  }

  private within<T>(tenantId: string, manager: EntityManager | undefined, work: (m: EntityManager) => Promise<T>): Promise<T> {
    return this.scope.within(tenantId, manager, work);
  }

  // ------------------------------------------------------------------ settings

  async getTolerance(tenantId: string, manager?: EntityManager): Promise<string> {
    return this.within(tenantId, manager, async (m) => {
      const row = await m.getRepository(TreasurySettingsEntity).findOne({ where: { tenantId } });
      return row?.writeoffTolerance ?? '0.00';
    });
  }

  async setTolerance(tenantId: string, tolerance: string): Promise<void> {
    await this.within(tenantId, undefined, async (m) => {
      await m.query(
        `INSERT INTO "fin_treasury_settings" ("tenant_id", "writeoff_tolerance") VALUES ($1, $2)
         ON CONFLICT ("tenant_id") DO UPDATE SET "writeoff_tolerance" = EXCLUDED."writeoff_tolerance", "updated_at" = now()`,
        [tenantId, tolerance],
      );
    });
  }

  /** Next gap-free number of the kind for this tenant; the counter row is locked until commit. */
  async nextNumber(tenantId: string, kind: TreasuryDocKind, manager: EntityManager): Promise<number> {
    const column = kind === TreasuryDocKind.RECEIPT ? 'next_receipt_no' : 'next_payment_no';
    const rows: Array<{ n: number }> = await manager.query(
      `INSERT INTO "fin_treasury_settings" ("tenant_id", "${column}") VALUES ($1, 2)
       ON CONFLICT ("tenant_id") DO UPDATE SET "${column}" = "fin_treasury_settings"."${column}" + 1, "updated_at" = now()
       RETURNING "${column}" - 1 AS n`,
      [tenantId],
    );
    return Number(rows[0].n);
  }

  // ------------------------------------------------------------------ documents

  createDocument(tenantId: string, input: DocumentInput, manager: EntityManager): Promise<TreasuryDocumentEntity> {
    const repo = manager.getRepository(TreasuryDocumentEntity);
    return repo.save(repo.create({ ...input, tenantId }));
  }

  async addLines(tenantId: string, documentId: number, lines: LineInput[], manager: EntityManager): Promise<void> {
    const repo = manager.getRepository(TreasuryDocumentLineEntity);
    await repo.save(lines.map((line) => repo.create({ ...line, tenantId, documentId })));
  }

  async addAllocations(
    tenantId: string,
    documentId: number,
    rows: AllocationInput[],
    manager: EntityManager,
  ): Promise<void> {
    if (rows.length === 0) return;
    const repo = manager.getRepository(TreasuryAllocationEntity);
    await repo.save(
      rows.map((row) => repo.create({ ...row, tenantId, documentId, targetType: AllocationTargetType.INVOICE })),
    );
  }

  async updateDocument(
    tenantId: string,
    id: number,
    patch: Partial<Pick<TreasuryDocumentEntity, 'advanceRemaining' | 'writeoffTotal' | 'journalEntryId'>>,
    manager: EntityManager,
  ): Promise<void> {
    await manager.getRepository(TreasuryDocumentEntity).update({ id, tenantId }, patch);
  }

  findDocument(tenantId: string, id: number, manager?: EntityManager): Promise<TreasuryDocumentEntity | null> {
    return this.within(tenantId, manager, (m) => m.getRepository(TreasuryDocumentEntity).findOne({ where: { id, tenantId } }));
  }

  /** Row-locked read, so two allocations of one advance cannot both pass the remaining check. */
  findDocumentForUpdate(tenantId: string, id: number, manager: EntityManager): Promise<TreasuryDocumentEntity | null> {
    return manager.getRepository(TreasuryDocumentEntity).findOne({
      where: { id, tenantId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  listDocuments(tenantId: string, filter: DocumentFilter): Promise<TreasuryDocumentEntity[]> {
    return this.within(tenantId, undefined, async (m) => {
      const qb = m
        .getRepository(TreasuryDocumentEntity)
        .createQueryBuilder('d')
        .where('d.tenant_id = :tenantId', { tenantId });
      if (filter.kind) qb.andWhere('d.kind = :kind', { kind: filter.kind });
      if (filter.partyCode) qb.andWhere('d.party_code = :partyCode', { partyCode: filter.partyCode });
      if (filter.from) qb.andWhere('d.doc_date >= :from', { from: filter.from });
      if (filter.to) qb.andWhere('d.doc_date <= :to', { to: filter.to });
      return qb.orderBy('d.doc_date', 'DESC').addOrderBy('d.id', 'DESC').limit(500).getMany();
    });
  }

  listLines(tenantId: string, documentId: number, manager?: EntityManager): Promise<TreasuryDocumentLineEntity[]> {
    return this.within(tenantId, manager, (m) =>
      m.getRepository(TreasuryDocumentLineEntity).find({ where: { tenantId, documentId }, order: { id: 'ASC' } }),
    );
  }

  listAllocationsOfDocument(tenantId: string, documentId: number, manager?: EntityManager): Promise<TreasuryAllocationEntity[]> {
    return this.within(tenantId, manager, (m) =>
      m.getRepository(TreasuryAllocationEntity).find({ where: { tenantId, documentId }, order: { id: 'ASC' } }),
    );
  }

  // ------------------------------------------------------------------ allocations

  /**
   * Serialises concurrent allocations to the same invoices: transaction-scoped advisory locks taken
   * in sorted order (no deadlock between two documents hitting the same invoices).
   */
  async lockTargets(tenantId: string, targetIds: string[], manager: EntityManager): Promise<void> {
    for (const id of [...new Set(targetIds)].sort()) {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`treasury:${tenantId}:${id}`]);
    }
  }

  /** Sum of `amount + writeoff` already allocated per invoice (decimal strings), keyed by invoice id. */
  async allocatedByTarget(tenantId: string, targetIds: string[], manager: EntityManager): Promise<Map<string, string>> {
    if (targetIds.length === 0) return new Map();
    const rows: Array<{ target_id: string; settled: string }> = await manager.query(
      `SELECT "target_id", SUM("amount" + "writeoff")::text AS settled
       FROM "fin_treasury_allocations"
       WHERE "tenant_id" = $1 AND "target_type" = 'invoice' AND "target_id" = ANY($2::text[])
       GROUP BY "target_id"`,
      [tenantId, targetIds],
    );
    return new Map(rows.map((r) => [r.target_id, r.settled]));
  }

  /** Allocation rows for ageing and statements, joined to their document. */
  listAllocations(
    tenantId: string,
    filter: { partyCode?: string; targetIds?: string[]; asOf?: string },
  ): Promise<AllocationRow[]> {
    return this.within(tenantId, undefined, async (m) => {
      const params: unknown[] = [tenantId];
      let where = `a."tenant_id" = $1 AND d."tenant_id" = $1 AND d."status" = 'posted'`;
      if (filter.partyCode) {
        params.push(filter.partyCode);
        where += ` AND d."party_code" = $${params.length}`;
      }
      if (filter.targetIds?.length) {
        params.push(filter.targetIds);
        where += ` AND a."target_id" = ANY($${params.length}::text[])`;
      }
      if (filter.asOf) {
        params.push(filter.asOf);
        where += ` AND a."allocated_date" <= $${params.length}`;
      }
      const rows: Array<Record<string, string | number>> = await m.query(
        `SELECT a."document_id", d."doc_number", d."kind", d."party_code", a."target_id", a."target_number",
                a."amount"::text AS amount, a."writeoff"::text AS writeoff, to_char(a."allocated_date", 'YYYY-MM-DD') AS allocated_date
         FROM "fin_treasury_allocations" a
         JOIN "fin_treasury_documents" d ON d."id" = a."document_id"
         WHERE ${where}
         ORDER BY a."allocated_date", a."id"`,
        params,
      );
      return rows.map((r) => ({
        documentId: Number(r.document_id),
        docNumber: String(r.doc_number),
        kind: r.kind as TreasuryDocKind,
        partyCode: String(r.party_code),
        targetId: String(r.target_id),
        targetNumber: r.target_number === null ? null : String(r.target_number),
        amount: String(r.amount),
        writeoff: String(r.writeoff),
        allocatedDate: String(r.allocated_date),
      }));
    });
  }
}
