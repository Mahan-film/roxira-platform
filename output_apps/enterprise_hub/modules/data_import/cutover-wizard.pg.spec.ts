/**
 * End-to-end PostgreSQL FORCE RLS integration spec for CutoverWizardService (#1217):
 * Runs REAL CutoverWizardService + AccountingService + CutoverRepository under a
 * NOSUPERUSER NOBYPASSRLS role (`rx_cutover_wizard_app`) proving:
 * empty input, AI actor, mid-way failure atomic rollback, typed OPENING journal,
 * dry verify-lock (0 writes), locked-period write rejection (PeriodLockedException),
 * replay protection, and concurrent Promise.all go-live.
 */
import 'reflect-metadata';
import * as path from 'path';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { ChartOfAccountEntity } from '../accounting/entities/chart-of-account.entity';
import { JournalEntryEntity } from '../accounting/entities/journal-entry.entity';
import { PeriodLockEntity } from '../accounting/entities/period-lock.entity';
import { AccountType, JournalEntryType } from '../accounting/enums/accounting.enum';
import { PeriodLockedException } from '../accounting/exceptions/ledger.exceptions';
import { AccountingRepository } from '../accounting/repositories/accounting.repository';
import { AccountingService } from '../accounting/services/accounting.service';
import { EffectiveTieOutConfigRegistry } from './analysis/effective-tie-out-config.registry';
import { ImportTieOutEngine } from './analysis/import-tie-out.engine';
import { CutoverEntity } from './entities/cutover.entity';
import { CutoverRepository } from './repositories/cutover.repository';
import { CutoverWizardService } from './services/cutover-wizard.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;

const ADMIN_USER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
const APP_ROLE = 'rx_cutover_wizard_app';
const TENANT_A = '33333333-3333-4333-8333-333333333333';
const TENANT_B = '44444444-4444-4444-8444-444444444444';

const baseOptions = (database: string, username: string) => ({
  type: 'postgres' as const,
  host: HOST,
  port: PORT,
  username,
  database,
  entities: [path.join(__dirname, '../**/*.entity.ts')],
  migrations: [path.join(__dirname, '../../migrations/*.ts')],
  migrationsTransactionMode: 'each' as const,
  synchronize: false,
  logging: false,
  extra: { max: 15 },
});

const adminQuery = async (sql: string) => {
  const admin = new DataSource({
    ...baseOptions('postgres', ADMIN_USER),
    entities: [],
    migrations: [],
  });
  await admin.initialize();
  try {
    await admin.query(sql);
  } finally {
    await admin.destroy();
  }
};

