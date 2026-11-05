/**
 * Seeding a very large ledger for performance testing (Issue #230 / T5, item 4).
 *
 * Seeds ONE tenant on an ALREADY-MIGRATED database with:
 *   - the default chart of accounts (same template the pg specs use),
 *   - 100,000 POSTED journal entries (2 balanced lines each, integer rial minor
 *     units, dates spread over two Jalali fiscal years, numbers `S-000001`..),
 *   - 50,000 stock items with some stock balances,
 *   - ~100,000 invoices with synthetic Persian party names.
 *
 * RAM discipline: everything is set-based SQL (`INSERT ... SELECT ...
 * generate_series`) in batches of 10,000 executed as SEPARATE statements, so
 * Node never holds a big array. Seeding 100k vouchers takes on the order of a
 * minute.
 *
 * Trigger handling (see migrations/1789320000000-LedgerPeriodLocksAndGuards.ts
 * and 1789420000000-AddVoucherStates.ts):
 *   - The posted-entry guards are BEFORE UPDATE/DELETE triggers only, so rows
 *     can be INSERTed directly with status='POSTED' — no DRAFT→POSTED dance is
 *     needed and no globally-disabled triggers.
 *   - The deferred constraint trigger `TRG_fin_journal_entry_lines_consistent`
 *     checks balance + tenant consistency at COMMIT, per entry (on its max
 *     line id). Each batch here commits exactly balanced pairs, so it passes.
 *   - `fin_guard_locked_period` refuses entries dated inside a locked period;
 *     the seeder creates no period locks, so this never fires.
 *   - We therefore do NOT need `SET session_replication_role = replica`.
 *
 * CLI:
 *   ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55433 \
 *   ROXIRA_TEST_PG_USER=postgres npx ts-node scripts/perf/seed-large-ledger.ts rx_perf_123_456
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';

export const PERF_TENANT = '99999999-9999-4999-8999-999999999999';

/** Default chart, mirroring the template AccountingService.ensureDefaultAccounts uses. */
const DEFAULT_ACCOUNTS: Array<{
  code: string;
  name: string;
  type: string;
  level?: string;
  parent?: string;
  reportLine?: string;
}> = [
  { code: '1010', name: 'صندوق', type: 'ASSET', level: 'TAFSILI', reportLine: 'CURRENT_ASSETS' },
  { code: '1020', name: 'بانک', type: 'ASSET', level: 'TAFSILI', reportLine: 'CURRENT_ASSETS' },
  { code: '1100', name: 'حساب‌های دریافتنی', type: 'ASSET', level: 'TAFSILI', reportLine: 'CURRENT_ASSETS' },
  { code: '1200', name: 'موجودی کالا', type: 'ASSET', level: 'TAFSILI', reportLine: 'CURRENT_ASSETS' },
  { code: '2100', name: 'حساب‌های پرداختنی', type: 'LIABILITY', level: 'TAFSILI', reportLine: 'CURRENT_LIABILITIES' },
  { code: '2200', name: 'مالیات ارزش افزوده فروش', type: 'LIABILITY', level: 'TAFSILI', reportLine: 'CURRENT_LIABILITIES' },
  { code: '3100', name: 'سرمایه', type: 'EQUITY', level: 'TAFSILI', reportLine: 'EQUITY' },
  { code: '4010', name: 'فروش', type: 'REVENUE', level: 'TAFSILI', reportLine: 'REVENUE' },
  { code: '5010', name: 'بهای تمام‌شده کالای فروش‌رفته', type: 'EXPENSE', level: 'TAFSILI', reportLine: 'COST_OF_SALES' },
  { code: '6010', name: 'هزینه‌های اداری', type: 'EXPENSE', level: 'TAFSILI', reportLine: 'OPERATING_EXPENSES' },
];

export interface SeedOptions {
  /** Journal entries (each with exactly 2 lines). Default 100_000. */
  entries?: number;
  /** Stock items. Default 50_000. */
  items?: number;
  /** Invoices. Default 100_000 (PERF_INVOICES=0 skips them). */
  invoices?: number;
  batchSize?: number;
  onProgress?: (step: string, done: number, total: number) => void;
}

/** Jalali fiscal year start days in Gregorian: FY1403 = 1403-01-01 = 2024-03-20. */
const FY_STARTS: Array<{ label: string; start: string; end: string }> = [
  { label: 'FY1403', start: '2024-03-20', end: '2025-03-20' },
  { label: 'FY1404', start: '2025-03-20', end: '2026-03-20' },
];

const pad = (n: number, w: number) => String(n).padStart(w, '0');

async function seedTenantAndChart(ds: DataSource, tenantId: string): Promise<void> {
  await ds.query(
    `INSERT INTO tenants (id, name, slug) VALUES ($1, 'شرکت عملکرد آزمایشی', 'perf-seed')
     ON CONFLICT (id) DO NOTHING`,
    [tenantId],
  );
  for (const a of DEFAULT_ACCOUNTS) {
    await ds.query(
      `INSERT INTO fin_chart_of_accounts (tenant_id, code, name, account_type, currency, balance, level, report_line)
       VALUES ($1, $2, $3, $4, 'IRR', 0, $5, $6) ON CONFLICT (tenant_id, code) DO NOTHING`,
      [tenantId, a.code, a.name, a.type, a.level ?? null, a.reportLine ?? null],
    );
  }
}

