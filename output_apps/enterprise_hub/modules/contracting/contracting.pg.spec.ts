/**
 * Contracting tables on a REAL PostgreSQL as a non-superuser role: migration with FORCE RLS,
 * repositories, composite project key, CHECK constraints and tenant isolation.
 * Opt-in: skipped unless ROXIRA_TEST_PG_HOST is set (see parties.pg.spec.ts for the variables).
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { fromDb } from '../accounting/money';
import { ContractSide } from './enums/contracting.enum';
import { ContractRepository } from './repositories/contract.repository';
import { ProjectRepository } from './repositories/project.repository';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const APP_PW = 'contracting-app-test-only';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const options = (database: string, username = OWNER, password = OWNER_PW) => ({
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

describePg('Contracting on PostgreSQL (non-superuser, FORCE RLS)', () => {
  const db = `rx_contracting_${process.pid}_${Date.now()}`;
  const role = `rx_con_app_${process.pid}`;
  let admin: DataSource;
  let owner: DataSource;
  let app: DataSource;
  let projects: ProjectRepository;
  let contracts: ContractRepository;
  let projectA: number;

  const contract = (over: Record<string, unknown> = {}) => ({
    code: 'K1', title: 'قرارداد', side: ContractSide.EMPLOYER, partyCode: 'S1', projectId: projectA,
    contractDate: '2026-11-01', amount: '500000000.00', advanceAmount: '100000000.00', insuranceType: null, ...over,
  }) as never;

  beforeAll(async () => {
    admin = await new DataSource({ ...options('postgres'), entities: [], migrations: [] }).initialize();
    await admin.query(`CREATE DATABASE "${db}"`);
    await admin.query(`DROP ROLE IF EXISTS ${role}`);
    await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${APP_PW}'`);
    owner = await new DataSource(options(db)).initialize();
    await owner.runMigrations();
    await owner.query(`GRANT CONNECT ON DATABASE "${db}" TO ${role}`);
    await owner.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await owner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
    await owner.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
    app = await new DataSource({ ...options(db, role, APP_PW), extra: { max: 8 } }).initialize();
    const scope = new TenantScope(app);
    projects = new ProjectRepository(scope);
    contracts = new ContractRepository(scope);
    projectA = (await projects.create(A, { code: 'P1', name: 'پروژه الف', budget: '1000000000.00' })).id;
  }, 240_000);

  afterAll(async () => {
    await app?.destroy();
    await owner?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin?.query(`DROP ROLE IF EXISTS ${role}`);
    await admin?.destroy();
  });

  it('both tables have ENABLE + FORCE RLS with one policy', async () => {
    const rows = await owner.query(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
              (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::int AS policies
         FROM pg_class c WHERE c.relname IN ('erp_projects','erp_contracts') ORDER BY c.relname`,
    );
    expect(rows).toEqual([
      { relname: 'erp_contracts', relrowsecurity: true, relforcerowsecurity: true, policies: 1 },
      { relname: 'erp_projects', relrowsecurity: true, relforcerowsecurity: true, policies: 1 },
    ]);
  });

  it('stores money exactly and reads it back', async () => {
    const k = await contracts.create(A, contract({ amount: '1234567890123.45', advanceAmount: '0.00', code: 'BIG' }));
    expect(fromDb((await contracts.findById(A, k.id))!.amount)).toBe(123456789012345n);
    const p = await projects.findById(A, projectA);
    expect(fromDb(p!.budget)).toBe(100000000000n);
  });

  it('tenant B sees nothing of tenant A, and the same code is allowed in B', async () => {
    const k = await contracts.create(A, contract());
    expect((await contracts.list(B, { limit: 50, offset: 0 })).total).toBe(0);
    expect((await projects.list(B, { limit: 50, offset: 0 })).total).toBe(0);
    expect(await contracts.findById(B, k.id)).toBeNull();
    expect(await projects.findById(B, projectA)).toBeNull();
    const own = await contracts.create(B, contract({ projectId: null }));
    expect(own.code).toBe('K1');
    expect((await contracts.list(A, { limit: 50, offset: 0 })).rows.map((r) => r.tenantId)).toEqual([A, A]);
  });

  it('with no tenant scope the app role reads zero rows', async () => {
    expect(await app.query(`SELECT 1 FROM erp_contracts`)).toEqual([]);
    expect(await app.query(`SELECT 1 FROM erp_projects`)).toEqual([]);
  });

  it('a contract of tenant B cannot point at the project of tenant A', async () => {
    await expect(contracts.create(B, contract({ code: 'X9', projectId: projectA }))).rejects.toThrow(/FK_erp_contracts_project/);
  });

  it('CHECK constraints refuse a zero amount and an advance above the amount; duplicates raise 23505', async () => {
    await expect(contracts.create(A, contract({ code: 'Z0', amount: '0.00', advanceAmount: '0.00' }))).rejects.toThrow(/CHK_erp_contracts_amount/);
    await expect(contracts.create(A, contract({ code: 'Z1', amount: '500.00', advanceAmount: '600.00' }))).rejects.toThrow(/CHK_erp_contracts_advance/);
    await expect(contracts.create(A, contract())).rejects.toMatchObject({ code: '23505' });
  });
});
