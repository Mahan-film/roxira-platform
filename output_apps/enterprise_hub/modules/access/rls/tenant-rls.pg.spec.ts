/**
 * Tenant isolation as the production backend sees it: a non-superuser role (`roxira_app`) behind
 * PgBouncer in transaction mode, tables owned by another role, FORCE row-level security.
 * Skipped unless ROXIRA_TEST_PG_HOST is set. Run it with test/rls/run-rls-e2e.sh, which starts
 * PostgreSQL and PgBouncer in Docker and sets:
 *   ROXIRA_TEST_PG_HOST/PORT/USER/PASSWORD  direct connection, owner (migrations, seeding)
 *   ROXIRA_TEST_PGB_HOST/PORT               PgBouncer, used with roxira_app
 *
 * Add every table an RLS batch covers to RLS_TABLES and a repository case to "batch repositories".
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { EnableRlsCheques1789430000000 } from '../../../migrations/1789430000000-EnableRlsCheques';
import { EnableRlsLedger1789440000000 } from '../../../migrations/1789440000000-EnableRlsLedger';
import { AccountingRepository } from '../../accounting/repositories/accounting.repository';
import { LedgerReportRepository } from '../../accounting/repositories/ledger-report.repository';
import { AccountingService } from '../../accounting/services/accounting.service';
import { ChartTemplateService } from '../../accounting/services/chart-template.service';
import { ChequesRepository } from '../../cheques/repositories/cheques.repository';
import { ChequeDirection, ChequeStatus } from '../../cheques/enums/cheque.enum';
import { TenantScope } from '../services/tenant-scope';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const PGB_HOST = process.env.ROXIRA_TEST_PGB_HOST ?? HOST;
const PGB_PORT = Number(process.env.ROXIRA_TEST_PGB_PORT ?? PORT);
const APP_PW = 'app-role-test-only';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

/** Tables whose FORCE RLS is part of the rollout so far (tenant column is always tenant_id). */
const RLS_TABLES = [
  'fin_cheques', 'fin_cheque_events',
  'fin_chart_of_accounts', 'fin_journal_entries', 'fin_journal_entry_lines', 'fin_period_locks', 'fin_balance_reconciliation_log',
];

const cheque = (n: string) => ({
  direction: ChequeDirection.RECEIVED,
  sayadNumber: null,
  sayadVerified: false,
  chequeNumber: n,
  bankName: null,
  amount: '1000.00',
  issueDate: '2026-01-01',
  dueDate: '2026-02-01',
  partyName: 'p',
  partyCode: null,
  description: null,
});

const options = (database: string, username = OWNER, password = OWNER_PW, host = HOST, port = PORT) => ({
  type: 'postgres' as const,
  host,
  port,
  username,
  password,
  database,
  entities: [path.join(__dirname, '../../**/*.entity.ts')],
  migrations: [path.join(__dirname, '../../../migrations/*.ts')],
  migrationsTransactionMode: 'each' as const,
  synchronize: false,
  logging: false,
});

