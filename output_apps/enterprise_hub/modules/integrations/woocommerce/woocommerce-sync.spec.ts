import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { BASE_CURRENCY, DEFAULT_RATES_PER_USD } from '../../currency/constants/currency.constants';
import { Currency } from '../../currency/enums/currency.enum';
import { CurrencyService } from '../../currency/services/currency.service';
import { InvoiceJurisdiction } from '../../invoicing/enums/invoice-jurisdiction.enum';
import { WooCommerceWebhookController } from './controllers/woocommerce-webhook.controller';
import {
  WooCommerceSyncDirection,
  WooCommerceSyncStatus,
} from './entities/woocommerce-sync-log.entity';
import { WooCommerceSyncService } from './services/woocommerce-sync.service';
import {
  assertSafeStoreUrl,
  computeHmacSignature,
  maskApiKey,
  openSecret,
  sealSecret,
  verifyHmacSignature,
} from './utils/woocommerce-crypto.util';

describe('WooCommerce Crypto, Controller & Sync Logic (Unit Specs)', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const tenantB = '22222222-2222-4222-8222-222222222222';

  beforeAll(() => {
    process.env.WOOCOMMERCE_KEY_ENCRYPTION_KEY = 'test_woocommerce_encryption_key_32b!';
  });

  describe('Credential Encryption, Masking & SSRF Guard', () => {
    it('seals and opens credentials with tenant AAD binding', () => {
      const plaintext = 'ck_secr3t_token_12345';
      const sealed = sealSecret(plaintext, tenantId);

      expect(sealed).toMatch(/^v1\./);
      expect(sealed).not.toContain(plaintext);
      expect(openSecret(sealed, tenantId)).toBe(plaintext);
      expect(() => openSecret(sealed, tenantB)).toThrow();
    });

    it('masks consumer API keys cleanly without exposing secret characters', () => {
      expect(maskApiKey('ck_9a8b7c6d5e4f3a2b1c')).toBe('ck_...2b1c');
      expect(maskApiKey('cs_1a2b3c4d5e6f7a8b9c')).toBe('cs_...8b9c');
      expect(maskApiKey('short')).toBe('****');
      expect(maskApiKey('')).toBe('');
    });

    it('rejects private/loopback URLs (including bracketed IPv6 and http) in assertSafeStoreUrl', () => {
      expect(() => assertSafeStoreUrl('http://127.0.0.1/wp')).toThrow();
      expect(() => assertSafeStoreUrl('http://169.254.169.254/latest')).toThrow();
      expect(() => assertSafeStoreUrl('http://shop.example.com/store')).toThrow();
      expect(() => assertSafeStoreUrl('https://[::1]/wp')).toThrow();
      expect(() => assertSafeStoreUrl('https://[fd00::1]/wp')).toThrow();
      expect(() => assertSafeStoreUrl('https://[fe80::1]/wp')).toThrow();
      expect(() => assertSafeStoreUrl('ftp://shop.example.com')).toThrow();
      expect(assertSafeStoreUrl('https://shop.example.com/store').origin).toBe(
        'https://shop.example.com',
      );
    });
  });

  describe('HMAC-SHA256 Webhook Verification', () => {
    const webhookSecret = 'test_webhook_secret_key_123';
    const payload = JSON.stringify({ id: 101, status: 'processing', total: '500000' });

    it('validates matching HMAC signature and rejects tampering', () => {
      const sig = computeHmacSignature(payload, webhookSecret);
      expect(verifyHmacSignature(payload, sig, webhookSecret)).toBe(true);

      const tampered = JSON.stringify({ id: 101, status: 'processing', total: '999999' });
      expect(verifyHmacSignature(tampered, sig, webhookSecret)).toBe(false);
      expect(verifyHmacSignature(payload, 'bad_signature', webhookSecret)).toBe(false);
      expect(verifyHmacSignature(payload, sig, 'wrong_secret')).toBe(false);
    });
  });

  describe('WooCommerceSyncService Config, Import & Outbound Stock Push', () => {
    let service: WooCommerceSyncService;
    let mockWooRepo: any;
    let mockInvoicingRepo: any;

    beforeEach(() => {
      mockWooRepo = {
        findConfig: jest.fn().mockResolvedValue(null),
        saveConfig: jest.fn().mockImplementation(async (_t: string, data: any) => ({
          ...data,
          lastSyncAt: null,
          updatedAt: new Date(),
        })),
        withOrderLock: jest.fn((_t: string, _ext: string, fn: any) => fn(undefined)),
        findSyncLogByExternalId: jest.fn().mockResolvedValue(null),
        createSyncLog: jest.fn().mockResolvedValue({}),
        listSyncLogs: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      };
      mockInvoicingRepo = {
        create: jest.fn().mockResolvedValue({ id: 'inv-uuid-101' }),
      };
      const currencyService = new CurrencyService({ get: () => '' } as any);
      service = new WooCommerceSyncService(mockWooRepo, mockInvoicingRepo, currencyService);
    });

    it('returns generatedWebhookSecret once on initial blank secret and saves real secrets containing dots', async () => {
      const autoSaved = await service.saveConfig(tenantId, {
        storeUrl: 'https://shop.example.com',
        consumerKey: 'ck_real_key_1234',
        consumerSecret: 'cs_real_secret_5678',
      });
      expect(autoSaved.generatedWebhookSecret).toMatch(/^[0-9a-f]{48}$/);
      expect(autoSaved.webhookSecret).toBe(`...${autoSaved.generatedWebhookSecret!.slice(-4)}`);

      const stored = mockWooRepo.saveConfig.mock.calls[0][1];
      mockWooRepo.findConfig.mockResolvedValue({
        tenantId,
        ...stored,
        lastSyncAt: null,
        updatedAt: new Date(),
      });

      const fetched = await service.getConfig(tenantId);
      expect(fetched.generatedWebhookSecret).toBeUndefined();

      const customUpdated = await service.saveConfig(tenantId, {
        storeUrl: 'https://shop.example.com',
        webhookSecret: 'sec...custom_with_dots_999',
      });
      expect(customUpdated.generatedWebhookSecret).toBeUndefined();
      const updatedStored = mockWooRepo.saveConfig.mock.calls[1][1];
      mockWooRepo.findConfig.mockResolvedValue({
        tenantId,
        ...updatedStored,
        lastSyncAt: null,
        updatedAt: new Date(),
      });
      expect(await service.getWebhookSecret(tenantId)).toBe('sec...custom_with_dots_999');
    });

    it('preserves existing encrypted keys and webhook secret on partial re-save', async () => {
      const initial = await service.saveConfig(tenantId, {
        storeUrl: 'https://shop.example.com',
        consumerKey: 'ck_real_key_1234',
        consumerSecret: 'cs_real_secret_5678',
        webhookSecret: 'whsec_real_secret_9999',
      });
      expect(initial.webhookSecret).toBe('...9999');

      const stored = mockWooRepo.saveConfig.mock.calls[0][1];
      mockWooRepo.findConfig.mockResolvedValue({
        tenantId,
        ...stored,
        lastSyncAt: null,
        updatedAt: new Date(),
      });

      const updated = await service.saveConfig(tenantId, {
        storeUrl: 'https://shop.example.com',
        webhookSecret: '...9999',
        autoSyncOrders: false,
      });

      expect(updated.autoSyncOrders).toBe(false);
      expect(await service.getWebhookSecret(tenantId)).toBe('whsec_real_secret_9999');
      const secondSave = mockWooRepo.saveConfig.mock.calls[1][1];
      expect(secondSave.consumerKeyEncrypted).toBe(stored.consumerKeyEncrypted);
      expect(secondSave.consumerSecretEncrypted).toBe(stored.consumerSecretEncrypted);
      expect(secondSave.webhookSecret).toBe(stored.webhookSecret);
    });

    it('imports USD/EUR orders cleanly with money.ts decimal strings and real FX rates/base totals', async () => {
      const result = await service.importOrder(tenantId, {
        id: 202,
        number: '202',
        currency: 'USD',
        total: '110.00',
        total_tax: '10.00',
        discount_total: '5.00',
        billing: { first_name: 'Sara', last_name: 'Test' },
        line_items: [
          {
            id: 1,
            name: 'Widget',
            product_id: 10,
            quantity: 2,
            subtotal: '52.50',
            total: '50.00',
            total_tax: '5.00',
            price: 25,
          },
        ],
      } as any);

      expect(result.success).toBe(true);
      expect(mockInvoicingRepo.create).toHaveBeenCalledWith(
        tenantId,
        expect.objectContaining({
          currency: Currency.USD,
          jurisdiction: InvoiceJurisdiction.INTL,
          exchangeRate: 1,
          fxRate: DEFAULT_RATES_PER_USD[Currency.IRR],
          baseCurrency: BASE_CURRENCY,
          baseTotalAmount: '105.00',
          baseTotalTax: '10.00',
          baseFinalPayable: '110.00',
          totalAmount: '105.00',
          totalDiscount: '5.00',
          totalTax: '10.00',
          finalPayable: '110.00',
        }),
        undefined,
      );
    });

    it('rejects missing or unsupported currencies instead of coercing to IRR', async () => {
      await expect(
        service.importOrder(tenantId, {
          id: 203,
          currency: 'XYZ',
          total: '100',
          line_items: [],
        } as any),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.importOrder(tenantId, {
          id: 204,
          total: '100',
          line_items: [],
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('executes outbound WooCommerce REST calls in pushStockUpdate and logs only on 2xx', async () => {
      mockWooRepo.findConfig.mockResolvedValue({
        tenantId,
        storeUrl: 'https://shop.example.com',
        consumerKeyEncrypted: sealSecret('ck_test_1', tenantId),
        consumerSecretEncrypted: sealSecret('cs_test_1', tenantId),
        webhookSecret: sealSecret('wh_1', tenantId),
        autoSyncStock: true,
      });

      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ id: 77, sku: 'SKU-1' }],
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 77 }),
        } as Response);

      const res = await service.pushStockUpdate(tenantId, 'SKU-1', 15, 250000n);
      expect(res).toEqual({ success: true, externalId: 'SKU-1' });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy.mock.calls[1][0]).toBe('https://shop.example.com/wp-json/wc/v3/products/77');
      expect(mockWooRepo.createSyncLog).toHaveBeenCalledWith(
        tenantId,
        expect.objectContaining({
          direction: WooCommerceSyncDirection.OUTBOUND_STOCK,
          status: WooCommerceSyncStatus.SUCCESS,
          externalId: 'SKU-1',
        }),
      );
      fetchSpy.mockRestore();
    });
  });

  describe('WooCommerceWebhookController (RawBody + Global ValidationPipe)', () => {
    let app: INestApplication;
    const webhookSecret = 'live_webhook_secret_xyz';
    let mockSyncService: {
      getWebhookSecret: jest.Mock;
      importOrder: jest.Mock;
    };

    beforeAll(async () => {
      mockSyncService = {
        getWebhookSecret: jest.fn().mockResolvedValue(webhookSecret),
        importOrder: jest.fn().mockResolvedValue({ success: true, invoiceId: 'inv-live-1' }),
      };

      const mod = await Test.createTestingModule({
        controllers: [WooCommerceWebhookController],
        providers: [{ provide: WooCommerceSyncService, useValue: mockSyncService }],
      }).compile();

      app = mod.createNestApplication({ rawBody: true });
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
          transformOptions: { enableImplicitConversion: true },
        }),
      );
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('returns 401 before DTO validation when HMAC signature is invalid', async () => {
      const badPayload = JSON.stringify({ not_an_order: true });
      await request(app.getHttpServer())
        .post(`/api/integrations/woocommerce/webhook/${tenantId}`)
        .set('x-wc-webhook-signature', 'invalid-sig')
        .set('x-wc-webhook-topic', 'order.created')
        .set('Content-Type', 'application/json')
        .send(badPayload)
        .expect(401);
    });

    it('accepts full real WooCommerce order payloads with extra undeclared keys', async () => {
      const fullWooPayload = JSON.stringify({
        id: 9081,
        number: '9081',
        status: 'processing',
        currency: 'IRR',
        date_created: '2026-11-12T10:00:00',
        payment_method: 'zibal',
        total: '2500000',
        total_tax: '0',
        shipping_lines: [{ method_id: 'flat_rate', total: '0' }],
        meta_data: [{ id: 1, key: '_billing_iran_code', value: '123' }],
        billing: {
          first_name: 'علی',
          last_name: 'محمدی',
          phone: '09120000000',
        },
        line_items: [
          {
            id: 55,
            name: 'محصول تستی',
            product_id: 901,
            quantity: 1,
            total: '2500000',
            meta_data: [{ id: 2, key: '_color', value: 'blue' }],
          },
        ],
      });
      const sig = computeHmacSignature(fullWooPayload, webhookSecret);

      const res = await request(app.getHttpServer())
        .post(`/api/integrations/woocommerce/webhook/${tenantId}`)
        .set('x-wc-webhook-signature', sig)
        .set('x-wc-webhook-topic', 'order.created')
        .set('Content-Type', 'application/json')
        .send(fullWooPayload)
        .expect(200);

      expect(res.body).toEqual({ status: 'ok', success: true, invoiceId: 'inv-live-1' });
    });

    it('returns 400 when signed order payload has non-array line_items', async () => {
      const invalidOrder = JSON.stringify({
        id: 9082,
        total: '1000',
        line_items: 'not-an-array',
      });
      const sig = computeHmacSignature(invalidOrder, webhookSecret);

      await request(app.getHttpServer())
        .post(`/api/integrations/woocommerce/webhook/${tenantId}`)
        .set('x-wc-webhook-signature', sig)
        .set('x-wc-webhook-topic', 'order.created')
        .set('Content-Type', 'application/json')
        .send(invalidOrder)
        .expect(400);
    });
  });
});
