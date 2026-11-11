/**
 * Tenant RLS isolation spec for Receipt Bot (Telegram/Bale) Integration (T87 / WAVE 8).
 * Exercises ReceiptBotRepository under a NOSUPERUSER NOBYPASSRLS role with TenantScope
 * and proves:
 *  1. FORCE ROW LEVEL SECURITY on `receipt_bot_link_codes` and `receipt_bot_user_links`.
 *  2. Tenant isolation: Tenant 1 link codes and user links cannot be read or modified by Tenant 2.
 *  3. SECURITY DEFINER pre-tenant lookup functions (receipt_bot_lookup_link, receipt_bot_consume_code)
 *     execute successfully under the non-superuser app role without exposing other tenants.
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { ReceiptBotLinkCodeEntity } from './entities/receipt-bot-link-code.entity';
import { ReceiptBotUserLinkEntity } from './entities/receipt-bot-user-link.entity';
import { ReceiptBotRepository } from './repositories/receipt-bot.repository';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const ROLE_NAME = `rx_receipt_bot_${process.pid}`;
const ROLE_PW = 'receipt-bot-rls-test';

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
  entities: [path.join(__dirname, '../**/*.entity.ts'), path.join(__dirname, '../../**/*.entity.ts')],
  migrations: [path.join(__dirname, '../../../migrations/*.ts')],
  migrationsTransactionMode: 'each' as const,
  synchronize: false,
  logging: false,
});

describePg('ReceiptBot RLS isolation (NOSUPERUSER NOBYPASSRLS)', () => {
  const db = `receipt_bot_${process.pid}`;
  let adminDs: DataSource;
  let ownerDs: DataSource;
  let appDs: DataSource;
  let scope: TenantScope;
  let repository: ReceiptBotRepository;

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
       GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${ROLE_NAME}";
       GRANT EXECUTE ON FUNCTION receipt_bot_lookup_link(text) TO "${ROLE_NAME}";
       GRANT EXECUTE ON FUNCTION receipt_bot_consume_code(text, text, text) TO "${ROLE_NAME}";`,
    );

    appDs = await new DataSource(dsOptions(db, ROLE_NAME, ROLE_PW)).initialize();
    scope = new TenantScope(appDs);
    repository = new ReceiptBotRepository(
      appDs.getRepository(ReceiptBotLinkCodeEntity),
      appDs.getRepository(ReceiptBotUserLinkEntity),
      scope,
    );
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

  it('enforces FORCE ROW LEVEL SECURITY on receipt bot tables', async () => {
    const rows = await ownerDs.query(`
      SELECT tablename, rowsecurity, forcerowsecurity
      FROM pg_tables
      WHERE tablename IN ('receipt_bot_link_codes', 'receipt_bot_user_links');
    `);

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.rowsecurity).toBe(true);
      expect(row.forcerowsecurity).toBe(true);
    }
  });

  it('proves Tenant 1 link codes cannot be seen by Tenant 2', async () => {
    const expiresAt = new Date(Date.now() + 600_000);
    const code = await repository.createLinkCode(T1, U1, '123456', expiresAt);
    expect(code.id).toBeDefined();
    expect(code.code).toBe('123456');

    // Tenant 1 can find its active code
    const t1Code = await repository.findActiveCode(T1, U1);
    expect(t1Code).not.toBeNull();
    expect(t1Code?.code).toBe('123456');

    // Tenant 2 cannot see Tenant 1 active code
    const t2Code = await repository.findActiveCode(T2, U1);
    expect(t2Code).toBeNull();
  });

  it('consumes link code via SECURITY DEFINER function under non-superuser role', async () => {
    // Consume code for Telegram user 987654321
    const consumed = await repository.consumeCode('123456', '987654321', 'telegram_tester');
    expect(consumed).not.toBeNull();
    expect(consumed?.tenantId).toBe(T1);
    expect(consumed?.userId).toBe(U1);

    // Code is now marked used and cannot be consumed again
    const secondTry = await repository.consumeCode('123456', '987654321', 'telegram_tester');
    expect(secondTry).toBeNull();

    // Pre-tenant lookup resolves the linked user without knowing tenantId upfront
    const lookup = await repository.lookupLinkByTelegramId('987654321');
    expect(lookup).not.toBeNull();
    expect(lookup?.tenantId).toBe(T1);
    expect(lookup?.userId).toBe(U1);
    expect(lookup?.telegramUsername).toBe('telegram_tester');
  });

  it('proves Tenant 2 cannot see or modify Tenant 1 user link', async () => {
    // Tenant 1 sees its link
    const t1Link = await repository.findLinkByTenantUser(T1, U1);
    expect(t1Link).not.toBeNull();
    expect(t1Link?.telegramUserId).toBe('987654321');

    // Tenant 2 cannot see Tenant 1 link
    const t2Link = await repository.findLinkByTenantUser(T2, U1);
    expect(t2Link).toBeNull();

    // Tenant 2 trying to update preferences for U1 does not affect Tenant 1 link
    await repository.updatePreferences(T2, U1, 'purchase');
    const t1After = await repository.findLinkByTenantUser(T1, U1);
    expect(t1After?.defaultKind).toBe('petty_cash'); // unchanged!

    // Tenant 1 updating preferences works
    await repository.updatePreferences(T1, U1, 'purchase');
    const t1Updated = await repository.findLinkByTenantUser(T1, U1);
    expect(t1Updated?.defaultKind).toBe('purchase');

    // Tenant 2 trying to unlink U1 does nothing to Tenant 1
    const t2Unlinked = await repository.unlink(T2, U1);
    expect(t2Unlinked).toBe(false);
    expect(await repository.findLinkByTenantUser(T1, U1)).not.toBeNull();

    // Tenant 1 unlinks successfully
    const t1Unlinked = await repository.unlink(T1, U1);
    expect(t1Unlinked).toBe(true);
    expect(await repository.findLinkByTenantUser(T1, U1)).toBeNull();
  });
});
