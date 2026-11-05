/**
 * 100k vouchers timing spec (Issue #230 item 4, T5). OPT-IN ONLY: it runs when
 * ROXIRA_PERF=1 AND ROXIRA_TEST_PG_HOST is set, otherwise describe.skip so
 * normal CI never pays for it. Creates a throwaway database
 * (`rx_perf_<pid>_<ts>`), runs migrations, seeds via
 * scripts/perf/seed-large-ledger, then measures the REAL service methods
 * (1 warm-up + median of 5 with process.hrtime.bigint()) and prints a table.
 * Every principal query also gets EXPLAIN (ANALYZE, BUFFERS): the plan's top
 * node, Execution Time and any Seq Scan on a table with > 10k rows are printed.
 *
 *   cd output_apps/enterprise_hub && \
 *   /home/mahan/Developer/roxira-wt/_fleet/heavy.sh env ROXIRA_PERF=1 \
 *     ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55433 \
 *     ROXIRA_TEST_PG_USER=postgres npx jest --runInBand \
 *     modules/accounting/large-ledger.perf.pg.spec.ts --testTimeout=1800000
 *
 * Assertions are opt-in too: ROXIRA_PERF_ASSERT=1 turns every printed number
 * into a hard < 2000 ms check; by default the spec only reports.
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { AccountingRepository } from './repositories/accounting.repository';
import { AccountingService } from './services/accounting.service';
import { CurrencyService } from '../currency/services/currency.service';
import { FifoBatchEntity } from '../inventory/entities/fifo-batch.entity';
import { StockItemEntity } from '../inventory/entities/stock-item.entity';
import { WarehouseEntity } from '../inventory/entities/warehouse.entity';
import { InventoryRepository } from '../inventory/repositories/inventory.repository';
import { InventoryService } from '../inventory/services/inventory.service';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { InvoicingRepository } from '../invoicing/repositories/invoicing.repository';
import { InvoicingService } from '../invoicing/services/invoicing.service';
import {
  PERF_TENANT,
  fiscalYearRange,
  seedLargeLedger,
  verifyLargeLedger,
} from '../../scripts/perf/seed-large-ledger';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const PERF_ON = process.env.ROXIRA_PERF === '1';
const describePerf = PERF_ON && HOST ? describe : describe.skip;
const USER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
const ASSERT = process.env.ROXIRA_PERF_ASSERT === '1';
const T1 = PERF_TENANT;

const options = (database: string) => ({
  type: 'postgres' as const,
  host: HOST,
  port: PORT,
  username: USER,
  database,
  entities: [path.join(__dirname, '../**/*.entity.ts')],
  migrations: [path.join(__dirname, '../../migrations/*.ts')],
  migrationsTransactionMode: 'each' as const,
  synchronize: false,
  logging: false,
});

const admin = async (sql: string) => {
  const ds = new DataSource({ ...options('postgres'), entities: [], migrations: [] });
  await ds.initialize();
  try {
    await ds.query(sql);
  } finally {
    await ds.destroy();
  }
};

interface TimingRow {
  label: string;
  medianMs: number;
  minMs: number;
  maxMs: number;
}
interface ExplainRow {
  label: string;
  topNode: string;
  executionTimeMs: number | null;
  seqScansBig: string[];
}

