import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Platform defaults (`tenant_id` NULL) for the end-of-service settlement: days of wage per full
 * year of service and the day count of a year for the part-year share. Neither lives in code.
 * Self-contained on purpose: the deploy builds migrations from this folder alone.
 *
 * Both rows are unverified until an accountant confirms them (docs/hr/STATUTORY_OPEN_ITEMS.md);
 * an organisation overrides them through PUT /enterprise-hub/hr/statutory-parameters.
 */
const SOURCE_DAYS = 'قانون کار، ماده ۲۴ (۳۰ روز مزد به‌ازای هر سال)؛ با متن رسمی تطبیق نشده';
const SOURCE_BASIS = 'مبنای ۳۶۵ روز برای کسر سال؛ منتظر تأیید حسابدار (docs/hr/STATUTORY_OPEN_ITEMS.md)';

const ROWS: Array<[fiscalYear: number, effectiveFrom: string, key: string, value: number, source: string]> = [];
for (const [year, from] of [
  [1404, '2025-03-21'],
  [1405, '2026-03-21'],
] as const) {
  ROWS.push([year, from, 'sanavat_days_per_year', 30, SOURCE_DAYS]);
  ROWS.push([year, from, 'sanavat_year_days', 365, SOURCE_BASIS]);
}

export class SeedSanavatParameters1789480000000 implements MigrationInterface {
  name = 'SeedSanavatParameters1789480000000';

  public async up(q: QueryRunner): Promise<void> {
    // The insert policy only admits tenant rows, so the table owner seeds with FORCE lifted.
    await q.query(`ALTER TABLE "statutory_parameters" NO FORCE ROW LEVEL SECURITY`);
    try {
      for (const [fiscalYear, effectiveFrom, key, value, source] of ROWS) {
        await q.query(
          `INSERT INTO "statutory_parameters"
             ("tenant_id", "country", "fiscal_year", "param_key", "effective_from", "value",
              "source", "source_kind", "verified", "created_by")
           VALUES (NULL, 'IR', $1, $2, $3, $4::jsonb, $5, 'REPORT', false, 'migration')`,
          [fiscalYear, key, effectiveFrom, JSON.stringify(value), source],
        );
      }
    } finally {
      await q.query(`ALTER TABLE "statutory_parameters" FORCE ROW LEVEL SECURITY`);
    }
  }

  public async down(): Promise<void> {
    // statutory_parameters is append-only; seeded versions stay.
  }
}
