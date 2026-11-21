import { MigrationInterface, QueryRunner } from 'typeorm';
import { disableTenantRls, enableTenantRls } from './data/tenant-rls';

/**
 * T184 reconciliation of a statement line:
 *   - `fin_bank_stmt_matches`: one confirmed match per line (UNIQUE line_id), the voucher it posted,
 *     the bank fee and the stored explanation of why it matched.
 *   - `fin_bank_stmt_match_allocations`: the invoices a payout settled (one payout, many invoices).
 * Both tables are tenant-scoped with ENABLE + FORCE ROW LEVEL SECURITY.
 */
export class CreateBankStatementMatches1789900011510 implements MigrationInterface {
  name = 'CreateBankStatementMatches1789900011510';

  private readonly tables = ['fin_bank_stmt_matches', 'fin_bank_stmt_match_allocations'];

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "fin_bank_stmt_matches" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "line_id" uuid NOT NULL,
        "rule" varchar(16) NOT NULL,
        "auto" boolean NOT NULL DEFAULT false,
        "fee" numeric(18,2) NOT NULL DEFAULT 0,
        "journal_entry_id" integer NOT NULL,
        "explanation" jsonb NOT NULL,
        "confirmed_by" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fin_bank_stmt_matches" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_fin_bank_stmt_matches_line" UNIQUE ("line_id"),
        CONSTRAINT "FK_fin_bank_stmt_matches_line" FOREIGN KEY ("line_id")
          REFERENCES "fin_bank_stmt_lines"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_fin_bank_stmt_matches_rule" CHECK ("rule" IN ('reference', 'amount_date', 'manual')),
        CONSTRAINT "CHK_fin_bank_stmt_matches_fee" CHECK ("fee" >= 0)
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fin_bank_stmt_matches_tenant"
        ON "fin_bank_stmt_matches" ("tenant_id", "created_at")
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "fin_bank_stmt_match_allocations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "match_id" uuid NOT NULL,
        "invoice_id" varchar(64) NOT NULL,
        "invoice_number" varchar(64) NULL,
        "amount" numeric(18,2) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fin_bank_stmt_match_allocations" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_fin_bank_stmt_match_allocations_invoice" UNIQUE ("match_id", "invoice_id"),
        CONSTRAINT "FK_fin_bank_stmt_match_allocations_match" FOREIGN KEY ("match_id")
          REFERENCES "fin_bank_stmt_matches"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_fin_bank_stmt_match_allocations_amount" CHECK ("amount" > 0)
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fin_bank_stmt_match_allocations_invoice"
        ON "fin_bank_stmt_match_allocations" ("tenant_id", "invoice_id")
    `);

    for (const table of this.tables) await enableTenantRls(q, table);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of [...this.tables].reverse()) {
      await disableTenantRls(q, table);
      await q.query(`DROP TABLE IF EXISTS "${table}"`);
    }
  }
}
