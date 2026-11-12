/**
 * Real PostgreSQL FORCE RLS & WooCommerce Integration Spec:
 * - Connects as non-superuser role (`roxira_app`, NOSUPERUSER NOBYPASSRLS) via createTestDatabase.
 * - Verifies `woocommerce_configs` and `woocommerce_sync_logs` have `relrowsecurity = true` and `relforcerowsecurity = true`.
 * - Exercises real WooCommerceRepository and WooCommerceSyncService with strict tenant isolation.
 * - Confirms secret preservation on partial re-save and concurrent order import idempotency under advisory lock + unique partial index.
 */
import 'reflect-metadata';
import { CurrencyService } from '../../currency/services/currency.service';
import { InvoiceEntity } from '../../invoicing/entities/invoice.entity';
import { InvoicingRepository } from '../../invoicing/repositories/invoicing.repository';
import { CreateWooCommerceIntegration1789900003400 } from '../../../migrations/1789900003400-CreateWooCommerceIntegration';
import {
  createTestDatabase,
  describePg,
  TestDatabaseContext,
  TEST_T1 as T1,
  TEST_T2 as T2,
} from '../../../test/support/test-pg';
import { WooCommerceConfigEntity } from './entities/woocommerce-config.entity';
import {
  WooCommerceSyncDirection,
  WooCommerceSyncLogEntity,
  WooCommerceSyncStatus,
} from './entities/woocommerce-sync-log.entity';
import { WooCommerceRepository } from './repositories/woocommerce.repository';
import { WooCommerceSyncService } from './services/woocommerce-sync.service';
import { computeHmacSignature, verifyHmacSignature } from './utils/woocommerce-crypto.util';

describePg('WooCommerce Integration on PostgreSQL (NOSUPERUSER NOBYPASSRLS) (T85)', () => {
  let testDb: TestDatabaseContext;
  let wooRepo: WooCommerceRepository;
  let invoicingRepo: InvoicingRepository;
  let syncService: WooCommerceSyncService;

  beforeAll(async () => {
    process.env.WOOCOMMERCE_KEY_ENCRYPTION_KEY =
      process.env.WOOCOMMERCE_KEY_ENCRYPTION_KEY || 'test_woocommerce_encryption_key_32b!';

    testDb = await createTestDatabase('wc');

    wooRepo = new WooCommerceRepository(
      testDb.app.getRepository(WooCommerceConfigEntity),
      testDb.app.getRepository(WooCommerceSyncLogEntity),
      testDb.app,
      testDb.scope,
    );
    invoicingRepo = new InvoicingRepository(
      testDb.app.getRepository(InvoiceEntity),
      testDb.app,
      testDb.scope,
    );
    const currencyService = new CurrencyService({ get: () => '' } as any);
    syncService = new WooCommerceSyncService(wooRepo, invoicingRepo, currencyService);

    for (const tid of [T1, T2]) {
      await testDb
        .rawQuery(`INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $2) ON CONFLICT DO NOTHING`, [
          tid,
          tid.slice(0, 8),
        ])
        .catch(() => undefined);
    }
  }, 120_000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('both woocommerce tables have relrowsecurity = true and relforcerowsecurity = true', async () => {
    const rows = await testDb.rawQuery<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(`
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

  it('enforces strict tenant isolation and preserves encrypted webhook secret on re-save under roxira_app', async () => {
    await syncService.saveConfig(T1, {
      storeUrl: 'https://store1.example.com',
      consumerKey: 'ck_tenant1_test_key',
      consumerSecret: 'cs_tenant1_test_secret',
      webhookSecret: 'whsec_secret_1234',
    });

    const t1Config = await syncService.getConfig(T1);
    expect(t1Config.storeUrl).toBe('https://store1.example.com');
    expect(t1Config.maskedConsumerKey).toBe('ck_..._key');
    expect(t1Config.webhookSecret).toBe('...1234');

    // Re-save without keys or with masked webhook secret preserves the real secret in DB
    await syncService.saveConfig(T1, {
      storeUrl: 'https://store1.example.com',
      webhookSecret: t1Config.webhookSecret,
      autoSyncStock: false,
    });
    expect(await syncService.getWebhookSecret(T1)).toBe('whsec_secret_1234');

    // Raw DB row has encrypted webhook secret (not plaintext)
    const [rawCfg] = await testDb.rawQuery<{ webhook_secret: string }>(
      `SELECT webhook_secret FROM woocommerce_configs WHERE tenant_id = $1`,
      [T1],
    );
    expect(rawCfg.webhook_secret).toMatch(/^v1\./);
    expect(rawCfg.webhook_secret).not.toContain('whsec_secret_1234');

    // Tenant 2 cannot see Tenant 1's config
    await expect(syncService.getConfig(T2)).rejects.toThrow(/not found/);
  });

  it('imports orders idempotently even under concurrent webhook deliveries', async () => {
    const orderPayload = {
      id: 55001,
      number: '55001',
      status: 'completed',
      currency: 'IRR',
      total: '1200000',
      total_tax: '0',
      billing: { first_name: 'رضا', last_name: 'محمدی', phone: '09121234567' },
      line_items: [
        { id: 1, name: 'کفش ورزشی', product_id: 101, quantity: 1, price: 1200000, total: '1200000' },
      ],
    };

    const [resA, resB] = await Promise.all([
      syncService.importOrder(T1, orderPayload as any),
      syncService.importOrder(T1, orderPayload as any),
    ]);

    expect(resA.success).toBe(true);
    expect(resB.success).toBe(true);
    expect(resA.invoiceId).toBeDefined();
    expect(resB.invoiceId).toBe(resA.invoiceId);
    expect([resA.skipped, resB.skipped].filter(Boolean)).toHaveLength(1);

    const logs = await syncService.listSyncLogs(T1, {
      direction: WooCommerceSyncDirection.INBOUND_ORDER,
    });
    const orderLogs = logs.items.filter((l) => l.externalId === '55001');
    expect(orderLogs).toHaveLength(1);
    expect(orderLogs[0].status).toBe(WooCommerceSyncStatus.SUCCESS);

    const savedInvoice = await invoicingRepo.findById(T1, resA.invoiceId!);
    expect(savedInvoice).not.toBeNull();
    expect(Number(savedInvoice!.exchangeRate)).toBeCloseTo(1 / 920000, 6);
    expect(Number(savedInvoice!.fxRate)).toBe(1);
    expect(Number(savedInvoice!.baseFinalPayable)).toBeCloseTo(1.3, 2);
  });

  it('validates webhook HMAC signatures against decrypted webhook secret', async () => {
    const realSecret = await syncService.getWebhookSecret(T1);
    expect(realSecret).toBe('whsec_secret_1234');
    const payload = JSON.stringify({ event: 'ping', time: Date.now() });

    const validSig = computeHmacSignature(payload, realSecret!);
    expect(verifyHmacSignature(payload, validSig, realSecret!)).toBe(true);

    const invalidSig = computeHmacSignature(payload, 'wrong-secret');
    expect(verifyHmacSignature(payload, invalidSig, realSecret!)).toBe(false);
  });

  it('reversibility: migration down() and up() succeed', async () => {
    const migration = new CreateWooCommerceIntegration1789900003400();
    const qr = testDb.owner.createQueryRunner();

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