async function seedStockItems(ds: DataSource, tenantId: string, count: number, batch: number): Promise<void> {
  for (let from = 1; from <= count; from += batch) {
    const to = Math.min(from + batch - 1, count);
    await ds.query(
      `INSERT INTO erp_stock_items (tenant_id, sku, barcode, name, quantity, min_quantity)
       SELECT $1::uuid,
              'SKU-' || lpad(g::text, 6, '0'),
              '626' || lpad(g::text, 10, '0'),
              'کالای آزمایشی ' || lpad(g::text, 6, '0'),
              CASE WHEN g % 10 = 0 THEN 0 WHEN g % 7 = 0 THEN 3 ELSE (g % 500 + 20)::double precision END,
              CASE WHEN g % 3 = 0 THEN 10 ELSE 0 END
       FROM generate_series($2::int, $3::int) AS g
       ON CONFLICT (tenant_id, sku) DO NOTHING`,
      [tenantId, from, to],
    );
  }
}

async function seedInvoices(ds: DataSource, tenantId: string, count: number, batch: number): Promise<void> {
  if (count <= 0) return;
  for (let from = 1; from <= count; from += batch) {
    const to = Math.min(from + batch - 1, count);
    await ds.query(
      `INSERT INTO invoices (
         tenant_id, "taxInvoiceNumber", "sellerInfo", "buyerInfo", items, currency,
         jurisdiction, "exchangeRate", fx_rate, "baseCurrency",
         "totalAmount", "totalDiscount", "totalTax", "finalPayable",
         "baseTotalAmount", "baseTotalTax", "baseFinalPayable",
         status, issued_at, direction, einvoice_type, subject, "createdAt"
       )
       SELECT $1::uuid,
              'INV-' || lpad(g::text, 6, '0'),
              '{"name":"فروشنده آزمایشی"}'::jsonb,
              jsonb_build_object('name', 'مشتری آزمایشی ' || (g % 5000 + 1)),
              jsonb_build_array(jsonb_build_object(
                'sku', 'SKU-' || lpad((g % 50000 + 1)::text, 6, '0'),
                'description', 'کالای آزمایشی',
                'quantity', 2, 'unitPrice', 500000, 'discount', 0,
                'vatRate', 0.1, 'tax', 100000, 'total', 1100000)),
              'IRR', 'IR', 1, 1, 'IRR',
              1000000, 0, 100000, 1100000, 1000000, 100000, 1100000,
              CASE WHEN g % 5 = 0 THEN 'ISSUED' WHEN g % 5 = 1 THEN 'PAID'
                   WHEN g % 5 = 2 THEN 'DRAFT' WHEN g % 5 = 3 THEN 'CANCELLED' ELSE 'PAID' END::text::"invoices_status_enum",
              CASE WHEN g % 5 IN (0, 1, 4) THEN now() - (g % 700) * interval '1 day' ELSE NULL END,
              'SALE', 1, 1, now() - (g % 700) * interval '1 day'
       FROM generate_series($2::int, $3::int) AS g
       ON CONFLICT (tenant_id, "taxInvoiceNumber") DO NOTHING`,
      [tenantId, from, to],
    );
  }
}

/**
 * Vouchers: batches of `batch` entries, each entry 2 balanced lines.
 * One line hits a debit-side account, the other a credit-side account, so both
 * `fin_chart_of_accounts.balance` (updated by the same statement) and the
 * deferred balance trigger agree.
 */
