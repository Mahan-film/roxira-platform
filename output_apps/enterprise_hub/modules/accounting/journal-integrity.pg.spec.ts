/**
 * T178 Journal Integrity & Period States on REAL PostgreSQL as roxira_app (NOSUPERUSER NOBYPASSRLS).
 *
 * Opt-in like all *.pg.spec.ts: skipped unless ROXIRA_TEST_PG_HOST is set.
 *   ROXIRA_TEST_PG_HOST=/tmp/rxpg npx jest modules/accounting/journal-integrity.pg.spec.ts
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { CalendarService } from '../calendar';
import { CurrencyService } from '../currency/services/currency.service';
import { AccountingPeriodState, JournalEntryStatus } from './enums/accounting.enum';
import { AccountingRepository } from './repositories/accounting.repository';
import { AccountingPeriodService } from './services/accounting-period.service';
import { AccountingService } from './services/accounting.service';
import { JournalSequencerService } from './services/journal-sequencer.service';
import { MasterDataChangeLogService } from './services/master-data-change-log.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const ADMIN_USER = process.env.ROXIRA_TEST_PG_ADMIN_USER ?? 'postgres';
const USER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const PASSWORD = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const APP_ROLE = `roxira_app_ji_${process.pid}`;
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
  const ds = new DataSource({ ...options('postgres', ADMIN_USER, PASSWORD), entities: [], migrations: [] });
  await ds.initialize();
  try {
    await ds.query(sql);
  } finally {
    await ds.destroy();
  }
};

describePg('T178 Journal Integrity & Period States on PostgreSQL (roxira_app, FORCE RLS)', () => {
  const dbName = `rx_ji_${process.pid}_${Date.now()}`;
  let ds: DataSource;
  let app: DataSource;
  let scope: TenantScope;
  let accounting: AccountingService;
  let sequencer: JournalSequencerService;
  let periods: AccountingPeriodService;
  let changeLogs: MasterDataChangeLogService;

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

    app = new DataSource(options(dbName, APP_ROLE, APP_PW));
    await app.initialize();
    scope = new TenantScope(app);
    sequencer = new JournalSequencerService(scope);
    periods = new AccountingPeriodService(scope, new CalendarService());
    changeLogs = new MasterDataChangeLogService(scope);
    const repo = new AccountingRepository(scope);
    const currency = { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService;
    accounting = new AccountingService(repo, currency, undefined, undefined, sequencer, periods);
  });

  afterAll(async () => {
    await app?.destroy();
    await ds?.destroy();
    await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin(`DROP ROLE IF EXISTS ${APP_ROLE}`);
  });

  it('allocates gapless gl_audit_number and SHA-256 chain under concurrent postings and verifies VALID', async () => {
    const postings = Array.from({ length: 10 }, (_, idx) =>
      accounting.createJournalEntry(T1, {
        entryNumber: `CONC-${idx + 1}`,
        date: '2026-11-10T12:00:00.000Z',
        description: `concurrent ${idx + 1}`,
        lines: [
          { accountCode: '1010', debit: '100.00' },
          { accountCode: '4010', credit: '100.00' },
        ],
      } as never),
    );
    const results = await Promise.all(postings);
    const nums = results.map((r) => Number(r.glAuditNumber)).sort((a, b) => a - b);
    expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const verified = await sequencer.verifyChain(T1);
    expect(verified.status).toBe('VALID');
    expect(verified.gaps).toBe(0);
    expect(verified.verified).toBe('10/10');
  });

  it('enforces RLS isolation between T1 and T2 for sequencers, periods, and change logs', async () => {
    await periods.createPeriod(T1, {
      code: '2026-10',
      name: 'October 2026',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
    });
    await changeLogs.recordChange(T1, {
      entityType: 'VAT_CODE',
      entityId: 'VAT-19',
      fieldName: 'description',
      oldValue: 'Old',
      newValue: 'New',
      changedBy: 'admin',
    });

    expect(await periods.listPeriods(T2)).toHaveLength(0);
    expect(await changeLogs.listChanges(T2)).toHaveLength(0);
    const t2Verify = await sequencer.verifyChain(T2);
    expect(t2Verify.totalEntries).toBe(0);
  });

  it('enforces irreversible hard close at both service and DB trigger level', async () => {
    const oct = (await periods.listPeriods(T1)).find((p) => p.code === '2026-10')!;
    const closed = await periods.hardClosePeriod(T1, oct.id, 'admin');
    expect(closed.state).toBe(AccountingPeriodState.HARD_CLOSED);

    await expect(
      ds.query(`UPDATE fin_accounting_periods SET state = 'OPEN' WHERE id = $1`, [oct.id]),
    ).rejects.toThrow(/irreversible/);
  });

  it('rejects manual posting into a control account', async () => {
    await accounting.createJournalEntry(T1, {
      entryNumber: 'SEED-CTRL',
      date: '2026-11-11T12:00:00.000Z',
      description: 'seed accounts',
      status: JournalEntryStatus.DRAFT,
      lines: [
        { accountCode: '1010', debit: '10.00' },
        { accountCode: '4010', credit: '10.00' },
      ],
    } as never);
    await ds.query(
      `UPDATE fin_chart_of_accounts SET is_control_account = true WHERE tenant_id = $1 AND code = '1010'`,
      [T1],
    );
    await expect(
      accounting.createJournalEntry(T1, {
        entryNumber: 'MANUAL-CTRL',
        date: '2026-11-11T12:00:00.000Z',
        description: 'should fail',
        lines: [
          { accountCode: '1010', debit: '50.00' },
          { accountCode: '4010', credit: '50.00' },
        ],
      } as never),
    ).rejects.toMatchObject({ status: 422 });
  });
});
