/**
 * Real PostgreSQL integration test for Import Dry-Run Report (T100):
 * - Runs as a uniquely named NOSUPERUSER NOBYPASSRLS role (like `roxira_app`).
 * - Exercises real `ImportDryRunService` writes across `fin_chart_of_accounts`,
 *   `erp_parties`, `erp_stock_items`, `fin_journal_entries`, `fin_journal_entry_lines`,
 *   `fin_cheques`, and `fin_cheque_events` inside `TenantScope.run` and verifies
 *   unconditional transaction rollback (zero committed rows afterwards).
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { ChartOfAccountEntity } from '../accounting/entities/chart-of-account.entity';
import { JournalEntryLineEntity } from '../accounting/entities/journal-entry-line.entity';
import { JournalEntryEntity } from '../accounting/entities/journal-entry.entity';
import { AccountLevel, AccountType } from '../accounting/enums/accounting.enum';
import { ChequeEventEntity } from '../cheques/entities/cheque-event.entity';
import { ChequeEntity } from '../cheques/entities/cheque.entity';
import { ChequeDirection, ChequeStatus } from '../cheques/enums/cheque.enum';
import { SayadRegistrationStatus } from '../cheques/sayad/sayad';
import { StockItemEntity } from '../inventory/entities/stock-item.entity';
import { PartyEntity } from '../parties/entities/party.entity';
import { CustomerGroup } from '../parties/enums/customer-group.enum';
import { PartyRole } from '../parties/enums/party-role.enum';
import { SepidarMappingAdapter } from './migration/bak/sepidar-mapping.adapter';
import { ImportDryRunService } from './services/import-dry-run.service';
import {
  SYNTHETIC_HOLOO_DRY_RUN_ACCOUNTS,
  SYNTHETIC_HOLOO_DRY_RUN_CHEQUES,
  SYNTHETIC_HOLOO_DRY_RUN_ITEMS,
  SYNTHETIC_HOLOO_DRY_RUN_OPENING_VOUCHER,
  SYNTHETIC_HOLOO_DRY_RUN_PARTIES,
} from './__fixtures__/synthetic-holoo-dry-run.fixture';
import {
  SYNTHETIC_SEPIDAR_ACCOUNTS,
  SYNTHETIC_SEPIDAR_PARTIES,
} from './__fixtures__/synthetic-sepidar.fixture';
import { SYNTHETIC_SEPIDAR_CHEQUES } from './__fixtures__/synthetic-sepidar-p2.fixture';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;

const ADMIN_USER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

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
  extra: { max: 10 },
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

describePg('Import Dry-Run on PostgreSQL (NOSUPERUSER NOBYPASSRLS)', () => {
  const suffix = `${process.pid}_${Date.now()}`;
  const dbName = `rx_dryrun_pg_${suffix}`;
  const appRole = `rx_dryrun_app_${suffix}`;
  let ownerDs: DataSource;
  let appDs: DataSource;
  let scope: TenantScope;
  let service: ImportDryRunService;

  beforeAll(async () => {
    await adminQuery(`CREATE DATABASE "${dbName}"`);
    await adminQuery(
      `CREATE ROLE "${appRole}" LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
    );

    ownerDs = new DataSource(baseOptions(dbName, ADMIN_USER));
    await ownerDs.initialize();
    await ownerDs.runMigrations();

    for (const tid of [TENANT_A, TENANT_B]) {
      await ownerDs.query(
        `INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $2) ON CONFLICT DO NOTHING`,
        [tid, `dry-${tid.slice(0, 8)}`],
      );
    }

    await ownerDs.query(`GRANT CONNECT ON DATABASE "${dbName}" TO "${appRole}"`);
    await ownerDs.query(`GRANT USAGE ON SCHEMA public TO "${appRole}"`);
    await ownerDs.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${appRole}"`,
    );
    await ownerDs.query(
      `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO "${appRole}"`,
    );

    appDs = new DataSource(baseOptions(dbName, appRole));
    await appDs.initialize();
    scope = new TenantScope(appDs);
    service = new ImportDryRunService(new SepidarMappingAdapter(), scope);
  }, 180_000);

  afterAll(async () => {
    if (appDs?.isInitialized) await appDs.destroy();
    if (ownerDs?.isInitialized) await ownerDs.destroy();
    await adminQuery(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await adminQuery(`DROP ROLE IF EXISTS "${appRole}"`);
  });

  async function countTenantRows(tenantId: string) {
    return scope.run(tenantId, async (em) => ({
      accounts: await em.getRepository(ChartOfAccountEntity).count({ where: { tenantId } }),
      parties: await em.getRepository(PartyEntity).count({ where: { tenantId } }),
      items: await em.getRepository(StockItemEntity).count({ where: { tenantId } }),
      entries: await em.getRepository(JournalEntryEntity).count({ where: { tenantId } }),
      lines: await em.getRepository(JournalEntryLineEntity).count({ where: { tenantId } }),
      cheques: await em.getRepository(ChequeEntity).count({ where: { tenantId } }),
      chequeEvents: await em.getRepository(ChequeEventEntity).count({ where: { tenantId } }),
    }));
  }

  it('executes Sepidar dry-run inside real Postgres transaction and rolls back 100% of rows', async () => {
    const before = await countTenantRows(TENANT_A);
    expect(before).toEqual({
      accounts: 0,
      parties: 0,
      items: 0,
      entries: 0,
      lines: 0,
      cheques: 0,
      chequeEvents: 0,
    });

    const report = await service.dryRunSepidar(TENANT_A, { useSynthetic: true });

    expect(report.dryRun).toBe(true);
    expect(report.rolledBack).toBe(true);
    expect(report.readyToCommit).toBe(true);
    expect(report.txVerification).toEqual({
      dbAccountsAfterInsert: SYNTHETIC_SEPIDAR_ACCOUNTS.length,
      dbPartiesAfterInsert: SYNTHETIC_SEPIDAR_PARTIES.length,
      dbItemsAfterInsert: 2,
      dbOpeningLinesAfterInsert: 5,
      dbChequesAfterInsert: 5,
    });
    expect(report.openingTrialBalance.totalDebitRial).toBe('250000000.00');
    expect(report.openCheques.totalCount).toBe(5);
    expect(report.openCheques.totalAmountRial).toBe('955000000.00');

    const after = await countTenantRows(TENANT_A);
    expect(after).toEqual(before);
  });

  it('executes Holoo dry-run inside real Postgres transaction and rolls back 100% of rows', async () => {
    const before = await countTenantRows(TENANT_A);

    const report = await service.dryRunHoloo(TENANT_A, { useSynthetic: true });

    expect(report.dryRun).toBe(true);
    expect(report.rolledBack).toBe(true);
    expect(report.readyToCommit).toBe(true);
    expect(report.txVerification).toEqual({
      dbAccountsAfterInsert: SYNTHETIC_HOLOO_DRY_RUN_ACCOUNTS.length,
      dbPartiesAfterInsert: SYNTHETIC_HOLOO_DRY_RUN_PARTIES.length,
      dbItemsAfterInsert: SYNTHETIC_HOLOO_DRY_RUN_ITEMS.length,
      dbOpeningLinesAfterInsert: SYNTHETIC_HOLOO_DRY_RUN_OPENING_VOUCHER.length,
      dbChequesAfterInsert: 2,
    });
    expect(report.openingTrialBalance.totalDebitRial).toBe('150000000.00');
    expect(report.openCheques.totalAmountRial).toBe('130000000.00');

    const after = await countTenantRows(TENANT_A);
    expect(after).toEqual(before);
  });

  it('detects existing DB collisions, duplicate parties, unmapped accounts, and preserves tenant isolation under RLS', async () => {
    await scope.run(TENANT_A, async (em) => {
      await em.getRepository(ChartOfAccountEntity).save(
        em.getRepository(ChartOfAccountEntity).create({
          tenantId: TENANT_A,
          code: '1010',
          name: 'صندوق موجود',
          accountType: AccountType.ASSET,
          currency: 'IRR',
          balance: '0',
          level: AccountLevel.MOEIN,
          parentCode: '10',
        }),
      );
      await em.getRepository(PartyEntity).save(
        em.getRepository(PartyEntity).create({
          tenantId: TENANT_A,
          code: 'HLO-CUS-01',
          name: 'مشتری قبلی دیتابیس',
          role: PartyRole.CUSTOMER,
          customerGroup: CustomerGroup.CONSUMER,
          nationalId: '10102030405',
          active: true,
        }),
      );
      await em.getRepository(ChequeEntity).save(
        em.getRepository(ChequeEntity).create({
          tenantId: TENANT_A,
          direction: ChequeDirection.RECEIVED,
          sayadNumber: SYNTHETIC_HOLOO_DRY_RUN_CHEQUES[0].SayadNumber,
          sayadVerified: false,
          sayadRegistrationStatus: SayadRegistrationStatus.UNKNOWN,
          chequeNumber: SYNTHETIC_HOLOO_DRY_RUN_CHEQUES[0].ChequeNumber,
          bankName: SYNTHETIC_HOLOO_DRY_RUN_CHEQUES[0].BankName,
          amount: '85000000.00',
          issueDate: '2026-10-01',
          dueDate: '2026-12-01',
          partyName: 'مشتری قبلی',
          partyCode: 'HLO-CUS-01',
          status: ChequeStatus.REGISTERED,
        }),
      );
    });

    const beforeA = await countTenantRows(TENANT_A);

    const reportA = await service.dryRunHoloo(TENANT_A, {
      accounts: SYNTHETIC_HOLOO_DRY_RUN_ACCOUNTS,
      parties: [
        ...SYNTHETIC_HOLOO_DRY_RUN_PARTIES,
        {
          PartyId: 999,
          Code: 'HLO-CUS-DUP',
          Name: 'کد ملی تکراری دیتابیس',
          IsCustomer: true,
          IsSupplier: false,
          NationalCode: '10102030405',
        },
        {
          PartyId: 1000,
          Code: 'HLO-SUP-BATCH-DUP',
          Name: 'کد ملی تکراری در فایل',
          IsCustomer: false,
          IsSupplier: true,
          NationalCode: '10109988776',
        },
      ],
      items: SYNTHETIC_HOLOO_DRY_RUN_ITEMS,
      openingVoucher: [
        ...SYNTHETIC_HOLOO_DRY_RUN_OPENING_VOUCHER,
        { SanadId: 99, AccountCode: '9999', Debit: 100000, Credit: 0 },
      ],
      cheques: SYNTHETIC_HOLOO_DRY_RUN_CHEQUES,
    });

    expect(reportA.readyToCommit).toBe(false);
    expect(reportA.counts.accounts.existingSkipped).toBe(1);
    expect(reportA.counts.cheques.existingSkipped).toBe(1);
    expect(reportA.duplicateParties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'HLO-CUS-01', reason: 'existing_code_in_db' }),
        expect.objectContaining({ code: 'HLO-CUS-DUP', reason: 'existing_national_id_in_db' }),
        expect.objectContaining({ code: 'HLO-SUP-BATCH-DUP', reason: 'duplicate_national_id_in_batch' }),
      ]),
    );
    expect(reportA.unmappedAccounts).toEqual([
      expect.objectContaining({ accountCode: '9999', reason: 'missing_in_chart' }),
    ]);
    expect(reportA.openingTrialBalance.balanced).toBe(false);
    expect(reportA.openingTrialBalance.persistedInTx).toBe(false);

    // Pre-seeded rows in TENANT_A are untouched after rollback
    const afterA = await countTenantRows(TENANT_A);
    expect(afterA).toEqual(beforeA);

    // TENANT_B cannot see TENANT_A's seeded rows (RLS) and gets clean dry-run counts
    const reportB = await service.dryRunSepidar(TENANT_B, {
      accounts: SYNTHETIC_SEPIDAR_ACCOUNTS,
      parties: SYNTHETIC_SEPIDAR_PARTIES,
      cheques: SYNTHETIC_SEPIDAR_CHEQUES,
    });
    expect(reportB.counts.accounts.existingSkipped).toBe(0);
    expect(reportB.duplicateParties).toHaveLength(0);
    expect(await countTenantRows(TENANT_B)).toEqual({
      accounts: 0,
      parties: 0,
      items: 0,
      entries: 0,
      lines: 0,
      cheques: 0,
      chequeEvents: 0,
    });
  });
});
