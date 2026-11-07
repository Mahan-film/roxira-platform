/**
 * Fixed assets and depreciation on a REAL PostgreSQL. Opt-in like the other pg specs: skipped
 * unless ROXIRA_TEST_PG_HOST is set; each run creates and drops its own database.
 */
import 'reflect-metadata';
import * as path from 'path';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { CurrencyService } from '../currency/services/currency.service';
import { AccountingRepository } from './repositories/accounting.repository';
import { FixedAssetRepository } from './repositories/fixed-asset.repository';
import { AccountingService } from './services/accounting.service';
import { ChartTemplateService } from './services/chart-template.service';
import { FixedAssetService } from './services/fixed-asset.service';
import { PostingRulesRepository } from '../posting_rules/repositories/posting-rules.repository';
import { PostingRulesService } from '../posting_rules/services/posting-rules.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const USER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const PASSWORD = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const T3 = '33333333-3333-4333-8333-333333333333';
/** The services run as a non-superuser without BYPASSRLS, like production, so FORCE RLS applies. */
const APP_ROLE = `rx_fa_app_${process.pid}`;
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

describePg('Fixed assets on PostgreSQL', () => {
  const dbName = `rx_fa_${process.pid}_${Date.now()}`;
  let ds: DataSource;
  let app: DataSource;
  let accounting: AccountingService;
  let assets: FixedAssetService;

  const base = {
    category: 'FURNITURE',
    assetAccountCode: '1113',
    accumulatedAccountCode: '1120',
    expenseAccountCode: '5060',
  };
  // 2026-04-10 is 1405/01/21.
  const make = (tenant: string, code: string, extra: object) =>
    assets.create(tenant, 'u', { ...base, code, name: code, acquisitionDate: '2026-04-10', ...extra } as never);
  const balance = async (tenant: string, code: string): Promise<string> =>
    (await ds.query(`SELECT balance FROM fin_chart_of_accounts WHERE tenant_id = $1 AND code = $2`, [tenant, code]))[0]?.balance;

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
    assets = new FixedAssetService(new FixedAssetRepository(ds), repo, new PostingRulesService(new PostingRulesRepository(new TenantScope(ds)), accounting), { get: async () => 'refuse' } as never);
    const templates = new ChartTemplateService(repo);
    await templates.apply(T1, 'iran-trading');
    await templates.apply(T2, 'iran-trading');
    await templates.apply(T3, 'iran-trading');
  }, 120000);

  afterAll(async () => {
    await app?.destroy();
    await ds?.destroy();
    await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin(`DROP ROLE IF EXISTS ${APP_ROLE}`);
  });

  it('runs the services as a role that cannot bypass row-level security', async () => {
    const [r] = await app.query(`SELECT r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user`);
    expect(r).toMatchObject({ rolsuper: false, rolbypassrls: false });
    // Without app.tenant_id the forced policy hides every asset row.
    await make(T2, 'FA-RLS', { cost: '10.00', method: 'STRAIGHT_LINE', lifeMonths: 10 });
    expect(await app.query(`SELECT id FROM fin_fixed_assets`)).toEqual([]);
    await ds.query(`DELETE FROM fin_fixed_assets WHERE code = 'FA-RLS'`);
  });

  it('registers assets and refuses duplicates, bad terms and unknown accounts', async () => {
    await make(T1, 'FA-1', { cost: '1200.00', method: 'STRAIGHT_LINE', lifeMonths: 12 });
    await make(T1, 'FA-2', { cost: '1000.00', method: 'DECLINING_BALANCE', annualRate: '0.24', rateSource: 'tax circular' });
    await expect(make(T1, 'FA-1', { cost: '1.00', method: 'STRAIGHT_LINE', lifeMonths: 1 })).rejects.toBeInstanceOf(ConflictException);
    await expect(make(T1, 'FA-3', { cost: '1.00', method: 'STRAIGHT_LINE' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(make(T1, 'FA-4', { cost: '1.00', method: 'STRAIGHT_LINE', lifeMonths: 1, expenseAccountCode: '9999' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(make(T1, 'FA-5', { cost: '10.00', salvageValue: '10.00', method: 'STRAIGHT_LINE', lifeMonths: 1 })).rejects.toBeInstanceOf(BadRequestException);
    expect((await assets.list(T1)).map((a) => [a.code, a.netBookValue])).toEqual([['FA-1', '1200.00'], ['FA-2', '1000.00']]);
    expect(await assets.list(T2)).toEqual([]);
  });

  it('posts one balanced entry per month, moves the ledger, and is idempotent', async () => {
    const first = await assets.runMonth(T1, { year: 1405, month: 1 });
    expect(first).toMatchObject({ entryNumber: 'DEP-140501-1', entryNumbers: ['DEP-140501-1', 'DEP-140501-2'], totalCharged: '120.00' });
    expect(first.charged).toEqual([{ code: 'FA-1', amount: '100.00' }, { code: 'FA-2', amount: '20.00' }]);
    expect(await balance(T1, '5060')).toBe('120.00');
    expect(await balance(T1, '1120')).toBe('-120.00');

    const again = await assets.runMonth(T1, { year: 1405, month: 1 });
    expect(again.entryNumber).toBeNull();
    expect(again.skipped.map((s) => s.reason)).toEqual(['ALREADY_DONE', 'ALREADY_DONE']);
    expect(await balance(T1, '5060')).toBe('120.00');
  });

  it('refuses to skip a month, and concurrent runs charge once', async () => {
    const gap = await assets.runMonth(T1, { year: 1405, month: 3 });
    expect(gap.skipped.map((s) => s.reason)).toEqual(['PREVIOUS_MONTH_MISSING', 'PREVIOUS_MONTH_MISSING']);
    const [a, b] = await Promise.all([assets.runMonth(T1, { year: 1405, month: 2 }), assets.runMonth(T1, { year: 1405, month: 2 })]);
    expect([a, b].filter((r) => r.entryNumber !== null)).toHaveLength(1);
    expect(await balance(T1, '5060')).toBe('239.60');
  });

  it('stops at the depreciable amount and marks the asset fully depreciated', async () => {
    // Acquired 2026-06-22 = 1405/04/01; one month of life leaves only the salvage value.
    await make(T1, 'FA-SHORT', { cost: '100.00', salvageValue: '40.00', method: 'STRAIGHT_LINE', lifeMonths: 1, acquisitionDate: '2026-06-22' });
    const r = await assets.runMonth(T1, { year: 1405, month: 4 });
    expect(r.charged.find((c) => c.code === 'FA-SHORT')).toEqual({ code: 'FA-SHORT', amount: '60.00' });
    expect(r.skipped.filter((s) => s.code !== 'FA-SHORT').map((s) => s.reason)).toEqual(['PREVIOUS_MONTH_MISSING', 'PREVIOUS_MONTH_MISSING']);
    const short = (await assets.list(T1)).find((a) => a.code === 'FA-SHORT')!;
    expect(short).toMatchObject({ status: 'FULLY_DEPRECIATED', netBookValue: '40.00' });
    const next = await assets.runMonth(T1, { year: 1405, month: 5 });
    expect([...next.charged, ...next.skipped].some((x) => x.code === 'FA-SHORT')).toBe(false);
  });

  it('rolls everything back when the period is locked', async () => {
    for (const month of [3, 4, 5, 6]) {
      await assets.runMonth(T1, { year: 1405, month });
    }
    // Mehr 1405 ends 2026-10-22.
    await accounting.lockPeriod(T1, 'u', { periodStart: '2026-10-01', periodEnd: '2026-10-31' } as never);
    const before = await balance(T1, '5060');
    await expect(assets.runMonth(T1, { year: 1405, month: 7 })).rejects.toMatchObject({ status: 423 });
    expect(await balance(T1, '5060')).toBe(before);
    const rows = await ds.query(`SELECT months_depreciated FROM fin_fixed_assets WHERE code = 'FA-1'`);
    expect(rows[0].months_depreciated).toBe(6);
  });

  it('shows another tenant nothing and the database refuses a double charge', async () => {
    expect(await assets.runMonth(T2, { year: 1405, month: 1 })).toMatchObject({ entryNumber: null, charged: [] });
    await expect(
      ds.query(`INSERT INTO fin_depreciation_lines (tenant_id, asset_id, period_year, period_month, amount, journal_entry_id)
                SELECT tenant_id, asset_id, period_year, period_month, amount, journal_entry_id FROM fin_depreciation_lines LIMIT 1`),
    ).rejects.toThrow(/UQ_fin_depreciation_lines_month/);
  });

  describe('charges that round to zero (#129)', () => {
    const asset = async (code: string) => (await assets.list(T3)).find((a) => a.code === code)!;
    const months = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

    it('a one-cent straight-line asset advances through zero months and ends fully depreciated', async () => {
      await make(T3, 'Z-SL', { cost: '0.01', salvageValue: '0', method: 'STRAIGHT_LINE', lifeMonths: 12 });
      for (const month of months(1, 5)) {
        const r = await assets.runMonth(T3, { year: 1405, month });
        expect(r).toMatchObject({ entryNumber: null, charged: [], zeroCharge: ['Z-SL'], skipped: [] });
      }
      const sixth = await assets.runMonth(T3, { year: 1405, month: 6 });
      expect(sixth.charged).toEqual([{ code: 'Z-SL', amount: '0.01' }]);
      expect(await asset('Z-SL')).toMatchObject({ status: 'FULLY_DEPRECIATED', monthsDepreciated: 6, netBookValue: '0.00' });
      expect(await balance(T3, '5060')).toBe('0.01');
    });

    it('a full straight-line life adds up to cost minus salvage', async () => {
      // Acquired 2026-07-23 = 1405/05/01.
      await make(T3, 'Z-FULL', { cost: '100.00', salvageValue: '0.01', method: 'STRAIGHT_LINE', lifeMonths: 7, acquisitionDate: '2026-07-23' });
      let total = 0;
      for (const month of months(5, 11)) {
        const r = await assets.runMonth(T3, { year: 1405, month });
        expect(r.skipped.filter((s) => s.code === 'Z-FULL')).toEqual([]);
        total += Number(r.charged.find((c) => c.code === 'Z-FULL')?.amount ?? 0) * 100;
      }
      expect(Math.round(total)).toBe(9999);
      expect(await asset('Z-FULL')).toMatchObject({ status: 'FULLY_DEPRECIATED', monthsDepreciated: 7, netBookValue: '0.01' });
    });

    it('declining balance writes off the rounded-away remainder and reaches FULLY_DEPRECIATED', async () => {
      // Acquired 2026-10-23 = 1405/08/01; 5 cents at 24%/year is 0.1 cent a month, which rounds to zero.
      await make(T3, 'Z-DB', { cost: '0.05', method: 'DECLINING_BALANCE', annualRate: '0.24', acquisitionDate: '2026-10-23' });
      const r = await assets.runMonth(T3, { year: 1405, month: 8 });
      expect(r.charged).toEqual([{ code: 'Z-DB', amount: '0.05' }]);
      expect(await asset('Z-DB')).toMatchObject({ status: 'FULLY_DEPRECIATED', netBookValue: '0.00' });
    });
  });
});
