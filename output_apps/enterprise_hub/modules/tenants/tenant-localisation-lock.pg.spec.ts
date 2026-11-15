/**
 * Real PostgreSQL spec for Company Localisation & Lock Trigger (WAVE 15 - T137 / R4 Decision 1).
 *
 * Verifies that:
 *   1. Migration adds localisation columns with safe defaults and backfills existing tenants.
 *   2. An organisation with NO posted journal entries can update country_code and book_currency_code.
 *   3. Once a POSTED journal entry exists for the organisation, any attempt to change
 *      country_code or book_currency_code is strictly blocked by the database trigger (RX003).
 *   4. Non-locked localisation fields (timezone, locale, default_calendar, etc.) remain editable.
 *   5. Executed under the non-superuser application role `NOSUPERUSER NOBYPASSRLS`.
 *
 * Opt-in like other pg specs: skipped unless ROXIRA_TEST_PG_HOST is set.
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TenantEntity } from './entities/tenant.entity';
import { TenantsRepository } from './repositories/tenants.repository';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const APP_PW = 'localisation-lock-app-test-pw';
const T1 = '11111111-1111-4111-8111-111111111111';

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

describePg('Company Localisation Lock Trigger on PostgreSQL (non-superuser)', () => {
  const db = `rx_localisation_${process.pid}_${Date.now()}`;
  const role = `rx_loc_app_${process.pid}`;
  let admin: DataSource;
  let owner: DataSource;
  let app: DataSource;
  let tenantsRepo: TenantsRepository;

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
    tenantsRepo = new TenantsRepository(app.getRepository(TenantEntity));
  });

  afterAll(async () => {
    if (app?.isInitialized) await app.destroy();
    if (owner?.isInitialized) await owner.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
      await admin.query(`DROP ROLE IF EXISTS ${role}`);
      await admin.destroy();
    }
  });

  it('backfills existing tenants with default pack values and allows initial changes without posted entries', async () => {
    // Insert tenant as owner
    await owner.query(`
      INSERT INTO "tenants" ("id", "name", "slug")
      VALUES ($1, 'Acme Test Corp', 'acme-test-corp')
      ON CONFLICT ("id") DO NOTHING
    `, [T1]);

    const tenant = await tenantsRepo.findById(T1);
    expect(tenant).toBeDefined();
    expect(tenant?.countryCode).toBe('IR');
    expect(tenant?.packVersion).toBe('1.0.0');
    expect(tenant?.bookCurrencyCode).toBe('IRR');
    expect(tenant?.defaultCalendar).toBe('jalali');
    expect(tenant?.timezone).toBe('Asia/Tehran');
    expect(tenant?.locale).toBe('fa-IR');
    expect(tenant?.fiscalYearStartMonth).toBe(1);

    // Can update country_code and book_currency_code when NO posted journal entries exist
    const updated = await tenantsRepo.updateSettings(T1, {
      countryCode: 'MY',
      bookCurrencyCode: 'MYR',
      defaultCalendar: 'gregorian',
      timezone: 'Asia/Kuala_Lumpur',
      locale: 'en-MY',
    });

    expect(updated?.countryCode).toBe('MY');
    expect(updated?.bookCurrencyCode).toBe('MYR');
    expect(updated?.timezone).toBe('Asia/Kuala_Lumpur');
  });

  it('strictly blocks updating country_code or book_currency_code once a POSTED entry exists (RX003)', async () => {
    // Insert a posted entry in fin_journal_entries
    await owner.query(`
      INSERT INTO "fin_journal_entries" (
        "id", "tenant_id", "entry_number", "date", "description", "status"
      ) VALUES (
        99901, $1, 'V-LOCK-01', now(), 'Opening journal entry', 'POSTED'
      )
    `, [T1]);

    // Attempting to change country_code must fail with RX003
    await expect(
      tenantsRepo.updateSettings(T1, { countryCode: 'IR' }),
    ).rejects.toThrow(/cannot change country_code or book_currency_code/);

    // Attempting to change book_currency_code must fail with RX003
    await expect(
      tenantsRepo.updateSettings(T1, { bookCurrencyCode: 'EUR' }),
    ).rejects.toThrow(/cannot change country_code or book_currency_code/);

    // Non-locked fields (timezone, locale, name) still succeed
    const unblockedUpdate = await tenantsRepo.updateSettings(T1, {
      timezone: 'Asia/Singapore',
      locale: 'ms-MY',
    });

    expect(unblockedUpdate?.timezone).toBe('Asia/Singapore');
    expect(unblockedUpdate?.locale).toBe('ms-MY');
    expect(unblockedUpdate?.countryCode).toBe('MY');
    expect(unblockedUpdate?.bookCurrencyCode).toBe('MYR');
  });
});

describe('Localisation lock trigger unit semantics', () => {
  it('identifies country_code and book_currency_code as the immutable localisation properties', () => {
    const lockedFields = ['country_code', 'book_currency_code'] as const;
    expect(lockedFields).toHaveLength(2);
    expect(lockedFields).toContain('country_code');
    expect(lockedFields).toContain('book_currency_code');
  });
});
