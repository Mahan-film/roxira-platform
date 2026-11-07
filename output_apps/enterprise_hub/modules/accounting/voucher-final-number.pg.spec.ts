/**
 * Final voucher number («شمارهٔ قطعی») on a REAL PostgreSQL as a non-superuser role with FORCE RLS.
 * The counter, the fiscal-year resolution and the database trigger are exercised end to end:
 * per-year sequences, DRAFT/TEMPORARY -> POSTED, rollback without a gap, 10 concurrent postings,
 * a tenant with no fiscal year, immutability and reversal.
 *
 * Opt-in like the other pg specs: skipped unless ROXIRA_TEST_PG_HOST is set; each run creates and
 * drops its own database and role. Optional: ROXIRA_TEST_PG_USER, ROXIRA_TEST_PG_PORT,
 * ROXIRA_TEST_PG_PASSWORD.
 *
 *   ROXIRA_TEST_PG_HOST=/tmp/rxpg npx jest modules/accounting/voucher-final-number.pg.spec.ts
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { CurrencyService } from '../currency/services/currency.service';
import { AccountingRepository } from './repositories/accounting.repository';
import { AccountingService } from './services/accounting.service';
import { JournalEntryStatus } from './enums/accounting.enum';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const USER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const PASSWORD = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const APP_ROLE = `rx_vfn_app_${process.pid}`;
const APP_PW = 'app-role-test-only';

const options = (database: string, username = USER, password = PASSWORD) => ({
  type: 'postgres' as const,
  host: HOST,
  port: PORT,
  username,
  password,
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

describePg('Final voucher number on PostgreSQL (non-superuser, FORCE RLS)', () => {
  const dbName = `rx_vfn_${process.pid}_${Date.now()}`;
  let ds: DataSource;
  let app: DataSource;
  let accounting: AccountingService;
  let fyY1: number;
  let fyY2: number;

  const pair = (entryNumber: string, date: string, amount = 100) =>
    ({
      entryNumber,
      date,
      description: 'test',
      lines: [
        { accountCode: '1010', debit: amount },
        { accountCode: '4010', credit: amount },
      ],
    }) as never;

  const draft = (entryNumber: string, date: string, amount = 100) =>
    ({
      ...(pair(entryNumber, date, amount) as object),
      status: JournalEntryStatus.DRAFT,
    }) as never;

  const counter = async (tenant: string, fy: number): Promise<number> => {
    const [row] = await ds.query(
      `SELECT last_number FROM fin_voucher_counters WHERE tenant_id = $1 AND fiscal_year_id = $2`,
      [tenant, fy],
    );
    return row ? Number(row.last_number) : 0;
  };

  beforeAll(async () => {
    await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin(`CREATE DATABASE "${dbName}"`);
    ds = new DataSource(options(dbName));
    await ds.initialize();
    await ds.runMigrations();
    await admin(`DROP ROLE IF EXISTS ${APP_ROLE}`);
    await admin(`CREATE ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${APP_PW}'`);
    await ds.query(`GRANT CONNECT ON DATABASE "${dbName}" TO ${APP_ROLE}`);
    await ds.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
    await ds.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`);
    await ds.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`);
    app = new DataSource({ ...options(dbName, APP_ROLE, APP_PW), migrations: [] });
    await app.initialize();
    const currency = { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService;
    accounting = new AccountingService(new AccountingRepository(new TenantScope(app)), currency);

    // Fiscal years for tenant A: Y1 = 2026-03-21..2027-03-20, Y2 = 2027-03-21..2028-03-20.
    const [y1] = await ds.query(
      `INSERT INTO fin_fiscal_years (tenant_id, name, start_date, end_date)
       VALUES ($1, 'Y1', '2026-03-21', '2027-03-20') RETURNING id`,
      [T1],
    );
    const [y2] = await ds.query(
      `INSERT INTO fin_fiscal_years (tenant_id, name, start_date, end_date)
       VALUES ($1, 'Y2', '2027-03-21', '2028-03-20') RETURNING id`,
      [T1],
    );
    fyY1 = Number(y1.id);
    fyY2 = Number(y2.id);
  }, 120_000);

  afterAll(async () => {
    await app?.destroy();
    await ds?.destroy();
    await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin(`DROP ROLE IF EXISTS ${APP_ROLE}`);
  });

  it('runs as a non-superuser without BYPASSRLS', async () => {
    const [r] = await app.query(
      `SELECT r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user`,
    );
    expect(r).toMatchObject({ rolsuper: false, rolbypassrls: false });
  });

  it('numbers posted vouchers 1,2,3 in Y1 and starts Y2 at 1 (counter per year)', async () => {
    const a = await accounting.createJournalEntry(T1, pair('FN-A1', '2026-05-01'));
    const b = await accounting.createJournalEntry(T1, pair('FN-A2', '2026-06-01'));
    const c = await accounting.createJournalEntry(T1, pair('FN-A3', '2026-07-01'));
    expect([a.permanentNumber, b.permanentNumber, c.permanentNumber]).toEqual(['1', '2', '3']);
    expect([a.permanentFiscalYearId, b.permanentFiscalYearId, c.permanentFiscalYearId]).toEqual([
      fyY1,
      fyY1,
      fyY1,
    ]);

    const next = await accounting.createJournalEntry(T1, pair('FN-A4', '2027-04-01'));
    expect(next.permanentNumber).toBe('1');
    expect(next.permanentFiscalYearId).toBe(fyY2);
  });

  it('leaves a DRAFT without a number; DRAFT->POSTED and DRAFT->TEMPORARY->POSTED take the next ones', async () => {
    const d = await accounting.createJournalEntry(T1, draft('FN-D1', '2026-06-15'));
    expect(d.status).toBe('DRAFT');
    expect(d.permanentNumber).toBeNull();
    const posted = await accounting.changeVoucherStatus(T1, d.id, JournalEntryStatus.POSTED);
    expect(posted.permanentNumber).toBe('4'); // after the three of test 1
    expect(posted.permanentFiscalYearId).toBe(fyY1);

    const t = await accounting.createJournalEntry(T1, draft('FN-D2', '2026-06-20'));
    await accounting.changeVoucherStatus(T1, t.id, JournalEntryStatus.TEMPORARY);
    const posted2 = await accounting.changeVoucherStatus(T1, t.id, JournalEntryStatus.POSTED);
    expect(posted2.permanentNumber).toBe('5');
  });

  it('rolls the counter back with the transaction, so the next committed voucher gets the same number', async () => {
    expect(await counter(T1, fyY1)).toBe(5); // tests 1-2 consumed 1..5 of Y1
    await expect(
      app.transaction(async (m) => {
        await accounting.createJournalEntry(T1, pair('FN-RB', '2026-06-25'), m);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(
      await ds.query(`SELECT 1 FROM fin_journal_entries WHERE entry_number = 'FN-RB'`),
    ).toHaveLength(0);

    const next = await accounting.createJournalEntry(T1, pair('FN-RB2', '2026-06-26'));
    expect(next.permanentNumber).toBe('6'); // not 7: the rolled-back 6 left no gap
  });

  it('10 concurrent postings in Y1 get 10 distinct consecutive numbers with no gap', async () => {
    const baseline = await counter(T1, fyY1);
    // Arithmetic: tests 1-3 consumed Y1 numbers 1..6 (test 1: 1,2,3; test 2: 4,5; test 3: 6,
    // committed). The 10 parallel ones therefore run from baseline+1 = 7 to baseline+10 = 16.
    expect(baseline).toBe(6);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        accounting.createJournalEntry(T1, pair(`FN-C${i}`, '2026-08-01')),
      ),
    );
    const numbers = results
      .map((r) => Number(r.permanentNumber))
      .sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 10 }, (_, i) => baseline + 1 + i)); // 7..16
    expect(new Set(numbers).size).toBe(10);
  });

  it('a tenant with no fiscal year gets number 1 with fiscal year id 0, and cannot read another tenant counters', async () => {
    expect(await counter(T2, 0)).toBe(0);
    const first = await accounting.createJournalEntry(T2, pair('FN-B1', '2026-05-01'));
    expect(first.permanentNumber).toBe('1');
    expect(first.permanentFiscalYearId).toBe(0);

    // RLS: tenant B sees only its own counter row, never tenant A's.
    const seen = await app.transaction(async (m) => {
      await TenantScope.bind(m, T2);
      return m.query(`SELECT tenant_id FROM fin_voucher_counters`);
    });
    expect(seen.map((r: { tenant_id: string }) => r.tenant_id)).toEqual([T2]);
  });

  it('refuses to change a permanent number and never backfills a pre-migration row', async () => {
    const [posted] = await ds.query(
      `SELECT id FROM fin_journal_entries WHERE tenant_id = $1 AND entry_number = 'FN-A1'`,
      [T1],
    );
    await expect(
      ds.query(`UPDATE fin_journal_entries SET permanent_number = 99 WHERE id = $1`, [posted.id]),
    ).rejects.toThrow(/immutable/);

    // A POSTED row that existed before the migration (inserted with the trigger off) stays NULL.
    await ds.query(
      `ALTER TABLE fin_journal_entries DISABLE TRIGGER "TRG_fin_journal_entries_assign_permanent_number"`,
    );
    const [legacy] = await ds.query(
      `INSERT INTO fin_journal_entries (entry_number, date, description, tenant_id, status)
       VALUES ('FN-LEGACY', '2026-06-01', 'pre-migration', $1, 'POSTED') RETURNING id`,
      [T1],
    );
    await ds.query(
      `ALTER TABLE fin_journal_entries ENABLE TRIGGER "TRG_fin_journal_entries_assign_permanent_number"`,
    );
    const [row] = await ds.query(
      `SELECT permanent_number, permanent_fiscal_year_id FROM fin_journal_entries WHERE id = $1`,
      [legacy.id],
    );
    expect(row).toEqual({ permanent_number: null, permanent_fiscal_year_id: null });
  });

  it('a reversal gets its own next number', async () => {
    const original = await accounting.createJournalEntry(T1, pair('FN-REV', '2026-09-01'));
    const originalNumber = Number(original.permanentNumber);
    const reversal = await accounting.reverseJournalEntry(T1, original.id, {
      date: '2026-09-15',
    });
    expect(reversal.permanentNumber).toBe(String(originalNumber + 1));
    expect(reversal.permanentFiscalYearId).toBe(fyY1);
  });
  it('an insert skipped because the working number exists does not consume a final number', async () => {
    const before = await counter(T1, fyY1);
    const rows = await ds.query(
      `INSERT INTO fin_journal_entries (entry_number, date, description, tenant_id, status)
       VALUES ('FN-A1', '2026-06-01', 'dup', $1, 'POSTED') ON CONFLICT DO NOTHING RETURNING id`,
      [T1],
    );
    expect(rows).toHaveLength(0);
    expect(await counter(T1, fyY1)).toBe(before);
  });
});
