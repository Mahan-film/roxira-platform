/**
 * Contract movements on a REAL PostgreSQL as a non-superuser role: migration with FORCE RLS,
 * retention held, sums, request-key uniqueness, CHECK constraints and tenant isolation.
 * Opt-in: skipped unless ROXIRA_TEST_PG_HOST is set (see parties.pg.spec.ts for the variables).
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { ContractSide } from '../enums/contracting.enum';
import { ContractRepository } from '../repositories/contract.repository';
import { ProjectRepository } from '../repositories/project.repository';
import { MovementRepository } from '../repositories/movement.repository';
import { StatementRepository } from '../repositories/statement.repository';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const APP_PW = 'movements-app-test-only';
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

describePg('Contract movements on PostgreSQL (non-superuser, FORCE RLS)', () => {
  const db = `rx_movements_${process.pid}_${Date.now()}`;
  const role = `rx_mov_app_${process.pid}`;
  let admin: DataSource;
  let owner: DataSource;
  let app: DataSource;
  let contracts: ContractRepository;
  let statements: StatementRepository;
  let movements: MovementRepository;
  let projects: ProjectRepository;
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
    movements = new MovementRepository(scope);
    projects = new ProjectRepository(scope);
    contractA = (await contracts.create(A, { code: 'K1', title: 'قرارداد', side: ContractSide.CONTRACTOR, partyCode: 'C1', projectId: null, contractDate: '2026-11-01', amount: '1000000000.00', advanceAmount: '0.00', insuranceType: null } as never)).id;
  }, 240_000);

  afterAll(async () => {
    await app?.destroy();
    await owner?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin?.query(`DROP ROLE IF EXISTS ${role}`);
    await admin?.destroy();
  });

  const mv = (over: Record<string, unknown> = {}) => ({ contractId: contractA, kind: 'advance', movementDate: '2026-11-01', amount: '100000000.00', requestKey: null, termsSnapshot: [], ...over }) as never;
  const inTx = <T>(tenant: string, work: (m: import('typeorm').EntityManager) => Promise<T>) => movements.runInTransaction(tenant, work);

  it('erp_contract_movements has ENABLE + FORCE RLS with one policy', async () => {
    const [row] = await owner.query(
      `SELECT c.relrowsecurity, c.relforcerowsecurity, (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::int AS policies
         FROM pg_class c WHERE c.relname = 'erp_contract_movements'`,
    );
    expect(row).toEqual({ relrowsecurity: true, relforcerowsecurity: true, policies: 1 });
  });

  it('sums advances and releases separately, exactly', async () => {
    await inTx(A, async (m) => {
      await movements.insert(A, mv({ amount: '100000000.00' }), m);
      await movements.insert(A, mv({ amount: '50000000.25' }), m);
      await movements.insert(A, mv({ kind: 'retention_release', amount: '10000000.00' }), m);
    });
    await inTx(A, async (m) => {
      expect(await movements.sum(A, contractA, 'advance', m)).toBe(15000000025n);
      expect(await movements.sum(A, contractA, 'retention_release', m)).toBe(1000000000n);
    });
  });

  it('retention held counts only POSTED statements: 40,000,000 + 30,000,000 = 70,000,000', async () => {
    await statements.insert(A, { contractId: contractA, number: 1, statementDate: '2026-11-01', cumulativeAmount: '400000000.00', previousAmount: '0.00', periodAmount: '400000000.00' } as never);
    await statements.insert(A, { contractId: contractA, number: 2, statementDate: '2026-12-01', cumulativeAmount: '700000000.00', previousAmount: '400000000.00', periodAmount: '300000000.00' } as never);
    const [one, two] = await statements.listByContract(A, contractA);
    const d = (r: string) => ({ retentionAmount: r, insuranceAmount: '0.00', advanceRecoveryAmount: '0.00', termsSnapshot: [] });
    await statements.approveWith(A, one.id, d('40000000.00'));
    await statements.approveWith(A, two.id, d('30000000.00'));
    await statements.markPosted(A, one.id, { journalEntryId: 1, journalEntryNumber: 'E-1' });
    await inTx(A, async (m) => expect(await movements.retentionHeld(A, contractA, m)).toBe(4000000000n));
    await statements.markPosted(A, two.id, { journalEntryId: 2, journalEntryNumber: 'E-2' });
    await inTx(A, async (m) => {
      expect(await movements.retentionHeld(A, contractA, m)).toBe(7000000000n);
      expect(await statements.recoveredBefore(A, contractA, 3, m)).toBe(0n);
    });
  });

  it('a request key is unique per contract and kind; without a key repeats are allowed', async () => {
    await inTx(A, async (m) => { await movements.insert(A, mv({ requestKey: 'k1' }), m); });
    await expect(inTx(A, (m) => movements.insert(A, mv({ requestKey: 'k1' }), m))).rejects.toMatchObject({ code: '23505' });
    await inTx(A, async (m) => {
      await movements.insert(A, mv({ kind: 'retention_release', requestKey: 'k1', amount: '1.00' }), m);
      expect((await movements.findByKey(A, contractA, 'advance', 'k1', m))!.kind).toBe('advance');
    });
  });

  it('tenant B sees nothing, cannot attach to A, and a zero amount is refused', async () => {
    expect(await movements.list(B, contractA)).toEqual([]);
    await expect(inTx(B, (m) => movements.insert(B, mv(), m))).rejects.toThrow(/FK_erp_contract_movements_contract/);
    await expect(inTx(A, (m) => movements.insert(A, mv({ amount: '0.00' }), m))).rejects.toThrow(/CHK_erp_contract_movements_amount/);
    expect(await app.query(`SELECT 1 FROM erp_contract_movements`)).toEqual([]);
  });

  it('posted statement totals per project split billed (contractor) and subcontracts (employer), within a date range', async () => {
    const p = await projects.create(A, { code: 'PX', name: 'پروژه', budget: '1000000000.00' });
    const mk = (code: string, side: ContractSide) => contracts.create(A, { code, title: 't', side, partyCode: 'X', projectId: p.id, contractDate: '2026-11-01', amount: '1000000000.00', advanceAmount: '0.00', insuranceType: null } as never);
    const sale = await mk('PXS', ContractSide.CONTRACTOR);
    const sub = await mk('PXB', ContractSide.EMPLOYER);
    const post = async (contractId: number, number: number, date: string, cum: string, prev: string, period: string, posted = true) => {
      const st = await statements.insert(A, { contractId, number, statementDate: date, cumulativeAmount: cum, previousAmount: prev, periodAmount: period } as never);
      if (posted) {
        await statements.approveWith(A, st.id, { retentionAmount: '0.00', insuranceAmount: '0.00', advanceRecoveryAmount: '0.00', termsSnapshot: [] });
        await statements.markPosted(A, st.id, { journalEntryId: 1, journalEntryNumber: 'E' });
      }
    };
    await post(sale.id, 1, '2026-11-01', '300000000.00', '0.00', '300000000.00');
    await post(sale.id, 2, '2026-12-01', '800000000.00', '300000000.00', '500000000.00');
    await post(sale.id, 3, '2026-12-05', '900000000.00', '800000000.00', '100000000.00', false); // draft: ignored
    await post(sub.id, 1, '2026-11-10', '120000000.00', '0.00', '120000000.00');
    expect(await statements.postedTotalsByProject(A, {})).toEqual(new Map([[p.id, { billed: 80000000000n, subcontracts: 12000000000n }]]));
    expect(await statements.postedTotalsByProject(A, { to: '2026-11-30' })).toEqual(new Map([[p.id, { billed: 30000000000n, subcontracts: 12000000000n }]]));
    expect((await statements.postedTotalsByProject(B, {})).size).toBe(0);
  });
});
