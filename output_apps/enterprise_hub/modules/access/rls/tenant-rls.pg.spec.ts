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
import { EnableRlsHr1789490000000 } from '../../../migrations/1789490000000-EnableRlsHr';
import { ApiTokensRepository } from '../../public_api/repositories/api-tokens.repository';
import { AccountingRepository } from '../../accounting/repositories/accounting.repository';
import { LedgerReportRepository } from '../../accounting/repositories/ledger-report.repository';
import { AccountingService } from '../../accounting/services/accounting.service';
import { ChartTemplateService } from '../../accounting/services/chart-template.service';
import { ChequesRepository } from '../../cheques/repositories/cheques.repository';
import { HrRepository } from '../../hr/repositories/hr.repository';
import { PostingRulesRepository } from '../../posting_rules/repositories/posting-rules.repository';
import { ChequeDirection, ChequeStatus } from '../../cheques/enums/cheque.enum';
import { AuditRepository } from '../repositories/audit.repository';
import { AuditService } from '../services/audit.service';
import { LedgerAuditService } from '../services/ledger-audit.service';
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
  'hr_employees', 'hr_employment_contracts', 'hr_contract_allowances', 'hr_payroll_runs', 'hr_payslips',
  'fin_posting_role_maps', 'fin_posting_sources',
  'public_api_tokens',
];

