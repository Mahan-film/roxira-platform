import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { minorToDecimal } from '../../accounting/money';
import { ParsedStatementLine } from '../statement/statement.types';

export type StatementLineStatus = 'unmatched' | 'matched';

export interface StatementLineRow {
  id: string;
  bankAccountId: number;
  importId: string;
  bankTxnId: string;
  bookingDate: string;
  valueDate: string | null;
  /** Decimal string. */
  amount: string;
  direction: 'credit' | 'debit';
  currency: string | null;
  reference: string;
  counterparty: string | null;
  status: StatementLineStatus;
}

export interface StatementMatchRow {
  id: string;
  lineId: string;
  rule: 'reference' | 'amount_date' | 'manual';
  auto: boolean;
  fee: string;
  journalEntryId: number;
  explanation: unknown;
  confirmedBy: string;
  allocations: Array<{ invoiceId: string; invoiceNumber: string | null; amount: string }>;
}

const LINE_COLUMNS = `"id", "bank_account_id" AS "bankAccountId", "import_id" AS "importId", "bank_txn_id" AS "bankTxnId",
  "booking_date"::text AS "bookingDate", "value_date"::text AS "valueDate", "amount"::text AS "amount",
  "direction", "currency", "reference", "counterparty", "status"`;

/**
 * Persistence of imported statement lines and their matches. Every statement carries the tenant id
 * and runs inside TenantScope (FORCE RLS on all four tables is the second line of defence).
 */
@Injectable()
export class BankStatementRepository {
  constructor(private readonly scope: TenantScope) {}

  runInTransaction<T>(tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.scope.run(tenantId, work);
  }

  async createImport(
    tenantId: string,
    input: {
      bankAccountId: number;
      format: string;
      statementId: string | null;
      accountRef: string | null;
      fileHash: string;
      lineCount: number;
      importedBy: string;
    },
    manager: EntityManager,
  ): Promise<string> {
    const rows: Array<{ id: string }> = await manager.query(
      `INSERT INTO "fin_bank_stmt_imports"
         ("tenant_id", "bank_account_id", "format", "statement_id", "account_ref", "file_hash", "line_count", "new_line_count", "imported_by")
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8) RETURNING "id"`,
      [tenantId, input.bankAccountId, input.format, input.statementId, input.accountRef, input.fileHash, input.lineCount, input.importedBy],
    );
    return rows[0].id;
  }

  async setImportNewCount(tenantId: string, importId: string, count: number, manager: EntityManager): Promise<void> {
    await manager.query(`UPDATE "fin_bank_stmt_imports" SET "new_line_count" = $3 WHERE "tenant_id" = $1 AND "id" = $2`, [tenantId, importId, count]);
  }

  /**
   * Inserts the lines that do not exist yet. The unique key (tenant, bank account, bank txn id) makes
   * a repeated import a no-op: only the rows actually inserted are returned.
   */
  async insertNewLines(
    tenantId: string,
    bankAccountId: number,
    importId: string,
    lines: readonly ParsedStatementLine[],
    manager: EntityManager,
  ): Promise<StatementLineRow[]> {
    if (lines.length === 0) return [];
    return manager.query(
      `INSERT INTO "fin_bank_stmt_lines"
         ("tenant_id", "bank_account_id", "import_id", "bank_txn_id", "booking_date", "value_date", "amount",
          "direction", "currency", "reference", "counterparty")
       SELECT $1::uuid, $2::int, $3::uuid, t.txn, t.booked::date, t.valued::date, t.amount::numeric,
              t.dir, t.ccy, t.ref, t.party
         FROM unnest($4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::text[])
              AS t(txn, booked, valued, amount, dir, ccy, ref, party)
       ON CONFLICT ("tenant_id", "bank_account_id", "bank_txn_id") DO NOTHING
       RETURNING ${LINE_COLUMNS}`,
      [
        tenantId,
        bankAccountId,
        importId,
        lines.map((l) => l.bankTxnId),
        lines.map((l) => l.bookingDate),
        lines.map((l) => l.valueDate),
        lines.map((l) => minorToDecimal(l.amountMinor)),
        lines.map((l) => l.direction),
        lines.map((l) => l.currency),
        lines.map((l) => l.reference),
        lines.map((l) => l.counterparty),
      ],
    );
  }

  listLines(
    tenantId: string,
    filter: { bankAccountId: number; status?: StatementLineStatus; limit: number; offset: number },
    manager?: EntityManager,
  ): Promise<StatementLineRow[]> {
    return this.scope.within(tenantId, manager, (m) =>
      m.query(
        `SELECT ${LINE_COLUMNS} FROM "fin_bank_stmt_lines"
          WHERE "tenant_id" = $1 AND "bank_account_id" = $2 AND ($3::text IS NULL OR "status" = $3)
          ORDER BY "booking_date" DESC, "created_at" DESC, "id"
          LIMIT $4 OFFSET $5`,
        [tenantId, filter.bankAccountId, filter.status ?? null, filter.limit, filter.offset],
      ),
    );
  }