describePg('CutoverWizardService end-to-end on PostgreSQL (NOSUPERUSER NOBYPASSRLS, #1217)', () => {
  const dbName = `rx_cutover_wiz_${process.pid}_${Date.now()}`;
  let ownerDs: DataSource;
  let appDs: DataSource;
  let scope: TenantScope;
  let accounting: AccountingService;
  let cutoverRepo: CutoverRepository;
  let wizard: CutoverWizardService;

  const seedAccounts = async (tenantId: string) => {
    await scope.run(tenantId, async (m) => {
      const repo = m.getRepository(ChartOfAccountEntity);
      await repo.save([
        repo.create({ tenantId, code: '1010', name: 'صندوق', accountType: AccountType.ASSET, balance: '0' }),
        repo.create({ tenantId, code: '3010', name: 'سرمایه', accountType: AccountType.EQUITY, balance: '0' }),
      ]);
    });
  };

  const countTenantState = async (tenantId: string) =>
    scope.run(tenantId, async (m) => ({
      journals: await m.getRepository(JournalEntryEntity).count({ where: { tenantId } }),
      locks: await m.getRepository(PeriodLockEntity).count({ where: { tenantId } }),
      cutovers: await m.getRepository(CutoverEntity).count({ where: { tenantId } }),
      auditLogs: await m
        .query(
          `SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND (resource_type = 'period_lock' OR action LIKE 'ledger.%')`,
          [tenantId],
        )
        .then((r) => r[0]?.n ?? 0),
    }));

  const validGoLiveDto = () => ({
    cutoverDate: '2026-01-01',
    preCutoverLockDate: '2025-12-31',
    openingBalances: [
      { accountCode: '1010', description: 'صندوق', debit: '1000000' },
      { accountCode: '3010', description: 'سرمایه', credit: '1000000' },
    ],
  });

  beforeAll(async () => {
    await adminQuery(`CREATE DATABASE "${dbName}"`);
    await adminQuery(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
          CREATE ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
        END IF;
      END $$;
    `);

    ownerDs = new DataSource(baseOptions(dbName, ADMIN_USER));
    await ownerDs.initialize();
    await ownerDs.runMigrations();

    await ownerDs.query(`GRANT CONNECT ON DATABASE "${dbName}" TO ${APP_ROLE}`);
    await ownerDs.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
    await ownerDs.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`,
    );
    await ownerDs.query(
      `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`,
    );

    appDs = new DataSource(baseOptions(dbName, APP_ROLE));
    await appDs.initialize();
    scope = new TenantScope(appDs);

    const currencyStub = {
      convertToRial: async () => ({ amountInRial: 0, rate: 1 }),
    } as never;
    accounting = new AccountingService(new AccountingRepository(scope), currencyStub);
    cutoverRepo = new CutoverRepository(appDs.getRepository(CutoverEntity), scope);
    const configRegistry = new EffectiveTieOutConfigRegistry();
    wizard = new CutoverWizardService(
      new ImportTieOutEngine(configRegistry),
      configRegistry,
      accounting,
      cutoverRepo,
    );

    await seedAccounts(TENANT_A);
    await seedAccounts(TENANT_B);
  }, 180_000);

  afterAll(async () => {
    if (appDs?.isInitialized) await appDs.destroy();
    if (ownerDs?.isInitialized) await ownerDs.destroy();
    await adminQuery(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  });

  it('rejects empty input, AI actor, and rolls back mid-way failure with ZERO orphan journals or locks', async () => {
    await expect(
      wizard.executeGoLive(TENANT_A, 'user-owner-1', { cutoverDate: '2026-01-01', openingBalances: [] }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      wizard.executeGoLive(TENANT_A, 'ai:assistant', validGoLiveDto()),
    ).rejects.toThrow(ForbiddenException);

    // Mid-way failure at createCutover must roll back BOTH the OPENING journal and the period lock.
    const spy = jest
      .spyOn(cutoverRepo, 'createCutover')
      .mockRejectedValueOnce(new Error('mid-way cutover insert failure'));
    await expect(
      wizard.executeGoLive(TENANT_A, 'user-owner-1', validGoLiveDto()),
    ).rejects.toThrow('mid-way cutover insert failure');
    spy.mockRestore();

    expect(await countTenantState(TENANT_A)).toEqual({ journals: 0, locks: 0, cutovers: 0, auditLogs: 0 });
  });

  it('posts typed OPENING journal, locks pre-cutover period, dry-verifies lock, blocks locked writes & replays', async () => {
    const goLive = await wizard.executeGoLive(TENANT_A, 'user-owner-1', validGoLiveDto());
    expect(goLive.executedBy).toBe('user-owner-1');
    expect(goLive.preCutoverLockDate).toBe('2025-12-31');

    // Verify OPENING entryType in database.
    const entries = await scope.run(TENANT_A, (m) =>
      m.getRepository(JournalEntryEntity).find({ where: { tenantId: TENANT_A } }),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].entryType).toBe(JournalEntryType.OPENING);

    // Dry verify-lock MUST NOT write any journal entries.
    const lockedCheck = await wizard.verifyPreCutoverLock(TENANT_A, { testDate: '2025-12-31' });
    const openCheck = await wizard.verifyPreCutoverLock(TENANT_A, { testDate: '2026-01-01' });
    expect(lockedCheck).toMatchObject({ locked: true, dryCheck: true, testDate: '2025-12-31' });
    expect(openCheck).toMatchObject({ locked: false, dryCheck: true, testDate: '2026-01-01' });
    expect((await countTenantState(TENANT_A)).journals).toBe(1);

    // Posting a journal entry into the locked pre-cutover period must throw PeriodLockedException.
    await expect(
      accounting.createJournalEntry(TENANT_A, {
        entryNumber: 'POST-LOCKED-TEST',
        date: '2025-12-31T00:00:00.000Z',
        description: 'should be rejected by pre-cutover lock',
        lines: [
          { accountCode: '1010', debit: '100' },
          { accountCode: '3010', credit: '100' },
        ],
      }),
    ).rejects.toBeInstanceOf(PeriodLockedException);

    // Replay go-live must be rejected with 409 ConflictException and leave strictly 1 journal + 1 lock.
    await expect(
      wizard.executeGoLive(TENANT_A, 'user-owner-1', validGoLiveDto()),
    ).rejects.toThrow(ConflictException);
    expect(await countTenantState(TENANT_A)).toMatchObject({ journals: 1, locks: 1, cutovers: 1 });
  });

  it('serializes concurrent go-live attempts so strictly one succeeds and zero duplicate OB journals are posted', async () => {
    const outcomes = await Promise.allSettled([
      wizard.executeGoLive(TENANT_B, 'user-owner-b1', validGoLiveDto()),
      wizard.executeGoLive(TENANT_B, 'user-owner-b2', validGoLiveDto()),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConflictException);
    expect(await countTenantState(TENANT_B)).toMatchObject({ journals: 1, locks: 1, cutovers: 1 });
  });
});
