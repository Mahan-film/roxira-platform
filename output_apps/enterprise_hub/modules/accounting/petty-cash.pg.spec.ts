/** Petty cash on a REAL PostgreSQL. Opt-in: skipped unless ROXIRA_TEST_PG_HOST is set. */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { CurrencyService } from '../currency/services/currency.service';
import { ChartOfAccountEntity } from './entities/chart-of-account.entity';
import { JournalEntryLineEntity } from './entities/journal-entry-line.entity';
import { JournalEntryEntity } from './entities/journal-entry.entity';
import { PeriodLockEntity } from './entities/period-lock.entity';
import { AccountingRepository } from './repositories/accounting.repository';
import { FiscalYearRepository } from './repositories/fiscal-year.repository';
import { LedgerReportRepository } from './repositories/ledger-report.repository';
import { PettyCashRepository } from './repositories/petty-cash.repository';
import { AccountingService } from './services/accounting.service';
import { ChartTemplateService } from './services/chart-template.service';
import { FinancialReportsService } from './services/financial-reports.service';
import { PettyCashService } from './services/petty-cash.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const T1 = '66666666-6666-4666-8666-666666666666';
const T2 = '77777777-7777-4777-8777-777777777777';

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

describePg('Petty cash on PostgreSQL', () => {
  const dbName = `rx_pc_${process.pid}_${Date.now()}`;
  let ds: DataSource;
  let accounting: AccountingService;
  let reports: FinancialReportsService;
  let petty: PettyCashService;

  beforeAll(async () => {
    await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin(`CREATE DATABASE "${dbName}"`);
    ds = new DataSource(options(dbName));
    await ds.initialize();
    await ds.runMigrations();
    const currency = { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService;
    const repo = new AccountingRepository(
      ds.getRepository(ChartOfAccountEntity),
      ds.getRepository(JournalEntryEntity),
      ds.getRepository(JournalEntryLineEntity),
      ds.getRepository(PeriodLockEntity),
      ds,
    );
    accounting = new AccountingService(repo, currency);
    reports = new FinancialReportsService(repo, new FiscalYearRepository(ds), new LedgerReportRepository(ds));
    petty = new PettyCashService(new PettyCashRepository(ds), repo, accounting);
    await new ChartTemplateService(repo).apply(T1, 'iran-trading');
    await accounting.createJournalEntry(T1, {
      entryNumber: 'SEED', date: '2026-04-01', description: 'seed',
      lines: [{ accountCode: '1012', debit: '1000000.00' }, { accountCode: '3010', credit: '1000000.00' }],
    } as never);
  }, 120000);

  afterAll(async () => {
    await ds.destroy();
    await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  });

  it('runs a fund through charge, receipts, settlement, refill, return and close', async () => {
    const fund = await petty.createFund(T1, { name: 'کارگاه', custodianName: 'مسئول', imprestAmount: '100000' });
    expect(fund.ledgerAccountCode).toBe('101302');
    const second = await petty.createFund(T1, { name: 'دفتر', custodianName: 'مسئول', imprestAmount: '5000' });
    expect(second.ledgerAccountCode).toBe('101303');

    const movement = { date: '2026-04-02', accountCode: '1012' };
    await expect(petty.charge(T1, 'u', fund.id, { ...movement, amount: '100000.01' })).rejects.toMatchObject({ status: 409 });
    await petty.charge(T1, 'u', fund.id, { ...movement, amount: '100000' });

    const receipt = { date: '2026-04-03', accountCode: '5030', description: 'لوازم' };
    const r1 = await petty.addExpense(T1, 'u', fund.id, { ...receipt, amount: '30000.50' });
    const r2 = await petty.addExpense(T1, 'u', fund.id, { ...receipt, amount: '20000', accountCode: '5020' });
    const r3 = await petty.addExpense(T1, 'u', fund.id, { ...receipt, amount: '10000' });
    await expect(petty.addExpense(T1, 'u', fund.id, { ...receipt, amount: '40000' })).rejects.toMatchObject({ status: 409 });
    await expect(petty.addExpense(T1, 'u', fund.id, { ...receipt, amount: '1', accountCode: '50' })).rejects.toMatchObject({ status: 400 });
    await expect(petty.addExpense(T1, 'u', fund.id, { ...receipt, amount: '1', accountCode: '1012' })).rejects.toMatchObject({ status: 400 });
    await petty.voidExpense(T1, fund.id, r3.id);

    let state = (await petty.statement(T1, fund.id)).fund;
    expect(state).toMatchObject({ balance: 100000, pending: 50000.5, available: 49999.5 });
    let trial = await reports.trialBalance(T1, { to: '2026-12-31' });
    expect(trial.rows.find((r) => r.code === '5030')).toBeUndefined();

    const settled = await petty.settle(T1, 'u', fund.id, {
      expenseIds: [r1.id, r2.id], date: '2026-04-10', replenishFromAccountCode: '1012',
    });
    expect(settled.fund).toMatchObject({ balance: 100000, pending: 0 });
    await expect(petty.settle(T1, 'u', fund.id, { expenseIds: [r1.id], date: '2026-04-11' })).rejects.toMatchObject({ status: 409 });

    trial = await reports.trialBalance(T1, { to: '2026-12-31', columns: 2 });
    expect(trial.rows.find((r) => r.code === '5030')!.endingDebit).toBe(3000050n);
    expect(trial.rows.find((r) => r.code === '5020')!.endingDebit).toBe(2000000n);
    expect(trial.rows.find((r) => r.code === '101302')!.endingDebit).toBe(10000000n);
    expect(trial.balanced).toBe(true);
    const sheet = await reports.balanceSheet(T1, { to: '2026-12-31' });
    expect(sheet.currentAssets.lines.find((l) => l.line === 'PETTY_CASH')!.amount).toBe(10000000n);
    expect(sheet.checks.every((c) => c.ok)).toBe(true);

    await expect(petty.closeFund(T1, fund.id)).rejects.toMatchObject({ status: 409 });
    await petty.returnCash(T1, 'u', fund.id, { ...movement, amount: '100000' });
    state = await petty.closeFund(T1, fund.id);
    expect(state.status).toBe('CLOSED');
    await expect(petty.charge(T1, 'u', fund.id, { ...movement, amount: '1' })).rejects.toMatchObject({ status: 409 });
  }, 60000);

  it('holds the limit under concurrent receipts', async () => {
    const fund = await petty.createFund(T1, { name: 'همزمان', custodianName: 'مسئول', imprestAmount: '1000' });
    await petty.charge(T1, 'u', fund.id, { amount: '1000', date: '2026-05-01', accountCode: '1012' });
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        petty.addExpense(T1, 'u', fund.id, { amount: '400', date: '2026-05-02', accountCode: '5030', description: 'x' }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(2);
    expect((await petty.statement(T1, fund.id)).fund.pending).toBe(800);
  }, 60000);

  it('answers concurrent creation of one name with a conflict', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () => petty.createFund(T1, { name: 'یکتا', custodianName: 'مسئول', imprestAmount: '10' })),
    );
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
    for (const result of results) {
      if (result.status === 'rejected') expect(result.reason).toMatchObject({ status: 409 });
    }
  }, 60000);

  it('keeps tenants apart and refuses an unknown fund', async () => {
    expect(await petty.listFunds(T2)).toEqual([]);
    const [fund] = await petty.listFunds(T1);
    await expect(petty.statement(T2, fund.id)).rejects.toMatchObject({ status: 404 });
    await expect(
      petty.charge(T2, 'u', fund.id, { amount: '1', date: '2026-05-01', accountCode: '1012' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('reverts its migration cleanly', async () => {
    while ((await ds.query(`SELECT 1 FROM migrations WHERE name = 'CreatePettyCash1789380000000'`)).length > 0) {
      await ds.undoLastMigration();
    }
    const [{ exists }] = await ds.query(`SELECT to_regclass('fin_petty_cash_funds') IS NOT NULL AS "exists"`);
    expect(exists).toBe(false);
    await ds.runMigrations();
  });
});