  /** Row-locked read of one line: two concurrent confirms of the same line queue up here. */
  async findLineForUpdate(tenantId: string, id: string, manager: EntityManager): Promise<StatementLineRow | null> {
    const rows: StatementLineRow[] = await manager.query(
      `SELECT ${LINE_COLUMNS} FROM "fin_bank_stmt_lines" WHERE "tenant_id" = $1 AND "id" = $2 FOR UPDATE`,
      [tenantId, id],
    );
    return rows[0] ?? null;
  }

  async markMatched(tenantId: string, id: string, manager: EntityManager): Promise<boolean> {
    // The CTE makes the driver return rows; a bare UPDATE ... RETURNING comes back as [rows, count].
    const rows: Array<{ n: number }> = await manager.query(
      `WITH claimed AS (
         UPDATE "fin_bank_stmt_lines" SET "status" = 'matched'
          WHERE "tenant_id" = $1 AND "id" = $2 AND "status" = 'unmatched' RETURNING "id")
       SELECT count(*)::int AS n FROM claimed`,
      [tenantId, id],
    );
    return rows[0].n === 1;
  }

  async insertMatch(
    tenantId: string,
    input: {
      lineId: string;
      rule: string;
      auto: boolean;
      fee: string;
      journalEntryId: number;
      explanation: unknown;
      confirmedBy: string;
      allocations: Array<{ invoiceId: string; invoiceNumber: string | null; amount: string }>;
    },
    manager: EntityManager,
  ): Promise<string> {
    const rows: Array<{ id: string }> = await manager.query(
      `INSERT INTO "fin_bank_stmt_matches"
         ("tenant_id", "line_id", "rule", "auto", "fee", "journal_entry_id", "explanation", "confirmed_by")
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8) RETURNING "id"`,
      [tenantId, input.lineId, input.rule, input.auto, input.fee, input.journalEntryId, JSON.stringify(input.explanation), input.confirmedBy],
    );
    const matchId = rows[0].id;
    for (const a of input.allocations) {
      await manager.query(
        `INSERT INTO "fin_bank_stmt_match_allocations" ("tenant_id", "match_id", "invoice_id", "invoice_number", "amount")
         VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, matchId, a.invoiceId, a.invoiceNumber, a.amount],
      );
    }
    return matchId;
  }

  /** Matches (with their invoice allocations) of the given lines. */
  async matchesForLines(tenantId: string, lineIds: string[], manager?: EntityManager): Promise<StatementMatchRow[]> {
    if (lineIds.length === 0) return [];
    return this.scope.within(tenantId, manager, async (m) => {
      const matches: Array<Omit<StatementMatchRow, 'allocations'>> = await m.query(
        `SELECT "id", "line_id" AS "lineId", "rule", "auto", "fee"::text AS "fee", "journal_entry_id" AS "journalEntryId",
                "explanation", "confirmed_by" AS "confirmedBy"
           FROM "fin_bank_stmt_matches" WHERE "tenant_id" = $1 AND "line_id" = ANY($2::uuid[])`,
        [tenantId, lineIds],
      );
      if (matches.length === 0) return [];
      const allocations: Array<{ matchId: string; invoiceId: string; invoiceNumber: string | null; amount: string }> = await m.query(
        `SELECT "match_id" AS "matchId", "invoice_id" AS "invoiceId", "invoice_number" AS "invoiceNumber", "amount"::text AS "amount"
           FROM "fin_bank_stmt_match_allocations"
          WHERE "tenant_id" = $1 AND "match_id" = ANY($2::uuid[]) ORDER BY "created_at", "invoice_number"`,
        [tenantId, matches.map((x) => x.id)],
      );
      return matches.map((x) => ({
        ...x,
        allocations: allocations.filter((a) => a.matchId === x.id).map(({ matchId: _matchId, ...rest }) => rest),
      }));
    });
  }

  /** Sum of statement allocations per invoice (decimal strings): what reconciliation already settled. */
  async allocatedByInvoice(tenantId: string, invoiceIds: string[], manager?: EntityManager): Promise<Map<string, string>> {
    if (invoiceIds.length === 0) return new Map();
    return this.scope.within(tenantId, manager, async (m) => {
      const rows: Array<{ invoice_id: string; settled: string }> = await m.query(
        `SELECT "invoice_id", SUM("amount")::text AS settled FROM "fin_bank_stmt_match_allocations"
          WHERE "tenant_id" = $1 AND "invoice_id" = ANY($2::text[]) GROUP BY "invoice_id"`,
        [tenantId, invoiceIds],
      );
      return new Map(rows.map((r) => [r.invoice_id, r.settled]));
    });
  }
}