async function seedVouchers(
  ds: DataSource,
  tenantId: string,
  count: number,
  batch: number,
  onProgress?: SeedOptions['onProgress'],
): Promise<void> {
  // Half the entries book into 1100 (busiest account -> ~100k ledger lines).
  // Amounts are integer rial minor units (x100 rials, the DB scale 2).
  for (let from = 1; from <= count; from += batch) {
    const to = Math.min(from + batch - 1, count);
    await ds.transaction(async (m) => {
      await m.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await m.query(
        `INSERT INTO fin_journal_entries (tenant_id, entry_number, date, description, status, entry_type)
         SELECT $1::uuid, 'S-' || lpad(g::text, 6, '0'),
                -- spread over the two fiscal years, day-granular
                TIMESTAMPTZ '2024-03-20' + ((g % 731) * interval '1 day') + interval '12 hours',
                'سند آزمایشی شماره ' || g,
                'POSTED', 'NORMAL'
         FROM generate_series($2::int, $3::int) AS g
         ON CONFLICT (tenant_id, entry_number) DO NOTHING`,
        [tenantId, from, to],
      );
      // Both lines of every voucher in ONE statement, so the deferred balance trigger sees pairs.
      await m.query(
        `WITH e AS (
           SELECT id, tenant_id, right(entry_number, 6)::int AS n FROM fin_journal_entries
            WHERE tenant_id = $1 AND entry_number BETWEEN $2 AND $3)
         INSERT INTO fin_journal_entry_lines
           (tenant_id, journal_entry_id, account_id, debit, credit, currency, description)
         SELECT e.tenant_id, e.id, a.id, s.debit, s.credit, 'IRR', s.d
           FROM e
           CROSS JOIN LATERAL (VALUES
             ('1100', ((e.n % 6) * 1000000 + 500000)::numeric(18,2), 0::numeric(18,2), 'بدهکار'),
             ((ARRAY['4010','2100','1020','2200'])[1 + e.n % 4], 0::numeric(18,2),
              ((e.n % 6) * 1000000 + 500000)::numeric(18,2), 'بستانکار')
           ) AS s(code, debit, credit, d)
           JOIN fin_chart_of_accounts a ON a.tenant_id = e.tenant_id AND a.code = s.code`,
        [tenantId, 'S-' + pad(from, 6), 'S-' + pad(to, 6)],
      );
      await m.query(
        `UPDATE fin_chart_of_accounts a SET balance = a.balance + sub.net
           FROM (
             SELECT l.account_id, COALESCE(SUM(l.debit - l.credit), 0) AS net
             FROM fin_journal_entry_lines l
             JOIN fin_journal_entries e ON e.id = l.journal_entry_id
             WHERE l.tenant_id = $1 AND e.status = 'POSTED'
               AND e.entry_number BETWEEN $2 AND $3
             GROUP BY l.account_id
           ) sub
          WHERE a.tenant_id = $1 AND a.id = sub.account_id`,
        [tenantId, 'S-' + pad(from, 6), 'S-' + pad(to, 6)],
      );
    });
    onProgress?.('vouchers', Math.min(to, count), count);
  }
}

export async function seedLargeLedger(ds: DataSource, opts: SeedOptions = {}): Promise<void> {
  const tenantId = PERF_TENANT;
  const batch = opts.batchSize ?? 10_000;
  const env = process.env;
  const entryCount = opts.entries ?? 100_000;
  const itemCount = opts.items ?? 50_000;
  const invoiceCount = opts.invoices ?? (env.PERF_INVOICES === '0' ? 0 : 100_000);

  await seedTenantAndChart(ds, tenantId);
  await seedStockItems(ds, tenantId, itemCount, batch);
  opts.onProgress?.('stock items', itemCount, itemCount);
  await seedInvoices(ds, tenantId, invoiceCount, batch);
  opts.onProgress?.('invoices', invoiceCount, invoiceCount);
  await seedVouchers(ds, tenantId, entryCount, batch, opts.onProgress);
}
export async function verifyLargeLedger(ds: DataSource, tenantId: string): Promise<void> {
  const balRows = (await ds.query(
    `SELECT COALESCE(SUM(debit),0) AS d, COALESCE(SUM(credit),0) AS c
       FROM fin_journal_entry_lines WHERE tenant_id = $1`,
    [tenantId],
  )) as Array<{ d: string; c: string }>;
  const bal = balRows[0];
  if (bal.d !== bal.c) {
    throw new Error(`ledger not balanced: debit ${bal.d} != credit ${bal.c}`);
  }
  const badRows = (await ds.query(
    `SELECT count(*)::int AS n FROM fin_chart_of_accounts a
      WHERE a.tenant_id = $1 AND a.balance <> (
        SELECT COALESCE(SUM(l.debit - l.credit), 0)
        FROM fin_journal_entry_lines l
        WHERE l.tenant_id = a.tenant_id AND l.account_id = a.id
      )`,
    [tenantId],
  )) as Array<{ n: number }>;
  if (badRows[0].n > 0) {
    throw new Error(`${badRows[0].n} account balances do not match their lines`);
  }
}

export function fiscalYearRange(which: 0 | 1): { start: string; end: string; label: string } {
  return FY_STARTS[which];
}

if (require.main === module) {
  const database = process.argv[2];
  if (!database) {
    console.error('usage: npx ts-node scripts/perf/seed-large-ledger.ts <database>');
    process.exit(2);
  }
  const host = process.env.ROXIRA_TEST_PG_HOST ?? '127.0.0.1';
  const port = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
  const user = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
  const ds = new DataSource({
    type: 'postgres',
    host,
    port,
    username: user,
    password: process.env.ROXIRA_TEST_PG_PASSWORD,
    database,
    entities: [path.join(__dirname, '../../modules/**/*.entity.ts')],
    synchronize: false,
    logging: false,
  });
  const t0 = Date.now();
  ds.initialize()
    .then(async () => {
      await seedLargeLedger(ds, {
        onProgress: (step, done, total) =>
          console.error(`[seed] ${step}: ${done}/${total} (${((Date.now() - t0) / 1000).toFixed(0)}s)`),
      });
      await verifyLargeLedger(ds, PERF_TENANT);
      console.log(`[seed] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    })
    .then(() => ds.destroy())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
