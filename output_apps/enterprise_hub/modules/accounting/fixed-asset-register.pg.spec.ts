import 'reflect-metadata';
import * as path from 'path';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { CurrencyService } from '../currency/services/currency.service';
import { AccountingRepository } from './repositories/accounting.repository';
import { FixedAssetRepository } from './repositories/fixed-asset.repository';
import { AccountingService } from './services/accounting.service';
import { ChartTemplateService } from './services/chart-template.service';
import { assetRegisterTable } from './assets/asset-register';
import { jalali } from './reports/report-tables';
import { ReportExportService } from './services/report-export.service';
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

describePg('Fixed-asset register on PostgreSQL', () => {
  const dbName = `rx_fa_reg_${process.pid}_${Date.now()}`;
  let ds: DataSource;
  let app: DataSource;
  let accounting: AccountingService;
  let assets: FixedAssetService;
  /** Reads through the non-superuser connection, so FORCE RLS also applies. */
  let appAssets: FixedAssetService;

  const base = {
    category: 'FURNITURE',
    assetAccountCode: '1113',
    accumulatedAccountCode: '1120',
    expenseAccountCode: '5060',
  };
  // 2026-04-10 is 1405/01/21.
  const make = (tenant: string, code: string, extra: object) =>
    assets.create(tenant, 'u', { ...base, code, name: code, acquisitionDate: '2026-04-10', ...extra } as never);

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
    const posting = new PostingRulesService(new PostingRulesRepository(new TenantScope(ds)), accounting);
    assets = new FixedAssetService(new FixedAssetRepository(ds), repo, posting);
    appAssets = new FixedAssetService(new FixedAssetRepository(app), repo, posting);
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

  it('lists each company\'s assets with exact cost, accumulated depreciation and book value', async () => {
    await make(T1, 'FA-1', { cost: '1200.00', method: 'STRAIGHT_LINE', lifeMonths: 12 });
    await make(T1, 'FA-2', { cost: '1000.00', method: 'DECLINING_BALANCE', annualRate: '0.24', rateSource: 'tax circular' });
    await make(T2, 'FA-1', { cost: '99999.00', method: 'STRAIGHT_LINE', lifeMonths: 12 });
    await ds.query(`UPDATE fin_fixed_assets SET accumulated_depreciation = '20.00', months_depreciated = 1 WHERE tenant_id = $1 AND code = 'FA-2'`, [T1]);

    const t1 = await appAssets.register(T1);
    expect(t1.rows.map((r) => [r.code, r.costMinor, r.accumulatedMinor, r.bookValueMinor])).toEqual([
      ['FA-1', 120000n, 0n, 120000n],
      ['FA-2', 100000n, 2000n, 98000n],
    ]);
    expect(t1.totals).toEqual({ costMinor: 220000n, accumulatedMinor: 2000n, bookValueMinor: 218000n });

    const t2 = await appAssets.register(T2);
    expect(t2.rows.map((r) => [r.code, r.costMinor])).toEqual([['FA-1', 9999900n]]);
    expect((await appAssets.register(T3)).rows).toEqual([]);
  });

  it('builds the month plan from the tenant\'s own asset and never from another company\'s', async () => {
    const plan = await appAssets.schedule(T1, 'FA-1');
    expect(plan.rows).toHaveLength(12);
    expect(plan.rows.every((r) => r.chargeMinor === 10000n)).toBe(true);
    expect(plan.rows[0].period).toBe(1);
    expect(plan.closingAccumulatedMinor).toBe(120000n);
    expect(plan.closingBookValueMinor).toBe(0n);
    expect((await appAssets.schedule(T2, 'FA-1')).closingAccumulatedMinor).toBe(9999900n);
    await expect(appAssets.schedule(T1, 'NOPE')).rejects.toBeInstanceOf(NotFoundException);
    await expect(appAssets.schedule(T3, 'FA-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('renders the register as XLSX and PDF', async () => {
    const exporter = new ReportExportService(undefined as never);
    const table = assetRegisterTable(await appAssets.register(T1), jalali);
    const xlsx = await exporter.render(table, 'xlsx', 'fixed-asset-register');
    expect(xlsx.body.subarray(0, 2).toString()).toBe('PK');
    expect(xlsx.filename).toBe('fixed-asset-register.xlsx');
    const pdf = await exporter.render(table, 'pdf', 'fixed-asset-register');
    expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
  });
});
