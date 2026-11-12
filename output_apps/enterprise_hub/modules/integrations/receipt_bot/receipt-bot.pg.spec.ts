/**
 * Tenant RLS isolation spec for Telegram Receipt Bot Integration (T87 / WAVE 8).
 * Exercises ReceiptBotRepository under a NOSUPERUSER NOBYPASSRLS role with TenantScope
 * and proves:
 *  1. FORCE ROW LEVEL SECURITY on `receipt_bot_link_codes` and `receipt_bot_user_links`.
 *  2. Tenant isolation: Tenant 1 link codes and user links cannot be read or modified by Tenant 2.
 *  3. SECURITY DEFINER pre-tenant functions refuse cross-tenant link hijack, enforce idempotency,
 *     and revoke PUBLIC EXECUTE.
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { APP_PASSWORD } from '../../../test/support/test-pg';
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
const ROLE_PW = APP_PASSWORD;

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
       GRANT EXECUTE ON FUNCTION receipt_bot_consume_code(text, text, text) TO "${ROLE_NAME}";
       GRANT EXECUTE ON FUNCTION receipt_bot_claim_update(text, bigint) TO "${ROLE_NAME}";`,
    );

    appDs = await new DataSource(dsOptions(db, ROLE_NAME, ROLE_PW)).initialize();
    scope = new TenantScope(appDs);
    repository = new ReceiptBotRepository(
      appDs.getRepository(ReceiptBotLinkCodeEntity),
      appDs.getRepository(ReceiptBotUserLinkEntity),
      scope,
    );
  }, 60_000);

  afterAll(async () => {
    await appDs?.destroy();
    await ownerDs?.destroy();
    if (adminDs) {
      await adminDs.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
      await adminDs.query(`DROP ROLE IF EXISTS "${ROLE_NAME}"`);
      await adminDs.destroy();
    }
  }, 30_000);

  it('enforces FORCE ROW LEVEL SECURITY on receipt bot tables', async () => {
    const rows = await ownerDs.query(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      WHERE c.relname IN ('receipt_bot_link_codes', 'receipt_bot_user_links');
    `);

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
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

  it('consumes link code via SECURITY DEFINER function under non-superuser role and refuses cross-tenant hijack', async () => {
    // Consume code for Telegram user 987654321
    const consumed = await repository.consumeCode('123456', '987654321', 'telegram_tester');
    expect(consumed.status).toBe('linked');
    expect(consumed.link?.tenantId).toBe(T1);
    expect(consumed.link?.userId).toBe(U1);

    // Code is now marked used and cannot be consumed again
    const secondTry = await repository.consumeCode('123456', '987654321', 'telegram_tester');
    expect(secondTry).toEqual({ status: 'invalid', link: null });

    // A code generated in Tenant 2 must NOT silently steal an existing Tenant 1 Telegram link
    await repository.createLinkCode(T2, U2, '654321', new Date(Date.now() + 600_000));
    const hijackTry = await repository.consumeCode('654321', '987654321', 'telegram_tester');
    expect(hijackTry).toEqual({ status: 'already_linked_other_tenant', link: null });

    // Pre-tenant lookup resolves the original Tenant 1 linked user intact
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

  it('receipt_bot_claim_update is idempotent per (bot, update_id) and all SECURITY DEFINER functions revoke PUBLIC EXECUTE', async () => {
    const first = await repository.claimUpdate('bot1', 424242);
    const retry = await repository.claimUpdate('bot1', 424242);
    const otherBot = await repository.claimUpdate('bot2', 424242);
    expect([first, retry, otherBot]).toEqual([true, false, true]);
    const pub = await ownerDs.query(
      `SELECT
         has_function_privilege('public', 'receipt_bot_lookup_link(text)', 'EXECUTE') AS lookup_p,
         has_function_privilege('public', 'receipt_bot_consume_code(text, text, text)', 'EXECUTE') AS consume_p,
         has_function_privilege('public', 'receipt_bot_claim_update(text, bigint)', 'EXECUTE') AS claim_p`,
    );
    expect(pub[0]).toEqual({ lookup_p: false, consume_p: false, claim_p: false });
  });
});