describePg('tenant RLS as roxira_app through PgBouncer (transaction mode)', () => {
  const db = `rls_${process.pid}`;
  let admin: DataSource;
  let owner: DataSource;
  let app: DataSource;
  let scope: TenantScope;
  let cheques: ChequesRepository;

  beforeAll(async () => {
    admin = await new DataSource({ ...options('postgres'), entities: [], migrations: [] }).initialize();
    await admin.query(`CREATE DATABASE "${db}"`);
    await admin.query(`DROP ROLE IF EXISTS roxira_app`);
    await admin.query(`CREATE ROLE roxira_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${APP_PW}'`);
    owner = await new DataSource(options(db)).initialize();
    await owner.runMigrations();
    await owner.query(`GRANT CONNECT ON DATABASE "${db}" TO roxira_app`);
    await owner.query(`GRANT USAGE ON SCHEMA public TO roxira_app`);
    await owner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO roxira_app`);
    await owner.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO roxira_app`);
    app = await new DataSource({
      ...options(db, 'roxira_app', APP_PW, PGB_HOST, PGB_PORT),
      extra: { max: 8 },
    }).initialize();
    scope = new TenantScope(app);
    cheques = new ChequesRepository(scope);
  }, 240_000);

  afterAll(async () => {
    await app?.destroy();
    await owner?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin?.query(`DROP ROLE IF EXISTS roxira_app`);
    await admin?.destroy();
  });

  it('is really a non-superuser without BYPASSRLS, on the pooled connection', async () => {
    const [r] = await app.query(
      `SELECT current_user AS u, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user`,
    );
    expect(r).toMatchObject({ u: 'roxira_app', rolsuper: false, rolbypassrls: false });
  });

  it('every covered table has ENABLE + FORCE RLS and a tenant policy', async () => {
    const rows = await owner.query(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
              (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::int AS policies
         FROM pg_class c WHERE c.relname = ANY($1)`,
      [RLS_TABLES],
    );
    expect(rows).toHaveLength(RLS_TABLES.length);
    for (const row of rows) {
      expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
      expect(row.policies).toBeGreaterThanOrEqual(1);
    }
  });

  describe('batch repositories (cheques)', () => {
    it('a tenant sees only its own rows through the repository', async () => {
      const a = await cheques.create(T1, cheque('A-1'));
      const b = await cheques.create(T2, cheque('B-1'));
      expect((await cheques.list(T1)).map((c) => c.id)).toEqual([a.id]);
      expect((await cheques.list(T2)).map((c) => c.id)).toEqual([b.id]);
      expect(await cheques.findById(T2, a.id)).toBeNull();
      await cheques.addEvent(T1, {
        chequeId: a.id, fromStatus: null, toStatus: ChequeStatus.REGISTERED, eventDate: '2026-01-01', journalEntryId: null, note: null,
      });
      expect(await cheques.listEvents(T2, a.id)).toEqual([]);
      expect(await cheques.listEvents(T1, a.id)).toHaveLength(1);
    });

    it('a repository bug cannot cross tenants: even a query with no tenant filter is cut off', async () => {
      const seen = await scope.run(T2, (m) => m.query(`SELECT tenant_id FROM fin_cheques`));
      expect(seen.every((r: { tenant_id: string }) => r.tenant_id === T2)).toBe(true);
      expect(seen.length).toBeGreaterThan(0);
    });

    it('the transaction path keeps the tenant for row-locked moves', async () => {
      const row = await cheques.create(T1, cheque('A-2'));
      await cheques.runInTransaction(T1, async (m) => {
        expect(await cheques.findByIdForUpdate(T1, row.id, m)).not.toBeNull();
        await cheques.updateStatus(T1, row.id, { status: ChequeStatus.DEPOSITED }, m);
        await cheques.addEvent(T1, {
          chequeId: row.id, fromStatus: ChequeStatus.REGISTERED, toStatus: ChequeStatus.DEPOSITED, eventDate: '2026-01-02', journalEntryId: null, note: null,
        }, m);
      });
      expect((await cheques.findById(T1, row.id))?.status).toBe(ChequeStatus.DEPOSITED);
      await expect(
        cheques.runInTransaction(T2, (m) => cheques.findByIdForUpdate(T2, row.id, m)),
      ).resolves.toBeNull();
    });
  });

  describe('batch repositories (ledger)', () => {
    const T3 = '33333333-3333-4333-8333-333333333333';
    const entry = (n: string) => ({
      entryNumber: n, date: '2026-04-01', description: 'rls',
      lines: [{ accountCode: '1012', debit: '500.00' }, { accountCode: '3010', credit: '500.00' }],
    });
    let accounting: AccountingService;
    let ledger: LedgerReportRepository;

    beforeAll(async () => {
      const repo = new AccountingRepository(scope);
      ledger = new LedgerReportRepository(scope);
      accounting = new AccountingService(repo, { convert: (v: number) => v, round: (v: number) => v } as never);
      for (const t of [T1, T2]) await new ChartTemplateService(repo).apply(t, 'iran-trading');
    }, 60_000);

    it('each tenant has its own chart and entries, and cannot read the other', async () => {
      const a = await accounting.createJournalEntry(T1, entry('RLS-A') as never);
      await accounting.createJournalEntry(T2, entry('RLS-B') as never);
      expect((await accounting.findAllJournalEntries(T1, { page: 1, limit: 50 } as never)).data.map((e) => e.entryNumber)).toEqual(['RLS-A']);
      await expect(accounting.findOneJournalEntry(T2, a.id)).rejects.toThrow();
      expect(await ledger.firstEntryDay(T3)).toBeNull();
      expect(await ledger.firstEntryDay(T1)).toBe('2026-04-01');
    });

    it('a ledger post inside ANOTHER module transaction that never set the tenant still works and stays scoped', async () => {
      await app.transaction(async (foreign) => {
        await accounting.createJournalEntry(T1, entry('RLS-FOREIGN') as never, foreign);
        const [{ n }] = await foreign.query(`SELECT count(*)::int AS n FROM fin_journal_entries`);
        expect(n).toBe(2);
      });
    });

    it('an unscoped ledger statement sees nothing and cannot write', async () => {
      expect(await app.query(`SELECT count(*)::int AS n FROM fin_journal_entry_lines`)).toEqual([{ n: 0 }]);
      await expect(app.query(`DELETE FROM fin_chart_of_accounts`)).resolves.toBeDefined();
      expect(await owner.query(`SELECT count(*)::int > 0 AS ok FROM fin_chart_of_accounts`)).toEqual([{ ok: true }]);
    });
  });

  describe('isolation properties', () => {
    it('no tenant set means no rows and no writes', async () => {
      expect(await app.query(`SELECT count(*)::int AS n FROM fin_cheques`)).toEqual([{ n: 0 }]);
      await expect(
        app.query(`INSERT INTO fin_cheques (tenant_id, direction, cheque_number, amount, issue_date, due_date, party_name)
                   VALUES ($1, 'received', 'x', 1, '2026-01-01', '2026-01-02', 'p')`, [T1]),
      ).rejects.toThrow(/row-level security/);
      const [{ n }] = await owner.query(`SELECT count(*)::int AS n FROM fin_cheques`);
      expect(n).toBeGreaterThan(0);
    });

    it('a forged tenant_id on insert or update is refused', async () => {
      await expect(
        scope.run(T2, (m) =>
          m.query(`INSERT INTO fin_cheques (tenant_id, direction, cheque_number, amount, issue_date, due_date, party_name)
                   VALUES ($1, 'received', 'x', 1, '2026-01-01', '2026-01-02', 'p')`, [T1]),
        ),
      ).rejects.toThrow(/row-level security/);
      await expect(
        scope.run(T2, (m) => m.query(`UPDATE fin_cheques SET tenant_id = $1 WHERE tenant_id = $2`, [T1, T2])),
      ).rejects.toThrow(/row-level security/);
    });

    it('the tenant setting does not leak between pooled clients (concurrent scoped work)', async () => {
      await cheques.create(T1, cheque('L-1'));
      await cheques.create(T2, cheque('L-2'));
      const work = Array.from({ length: 60 }, (_, i) => {
        const t = i % 2 ? T1 : T2;
        return scope
          .run(t, async (m) => {
            await m.query(`SELECT pg_sleep(0.01)`);
            return m.query(`SELECT DISTINCT tenant_id FROM fin_cheques`);
          })
          .then((rows: { tenant_id: string }[]) => ({ t, rows }));
      });
      for (const { t, rows } of await Promise.all(work)) {
        expect(rows.map((r) => r.tenant_id)).toEqual([t]);
      }
      // and nothing is left on the server connection afterwards
      for (let i = 0; i < 20; i++) {
        const [{ t }] = await app.query(`SELECT nullif(current_setting('app.tenant_id', true), '') AS t`);
        expect(t).toBeNull();
      }
    });

    it('a rolled-back scoped transaction leaves no tenant behind', async () => {
      await expect(scope.run(T1, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
      const [{ t }] = await app.query(`SELECT nullif(current_setting('app.tenant_id', true), '') AS t`);
      expect(t).toBeNull();
    });
  });

  describe('migration is reversible', () => {
    it('down() switches RLS off and up() restores it', async () => {
      const runner = owner.createQueryRunner();
      const migration = new EnableRlsCheques1789430000000();
      await migration.down(runner);
      const off = await owner.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'fin_cheques'`);
      expect(off).toEqual([{ relrowsecurity: false, relforcerowsecurity: false }]);
      expect(await app.query(`SELECT count(*)::int AS n FROM fin_cheques`)).not.toEqual([{ n: 0 }]);
      await migration.up(runner);
      expect(await app.query(`SELECT count(*)::int AS n FROM fin_cheques`)).toEqual([{ n: 0 }]);
      const ledgerMigration = new EnableRlsLedger1789440000000();
      await ledgerMigration.down(runner);
      expect(await app.query(`SELECT count(*)::int > 0 AS ok FROM fin_journal_entries`)).toEqual([{ ok: true }]);
      await ledgerMigration.up(runner);
      expect(await app.query(`SELECT count(*)::int AS n FROM fin_journal_entries`)).toEqual([{ n: 0 }]);
      await runner.release();
    });
  });
});
