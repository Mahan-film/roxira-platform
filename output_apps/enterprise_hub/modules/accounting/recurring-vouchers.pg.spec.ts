/** Recurring vouchers and auto-reversing accruals on a REAL PostgreSQL. Opt-in: skipped unless ROXIRA_TEST_PG_HOST is set. */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { CurrencyService } from '../currency/services/currency.service';
import { jalaliToGregorian } from '../data_import/normaliser/normalise';
import { RecurringVoucherFrequency } from './constants/recurring-voucher.constants';
import { AccountingRepository } from './repositories/accounting.repository';
import { RecurringVoucherRepository } from './repositories/recurring-voucher.repository';
import { AccountingService } from './services/accounting.service';
import { RecurringVoucherService } from './services/recurring-voucher.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const T3 = '33333333-3333-4333-8333-333333333333';
const T4 = '44444444-4444-4444-8444-444444444444';

const options = (database: string) => ({
  type: 'postgres' as const,
  host: HOST,
  port: process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432,
  username: process.env.ROXIRA_TEST_PG_USER ?? 'postgres',
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

/** `date` columns come back as 'YYYY-MM-DD' strings; tolerate a Date just in case. */
const isoDay = (value: unknown): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

/** Gregorian ISO day of a Jalali date, using the same conversion the ledger uses. */
const jalaliIso = (jy: number, jm: number, jd: number): string => {
  const g = jalaliToGregorian(jy, jm, jd);
  return `${String(g.gy).padStart(4, '0')}-${String(g.gm).padStart(2, '0')}-${String(g.gd).padStart(2, '0')}`;
};

describePg('Recurring vouchers on PostgreSQL', () => {
  const dbName = `rx_rv_${process.pid}_${Date.now()}`;
  let ds: DataSource;
  let accounting: AccountingService;
  let service: RecurringVoucherService;

  beforeAll(async () => {
    await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin(`CREATE DATABASE "${dbName}"`);
    ds = new DataSource(options(dbName));
    await ds.initialize();
    await ds.runMigrations();
    const currency = { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService;
    const scope = new TenantScope(ds);
    const accountingRepo = new AccountingRepository(scope);
    accounting = new AccountingService(accountingRepo, currency);
    service = new RecurringVoucherService(new RecurringVoucherRepository(scope, ds), accounting);
  }, 120000);

  afterAll(async () => {
    await ds.destroy();
    await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  });

  it('rejects an unbalanced template on create', async () => {
    await expect(
      service.create(T1, 'tester', {
        name: 'ناتراز',
        description: 'سند ناتراز',
        frequency: RecurringVoucherFrequency.MONTHLY,
        nextRunDate: '2026-03-21',
        lines: [
          { accountCode: '5010', debit: '1000000' },
          { accountCode: '2010', credit: '999999' },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('catches up three missed months as exactly three draft vouchers, and a second run adds none', async () => {
    const template = await service.create(T1, 'tester', {
      name: 'اجاره ماهانه',
      description: 'اجاره ماهانه دفتر',
      frequency: RecurringVoucherFrequency.MONTHLY,
      nextRunDate: '2026-03-21',
      lines: [
        { accountCode: '5010', debit: '1000000' },
        { accountCode: '2010', credit: '1000000' },
      ],
    });

    const first = await service.runDue(T1, '2026-06-21');
    expect(first).toMatchObject({ created: 3, reversed: 0, skipped: [] });

    const runs: Array<{ run_date: unknown }> = await ds.query(
      `SELECT run_date FROM erp_recurring_voucher_runs WHERE tenant_id = $1 AND recurring_id = $2 ORDER BY run_date`,
      [T1, template.id],
    );
    expect(runs.map((row) => isoDay(row.run_date))).toEqual(['2026-03-21', '2026-04-21', '2026-05-22']);

    const entries: Array<{ status: string; date: unknown }> = await ds.query(
      `SELECT status, date FROM fin_journal_entries WHERE tenant_id = $1 AND entry_number LIKE $2 ORDER BY entry_number`,
      [T1, `RV-${template.id}-%`],
    );
    expect(entries).toHaveLength(3);
    expect(entries.every((entry) => entry.status === 'DRAFT')).toBe(true);

    const again = await service.runDue(T1, '2026-06-21');
    expect(again).toMatchObject({ created: 0, reversed: 0 });
    const count: Array<{ n: number }> = await ds.query(
      `SELECT COUNT(*)::int AS n FROM erp_recurring_voucher_runs WHERE tenant_id = $1 AND recurring_id = $2`,
      [T1, template.id],
    );
    expect(count[0].n).toBe(3);
  });

  it('posts a 10,000,000 accrual on 1404-12-20 and reverses it on 1405-01-01, debit and credit swapped', async () => {
    const accrualDate = jalaliIso(1404, 12, 20);
    const reversalDate = jalaliIso(1405, 1, 1);
    expect(reversalDate).toBe('2026-03-21');

    const template = await service.create(T2, 'tester', {
      name: 'تعهد خودکار',
      description: 'تعهد خودکار',
      frequency: RecurringVoucherFrequency.MONTHLY,
      nextRunDate: accrualDate,
      autoReverse: true,
      lines: [
        { accountCode: '5010', debit: '10000000' },
        { accountCode: '2010', credit: '10000000' },
      ],
    });

    const posted = await service.runDue(T2, accrualDate);
    expect(posted).toMatchObject({ created: 1, reversed: 0 });

    const run: Array<{ id: number; journal_entry_id: number; reversal_entry_id: number | null; reversal_date: unknown }> =
      await ds.query(
        `SELECT id, journal_entry_id, reversal_entry_id, reversal_date FROM erp_recurring_voucher_runs WHERE tenant_id = $1 AND recurring_id = $2`,
        [T2, template.id],
      );
    expect(isoDay(run[0].reversal_date)).toBe(reversalDate);
    expect(run[0].reversal_entry_id).toBeNull();

    const accrual: Array<{ status: string; date: unknown }> = await ds.query(
      `SELECT status, date FROM fin_journal_entries WHERE id = $1`,
      [run[0].journal_entry_id],
    );
    expect(accrual[0].status).toBe('POSTED');
    expect(isoDay(accrual[0].date)).toBe(accrualDate);
    const balanceAfterPost: Array<{ balance: string }> = await ds.query(
      `SELECT balance FROM fin_chart_of_accounts WHERE tenant_id = $1 AND code = '5010'`,
      [T2],
    );
    expect(balanceAfterPost[0].balance).toBe('10000000.00');

    const reversed = await service.runDue(T2, reversalDate);
    expect(reversed).toMatchObject({ created: 0, reversed: 1, skipped: [] });

    const updated: Array<{ reversal_entry_id: number }> = await ds.query(
      `SELECT reversal_entry_id FROM erp_recurring_voucher_runs WHERE id = $1`,
      [run[0].id],
    );
    expect(updated[0].reversal_entry_id).toBeGreaterThan(0);

    const reversalEntry: Array<{ date: unknown; reverses_entry_id: number }> = await ds.query(
      `SELECT date, reverses_entry_id FROM fin_journal_entries WHERE id = $1`,
      [updated[0].reversal_entry_id],
    );
    expect(isoDay(reversalEntry[0].date)).toBe(reversalDate);
    expect(reversalEntry[0].reverses_entry_id).toBe(run[0].journal_entry_id);

    const reversalLines: Array<{ account_id: number; debit: string; credit: string }> = await ds.query(
      `SELECT l.account_id, l.debit, l.credit
         FROM fin_journal_entry_lines l
         JOIN fin_chart_of_accounts a ON a.id = l.account_id AND a.tenant_id = l.tenant_id
        WHERE l.journal_entry_id = $1 AND a.code IN ('5010', '2010')
        ORDER BY a.code`,
      [updated[0].reversal_entry_id],
    );
    expect(reversalLines).toEqual([
      { account_id: expect.any(Number), debit: '10000000.00', credit: '0.00' },
      { account_id: expect.any(Number), debit: '0.00', credit: '10000000.00' },
    ]);

    const balanceAfterReverse: Array<{ balance: string }> = await ds.query(
      `SELECT balance FROM fin_chart_of_accounts WHERE tenant_id = $1 AND code = '5010'`,
      [T2],
    );
    expect(balanceAfterReverse[0].balance).toBe('0.00');
  });

  it('reports a locked period in skipped, keeps the due date and posts it after the unlock', async () => {
    const template = await service.create(T3, 'tester', {
      name: 'در دوره قفل',
      description: 'سررسید در دوره قفل',
      frequency: RecurringVoucherFrequency.MONTHLY,
      nextRunDate: '2026-08-01',
      lines: [
        { accountCode: '5010', debit: '500000' },
        { accountCode: '2010', credit: '500000' },
      ],
    });
    const lock = await accounting.lockPeriod(T3, 'tester', {
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      reason: 'locked for test',
    });

    const blocked = await service.runDue(T3, '2026-08-01');
    expect(blocked.created).toBe(0);
    expect(blocked.skipped).toEqual([
      { id: template.id, date: '2026-08-01', reason: expect.any(String) },
    ]);

    const still: Array<{ next_run_date: unknown }> = await ds.query(
      `SELECT next_run_date FROM erp_recurring_vouchers WHERE id = $1`,
      [template.id],
    );
    expect(isoDay(still[0].next_run_date)).toBe('2026-08-01');
    const noRun: Array<{ n: number }> = await ds.query(
      `SELECT COUNT(*)::int AS n FROM erp_recurring_voucher_runs WHERE tenant_id = $1 AND recurring_id = $2`,
      [T3, template.id],
    );
    expect(noRun[0].n).toBe(0);

    await accounting.unlockPeriod(T3, 'tester', lock.id, { reason: 'unlocked for test' });
    const retried = await service.runDue(T3, '2026-08-01');
    expect(retried).toMatchObject({ created: 1, skipped: [] });
    const created: Array<{ n: number }> = await ds.query(
      `SELECT COUNT(*)::int AS n FROM erp_recurring_voucher_runs WHERE tenant_id = $1 AND recurring_id = $2`,
      [T3, template.id],
    );
    expect(created[0].n).toBe(1);
  });

  it('keeps every tenant isolated', async () => {
    const foreign = await service.create(T4, 'tester', {
      name: 'الگوی مستأجر دیگر',
      description: 'الگوی مستأجر دیگر',
      frequency: RecurringVoucherFrequency.MONTHLY,
      nextRunDate: '2026-01-01',
      lines: [
        { accountCode: '5010', debit: '700000' },
        { accountCode: '2010', credit: '700000' },
      ],
    });

    const visibleToT1 = await service.list(T1);
    expect(visibleToT1.some((row) => row.id === foreign.id)).toBe(false);

    await service.runDue(T1, '2026-01-01');
    const foreignRuns: Array<{ n: number }> = await ds.query(
      `SELECT COUNT(*)::int AS n FROM erp_recurring_voucher_runs WHERE tenant_id = $1`,
      [T4],
    );
    expect(foreignRuns[0].n).toBe(0);
  });
});
