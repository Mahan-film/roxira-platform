/**
 * Fixed-asset disposal (#561) on a REAL PostgreSQL. Opt-in like the other pg specs: skipped unless
 * ROXIRA_TEST_PG_HOST is set; each run creates and drops its own database.
 */
import 'reflect-metadata';
import * as path from 'path';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { CurrencyService } from '../currency/services/currency.service';
import { AccountingRepository } from './repositories/accounting.repository';
import { FixedAssetRepository } from './repositories/fixed-asset.repository';
import { AccountingService } from './services/accounting.service';
import { ChartTemplateService } from './services/chart-template.service';
import { FixedAssetService } from './services/fixed-asset.service';
import { fromDb } from './money';
import { PostingRulesRepository } from '../posting_rules/repositories/posting-rules.repository';
import { PostingRulesService } from '../posting_rules/services/posting-rules.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const USER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const PASSWORD = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
/** The services run as a non-superuser without BYPASSRLS, like production, so FORCE RLS applies. */
const APP_ROLE = `rx_fa_disposal_${process.pid}`;
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

// Every scenario asset: cost 120,000,000, straight line over 12 months, no salvage, so one posted
// month is exactly 10,000,000 and three posted months accumulate exactly 30,000,000 (book value 90,000,000).
const COST = '120000000.00';
const ACCUMULATED = '30000000.00';
const BOOK_VALUE = '90000000.00';