const cheque = (n: string) => ({
  direction: ChequeDirection.RECEIVED,
  sayadNumber: null,
  sayadVerified: false,
  sayadRegistrationStatus: 'unknown' as never,
  sayadVerifiedBy: null,
  sayadVerifiedAt: null,
  receiverNationalId: null,
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
        chequeId: a.id, fromStatus: null, toStatus: ChequeStatus.REGISTERED, eventDate: '2026-01-01', journalEntryId: null, amount: null, note: null,
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
          chequeId: row.id, fromStatus: ChequeStatus.REGISTERED, toStatus: ChequeStatus.DEPOSITED, eventDate: '2026-01-02', journalEntryId: null, amount: null, note: null,
        }, m);
      });
      expect((await cheques.findById(T1, row.id))?.status).toBe(ChequeStatus.DEPOSITED);
      await expect(
        cheques.runInTransaction(T2, (m) => cheques.findByIdForUpdate(T2, row.id, m)),
      ).resolves.toBeNull();
    });
  });

  describe('public API tokens', () => {
    const tok = (n: string) => ({
      name: n, tokenPrefix: 'rxk_test', tokenHash: n.padEnd(64, '0'), scopes: ['items:read'],
      rateLimitPerMinute: 60, createdBy: 'u', expiresAt: null,
    });

    it('a tenant sees, finds and revokes only its own tokens', async () => {
      const tokens = new ApiTokensRepository(scope);
      const a = await tokens.create(T1, tok('a'));
      const b = await tokens.create(T2, tok('b'));
      expect((await tokens.list(T1)).map((t) => t.id)).toEqual([a.id]);
      expect((await tokens.list(T2)).map((t) => t.id)).toEqual([b.id]);
      expect(await tokens.findByHash(T2, a.tokenHash)).toBeNull();
      expect(await tokens.revoke(T2, a.id, new Date())).toBe(false);
      expect((await tokens.findByHash(T1, a.tokenHash))?.revokedAt).toBeNull();
    });

    it('a query with no tenant filter is cut off, and a session without a tenant sees nothing', async () => {
      const seen = await scope.run(T2, (m) => m.query(`SELECT tenant_id FROM public_api_tokens`));
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((r: { tenant_id: string }) => r.tenant_id === T2)).toBe(true);
      expect(await app.query(`SELECT 1 FROM public_api_tokens`)).toEqual([]);
    });

    it('cannot write a row for another tenant', async () => {
      await expect(
        scope.run(T1, (m) =>
          m.query(`INSERT INTO public_api_tokens (tenant_id, name, token_prefix, token_hash, scopes, created_by) VALUES ($1, 'x', 'p', repeat('f', 64), ARRAY['items:read'], 'u')`, [T2]),
        ),
      ).rejects.toThrow();
    });
  });

  describe('batch repositories (ledger)', () => {
    const T3 = '33333333-3333-4333-8333-333333333333';
    const entry = (n: string) => ({
      entryNumber: n, date: '2026-04-01', description: 'rls',
      lines: [{ accountCode: '1012', debit: '500.00' }, { accountCode: '3010', credit: '500.00' }],
    });
    let accounting: AccountingService;
    let audit: AuditService;
    let ledger: LedgerReportRepository;

    beforeAll(async () => {
      const repo = new AccountingRepository(scope);
      ledger = new LedgerReportRepository(scope);
      audit = new AuditService(new AuditRepository(scope, app));
      accounting = new AccountingService(repo, { convert: (v: number) => v, round: (v: number) => v } as never, new LedgerAuditService(audit));
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

    it('ledger events are hash-chained: post, reverse, lock and unlock, and verify covers them', async () => {
      const posted = await accounting.createJournalEntry(T1, entry('AUD-1') as never);
      await accounting.reverseJournalEntry(T1, posted.id, { reason: 'test' });
      const lock = await accounting.lockPeriod(T1, '44444444-4444-4444-8444-444444444444', { periodStart: '2026-01-01', periodEnd: '2026-01-31', reason: 'close' } as never);
      await accounting.unlockPeriod(T1, 'someone', lock.id, { reason: 'fix' } as never);
      const rows = await audit.list(T1, { limit: 50 });
      const actions = rows.map((r) => r.action).filter((a) => a.startsWith('ledger.'));
      expect(actions).toEqual(expect.arrayContaining(['ledger.entry.posted', 'ledger.entry.reversed', 'ledger.period.locked', 'ledger.period.unlocked']));
      const verdict = await audit.verify(T1);
      expect(verdict).toMatchObject({ ok: true, ledgerMissing: [] });
      expect(verdict.ledgerEvents).toBeGreaterThanOrEqual(4);
      // the other tenant's chain is separate
      expect((await audit.verify(T2)).ledgerEvents).toBeLessThan(verdict.ledgerEvents);
    });

    it('a post that rolls back leaves no audit row; one that commits leaves exactly one', async () => {
      const before = (await audit.list(T1, { limit: 500 })).length;
      await expect(
        app.transaction(async (foreign) => {
          await accounting.createJournalEntry(T1, entry('AUD-ROLLBACK') as never, foreign);
          throw new Error('abort');
        }),
      ).rejects.toThrow('abort');
      expect((await audit.list(T1, { limit: 500 })).length).toBe(before);
      await accounting.createJournalEntry(T1, entry('AUD-COMMIT') as never);
      const rows = await audit.list(T1, { limit: 500 });
      expect(rows.length).toBe(before + 1);
      expect(rows[0].metadata).toMatchObject({ entryNumber: 'AUD-COMMIT', totalMinor: expect.any(String) });
    });

    it('verify reports a ledger entry that was removed behind the application\'s back', async () => {
      const e = await accounting.createJournalEntry(T1, entry('AUD-TAMPER') as never);
      const runner = owner.createQueryRunner();
      await runner.startTransaction();
      await runner.query(`SET LOCAL session_replication_role = replica`);
      await runner.query(`DELETE FROM fin_journal_entry_lines WHERE journal_entry_id = $1`, [e.id]);
      await runner.query(`DELETE FROM fin_journal_entries WHERE id = $1`, [e.id]);
      await runner.commitTransaction();
      await runner.release();
      const verdict = await audit.verify(T1);
      expect(verdict.ok).toBe(false);
      expect(verdict.ledgerMissing).toHaveLength(1);
    });

    it('a ledger post inside ANOTHER module transaction that never set the tenant still works and stays scoped', async () => {
      await app.transaction(async (foreign) => {
        const [{ n: before }] = await scope.run(T1, (m) => m.query(`SELECT count(*)::int AS n FROM fin_journal_entries`));
        await accounting.createJournalEntry(T1, entry('RLS-FOREIGN') as never, foreign);
        const [{ n }] = await foreign.query(`SELECT count(*)::int AS n FROM fin_journal_entries`);
        expect(n).toBe(before + 1);
      });
    });

    it('an unscoped ledger statement sees nothing and cannot write', async () => {
      expect(await app.query(`SELECT count(*)::int AS n FROM fin_journal_entry_lines`)).toEqual([{ n: 0 }]);
      await expect(app.query(`DELETE FROM fin_chart_of_accounts`)).resolves.toBeDefined();
      expect(await owner.query(`SELECT count(*)::int > 0 AS ok FROM fin_chart_of_accounts`)).toEqual([{ ok: true }]);
    });
  });

  describe('batch repositories (hr)', () => {
    const employee = (n: string) => ({
      employeeNumber: n, firstName: 'a', lastName: 'b', nationalId: `00${n}`, gender: 'male', mobile: '09120000000',
      jobTitle: 'j', department: 'd', maritalStatus: 'single', dependants: 0, status: 'active',
      hireDate: '2026-01-01', createdAt: new Date(), updatedAt: new Date(),
    });
    let hr: HrRepository;
    beforeAll(() => { hr = new HrRepository(scope, app); });

    it('a tenant sees only its own employees through the repository', async () => {
      const a = await hr.createEmployee(T1, employee('E1') as never);
      const b = await hr.createEmployee(T2, employee('E2') as never);
      expect(await hr.findEmployeeById(T1, a.id)).not.toBeNull();
      expect(await hr.findEmployeeById(T2, a.id)).toBeNull();
      expect(await hr.countEmployees(T1)).toBe(1);
      expect(await hr.countEmployees(T2)).toBe(1);
      expect((await hr.findEmployeeById(T2, b.id))?.tenantId).toBe(T2);
    });

    it('roxira_app cannot read another tenant even with an unfiltered query', async () => {
      const seen = await scope.run(T2, (m) => m.query(`SELECT tenant_id FROM hr_employees`));
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((r: { tenant_id: string }) => r.tenant_id === T2)).toBe(true);
      for (const table of ['hr_employees', 'hr_employment_contracts', 'hr_contract_allowances', 'hr_payroll_runs', 'hr_payslips']) {
        expect(await app.query(`SELECT count(*)::int AS n FROM ${table}`)).toEqual([{ n: 0 }]);
      }
    });

    it('a forged tenant_id on an HR row is refused', async () => {
      await expect(
        scope.run(T2, (m) => m.query(`UPDATE hr_employees SET tenant_id = $1 WHERE tenant_id = $2`, [T1, T2])),
      ).rejects.toThrow(/row-level security/);
    });
  });

  describe('batch repositories (posting rules)', () => {
    let posting: PostingRulesRepository;
    beforeAll(() => { posting = new PostingRulesRepository(scope); });

    it('a tenant sees only its own role mappings', async () => {
      await posting.upsertMapping(T1, 'payroll.run', 'bank', '1012');
      await posting.upsertMapping(T2, 'payroll.run', 'bank', '1099');
      expect((await posting.listAllMappings(T1)).map((r) => r.accountCode)).toEqual(['1012']);
      expect((await posting.listAllMappings(T2)).map((r) => r.accountCode)).toEqual(['1099']);
    });

    it('the idempotency key is per tenant: the same source id can be claimed by both', async () => {
      const claim = (tenant: string) => posting.runInTransaction(tenant, (m) => posting.claimSource(tenant, 'payroll_run', '7', 'payroll.run', m));
      expect(await claim(T1)).toBe(true);
      expect(await claim(T1)).toBe(false);
      expect(await claim(T2)).toBe(true);
      expect(await posting.findSource(T1, 'payroll_run', '7', 'payroll.run')).not.toBeNull();
      expect(await app.query(`SELECT count(*)::int AS n FROM fin_posting_sources`)).toEqual([{ n: 0 }]);
    });

    it('a forged tenant_id on a mapping is refused', async () => {
      await expect(
        scope.run(T2, (m) => m.query(`UPDATE fin_posting_role_maps SET tenant_id = $1 WHERE tenant_id = $2`, [T1, T2])),
      ).rejects.toThrow(/row-level security/);
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
      const hrMigration = new EnableRlsHr1789490000000();
      await hrMigration.down(runner);
      expect(await app.query(`SELECT count(*)::int > 0 AS ok FROM hr_employees`)).toEqual([{ ok: true }]);
      await hrMigration.up(runner);
      expect(await app.query(`SELECT count(*)::int AS n FROM hr_employees`)).toEqual([{ n: 0 }]);
      expect(await app.query(`SELECT count(*)::int AS n FROM fin_journal_entries`)).toEqual([{ n: 0 }]);
      await runner.release();
    });
  });
});
