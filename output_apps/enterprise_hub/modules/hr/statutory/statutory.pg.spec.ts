/**
 * Statutory store against a REAL PostgreSQL: seed, row-level security, append-only versions.
 * Skipped unless ROXIRA_TEST_PG_HOST is set; each run creates and drops its own database.
 *
 *   ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55441 npx jest modules/hr/statutory/statutory.pg.spec.ts
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { AuditService } from '../../access/services/audit.service';
import { StatutoryRepository } from './statutory.repository';
import { StatutoryService } from './statutory.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const USER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const APP_ROLE = 'statutory_app';

const options = (database: string) => ({
  type: 'postgres' as const,
  host: HOST,
  port: PORT,
  username: USER,
  database,
  entities: [path.join(__dirname, '../../**/*.entity.ts')],
  migrations: [path.join(__dirname, '../../../migrations/*.ts')],
  migrationsTransactionMode: 'each' as const,
  synchronize: false,
  logging: false,
});

describePg('statutory parameters on PostgreSQL', () => {
  const db = `statutory_${process.pid}`;
  let admin: DataSource;
  let ds: DataSource;
  let service: StatutoryService;
  const audit = { record: jest.fn(async () => undefined) };

  beforeAll(async () => {
    admin = await new DataSource({ ...options('postgres'), entities: [], migrations: [] }).initialize();
    await admin.query(`CREATE DATABASE "${db}"`);
    await admin.query(`DROP ROLE IF EXISTS ${APP_ROLE}`);
    await admin.query(`CREATE ROLE ${APP_ROLE} LOGIN NOSUPERUSER`);
    const owner = await new DataSource(options(db)).initialize();
    await owner.runMigrations();
    await owner.query(`GRANT SELECT, INSERT ON statutory_parameters TO ${APP_ROLE}`);
    await owner.query(`GRANT USAGE ON SEQUENCE statutory_parameters_id_seq TO ${APP_ROLE}`);
    await owner.destroy();
    ds = await new DataSource({ ...options(db), username: APP_ROLE }).initialize();
    service = new StatutoryService(
      new StatutoryRepository(new TenantScope(ds)),
      audit as unknown as AuditService,
    );
  }, 180_000);

  afterAll(async () => {
    await ds?.destroy();
    await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin.query(`DROP ROLE IF EXISTS ${APP_ROLE}`);
    await admin.destroy();
  });

  const input = {
    fiscalYear: 1405,
    key: 'housing_allowance',
    value: 31_000_000,
    source: 'مصوبه تست',
    verified: true,
  };

  it('reads the seed with official values verified', async () => {
    const rates = await service.ratesFor(T1, 1405);
    expect(rates.minDailyWage).toBe(5_541_850);
    expect(rates.seniorityPerYear).toBe(5_000_010);
    expect(rates.unverifiedKeys).toContain('housing_allowance');
    expect(rates.unverifiedKeys).not.toContain('min_daily_wage');
  });

  it('seeds sanavat terms as platform defaults and lets a tenant override them by date', async () => {
    const base = await service.settlementTermsOn(T1, '2026-12-31');
    expect([base.daysPerYear, base.yearDays, base.monthDays]).toEqual([30, 365, 30]);
    expect(base.parameters.every((p) => !p.tenantOverride && !p.verified)).toBe(true);
    await service.setValue(T1, 'u1', {
      fiscalYear: 1405, key: 'sanavat_year_days', value: 360,
      effectiveFrom: '2026-09-23', source: 'تأیید حسابدار', verified: true,
    });
    expect((await service.settlementTermsOn(T1, '2026-09-22')).yearDays).toBe(365);
    expect((await service.settlementTermsOn(T1, '2026-12-31')).yearDays).toBe(360);
    expect((await service.settlementTermsOn(T2, '2026-12-31')).yearDays).toBe(365);
    // A later fiscal year with no rows of its own inherits the last one in force.
    expect((await service.settlementTermsOn(T2, '2027-06-01')).daysPerYear).toBe(30);
  });

  it('a tenant edit stays with that tenant and versions up', async () => {
    await service.setValue(T1, 'u1', input);
    await service.setValue(T1, 'u1', { ...input, value: 32_000_000 });
    expect((await service.ratesFor(T1, 1405)).housingAllowance).toBe(32_000_000);
    expect((await service.ratesFor(T2, 1405)).housingAllowance).toBe(30_000_000);
    const history = await service.history(T1, 1405, 'housing_allowance');
    expect(history.map((r) => r.version)).toEqual([2, 1, 1]);
  });

  it('RLS hides another tenant and refuses forged or global inserts', async () => {
    const scope = new TenantScope(ds);
    const seen = await scope.run(T2, (m) =>
      m.query(`SELECT count(*)::int AS n FROM statutory_parameters WHERE tenant_id IS NOT NULL`),
    );
    expect(seen[0].n).toBe(0);
    const insert = (tenant: string | null) =>
      scope.run(T2, (m) =>
        m.query(
          `INSERT INTO statutory_parameters (tenant_id, country, fiscal_year, param_key, effective_from, value, source, source_kind, created_by)
           VALUES ($1, 'IR', 1405, 'housing_allowance', '2026-03-21', '1', 'x', 'TENANT', 'x')`,
          [tenant],
        ),
      );
    await expect(insert(T1)).rejects.toThrow(/row-level security/);
    await expect(insert(null)).rejects.toThrow(/row-level security/);
  });

  it('rows cannot be changed or deleted, even by the table owner', async () => {
    const owner = await new DataSource(options(db)).initialize();
    await expect(owner.query(`UPDATE statutory_parameters SET verified = true`)).rejects.toThrow(/append-only/);
    await expect(owner.query(`DELETE FROM statutory_parameters`)).rejects.toThrow(/append-only/);
    await owner.destroy();
  });
});