describePg('Fixed-asset disposal on PostgreSQL', () => {
  const dbName = `rx_fa_disposal_${process.pid}_${Date.now()}`;
  let ds: DataSource;
  let app: DataSource;
  let accounting: AccountingService;
  let assets: FixedAssetService;

  const base = {
    category: 'FURNITURE',
    assetAccountCode: '1113',
    accumulatedAccountCode: '1120',
    expenseAccountCode: '5060',
    cost: COST,
    method: 'STRAIGHT_LINE',
    lifeMonths: 12,
  };
  // 2026-04-10 is 1405/01/21; the month-end vouchers of months 1..3 are dated 2026-06-21 at the latest.
  const make = (code: string) => assets.create(T1, 'u', { ...base, name: code, acquisitionDate: '2026-04-10', code } as never);
  const balance = async (code: string): Promise<string> =>
    (await ds.query(`SELECT balance FROM fin_chart_of_accounts WHERE tenant_id = $1 AND code = $2`, [T1, code]))[0]?.balance;
  const linesOf = async (entryId: number): Promise<Array<[string, bigint, bigint]>> =>
    (
      await ds.query(
        `SELECT a.code, l.debit, l.credit FROM fin_journal_entry_lines l
           JOIN fin_chart_of_accounts a ON a.id = l.account_id
          WHERE l.journal_entry_id = $1 ORDER BY l.id`,
        [entryId],
      )
    ).map((row: { code: string; debit: string; credit: string }) => [row.code, fromDb(row.debit), fromDb(row.credit)] as [string, bigint, bigint]);
  const sumsOf = async (entryId: number): Promise<{ d: string; c: string }> =>
    (
      await ds.query(`SELECT SUM(debit) AS d, SUM(credit) AS c FROM fin_journal_entry_lines WHERE journal_entry_id = $1`, [
        entryId,
      ])
    )[0];

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
    const repo = new AccountingRepository(new TenantScope(app));
    accounting = new AccountingService(repo, currency);
    assets = new FixedAssetService(new FixedAssetRepository(ds), repo, new PostingRulesService(new PostingRulesRepository(new TenantScope(ds)), accounting));
    const templates = new ChartTemplateService(repo);
    await templates.apply(T1, 'iran-trading');
    await templates.apply(T2, 'iran-trading');
  }, 120000);

  afterAll(async () => {
    await app?.destroy();
    await ds?.destroy();
    await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin(`DROP ROLE IF EXISTS ${APP_ROLE}`);
  });

  let gain: Awaited<ReturnType<typeof make>>;
  let loss: Awaited<ReturnType<typeof make>>;
  let zero: Awaited<ReturnType<typeof make>>;
  let locked: Awaited<ReturnType<typeof make>>;
  let early: Awaited<ReturnType<typeof make>>;

  beforeAll(async () => {
    gain = await make('FA-GAIN');
    loss = await make('FA-LOSS');
    zero = await make('FA-ZERO');
    locked = await make('FA-LOCK');
    early = await make('FA-EARLY');
    await make('FA-KEEP');
    for (const month of [1, 2, 3]) {
      const run = await assets.runMonth(T1, { year: 1405, month });
      expect(run.charged).toHaveLength(6);
    }
  }, 60000);

  it('posts one balanced disposal voucher and books the gain from the posted runs', async () => {
    const result = await assets.dispose(T1, gain.id, { date: '2026-06-22', proceeds: '100000000.00', cashAccountRole: 'cash' });
    expect(result).toMatchObject({
      code: 'FA-GAIN',
      status: 'DISPOSED',
      cost: COST,
      accumulatedDepreciation: ACCUMULATED,
      netBookValue: BOOK_VALUE,
      proceeds: '100000000.00',
      gain: '10000000.00',
      loss: '0.00',
    });
    expect(result.journalEntryId).toBeGreaterThan(0);
    // debit accumulated depreciation and the cash proceeds, credit the asset cost, credit the gain.
    expect(await linesOf(result.journalEntryId)).toEqual([
      ['1120', fromDb(ACCUMULATED), 0n],
      ['1011', fromDb('100000000.00'), 0n],
      ['1113', 0n, fromDb(COST)],
      ['4050', 0n, fromDb('10000000.00')],
    ]);
    const sums = await sumsOf(result.journalEntryId);
    expect(sums.d).toBe(COST);
    expect(sums.c).toBe(COST);
    expect(await balance('1120')).toBe('-150000000.00'); // 6 assets charged, one asset's accumulated removed
  });

  it('refuses the second disposal of the same asset with 409', async () => {
    await expect(
      assets.dispose(T1, gain.id, { date: '2026-06-22', proceeds: '100000000.00', cashAccountRole: 'cash' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('books the loss when the proceeds are below the book value, and the voucher balances', async () => {
    const result = await assets.dispose(T1, loss.id, { date: '2026-06-23', proceeds: '80000000.00', cashAccountRole: 'cash' });
    expect(result).toMatchObject({
      code: 'FA-LOSS',
      proceeds: '80000000.00',
      gain: '0.00',
      loss: '10000000.00',
    });
    expect(await linesOf(result.journalEntryId)).toEqual([
      ['1120', fromDb(ACCUMULATED), 0n],
      ['1011', fromDb('80000000.00'), 0n],
      ['1113', 0n, fromDb(COST)],
      ['5070', fromDb('10000000.00'), 0n],
    ]);
    const sums = await sumsOf(result.journalEntryId);
    expect(sums.d).toBe(COST);
    expect(sums.c).toBe(COST);
  });

  it('books the whole book value as loss when the proceeds are zero, and the voucher balances', async () => {
    const result = await assets.dispose(T1, zero.id, { date: '2026-06-23', proceeds: '0.00', cashAccountRole: 'cash' });
    expect(result).toMatchObject({
      code: 'FA-ZERO',
      proceeds: '0.00',
      gain: '0.00',
      loss: BOOK_VALUE,
    });
    // proceeds of zero drop the settlement line entirely.
    expect(await linesOf(result.journalEntryId)).toEqual([
      ['1120', fromDb(ACCUMULATED), 0n],
      ['1113', 0n, fromDb(COST)],
      ['5070', fromDb(BOOK_VALUE), 0n],
    ]);
    const sums = await sumsOf(result.journalEntryId);
    expect(sums.d).toBe(COST);
    expect(sums.c).toBe(COST);
  });

  it('refuses a disposal inside a locked period with 423 and writes nothing, then succeeds after the unlock', async () => {
    const before = await balance('5060');
    const lock = await accounting.lockPeriod(T1, 'u', {
      periodStart: '2026-06-25',
      periodEnd: '2026-06-30',
      reason: 'disposal test',
    } as never);
    await expect(
      assets.dispose(T1, locked.id, { date: '2026-06-26', proceeds: '0.00', cashAccountRole: 'cash' }),
    ).rejects.toMatchObject({ status: 423 });
    expect(await balance('5060')).toBe(before);
    const rows = await ds.query(`SELECT status, disposal_date FROM fin_fixed_assets WHERE id = $1`, [locked.id]);
    expect(rows[0]).toMatchObject({ status: 'ACTIVE', disposal_date: null });
    await accounting.unlockPeriod(T1, 'u', lock.id, { reason: 'disposal test done' });
    const after = await assets.dispose(T1, locked.id, { date: '2026-06-26', proceeds: '0.00', cashAccountRole: 'cash' });
    expect(after).toMatchObject({ status: 'DISPOSED', loss: BOOK_VALUE });
  });

  it('shows another tenant nothing (404)', async () => {
    await expect(
      assets.dispose(T2, gain.id, { date: '2026-06-23', proceeds: '100000000.00', cashAccountRole: 'cash' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a disposal dated before the newest posted depreciation run, and allows the same day', async () => {
    // The newest posted run of this asset is the Khordad month end, 2026-06-21.
    await expect(
      assets.dispose(T1, early.id, { date: '2026-06-20', proceeds: '0.00', cashAccountRole: 'cash' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const even = await assets.dispose(T1, early.id, { date: '2026-06-21', proceeds: BOOK_VALUE, cashAccountRole: 'cash' });
    expect(even).toMatchObject({ status: 'DISPOSED', gain: '0.00', loss: '0.00' });
    // No gain and no loss: only accumulated, proceeds and cost reach the voucher.
    expect(await linesOf(even.journalEntryId)).toEqual([
      ['1120', fromDb(ACCUMULATED), 0n],
      ['1011', fromDb(BOOK_VALUE), 0n],
      ['1113', 0n, fromDb(COST)],
    ]);
  });

  it('the month after the disposals charges only the asset still on the books', async () => {
    const run = await assets.runMonth(T1, { year: 1405, month: 4 });
    expect(run.charged).toEqual([{ code: 'FA-KEEP', amount: '10000000.00' }]);
    const touched = [...run.charged.map((c) => c.code), ...run.skipped.map((s) => s.code), ...run.zeroCharge];
    expect(touched).toEqual(['FA-KEEP']);
    expect(await balance('4050')).toBe('-10000000.00');
    expect(await balance('5070')).toBe('190000000.00'); // 10 + 90 + 90 million of losses
    expect(await balance('1011')).toBe('270000000.00'); // 100 + 80 + 0 + 0 + 90 million of proceeds
    expect(await balance('1113')).toBe('-600000000.00'); // five assets sold at cost
    expect(await balance('1120')).toBe('-40000000.00'); // 180 - 150 posted, then KEEP's fourth month
  });
});
