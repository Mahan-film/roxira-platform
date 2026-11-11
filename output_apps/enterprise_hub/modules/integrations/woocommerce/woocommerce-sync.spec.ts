import {
  computeHmacSignature,
  maskApiKey,
  openSecret,
  sealSecret,
  verifyHmacSignature,
} from './utils/woocommerce-crypto.util';
import { WooCommerceSyncService } from './services/woocommerce-sync.service';
import { WooCommerceRepository } from './repositories/woocommerce.repository';
import { InvoicingRepository } from '../../invoicing/repositories/invoicing.repository';
import {
  WooCommerceSyncDirection,
  WooCommerceSyncStatus,
} from './entities/woocommerce-sync-log.entity';

describe('WooCommerce Crypto & Sync Logic (Unit Specs)', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const tenantB = '22222222-2222-4222-8222-222222222222';

  describe('Credential Encryption & Masking', () => {
    it('seals and opens credentials with tenant AAD binding', () => {
      const plaintext = 'ck_secr3t_token_12345';
      const sealed = sealSecret(plaintext, tenantId);

      expect(sealed).toMatch(/^v1\./);
      expect(sealed).not.toContain(plaintext);

      const decrypted = openSecret(sealed, tenantId);
      expect(decrypted).toBe(plaintext);

      // Fails when decrypted with a different tenant AAD (prevents cross-tenant ciphertext copying)
      expect(() => openSecret(sealed, tenantB)).toThrow();
    });

    it('masks consumer API keys cleanly without exposing secret characters', () => {
      expect(maskApiKey('ck_9a8b7c6d5e4f3a2b1c')).toBe('ck_...2b1c');
      expect(maskApiKey('cs_1a2b3c4d5e6f7a8b9c')).toBe('cs_...8b9c');
      expect(maskApiKey('short')).toBe('****');
      expect(maskApiKey('')).toBe('');
    });
  });

  describe('HMAC-SHA256 Webhook Verification', () => {
    const webhookSecret = 'test_webhook_secret_key_123';
    const payload = JSON.stringify({ id: 101, status: 'processing', total: '500000' });

    it('validates matching HMAC signature', () => {
      const sig = computeHmacSignature(payload, webhookSecret);
      expect(verifyHmacSignature(payload, sig, webhookSecret)).toBe(true);
    });

    it('rejects tampered payload or incorrect signature', () => {
      const sig = computeHmacSignature(payload, webhookSecret);
      const tampered = JSON.stringify({ id: 101, status: 'processing', total: '999999' });

      expect(verifyHmacSignature(tampered, sig, webhookSecret)).toBe(false);
      expect(verifyHmacSignature(payload, 'bad_signature', webhookSecret)).toBe(false);
      expect(verifyHmacSignature(payload, sig, 'wrong_secret')).toBe(false);
    });
  });

  describe('WooCommerceSyncService Order Idempotency', () => {
    let service: WooCommerceSyncService;
    let mockWooRepo: any;
    let mockInvoicingRepo: any;

    beforeEach(() => {
      mockWooRepo = {
        findConfig: jest.fn().mockResolvedValue(null),
        saveConfig: jest.fn().mockResolvedValue({}),
        findSyncLogByExternalId: jest.fn(),
        createSyncLog: jest.fn().mockResolvedValue({}),
        listSyncLogs: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      };
      mockInvoicingRepo = {
        create: jest.fn(),
      };
      service = new WooCommerceSyncService(mockWooRepo, mockInvoicingRepo);
    });

    it('imports new order as draft sales invoice and creates success log', async () => {
      mockWooRepo.findSyncLogByExternalId.mockResolvedValue(null);
      mockInvoicingRepo.create.mockResolvedValue({ id: 'inv-uuid-101' });

      const orderPayload = {
        id: 101,
        number: '101',
        status: 'processing',
        total: '750000',
        billing: { first_name: 'علی', last_name: 'رضایی', phone: '09120000000' },
        line_items: [
          { id: 1, name: 'کالای تست ۱', product_id: 50, quantity: 2, price: 375000, total: '750000' },
        ],
      };

      const result = await service.importOrder(tenantId, orderPayload as any);

      expect(result.success).toBe(true);
      expect(result.invoiceId).toBe('inv-uuid-101');
      expect(mockInvoicingRepo.create).toHaveBeenCalledTimes(1);
      expect(mockWooRepo.createSyncLog).toHaveBeenCalledWith(
        tenantId,
        expect.objectContaining({
          direction: WooCommerceSyncDirection.INBOUND_ORDER,
          status: WooCommerceSyncStatus.SUCCESS,
          externalId: '101',
          internalId: 'inv-uuid-101',
        }),
      );
    });

    it('skips import when order was already imported previously (idempotent)', async () => {
      mockWooRepo.findSyncLogByExternalId.mockResolvedValue({
        id: 'log-1',
        status: WooCommerceSyncStatus.SUCCESS,
        externalId: '101',
        internalId: 'inv-uuid-existing-101',
      });

      const orderPayload = {
        id: 101,
        total: '750000',
        line_items: [],
      };

      const result = await service.importOrder(tenantId, orderPayload as any);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.invoiceId).toBe('inv-uuid-existing-101');
      expect(mockInvoicingRepo.create).not.toHaveBeenCalled();
    });
  });
});
