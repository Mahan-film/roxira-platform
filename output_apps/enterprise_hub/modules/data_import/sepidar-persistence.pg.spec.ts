/**
 * Real PostgreSQL integration test for Sepidar Data Persistence (T88 / #774):
 * - Runs as a uniquely named NOSUPERUSER NOBYPASSRLS role (like `roxira_app`).
 * - Exercises real `SepidarPersistenceService` writes across `fin_chart_of_accounts`,
 *   `erp_parties`, `erp_stock_items`, `fin_journal_entries`, `fin_journal_entry_lines`,
 *   `fin_cheques` (including `CHK_fin_cheques_verified_audit`), and `fin_cheque_events`.
 * - Verifies tenant isolation, atomic rollback, concurrency safety, cross-bank cheques, and 409 conflicts.
 */
import 'reflect-metadata';
import * as path from 'path';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { ChartOfAccountEntity } from '../accounting/entities/chart-of-account.entity';
import { JournalEntryEntity } from '../accounting/entities/journal-entry.entity';
import { JournalEntryLineEntity } from '../accounting/entities/journal-entry-line.entity';
import { ChequeEventEntity } from '../cheques/entities/cheque-event.entity';
import { ChequeEntity } from '../cheques/entities/cheque.entity';
import { ChequesRepository } from '../cheques/repositories/cheques.repository';
import { StockItemEntity } from '../inventory/entities/stock-item.entity';
import { PartyEntity } from '../parties/entities/party.entity';
import {
  SYNTHETIC_SEPIDAR_ACCOUNTS,
  SYNTHETIC_SEPIDAR_ITEMS,
  SYNTHETIC_SEPIDAR_PARTIES,
} from './__fixtures__/synthetic-sepidar.fixture';
import { SYNTHETIC_SEPIDAR_CHEQUES } from './__fixtures__/synthetic-sepidar-p2.fixture';
import { SepidarChequesFifoAdapter } from './migration/bak/sepidar-cheques-fifo.adapter';
import { SepidarMappingAdapter } from './migration/bak/sepidar-mapping.adapter';
import { SepidarPersistenceService } from './services/sepidar-persistence.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;

const ADMIN_USER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const TENANT_C = '33333333-3333-4333-8333-333333333333';

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