describePerf('100k vouchers timing on PostgreSQL', () => {
  const dbName = `rx_perf_${process.pid}_${Date.now()}`;
  let ds: DataSource;
  let accounting: AccountingService;
  let inventory: InventoryService;
  let invoicing: InvoicingService;
  let busiestAccountId = 0;
  const timings: TimingRow[] = [];
  const explains: ExplainRow[] = [];

  const measure = async (label: string, fn: () => Promise<unknown>, runs = 5): Promise<number> => {
    await fn(); // warm-up, not counted
    const samples: number[] = [];
    for (let i = 0; i < runs; i += 1) {
      const t0 = process.hrtime.bigint();
      await fn();
      samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(runs / 2)];
    timings.push({ label, medianMs: median, minMs: samples[0], maxMs: samples[runs - 1] });
    return median;
  };

  /**
   * EXPLAIN (ANALYZE, BUFFERS) of the principal SQL, copied from the
   * repository methods (accounting.repository.getTrialBalance /
   * getAccountLedger) or a faithful stand-in for the TypeORM findAndCount /
   * searchAndCount queries used by the inventory / invoicing repositories.
   * Runs the query once more, so it is only executed once per label.
   */
  const explain = async (label: string, sql: string, params: unknown[]): Promise<void> => {
    const rows = (await ds.query(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`, params)) as Array<
      Record<string, string>
    >;
    const plan = rows.map((r) => String(Object.values(r)[0]));
    const topNode = plan[0] ?? '';
    const execMatch = plan.find((l) => /Execution Time:/.test(l));
    const execMs = execMatch ? Number(/Execution Time: ([\d.]+) ms/.exec(execMatch)![1]) : null;
    const seqScansBig: string[] = [];
    for (const line of plan) {
      const m = /Seq Scan on "?([\w.]+)"?/.exec(line);
      const rowsM = /rows=(\d+)/.exec(line);
      if (m && rowsM && Number(rowsM[1]) > 10_000) {
        seqScansBig.push(`${m[1]} (rows=${rowsM[1]})`);
      }
    }
    explains.push({ label, topNode, executionTimeMs: execMs, seqScansBig });
  };

  beforeAll(async () => {
    await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin(`CREATE DATABASE "${dbName}"`);
    ds = new DataSource(options(dbName));
    await ds.initialize();
    await ds.runMigrations();
    await seedLargeLedger(ds, {
      onProgress: (step, done, total) =>
        console.error(`[seed] ${step}: ${done}/${total}`),
    });
    await verifyLargeLedger(ds, T1);

    const currency = { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService;
    accounting = new AccountingService(
      new AccountingRepository(new TenantScope(ds)),
      currency,
    );
    const inventoryRepo = new InventoryRepository(
      ds.getRepository(WarehouseEntity),
      ds.getRepository(StockItemEntity),
      ds.getRepository(FifoBatchEntity),
      ds,
    );
    inventory = new InventoryService(inventoryRepo);
    const invoicingRepo = new InvoicingRepository(ds.getRepository(InvoiceEntity), ds);
    invoicing = new InvoicingService(invoicingRepo, currency);
    busiestAccountId = Number(
      (
        (await ds.query(
          `SELECT a.id, count(l.id) AS n FROM fin_chart_of_accounts a
             JOIN fin_journal_entry_lines l ON l.account_id = a.id
            WHERE a.tenant_id = $1 GROUP BY a.id ORDER BY n DESC LIMIT 1`,
          [T1],
        )) as Array<{ id: number; n: string }>
      )[0].id,
    );
  }, 600_000);

  afterAll(async () => {
    await ds?.destroy();
    await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  });

  it('trial balance: whole range and "one fiscal year" variant', async () => {
    await measure('trial balance — whole range', () => accounting.getTrialBalance(T1));
    // The public API has no date filter (QueryTrialBalanceDto only has
    // currency), so the fiscal-year variant re-measures with a currency filter.
    await measure('trial balance — currency=IRR ("fiscal year" filter unsupported by API)', () =>
      accounting.getTrialBalance(T1, { currency: 'IRR' }),
    );
    await explain(
      'trial balance — whole range',
      `SELECT account.code, COALESCE(SUM(line.debit), 0) AS totalDebit,
              COALESCE(SUM(line.credit), 0) AS totalCredit
         FROM fin_journal_entry_lines line
         INNER JOIN fin_chart_of_accounts account ON account.id = line.account_id
         INNER JOIN fin_journal_entries entry ON entry.id = line.journal_entry_id
        WHERE line.tenant_id = $1 AND entry.status = 'POSTED'
        GROUP BY account.code, account.name, account.account_type
        ORDER BY account.code ASC`,
      [T1],
    );
  });

  it('account ledger: busiest account, one fiscal year and whole range, paged', async () => {
    const fy = fiscalYearRange(0);
    await measure('account ledger 1100 — whole range', () =>
      accounting.getAccountLedger(T1, '1100', { limit: 100 }),
    );
    await measure('account ledger 1100 — one fiscal year, limit 50', () =>
      accounting.getAccountLedger(T1, '1100', { fromDate: fy.start, toDate: fy.end, limit: 50 }),
    );
    await explain(
      'account ledger — whole range',
      `SELECT line.id, line.journal_entry_id, entry.entry_number, entry.date,
              entry.description, line.description, line.debit, line.credit
         FROM fin_journal_entry_lines line
         INNER JOIN fin_journal_entries entry ON entry.id = line.journal_entry_id
        WHERE line.tenant_id = $1 AND line.account_id = $2 AND entry.status = 'POSTED'
        ORDER BY entry.date ASC, line.id ASC`,
      [T1, busiestAccountId],
    );
  });

  it('stock list: page 1, with search, with lowStockOnly', async () => {
    await measure('stock list — page 1', () =>
      inventory.listStockItems(T1, { page: 1, limit: 20 } as never),
    );
    await measure('stock list — search "500"', () =>
      inventory.listStockItems(T1, { page: 1, limit: 20, search: '500' } as never),
    );
    await measure('stock list — lowStockOnly', () =>
      inventory.listStockItems(T1, { page: 1, limit: 20, lowStockOnly: true } as never),
    );
    await explain(
      'stock list — page 1',
      `SELECT * FROM erp_stock_items WHERE tenant_id = $1 ORDER BY id LIMIT 20 OFFSET 0`,
      [T1],
    );
    await explain(
      'stock list — search (stand-in for findStockItemsAndCount search branch)',
      `SELECT * FROM erp_stock_items
        WHERE tenant_id = $1 AND (sku ILIKE $2 OR name ILIKE $2 OR barcode ILIKE $2)
        ORDER BY id LIMIT 20 OFFSET 0`,
      [T1, '%500%'],
    );
    await explain(
      'stock list — count (all items)',
      `SELECT COUNT(*) FROM erp_stock_items WHERE tenant_id = $1`,
      [T1],
    );
  });

  it('invoice search: search and status filter', async () => {
    await measure('invoices — search "مشتری آزمایشی 123"', () =>
      invoicing.findAll(T1, { page: 1, limit: 20, search: 'مشتری آزمایشی 123' } as never),
    );
    await measure('invoices — status PAID', () =>
      invoicing.findAll(T1, { page: 1, limit: 20, status: 'PAID' } as never),
    );
    await explain(
      'invoices — status filter (stand-in for findAndCount)',
      `SELECT * FROM invoices WHERE tenant_id = $1 AND status = 'PAID'
        ORDER BY "createdAt" DESC LIMIT 20 OFFSET 0`,
      [T1],
    );
    await explain(
      'invoices — search (stand-in for searchAndCount)',
      `SELECT * FROM invoices
        WHERE tenant_id = $1 AND (buyer_info->>'name' ILIKE $2 OR tax_invoice_number ILIKE $2)
        ORDER BY "createdAt" DESC LIMIT 20 OFFSET 0`,
      [T1, '%مشتری آزمایشی 123%'],
    );
    await explain(
      'invoices — count (status filter)',
      `SELECT COUNT(*) FROM invoices WHERE tenant_id = $1 AND status = 'PAID'`,
      [T1],
    );
  });

  it('prints the timing table and (opt-in) asserts < 2000 ms', () => {
    const lines = [
      '',
      '=== 100k vouchers timing (median of 5 after warm-up) ===',
      'method'.padEnd(62) + 'median'.padStart(9) + 'min'.padStart(9) + 'max'.padStart(9),
      '-'.repeat(89),
    ];
    for (const t of timings) {
      lines.push(
        t.label.padEnd(62) +
          t.medianMs.toFixed(0).padStart(7) + ' ms' +
          t.minMs.toFixed(0).padStart(6) + ' ms' +
          t.maxMs.toFixed(0).padStart(6) + ' ms',
      );
    }
    lines.push('');
    lines.push('=== EXPLAIN (ANALYZE, BUFFERS) findings ===');
    for (const e of explains) {
      lines.push(`- ${e.label}`);
      lines.push(`  top node: ${e.topNode}`);
      lines.push(`  execution time: ${e.executionTimeMs === null ? 'n/a' : e.executionTimeMs + ' ms'}`);
      lines.push(
        e.seqScansBig.length
          ? `  seq scans on >10k-row tables: ${e.seqScansBig.join(', ')}`
          : '  no seq scan on >10k-row tables',
      );
    }
    console.log(lines.join('\n'));

    if (ASSERT) {
      for (const t of timings) {
        expect(t.medianMs).toBeLessThan(2000);
      }
    }
  });
});
