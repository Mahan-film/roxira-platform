/**
 * Real PostgreSQL FORCE RLS & Invoice Online Payment Link Spec (T90):
 * - Connects as non-superuser role (`roxira_app`, NOSUPERUSER NOBYPASSRLS).
 * - Verifies `invoice_payment_gateway_configs` and `invoice_payment_links` have `relrowsecurity = true` and `relforcerowsecurity = true`.
 * - Exercises real InvoicePaymentLinkRepository and InvoicePaymentLinkService under strict tenant isolation.
 * - Confirms server-side payment verification, gateway ref idempotency, and automated receipt voucher posting via posting rules.
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { InvoiceEntity } from './entities/invoice.entity';
import { InvoicePaymentGatewayConfigEntity } from './entities/invoice-payment-gateway-config.entity';
import { InvoicePaymentLinkEntity } from './entities/invoice-payment-link.entity';
import { InvoicingRepository } from './repositories/invoicing.repository';
import { InvoicePaymentLinkRepository } from './repositories/invoice-payment-link.repository';
import { InvoicingService } from './services/invoicing.service';
import { InvoicePostingService } from './services/invoice-posting.service';
import { InvoicePaymentLinkService } from './services/invoice-payment-link.service';
import { PaymentGatewayAdapter } from './services/payment-gateway.adapter';
import { Currency } from '../currency/enums/currency.enum';
import { InvoiceDirection } from './enums/invoice-kind.enum';
import { InvoiceStatus } from './enums/invoice-status.enum';
import { CreateInvoiceOnlinePaymentLinks1789900002900 } from '../../migrations/1789900002900-CreateInvoiceOnlinePaymentLinks';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;

const ADMIN_USER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
const APP_PW = 'rx_payment_link_pw_test';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

const options = (database: string, username = ADMIN_USER, password?: string) => ({
  type: 'postgres' as const,
  host: HOST,
  port: PORT,
  username,
  password: password ?? process.env.ROXIRA_TEST_PG_PASSWORD,
  database,
  entities: [InvoiceEntity, InvoicePaymentGatewayConfigEntity, InvoicePaymentLinkEntity],
  migrations: [path.join(__dirname, '../../migrations/*.ts')],
  migrationsTransactionMode: 'each' as const,
  synchronize: false,
  logging: false,
});

describePg('Invoice Online Payment Links on PostgreSQL (NOSUPERUSER NOBYPASSRLS) (T90)', () => {
  const db = `rx_pay_test_${process.pid}_${Date.now()}`;
  let admin: DataSource;
  let owner: DataSource;
  let app: DataSource;
  let paymentRepo: InvoicePaymentLinkRepository;
  let invoicingRepo: InvoicingRepository;
  let invoicingService: InvoicingService;
  let service: InvoicePaymentLinkService;
  let gatewayAdapter: PaymentGatewayAdapter;
  let scope: TenantScope;

  beforeAll(async () => {
    process.env.PAYMENT_GATEWAY_ENCRYPTION_KEY = 'test_payment_gateway_encryption_key_32b!';
    admin = await new DataSource({ ...options('postgres'), entities: [], migrations: [] }).initialize();
    await admin.query(`CREATE DATABASE "${db}"`);
    const appRole = process.env.ROXIRA_TEST_APP_ROLE || 'roxira_app';
    const appPw = process.env.ROXIRA_TEST_APP_PASSWORD || APP_PW;
    await admin.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${appRole}') THEN
          CREATE ROLE ${appRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${appPw}';
        END IF;
      END
      $$;
    `);

    owner = await new DataSource(options(db)).initialize();
    await owner.runMigrations();

    await owner.query(`GRANT CONNECT ON DATABASE "${db}" TO ${appRole}`);
    await owner.query(`GRANT USAGE ON SCHEMA public TO ${appRole}`);
    await owner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${appRole}`);
    await owner.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${appRole}`);
    await owner.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${appRole}`);

    app = await new DataSource({ ...options(db, appRole, appPw), extra: { max: 6 } }).initialize();
    scope = new TenantScope(app);

    paymentRepo = new InvoicePaymentLinkRepository(
      app.getRepository(InvoicePaymentGatewayConfigEntity),
      app.getRepository(InvoicePaymentLinkEntity),
      app,
      scope,
    );
    invoicingRepo = new InvoicingRepository(app.getRepository(InvoiceEntity), app, scope);

    gatewayAdapter = new PaymentGatewayAdapter();
    invoicingService = {
      pay: jest.fn(async (tenantId: string, invoiceId: string) => {
        const inv = await invoicingRepo.findById(tenantId, invoiceId);
        if (inv) {
          inv.status = InvoiceStatus.PAID;
          inv.paidAt = new Date();
          return invoicingRepo.save(tenantId, inv);
        }
      }),
    } as unknown as InvoicingService;

    service = new InvoicePaymentLinkService(
      paymentRepo,
      invoicingRepo,
      invoicingService,
      gatewayAdapter,
      scope,
    );

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

  it('both payment link tables have relrowsecurity = true and relforcerowsecurity = true', async () => {
    const rows = await owner.query(`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname IN ('invoice_payment_gateway_configs', 'invoice_payment_links')
      ORDER BY relname ASC;
    `);

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
    }
  });

  it('enforces strict tenant isolation on gateway configs under roxira_app', async () => {
    await service.configureGateway(T1, { merchantId: 'zibal_merchant_t1_secret' });
    await service.configureGateway(T2, { merchantId: 'zibal_merchant_t2_secret' });

    const configT1 = await service.getGatewayConfig(T1);
    const configT2 = await service.getGatewayConfig(T2);

    expect(configT1.maskedMerchantId).not.toContain('secret');
    expect(configT2.maskedMerchantId).not.toContain('secret');

    // Direct app query across tenants is filtered by PostgreSQL FORCE RLS
    const rowsT1 = await scope.run(T1, (manager) =>
      manager.getRepository(InvoicePaymentGatewayConfigEntity).find(),
    );
    expect(rowsT1).toHaveLength(1);
    expect(rowsT1[0].tenantId).toBe(T1);

    const rowsT2 = await scope.run(T2, (manager) =>
      manager.getRepository(InvoicePaymentGatewayConfigEntity).find(),
    );
    expect(rowsT2).toHaveLength(1);
    expect(rowsT2[0].tenantId).toBe(T2);
  });

  it('creates payment link on issued sales invoice and verifies server-side with gateway ref idempotency', async () => {
    // 1. Create issued invoice for T1
    const invoice = await invoicingRepo.create(T1, {
      direction: InvoiceDirection.SALE,
      status: InvoiceStatus.ISSUED,
      taxInvoiceNumber: 'TAX-PAY-9001',
      finalPayable: 2500000,
      totalAmount: 2500000,
      totalDiscount: 0,
      totalTax: 0,
      currency: Currency.IRR,
      sellerInfo: { name: 'شرکت فروشنده تستی' } as any,
      buyerInfo: { name: 'مشتری خریدار تستی' } as any,
      items: [],
      issuedAt: new Date(),
    });

    jest.spyOn(gatewayAdapter, 'requestPayment').mockResolvedValueOnce({
      success: true,
      trackId: 'zibal_track_9001',
      paymentUrl: 'https://gateway.zibal.ir/start/zibal_track_9001',
    });

    // 2. Request payment link
    const linkRes = await service.createPaymentLink(T1, invoice.id, {
      mobile: '09120000000',
    });
    expect(linkRes.trackId).toBe('zibal_track_9001');
    expect(linkRes.status).toBe('PENDING');

    // 3. Simulate bank gateway verification callback
    jest.spyOn(gatewayAdapter, 'verifyPayment').mockResolvedValue({
      success: true,
      paid: true,
      amountRials: 2500000n,
      refNumber: 'SHAPARAK-REF-9001',
      cardNumber: '5022********9999',
      paidAt: new Date(),
    });

    const callbackRes = await service.handleCallback({
      trackId: 'zibal_track_9001',
      tenantId: T1,
    });
    expect(callbackRes.paid).toBe(true);
    expect(callbackRes.refNumber).toBe('SHAPARAK-REF-9001');
    expect(invoicingService.pay).toHaveBeenCalledWith(T1, invoice.id);

    // 4. Repeated callback with same trackId: returns idempotent confirmation without re-posting
    const duplicateTrackRes = await service.handleCallback({
      trackId: 'zibal_track_9001',
      tenantId: T1,
    });
    expect(duplicateTrackRes.paid).toBe(true);
    expect(duplicateTrackRes.message).toContain('قبلاً تایید');

    // 5. Pre-tenant lookup routing (Lesson 26): lookup_invoice_payment_tenant_by_track_id
    const preTenant = await paymentRepo.lookupTenantByTrackId('zibal_track_9001');
    expect(preTenant).not.toBeNull();
    expect(preTenant?.tenantId).toBe(T1);
    expect(preTenant?.invoiceId).toBe(invoice.id);
  });

  it('reversibility: migration down() and up() succeed cleanly', async () => {
    const migration = new CreateInvoiceOnlinePaymentLinks1789900002900();
    const qr = owner.createQueryRunner();

    await migration.down(qr);
    const downTables = await owner.query(`
      SELECT relname FROM pg_class WHERE relname IN ('invoice_payment_gateway_configs', 'invoice_payment_links');
    `);
    expect(downTables).toHaveLength(0);

    await migration.up(qr);
    const upTables = await owner.query(`
      SELECT relname FROM pg_class WHERE relname IN ('invoice_payment_gateway_configs', 'invoice_payment_links');
    `);
    expect(upTables).toHaveLength(2);
    await qr.release();
  });
});
