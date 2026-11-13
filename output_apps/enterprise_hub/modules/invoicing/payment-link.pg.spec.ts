/**
 * Real PostgreSQL FORCE RLS & Invoice Online Payment Link Spec (T90):
 * - Connects as non-superuser role (`roxira_app`, NOSUPERUSER NOBYPASSRLS) via createTestDatabase.
 * - Verifies `invoice_payment_gateway_configs` and `invoice_payment_links` have `relrowsecurity = true` and `relforcerowsecurity = true`.
 * - Exercises real InvoicePaymentLinkRepository, InvoicePaymentLinkService, InvoicingService and InvoicePostingService under strict tenant isolation.
 * - Confirms server-side payment verification, fail-closed amount validation, atomic concurrency locking, and automated receipt voucher posting via posting rules.
 */
import 'reflect-metadata';
import * as crypto from 'crypto';
import { Queue } from 'bullmq';
import { AccountingRepository } from '../accounting/repositories/accounting.repository';
import { AccountingService } from '../accounting/services/accounting.service';
import { Currency } from '../currency/enums/currency.enum';
import { CurrencyService } from '../currency/services/currency.service';
import { FifoBatchEntity } from '../inventory/entities/fifo-batch.entity';
import { StockItemEntity } from '../inventory/entities/stock-item.entity';
import { WarehouseEntity } from '../inventory/entities/warehouse.entity';
import { InventoryRepository } from '../inventory/repositories/inventory.repository';
import { StockDocumentsRepository } from '../inventory/repositories/stock-documents.repository';
import { InventoryService } from '../inventory/services/inventory.service';
import { PostingRulesRepository } from '../posting_rules/repositories/posting-rules.repository';
import { PostingRulesService } from '../posting_rules/services/posting-rules.service';
import { CreateInvoiceOnlinePaymentLinks1789900004500 } from '../../migrations/1789900004500-CreateInvoiceOnlinePaymentLinks';
import {
  createTestDatabase,
  describePg,
  TestDatabaseContext,
  TEST_T1 as T1,
  TEST_T2 as T2,
} from '../../test/support/test-pg';
import { InvoiceEntity } from './entities/invoice.entity';
import { InvoicePaymentGatewayConfigEntity } from './entities/invoice-payment-gateway-config.entity';
import { InvoicePaymentLinkEntity } from './entities/invoice-payment-link.entity';
import { InvoiceDirection } from './enums/invoice-kind.enum';
import { InvoiceStatus } from './enums/invoice-status.enum';
import { InvoicePaymentLinkRepository } from './repositories/invoice-payment-link.repository';
import { InvoicingRepository } from './repositories/invoicing.repository';
import { InvoicePaymentLinkService } from './services/invoice-payment-link.service';
import { InvoicePostingService } from './services/invoice-posting.service';
import { InvoicingService } from './services/invoicing.service';
import { PaymentGatewayAdapter } from './services/payment-gateway.adapter';

