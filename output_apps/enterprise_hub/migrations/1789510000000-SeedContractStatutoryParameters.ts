import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Contracting parameters (HR-CON-01, issue #228) for laptop track T3 (#227): platform defaults
 * (`tenant_id` NULL, country IR) for contract retention, the article 38 insurance deposit, the
 * social-security coefficient by contract type, contractor tax withholding and advance payments.
 *
 * A figure that no official text could establish is seeded as `unclear`: value NULL and
 * `unclear = true`. It is never guessed. A figure known only from secondary sources is seeded with
 * `verified = false` and source kind REPORT. Sources: docs/legal_sources/iran/contract-statutory-parameters.md.
 * Self-contained on purpose: the deploy builds migrations from this folder alone.
 */
const SRC_DOC = 'docs/legal_sources/iran/contract-statutory-parameters.md';

type Row = [key: string, value: string | null, source: string];
const ROWS: Row[] = [
  [
    'contract_retention_rate',
    '0.1',
    `سپرده حسن انجام کار ۱۰٪ هر پرداخت طبق شرایط عمومی پیمان (قراردادهای مشمول)؛ شرط قراردادی است نه قانونی؛ منبع ثانویه، با متن رسمی تطبیق نشده (${SRC_DOC})`,
  ],
  [
    'contract_insurance_deposit_rate',
    '0.05',
    `ماده ۳۸ قانون تأمین اجتماعی: ۵٪ بهای کل کار تا ارائه مفاصاحساب؛ چند منبع حقوقی همسان، متن مجلس/سازمان بازبینی نشده (${SRC_DOC})`,
  ],
  [
    'contract_insurance_rate_mechanical',
    '0.07',
    `بخشنامه ۱۴ درآمد تأمین اجتماعی: پیمان مکانیزه ۷٪ ناخالص کارکرد، بدون بیمه بیکاری؛ منبع ثانویه (${SRC_DOC})`,
  ],
  [
    'contract_insurance_rate_non_mechanical',
    '0.15',
    `بخشنامه ۱۴ درآمد تأمین اجتماعی: پیمان دستمزدی/خدماتی غیرمکانیزه ۱۵٪ ناخالص کارکرد، بدون بیمه بیکاری؛ منبع ثانویه (${SRC_DOC})`,
  ],
  [
    'contract_insurance_rate_civil_executive',
    null,
    `نامشخص: منابع ۶٫۶٪ (۶٪+۰٫۶٪) یا ۶٪ می‌نویسند و مبنای بیکاری یکسان نیست؛ مصوبات ۱۲۹ و ۱۴۳ شورای عالی تأمین اجتماعی را ببینید (${SRC_DOC})`,
  ],
  [
    'contract_insurance_rate_civil_consulting',
    null,
    `نامشخص: ۱۵٫۶٪ فقط در یک منبع ثانویه با تفکیک سهم کارفرما و مشاور دیده شد (${SRC_DOC})`,
  ],
  [
    'contract_unemployment_addon_fraction',
    null,
    `نامشخص: منابع ثانویه «یک‌نهم» ضریب را می‌گویند اما کسر دقیق و مبنای آن در متن رسمی دیده نشد (${SRC_DOC})`,
  ],
  [
    'contract_tax_withholding_rate',
    null,
    `نامشخص: ماده ۱۰۴ قانون مالیات‌های مستقیم با بند ۲۵ قانون اصلاح ۱۳۹۴/۰۴/۳۱ نسخ شده؛ مبنای کنونی کسر از صورت وضعیت از متن رسمی روشن نشد (${SRC_DOC})`,
  ],
  [
    'contract_advance_payment_max_rate',
    null,
    `نامشخص: سقف پیش‌پرداخت در قراردادهای دولتی شرط پیمان است و برای بخش خصوصی قانونی نیست؛ رقم رسمی احراز نشد (${SRC_DOC})`,
  ],
];

const YEARS: Array<[fiscalYear: number, effectiveFrom: string]> = [
  [1404, '2025-03-21'],
  [1405, '2026-03-21'],
];

export class SeedContractStatutoryParameters1789500000000 implements MigrationInterface {
  name = 'SeedContractStatutoryParameters1789500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "statutory_parameters" ALTER COLUMN "value" DROP NOT NULL`);
    await q.query(`ALTER TABLE "statutory_parameters" ADD COLUMN "unclear" boolean NOT NULL DEFAULT false`);
    await q.query(
      `ALTER TABLE "statutory_parameters" ADD CONSTRAINT "CHK_statutory_parameters_unclear"
         CHECK (("value" IS NULL) = "unclear")`,
    );
    // The insert policy only admits tenant rows, so the table owner seeds with FORCE lifted.
    await q.query(`ALTER TABLE "statutory_parameters" NO FORCE ROW LEVEL SECURITY`);
    try {
      for (const [fiscalYear, effectiveFrom] of YEARS) {
        for (const [key, value, source] of ROWS) {
          await q.query(
            `INSERT INTO "statutory_parameters"
               ("tenant_id", "country", "fiscal_year", "param_key", "effective_from", "value",
                "unclear", "source", "source_kind", "verified", "created_by")
             VALUES (NULL, 'IR', $1, $2, $3, $4::jsonb, $5, $6, 'REPORT', false, 'migration')`,
            [fiscalYear, key, effectiveFrom, value === null ? null : JSON.stringify(value), value === null, source],
          );
        }
      }
    } finally {
      await q.query(`ALTER TABLE "statutory_parameters" FORCE ROW LEVEL SECURITY`);
    }
  }

  public async down(): Promise<void> {
    // statutory_parameters is append-only; seeded versions stay.
  }
}