describePg('Sepidar Data Persistence on PostgreSQL (NOSUPERUSER NOBYPASSRLS)', () => {
  const suffix = `${process.pid}_${Date.now()}`;
  const dbName = `rx_sepidar_pg_${suffix}`;
  const appRole = `rx_sepidar_app_${suffix}`;
  let ownerDs: DataSource;
  let appDs: DataSource;
  let scope: TenantScope;
  let service: SepidarPersistenceService;

  beforeAll(async () => {
    await adminQuery(`CREATE DATABASE "${dbName}"`);
    await adminQuery(
      `CREATE ROLE "${appRole}" LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
    );

    ownerDs = new DataSource(baseOptions(dbName, ADMIN_USER));
    await ownerDs.initialize();
    await ownerDs.runMigrations();

    for (const tid of [TENANT_A, TENANT_B, TENANT_C]) {
      await ownerDs.query(
        `INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $2) ON CONFLICT DO NOTHING`,
        [tid, `sep-${tid.slice(0, 8)}`],
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
    service = new SepidarPersistenceService(
      new SepidarMappingAdapter(),
      new SepidarChequesFifoAdapter(),
      scope,
      new ChequesRepository(scope),
    );
  }, 180_000);

  afterAll(async () => {
    if (appDs?.isInitialized) await appDs.destroy();
    if (ownerDs?.isInitialized) await ownerDs.destroy();
    await adminQuery(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await adminQuery(`DROP ROLE IF EXISTS "${appRole}"`);
  });

  it('persists all 5 entity groups under NOSUPERUSER NOBYPASSRLS, sets sayadVerified=false, and writes audit events', async () => {
    const cert = await service.persistSepidarData(
      TENANT_A,
      { useSynthetic: true },
      'pg-idem-1',
    );

    expect(cert.balanced).toBe(true);
    expect(cert.varianceMinor).toBe('0');
    expect(cert.counts).toEqual({
      accounts: SYNTHETIC_SEPIDAR_ACCOUNTS.length,
      parties: SYNTHETIC_SEPIDAR_PARTIES.length,
      items: SYNTHETIC_SEPIDAR_ITEMS.length,
      openingLines: 5,
      cheques: 5,
    });

    await scope.run(TENANT_A, async (em) => {
      const cash = await em.getRepository(ChartOfAccountEntity).findOne({
        where: { tenantId: TENANT_A, code: '1010' },
      });
      expect(cash?.balance).toBe('50000000.00');

      const cheques = await em.getRepository(ChequeEntity).find({
        where: { tenantId: TENANT_A },
      });
      expect(cheques).toHaveLength(5);
      expect(
        cheques.every(
          (c) => c.sayadVerified === false && c.sayadVerifiedBy === null && c.sayadVerifiedAt === null,
        ),
      ).toBe(true);

      const events = await em.getRepository(ChequeEventEntity).find({
        where: { tenantId: TENANT_A },
      });
      expect(events).toHaveLength(5);
    });
  });

  it('isolates tenants under RLS and allows concurrent idempotent runs without duplicating entries or balances', async () => {
    const [r1, r2] = await Promise.all([
      service.persistSepidarData(TENANT_B, { useSynthetic: true }, 'pg-idem-b'),
      service.persistSepidarData(TENANT_B, { useSynthetic: true }, 'pg-idem-b'),
    ]);

    expect(r1.canonicalSha256).toBe(r2.canonicalSha256);
    expect(r1.idempotencySummary.openingVoucherCreated || r2.idempotencySummary.openingVoucherCreated).toBe(true);
    expect(r1.idempotencySummary.openingVoucherCreated && r2.idempotencySummary.openingVoucherCreated).toBe(false);

    await scope.run(TENANT_B, async (em) => {
      const entries = await em.getRepository(JournalEntryEntity).find({
        where: { tenantId: TENANT_B, entryNumber: 'JV-OPENING-SEPIDAR' },
      });
      expect(entries).toHaveLength(1);

      const cash = await em.getRepository(ChartOfAccountEntity).findOne({
        where: { tenantId: TENANT_B, code: '1010' },
      });
      expect(cash?.balance).toBe('50000000.00');
    });

    // TENANT_A cannot read TENANT_B rows under RLS
    await scope.run(TENANT_A, async (em) => {
      const cross = await em.getRepository(PartyEntity).find({
        where: { tenantId: TENANT_B },
      });
      expect(cross).toHaveLength(0);
    });
  });

  it('rolls back all entity groups on missing-account voucher failure and handles same chequeNumber across banks', async () => {
    await expect(
      service.persistSepidarData(TENANT_C, {
        accounts: SYNTHETIC_SEPIDAR_ACCOUNTS,
        parties: SYNTHETIC_SEPIDAR_PARTIES,
        items: SYNTHETIC_SEPIDAR_ITEMS,
        openingVoucher: [
          { VoucherItemID: 1, AccountCode: '999999', Debit: 1000, Credit: 0 },
          { VoucherItemID: 2, AccountCode: '3010', Debit: 0, Credit: 1000 },
        ],
      }),
    ).rejects.toThrow(BadRequestException);

    await scope.run(TENANT_C, async (em) => {
      expect(await em.getRepository(ChartOfAccountEntity).count({ where: { tenantId: TENANT_C } })).toBe(0);
      expect(await em.getRepository(PartyEntity).count({ where: { tenantId: TENANT_C } })).toBe(0);
      expect(await em.getRepository(StockItemEntity).count({ where: { tenantId: TENANT_C } })).toBe(0);
      expect(await em.getRepository(JournalEntryLineEntity).count({ where: { tenantId: TENANT_C } })).toBe(0);
    });

    // Two cheques sharing chequeNumber across different banks both persist;
    // distinct Sayad numbers on same bank + chequeNumber also both persist
    const cert = await service.persistSepidarData(
      TENANT_C,
      {
        cheques: [
          {
            ...SYNTHETIC_SEPIDAR_CHEQUES[0],
            ChequeId: 9001,
            ChequeNumber: 'DUP-777',
            SayadNumber: '9111222233334444',
            BankName: 'بانک ملت',
          },
          {
            ...SYNTHETIC_SEPIDAR_CHEQUES[0],
            ChequeId: 9002,
            ChequeNumber: 'DUP-777',
            SayadNumber: '9555666677778888',
            BankName: 'بانک صادرات',
          },
          {
            ...SYNTHETIC_SEPIDAR_CHEQUES[0],
            ChequeId: 9003,
            ChequeNumber: 'DUP-777',
            SayadNumber: '9666777788889999',
            BankName: 'بانک ملت',
          },
        ],
      },
      'pg-cheques-only-c',
    );
    expect(cert.counts.cheques).toBe(3);

    // Reusing TENANT_C's cheques-only Idempotency-Key with a different payload throws 409
    await expect(
      service.persistSepidarData(
        TENANT_C,
        { cheques: [SYNTHETIC_SEPIDAR_CHEQUES[1]] },
        'pg-cheques-only-c',
      ),
    ).rejects.toThrow(ConflictException);

    // Reusing TENANT_A's Idempotency-Key with a different payload throws 409
    await expect(
      service.persistSepidarData(
        TENANT_A,
        {
          accounts: [
            { AccountID: 999, Code: '999', Title: 'متفاوت', Level: 1, ParentAccountID: null },
          ],
        },
        'pg-idem-1',
      ),
    ).rejects.toThrow(ConflictException);
  });
});
