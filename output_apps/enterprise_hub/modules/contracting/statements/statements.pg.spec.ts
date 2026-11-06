/**
 * Progress statements on a REAL PostgreSQL as a non-superuser role: migration with FORCE RLS,
 * numbering under the contract lock, CHECK constraints and tenant isolation.
 * Opt-in: skipped unless ROXIRA_TEST_PG_HOST is set (see parties.pg.spec.ts for the variables).
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { ContractSide } from '../enums/contracting.enum';
import { ContractRepository } from '../repositories/contract.repository';
import { StatementRepository } from '../repositories/statement.repository';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const APP_PW = 'statements-app-test-only';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const options = (database: string, username = OWNER, password = OWNER_PW) => ({
  type: 'postgres' as const,
  host: HOST,
  port: PORT,
  username,
  password,
  database,
  entities: [path.join(__dirname, '../../**/*.entity.ts')],
  migrations: [path.join(__dirname, '../../../migrations/*.ts')],
  migrationsTransactionMode: 'each' as const,
  synchronize: false,
  logging: false,
});

describePg('Progress statements on PostgreSQL (non-superuser, FORCE RLS)', () => {
  const db = `rx_statements_${process.pid}_${Date.now()}`;
  const role = `rx_stm_app_${process.pid}`;
  let admin: DataSource;
  let owner: DataSource;
  let app: DataSource;
  let contracts: ContractRepository;
  let statements: StatementRepository;
  let contractA: number;

  const input = (over: Record<string, unknown> = {}) => ({
    contractId: contractA, number: 1, statementDate: '2026-11-01', cumulativeAmount: '300000000.00', previousAmount: '0.00', periodAmount: '300000000.00', ...over,
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
    contracts = new ContractRepository(scope);
    statements = new StatementRepository(scope);
    contractA = (await contracts.create(A, { code: 'K1', title: 'قرارداد', side: ContractSide.CONTRACTOR, partyCode: 'C1', projectId: null, contractDate: '2026-11-01', amount: '1000000000.00', advanceAmount: '0.00', insuranceType: null } as never)).id;
  }, 240_000);

  afterAll(async () => {
    await app?.destroy();
    await owner?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin?.query(`DROP ROLE IF EXISTS ${role}`);
    await admin?.destroy();
  });

  it('erp_progress_statements has ENABLE + FORCE RLS with one policy', async () => {
    const [row] = await owner.query(
      `SELECT c.relrowsecurity, c.relforcerowsecurity, (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::int AS policies
         FROM pg_class c WHERE c.relname = 'erp_progress_statements'`,
    );
    expect(row).toEqual({ relrowsecurity: true, relforcerowsecurity: true, policies: 1 });
  });

  it('numbers 1 then 2 under the contract lock and reads them back in order', async () => {
    await statements.runInTransaction(A, async (m) => {
      await statements.lockContract(A, contractA, m);
      expect(await statements.findLast(A, contractA, m)).toBeNull();
      await statements.insert(A, input(), m);
    });
    await statements.runInTransaction(A, async (m) => {
      await statements.lockContract(A, contractA, m);
      const last = await statements.findLast(A, contractA, m);
      expect(last!.number).toBe(1);
      await statements.insert(A, input({ number: 2, statementDate: '2026-12-01', cumulativeAmount: '700000000.00', previousAmount: '300000000.00', periodAmount: '400000000.00' }), m);
    });
    const list = await statements.listByContract(A, contractA);
    expect(list.map((s) => [s.number, s.periodAmount, s.status])).toEqual([[1, '300000000.00', 'draft'], [2, '400000000.00', 'draft']]);
  });

  it('draft -> approved -> posted once; a second approve or a delete after approval finds nothing', async () => {
    const [first] = await statements.listByContract(A, contractA);
    expect((await statements.approveWith(A, first.id, { retentionAmount: '30000000.00', insuranceAmount: '0.00', advanceRecoveryAmount: '0.00', termsSnapshot: [] }))!.status).toBe('approved');
    expect(await statements.approveWith(A, first.id, { retentionAmount: '30000000.00', insuranceAmount: '0.00', advanceRecoveryAmount: '0.00', termsSnapshot: [] })).toBeNull();
    expect(await statements.deleteDraft(A, first.id)).toBe(false);
    expect((await statements.markPosted(A, first.id, { journalEntryId: 9, journalEntryNumber: 'E-9' }))!.status).toBe('posted');
    expect(await statements.markPosted(A, first.id, { journalEntryId: 10, journalEntryNumber: 'E-10' })).toBeNull();
  });

  it('tenant B cannot see them, and the app role with no scope reads nothing', async () => {
    expect(await statements.listByContract(B, contractA)).toEqual([]);
    const [first] = await statements.listByContract(A, contractA);
    expect(await statements.findById(B, first.id)).toBeNull();
    expect(await app.query(`SELECT 1 FROM erp_progress_statements`)).toEqual([]);
  });

  it('refuses another tenant on the composite key, wrong period math, deductions above the period, duplicate numbers', async () => {
    await expect(statements.insert(B, input({ number: 9 }))).rejects.toThrow(/FK_erp_progress_statements_contract/);
    await expect(statements.insert(A, input({ number: 3, periodAmount: '1.00' }))).rejects.toThrow(/CHK_erp_progress_statements_period/);
    await expect(statements.insert(A, input({ number: 1 }))).rejects.toMatchObject({ code: '23505' });
    await expect(
      app.transaction(async (m) => {
        await TenantScope.bind(m, A);
        await m.query(`UPDATE erp_progress_statements SET retention_amount = 300000001 WHERE number = 1`);
      }),
    ).rejects.toThrow(/CHK_erp_progress_statements_deductions/);
  });
});