describePg('Invoice Online Payment Links on PostgreSQL (NOSUPERUSER NOBYPASSRLS) (T90)', () => {
  let testDb: TestDatabaseContext;
  let paymentRepo: InvoicePaymentLinkRepository;
  let invoicingRepo: InvoicingRepository;
  let invoicingService: InvoicingService;
  let postingService: InvoicePostingService;
  let service: InvoicePaymentLinkService;
  let gatewayAdapter: PaymentGatewayAdapter;

  beforeAll(async () => {
    process.env.PAYMENT_GATEWAY_ENCRYPTION_KEY =
      process.env.PAYMENT_GATEWAY_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
    process.env.PAYMENT_GATEWAY_CALLBACK_BASE_URL = 'https://app.example.test';

    testDb = await createTestDatabase('pay_link');

    const currencyStub = {
      convert: (v: number) => v,
      round: (v: number) => v,
    } as unknown as CurrencyService;
    const accounting = new AccountingService(
      new AccountingRepository(testDb.scope),
      currencyStub,
    );
    const inventory = new InventoryService(
      new InventoryRepository(
        testDb.app.getRepository(WarehouseEntity),
        testDb.app.getRepository(StockItemEntity),
        testDb.app.getRepository(FifoBatchEntity),
        testDb.app,
      ),
    );
    invoicingRepo = new InvoicingRepository(
      testDb.app.getRepository(InvoiceEntity),
      testDb.app,
      testDb.scope,
    );
    postingService = new InvoicePostingService(
      invoicingRepo,
      inventory,
      accounting,
      new PostingRulesService(new PostingRulesRepository(testDb.scope), accounting),
      new StockDocumentsRepository(testDb.app),
    );

    const inlineQueue = {
      add: async (_name: string, payload: { tenantId: string; invoiceId: string; status: InvoiceStatus }) => {
        if (payload.status === InvoiceStatus.PAID) {
          await postingService.postPaid(payload);
        }
      },
    } as unknown as Queue;

    invoicingService = new InvoicingService(
      invoicingRepo,
      currencyStub,
      undefined,
      undefined,
      undefined,
      inlineQueue,
    );

    paymentRepo = new InvoicePaymentLinkRepository(
      testDb.app.getRepository(InvoicePaymentGatewayConfigEntity),
      testDb.app.getRepository(InvoicePaymentLinkEntity),
      testDb.app,
      testDb.scope,
    );

    gatewayAdapter = new PaymentGatewayAdapter();
    service = new InvoicePaymentLinkService(
      paymentRepo,
      invoicingRepo,
      invoicingService,
      gatewayAdapter,
      testDb.scope,
    );

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

  it('both payment link tables have relrowsecurity = true and relforcerowsecurity = true', async () => {
    const rows = await testDb.rawQuery<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(`
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

  it('enforces strict tenant isolation on gateway configs and payment links under roxira_app', async () => {
    await service.configureGateway(T1, { merchantId: 'zibal_merchant_t1_secret' });
    await service.configureGateway(T2, { merchantId: 'zibal_merchant_t2_secret' });

    const configT1 = await service.getGatewayConfig(T1);
    const configT2 = await service.getGatewayConfig(T2);

    expect(configT1.maskedMerchantId).toBe('****cret');
    expect(configT2.maskedMerchantId).toBe('****cret');
    expect(configT1.maskedMerchantId).not.toContain('zibal_merchant');

    const rowsT1 = await testDb.scope.run(T1, (manager) =>
      manager.getRepository(InvoicePaymentGatewayConfigEntity).find(),
    );
    expect(rowsT1).toHaveLength(1);
    expect(rowsT1[0].tenantId).toBe(T1);

    const rowsT2 = await testDb.scope.run(T2, (manager) =>
      manager.getRepository(InvoicePaymentGatewayConfigEntity).find(),
    );
    expect(rowsT2).toHaveLength(1);
    expect(rowsT2[0].tenantId).toBe(T2);
  });

  it('creates payment link, verifies server-side with amount check, posts real receipt voucher, and blocks concurrent duplicates', async () => {
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
      issuedAt: new Date('2026-09-10T12:00:00Z'),
    });

    jest.spyOn(gatewayAdapter, 'requestPayment').mockResolvedValueOnce({
      success: true,
      trackId: 'zibal_track_9001',
      paymentUrl: 'https://gateway.zibal.ir/start/zibal_track_9001',
    });

    const linkRes = await service.createPaymentLink(T1, invoice.id, {
      mobile: '09120000000',
    });
    expect(linkRes.trackId).toBe('zibal_track_9001');
    expect(linkRes.status).toBe('PENDING');

    // Cross-tenant isolation on invoice_payment_links: T2 cannot see T1's link
    const t2Links = await testDb.scope.run(T2, (manager) =>
      manager.getRepository(InvoicePaymentLinkEntity).find(),
    );
    expect(t2Links.some((l) => l.trackId === 'zibal_track_9001')).toBe(false);

    // Pre-tenant SECURITY DEFINER lookup works under roxira_app
    const preTenant = await paymentRepo.lookupTenantByTrackId('zibal_track_9001');
    expect(preTenant).toEqual({
      tenantId: T1,
      invoiceId: invoice.id,
      status: 'PENDING',
    });

    // Simulate concurrent GET + POST callbacks arriving together
    const verifySpy = jest.spyOn(gatewayAdapter, 'verifyPayment').mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return {
        success: true,
        paid: true,
        amountRials: 2500000n,
        refNumber: 'SHAPARAK-REF-9001',
        cardNumber: '5022********9999',
        paidAt: new Date('2026-09-10T12:05:00Z'),
      };
    });

    const [cb1, cb2] = await Promise.all([
      service.handleCallback({ trackId: 'zibal_track_9001' }),
      service.handleCallback({ trackId: 'zibal_track_9001' }),
    ]);

    expect(verifySpy).toHaveBeenCalledTimes(1);
    expect([cb1.paid, cb2.paid].filter(Boolean)).toHaveLength(1);

    // Real invoice state and real posted receipt voucher in PostgreSQL
    const paidInvoice = await invoicingRepo.findById(T1, invoice.id);
    expect(paidInvoice?.status).toBe(InvoiceStatus.PAID);
    expect(paidInvoice?.postingError).toBeNull();
    expect(paidInvoice?.paidJournalEntryId).toBeTruthy();

    const journalRows = await testDb.rawQuery<{ id: string; description: string }>(
      `SELECT id, description FROM fin_journal_entries WHERE tenant_id = $1 AND id = $2`,
      [T1, paidInvoice!.paidJournalEntryId],
    );
    expect(journalRows).toHaveLength(1);
    expect(journalRows[0].description).toContain('TAX-PAY-9001');

    // Repeated callback after PAID returns idempotent success without re-verifying
    verifySpy.mockClear();
    const duplicateTrackRes = await service.handleCallback({ trackId: 'zibal_track_9001' });
    expect(duplicateTrackRes.paid).toBe(true);
    expect(duplicateTrackRes.message).toContain('قبلاً تایید');
    expect(verifySpy).not.toHaveBeenCalled();

    // Issuing a second payment link for the same invoice fails closed
    await expect(service.createPaymentLink(T1, invoice.id)).rejects.toThrow();
  });

  it('reclaims stale VERIFYING link and settles PAID_UNSETTLED links on callback retry in PG', async () => {
    const invoice = await invoicingRepo.create(T1, {
      direction: InvoiceDirection.SALE,
      status: InvoiceStatus.ISSUED,
      taxInvoiceNumber: 'TAX-PAY-9003',
      finalPayable: 1500000,
      totalAmount: 1500000,
      totalDiscount: 0,
      totalTax: 0,
      currency: Currency.IRR,
      sellerInfo: { name: 'فروشنده' } as any,
      buyerInfo: { name: 'خریدار' } as any,
      items: [],
      issuedAt: new Date('2026-09-10T12:00:00Z'),
    });

    jest.spyOn(gatewayAdapter, 'requestPayment').mockResolvedValueOnce({
      success: true,
      trackId: 'zibal_track_stale_retry',
      paymentUrl: 'https://gateway.zibal.ir/start/zibal_track_stale_retry',
    });
    await service.createPaymentLink(T1, invoice.id);

    // Block issuing a duplicate link while PENDING
    await expect(service.createPaymentLink(T1, invoice.id)).rejects.toThrow();

    // Simulate a crashed worker leaving row stuck in VERIFYING for > 2 minutes
    await testDb.rawQuery(
      `UPDATE invoice_payment_links SET status = 'VERIFYING', updated_at = NOW() - INTERVAL '5 minutes' WHERE track_id = $1`,
      ['zibal_track_stale_retry'],
    );

    jest.spyOn(gatewayAdapter, 'verifyPayment').mockResolvedValueOnce({
      success: true,
      paid: true,
      amountRials: 1500000n,
      refNumber: 'SHAPARAK-REF-9003',
      paidAt: new Date('2026-09-10T12:10:00Z'),
    });

    // Simulate transient settlement failure after Zibal verified payment
    const paySpy = jest
      .spyOn(invoicingService, 'pay')
      .mockRejectedValueOnce(new Error('temporary settlement error'));

    await expect(service.handleCallback({ trackId: 'zibal_track_stale_retry' })).rejects.toThrow(
      'temporary settlement error',
    );
    paySpy.mockRestore();

    const midLink = await paymentRepo.findPaymentLinkByTrackId(T1, 'zibal_track_stale_retry');
    expect(midLink?.status).toBe('PAID_UNSETTLED');
    expect(midLink?.gatewayRef).toBe('SHAPARAK-REF-9003');

    // Retry completes settlement without re-calling Zibal
    const retryRes = await service.handleCallback({ trackId: 'zibal_track_stale_retry' });
    expect(retryRes.success).toBe(true);
    expect(retryRes.paid).toBe(true);

    const finalLink = await paymentRepo.findPaymentLinkByTrackId(T1, 'zibal_track_stale_retry');
    expect(finalLink?.status).toBe('PAID');
    const settledInv = await invoicingRepo.findById(T1, invoice.id);
    expect(settledInv?.status).toBe(InvoiceStatus.PAID);
  });

  it('fails closed in DB when gateway verify returns missing or mismatched amount', async () => {
    const invoice = await invoicingRepo.create(T1, {
      direction: InvoiceDirection.SALE,
      status: InvoiceStatus.ISSUED,
      taxInvoiceNumber: 'TAX-PAY-9002',
      finalPayable: 1000000,
      totalAmount: 1000000,
      totalDiscount: 0,
      totalTax: 0,
      currency: Currency.IRR,
      sellerInfo: { name: 'فروشنده' } as any,
      buyerInfo: { name: 'خریدار' } as any,
      items: [],
      issuedAt: new Date('2026-09-10T12:00:00Z'),
    });

    jest.spyOn(gatewayAdapter, 'requestPayment').mockResolvedValueOnce({
      success: true,
      trackId: 'zibal_track_bad_amt',
      paymentUrl: 'https://gateway.zibal.ir/start/zibal_track_bad_amt',
    });
    await service.createPaymentLink(T1, invoice.id);

    jest.spyOn(gatewayAdapter, 'verifyPayment').mockResolvedValueOnce({
      success: true,
      paid: true,
      amountRials: undefined,
      refNumber: 'REF-NO-AMT-PG',
    });

    const res = await service.handleCallback({ trackId: 'zibal_track_bad_amt' });
    expect(res.paid).toBe(false);

    const link = await paymentRepo.findPaymentLinkByTrackId(T1, 'zibal_track_bad_amt');
    expect(link?.status).toBe('RECONCILIATION_REQUIRED');
    const invAfter = await invoicingRepo.findById(T1, invoice.id);
    expect(invAfter?.status).toBe(InvoiceStatus.ISSUED);
  });

  it('reversibility: migration down() and up() succeed cleanly', async () => {
    const migration = new CreateInvoiceOnlinePaymentLinks1789900004500();
    const qr = testDb.owner.createQueryRunner();

    await migration.down(qr);
    const downTables = await testDb.rawQuery(
      `SELECT relname FROM pg_class WHERE relname IN ('invoice_payment_gateway_configs', 'invoice_payment_links')`,
    );
    expect(downTables).toHaveLength(0);

    await migration.up(qr);
    const upTables = await testDb.rawQuery(
      `SELECT relname FROM pg_class WHERE relname IN ('invoice_payment_gateway_configs', 'invoice_payment_links')`,
    );
    expect(upTables).toHaveLength(2);
    await qr.release();
  });
});
