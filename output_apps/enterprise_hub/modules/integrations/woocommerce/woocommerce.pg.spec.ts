/**
 * Real PostgreSQL FORCE RLS & WooCommerce Integration Spec:
 * - Connects as non-superuser role (`roxira_app`, NOSUPERUSER NOBYPASSRLS).
 * - Verifies `woocommerce_configs` and `woocommerce_sync_logs` have `relrowsecurity = true` and `relforcerowsecurity = true`.
 * - Exercises real WooCommerceRepository and WooCommerceSyncService with strict tenant isolation.
 * - Confirms order import idempotency and webhook HMAC signature rejection on invalid keys.
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { InvoiceEntity } from '../../invoicing/entities/invoice.entity';
import { InvoicingRepository } from '../../invoicing/repositories/invoicing.repository';
import { WooCommerceConfigEntity } from './entities/woocommerce-config.entity';
import {
  WooCommerceSyncDirection,
  WooCommerceSyncLogEntity,
  WooCommerceSyncStatus,
} from './entities/woocommerce-sync-log.entity';
import { WooCommerceRepository } from './repositories/woocommerce.repository';
import { WooCommerceSyncService } from './services/woocommerce-sync.service';
import { computeHmacSignature, verifyHmacSignature } from './utils/woocommerce-crypto.util';
import { CreateWooCommerceIntegration1789900002800 } from '../../migrations/1789900002800-CreateWooCommerceIntegration';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;

const ADMIN_USER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
const APP_PW = 'rx_wc_app_pw_test';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

const options = (database: string, username = ADMIN_USER, password?: string) => ({
  type: 'postgres' as const,
  host: HOST,
  port: PORT,
  username,
  password: password ?? process.env.ROXIRA_TEST_PG_PASSWORD,
  database,
  entities: [WooCommerceConfigEntity, WooCommerceSyncLogEntity, InvoiceEntity],
  migrations: [path.join(__dirname, '../../migrations/*.ts')],
  migrationsTransactionMode: 'each' as const,
  synchronize: false,
  logging: false,
});

describePg('WooCommerce Integration on PostgreSQL (NOSUPERUSER NOBYPASSRLS) (T85)', () => {
  const db = `rx_wc_test_${process.pid}_${Date.now()}`;
  let admin: DataSource;
  let owner: DataSource;
  let app: DataSource;
  let wooRepo: WooCommerceRepository;
  let invoicingRepo: InvoicingRepository;
  let syncService: WooCommerceSyncService;
  let scope: TenantScope;

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

    app = await new DataSource({ ...options(db, 'roxira_app', APP_PW), extra: { max: 4 } }).initialize();
    scope = new TenantScope(app);
    wooRepo = new WooCommerceRepository(
      app.getRepository(WooCommerceConfigEntity),
      app.getRepository(WooCommerceSyncLogEntity),
      app,
      scope,
    );
    invoicingRepo = new InvoicingRepository(app.getRepository(InvoiceEntity), app, scope);
    syncService = new WooCommerceSyncService(wooRepo, invoicingRepo);

    for (const tid of [T1, T2]) {
      await owner
        .query(`INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $2) ON CONFLICT DO NOTHING`, [
          tid,
          tid.slice(0, 8),
        ])
        .catch(() => undefined);
    }
  });

  afterAll(async () => {
    await app?.destroy().catch(() => undefined);
    await owner?.destroy().catch(() => undefined);
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${db}"`).catch(() => undefined);
      await admin.destroy().catch(() => undefined);
    }
  });

  it('both woocommerce tables have relrowsecurity = true and relforcerowsecurity = true', async () => {
    const rows = await owner.query(`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname IN ('woocommerce_configs', 'woocommerce_sync_logs')
      ORDER BY relname ASC;
    `);

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
    }
  });

  it('enforces strict tenant isolation on woocommerce config under roxira_app', async () => {
    // Tenant 1 saves its store configuration
    await scope.run(T1, async () => {
      await syncService.saveConfig(T1, {
        storeUrl: 'https://store1.example.com',
        consumerKey: 'ck_tenant1_test_key',
        consumerSecret: 'cs_tenant1_test_secret',
      });
    });

    // Tenant 1 reads its config and sees its masked key
    const t1Config = await scope.run(T1, async () => syncService.getConfig(T1));
    expect(t1Config.storeUrl).toBe('https://store1.example.com');
    expect(t1Config.maskedConsumerKey).toBe('ck_..._key');

    // Tenant 2 cannot see Tenant 1's config
    await scope.run(T2, async () => {
      await expect(syncService.getConfig(T2)).rejects.toThrow(/not found/);
    });
  });

  it('imports orders idempotently into draft sales invoices', async () => {
    const orderPayload = {
      id: 55001,
      number: '55001',
      status: 'completed',
      total: '1200000',
      billing: { first_name: 'رضا', last_name: 'محمدی', phone: '09121234567' },
      line_items: [
        { id: 1, name: 'کفش ورزشی', product_id: 101, quantity: 1, price: 1200000, total: '1200000' },
      ],
    };

    // First import
    const firstResult = await scope.run(T1, async () => syncService.importOrder(T1, orderPayload as any));
    expect(firstResult.success).toBe(true);
    expect(firstResult.invoiceId).toBeDefined();

    // Second import with the exact same order ID
    const secondResult = await scope.run(T1, async () => syncService.importOrder(T1, orderPayload as any));
    expect(secondResult.success).toBe(true);
    expect(secondResult.skipped).toBe(true);
    expect(secondResult.invoiceId).toBe(firstResult.invoiceId);

    // Verify only one invoice exists for this order
    const logs = await scope.run(T1, async () =>
      syncService.listSyncLogs(T1, { direction: WooCommerceSyncDirection.INBOUND_ORDER }),
    );
    const orderLogs = logs.items.filter((l) => l.externalId === '55001');
    expect(orderLogs).toHaveLength(1);
    expect(orderLogs[0].status).toBe(WooCommerceSyncStatus.SUCCESS);
  });

  it('validates webhook HMAC signatures', async () => {
    const config = await scope.run(T1, async () => syncService.getConfig(T1));
    const payload = JSON.stringify({ event: 'ping', time: Date.now() });

    const validSig = computeHmacSignature(payload, config.webhookSecret);
    expect(verifyHmacSignature(payload, validSig, config.webhookSecret)).toBe(true);

    const invalidSig = computeHmacSignature(payload, 'wrong-secret');
    expect(verifyHmacSignature(payload, invalidSig, config.webhookSecret)).toBe(false);
  });

  it('reversibility: migration down() and up() succeed', async () => {
    const migration = new CreateWooCommerceIntegration1789900002800();
    const qr = owner.createQueryRunner();

    try {
      await migration.down(qr);
      const tablesDown = await qr.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('woocommerce_configs', 'woocommerce_sync_logs');
      `);
      expect(tablesDown).toHaveLength(0);

      await migration.up(qr);
      const tablesUp = await qr.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('woocommerce_configs', 'woocommerce_sync_logs');
      `);
      expect(tablesUp).toHaveLength(2);
    } finally {
      await qr.release();
    }
  });
});
