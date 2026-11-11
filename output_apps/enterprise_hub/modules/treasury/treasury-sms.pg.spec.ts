/**
 * Treasury SMS drafts on real PostgreSQL as non-superuser role (NOSUPERUSER NOBYPASSRLS):
 * Proves FORCE ROW LEVEL SECURITY and strict cross-tenant isolation on `fin_treasury_sms_drafts`.
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { TreasurySmsDraftEntity, TreasurySmsDraftStatus } from './entities/treasury-sms-draft.entity';
import { TreasurySmsRepository } from './repositories/treasury-sms.repository';
import { TreasurySmsService } from './services/treasury-sms.service';
import { TreasuryService } from './services/treasury.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const ROLE_NAME = `rx_treasury_sms_${process.pid}`;
const ROLE_PW = 'treasury-sms-rls-test';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const U1 = '11111111-1111-4111-8111-222222222222';
const U2 = '22222222-2222-4222-8222-333333333333';

const dsOptions = (database: string, username = OWNER, password = OWNER_PW) => ({
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

describePg('TreasurySmsDrafts RLS isolation (NOSUPERUSER NOBYPASSRLS)', () => {
  const db = `treasury_sms_${process.pid}`;
  let adminDs: DataSource;
  let ownerDs: DataSource;
  let appDs: DataSource;
  let scope: TenantScope;
  let repository: TreasurySmsRepository;
  let service: TreasurySmsService;

  beforeAll(async () => {
    adminDs = await new DataSource({ ...dsOptions('postgres'), entities: [], migrations: [] }).initialize();
    await adminDs.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await adminDs.query(`CREATE DATABASE "${db}"`);
    await adminDs.query(`DROP ROLE IF EXISTS "${ROLE_NAME}"`);
    await adminDs.query(`CREATE ROLE "${ROLE_NAME}" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${ROLE_PW}'`);

    ownerDs = await new DataSource(dsOptions(db)).initialize();
    await ownerDs.runMigrations();

    await ownerDs.query(
      `GRANT CONNECT ON DATABASE "${db}" TO "${ROLE_NAME}";
       GRANT USAGE ON SCHEMA public TO "${ROLE_NAME}";
       GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${ROLE_NAME}";
       GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${ROLE_NAME}";`,
    );

    appDs = await new DataSource(dsOptions(db, ROLE_NAME, ROLE_PW)).initialize();
    scope = new TenantScope(appDs);
    repository = new TreasurySmsRepository(appDs.getRepository(TreasurySmsDraftEntity), scope);
    service = new TreasurySmsService(repository, {} as TreasuryService);
  });

  afterAll(async () => {
    await appDs?.destroy();
    await ownerDs?.destroy();
    if (adminDs) {
      await adminDs.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
      await adminDs.query(`DROP ROLE IF EXISTS "${ROLE_NAME}"`);
      await adminDs.destroy();
    }
  });

  it('enforces FORCE ROW LEVEL SECURITY on fin_treasury_sms_drafts', async () => {
    const rows = await ownerDs.query(`
      SELECT tablename, rowsecurity, forcerowsecurity
      FROM pg_tables
      WHERE tablename = 'fin_treasury_sms_drafts';
    `);

    expect(rows).toHaveLength(1);
    expect(rows[0].rowsecurity).toBe(true);
    expect(rows[0].forcerowsecurity).toBe(true);
  });

  it('proves Tenant 1 SMS drafts cannot be seen or modified by Tenant 2 under non-superuser app role', async () => {
    const MELLI_SMS = `بانک ملی ایران
واریز: ۲,۵۰۰,۰۰۰ ریال
حساب: ...۴۳۲۱
مانده: ۱۰,۰۰۰,۰۰۰ ریال
۱۴۰۳/۰۸/۲۲-۱۴:۳۰`;

    const draftT1 = await service.captureSms(T1, U1, MELLI_SMS);
    expect(draftT1.id).toBeDefined();

    // Tenant 1 sees their draft
    const listT1 = await service.listDrafts(T1);
    expect(listT1.some((d) => d.id === draftT1.id)).toBe(true);

    // Tenant 2 sees nothing
    const listT2 = await service.listDrafts(T2);
    expect(listT2.some((d) => d.id === draftT1.id)).toBe(false);

    // Tenant 2 cannot reject or modify Tenant 1 draft
    await expect(service.rejectDraft(T2, draftT1.id)).rejects.toThrow();

    // Direct appDs SQL query under Tenant 2 context sees 0 rows
    const crossRows = await appDs.query(
      `SELECT * FROM fin_treasury_sms_drafts WHERE id = $1`,
      [draftT1.id],
    );
    expect(crossRows).toHaveLength(0); // RLS filtered out because app.tenant_id is not T1
  });
});
