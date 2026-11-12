import { BadRequestException, ConflictException } from '@nestjs/common';
import { InvoiceDirection } from '../enums/invoice-kind.enum';
import { InvoiceStatus } from '../enums/invoice-status.enum';
import { InvoicePaymentLinkService } from './invoice-payment-link.service';
import {
  maskMerchantId,
  openMerchantId,
  sealMerchantId,
} from '../utils/payment-gateway-crypto.util';
import { PaymentGatewayAdapter } from './payment-gateway.adapter';

describe('Payment Link Crypto & Unit Logic (T90)', () => {
  const T1 = '11111111-1111-4111-8111-111111111111';
  const T2 = '22222222-2222-4222-8222-222222222222';

  beforeAll(() => {
    process.env.PAYMENT_GATEWAY_ENCRYPTION_KEY = 'test_payment_gateway_encryption_key_32b!';
  });

  describe('Merchant Credential Encryption & Masking', () => {
    it('seals and opens merchant ID with tenant AAD binding', () => {
      const plain = 'zibal_merchant_secret_12345';
      const sealed = sealMerchantId(plain, T1);
      expect(sealed).not.toContain(plain);
      expect(sealed.startsWith('v1.')).toBe(true);

      const opened = openMerchantId(sealed, T1);
      expect(opened).toBe(plain);
    });

    it('rejects decryption when tenant AAD does not match', () => {
      const plain = 'zibal_merchant_secret_12345';
      const sealed = sealMerchantId(plain, T1);
      expect(() => openMerchantId(sealed, T2)).toThrow();
    });

    it('masks merchant key preventing secret leakage', () => {
      expect(maskMerchantId('zibal_merchant_12345')).toBe('zib-****-345');
      expect(maskMerchantId('1234')).toBe('****');
      expect(maskMerchantId('')).toBe('');
    });
  });

  describe('InvoicePaymentLinkService Unit Tests', () => {
    let service: InvoicePaymentLinkService;
    let paymentRepo: any;
    let invoicingRepo: any;
    let invoicingService: any;
    let gatewayAdapter: PaymentGatewayAdapter;
    let tenantScope: any;

    beforeEach(() => {
      paymentRepo = {
        findConfig: jest.fn(),
        saveConfig: jest.fn(),
        createPaymentLink: jest.fn(),
        updatePaymentLink: jest.fn(),
        findPaymentLinkByTrackId: jest.fn(),
        findPaymentLinkByGatewayRef: jest.fn(),
        lookupTenantByTrackId: jest.fn().mockResolvedValue({ tenantId: T1, invoiceId: 'inv-1', status: 'PENDING' }),
      };
      invoicingRepo = {
        findById: jest.fn(),
      };
      invoicingService = {
        pay: jest.fn(),
      };
      gatewayAdapter = new PaymentGatewayAdapter();
      tenantScope = {
        run: jest.fn((tenantId, fn) => fn()),
      };

      service = new InvoicePaymentLinkService(
        paymentRepo,
        invoicingRepo,
        invoicingService,
        gatewayAdapter,
        tenantScope,
      );
    });

    it('refuses to create payment link for non-sale invoice', async () => {
      invoicingRepo.findById.mockResolvedValue({
        id: 'inv-1',
        direction: InvoiceDirection.PURCHASE,
        status: InvoiceStatus.ISSUED,
        finalPayable: 100000,
      });

      await expect(service.createPaymentLink(T1, 'inv-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses to create payment link for draft or paid invoices', async () => {
      invoicingRepo.findById.mockResolvedValueOnce({
        id: 'inv-1',
        direction: InvoiceDirection.SALE,
        status: InvoiceStatus.DRAFT,
        finalPayable: 100000,
      });

      await expect(service.createPaymentLink(T1, 'inv-1')).rejects.toThrow(
        ConflictException,
      );

      invoicingRepo.findById.mockResolvedValueOnce({
        id: 'inv-2',
        direction: InvoiceDirection.SALE,
        status: InvoiceStatus.PAID,
        finalPayable: 100000,
      });

      await expect(service.createPaymentLink(T1, 'inv-2')).rejects.toThrow(
        ConflictException,
      );
    });

    it('creates payment link on issued sales invoice with valid gateway config', async () => {
      invoicingRepo.findById.mockResolvedValue({
        id: 'inv-1',
        direction: InvoiceDirection.SALE,
        status: InvoiceStatus.ISSUED,
        finalPayable: 500000,
        taxInvoiceNumber: 'INV-2026-001',
      });

      const encrypted = sealMerchantId('zibal_test_merchant', T1);
      paymentRepo.findConfig.mockResolvedValue({
        tenantId: T1,
        gateway: 'zibal',
        encryptedMerchantId: encrypted,
        isActive: true,
      });

      jest.spyOn(gatewayAdapter, 'requestPayment').mockResolvedValue({
        success: true,
        trackId: 'trk-1001',
        paymentUrl: 'https://gateway.zibal.ir/start/trk-1001',
      });

      paymentRepo.createPaymentLink.mockImplementation((_: unknown, data: any) => ({
        id: 'link-1',
        ...data,
        createdAt: new Date(),
      }));

      const res = await service.createPaymentLink(T1, 'inv-1');
      expect(res.trackId).toBe('trk-1001');
      expect(res.paymentUrl).toBe('https://gateway.zibal.ir/start/trk-1001');
      expect(res.status).toBe('PENDING');
      expect(paymentRepo.createPaymentLink).toHaveBeenCalledWith(
        T1,
        expect.objectContaining({
          invoiceId: 'inv-1',
          trackId: 'trk-1001',
          status: 'PENDING',
        }),
      );
    });

    it('handles callback verification and triggers invoice payment idempotently', async () => {
      const link = {
        id: 'link-1',
        tenantId: T1,
        invoiceId: 'inv-1',
        trackId: 'trk-1001',
        amount: 50000000n,
        status: 'PENDING',
        gateway: 'zibal',
      };
      paymentRepo.findPaymentLinkByTrackId.mockResolvedValue(link);

      const encrypted = sealMerchantId('zibal_test_merchant', T1);
      paymentRepo.findConfig.mockResolvedValue({
        tenantId: T1,
        gateway: 'zibal',
        encryptedMerchantId: encrypted,
        isActive: true,
      });

      jest.spyOn(gatewayAdapter, 'verifyPayment').mockResolvedValue({
        success: true,
        paid: true,
        amountRials: 500000n,
        refNumber: 'REF-BANK-7788',
        cardNumber: '6037********1234',
        paidAt: new Date(),
      });

      paymentRepo.findPaymentLinkByGatewayRef.mockResolvedValue(null);
      invoicingRepo.findById.mockResolvedValue({
        id: 'inv-1',
        status: InvoiceStatus.ISSUED,
      });

      const res = await service.handleCallback({ trackId: 'trk-1001', tenantId: T1 });
      expect(res.paid).toBe(true);
      expect(res.refNumber).toBe('REF-BANK-7788');
      expect(link.status).toBe('PAID');
      expect(invoicingService.pay).toHaveBeenCalledWith(T1, 'inv-1');

      // Subsequent identical callback: returns idempotent success without calling invoicingService.pay again
      invoicingService.pay.mockClear();
      const secondCall = await service.handleCallback({ trackId: 'trk-1001', tenantId: T1 });
      expect(secondCall.paid).toBe(true);
      expect(invoicingService.pay).not.toHaveBeenCalled();
    });

    it('enforces idempotency on gateway ref across concurrent payment attempts', async () => {
      const link = {
        id: 'link-2',
        tenantId: T1,
        invoiceId: 'inv-1',
        trackId: 'trk-1002',
        amount: 50000000n,
        status: 'PENDING',
        gateway: 'zibal',
      };
      paymentRepo.findPaymentLinkByTrackId.mockResolvedValue(link);

      const encrypted = sealMerchantId('zibal_test_merchant', T1);
      paymentRepo.findConfig.mockResolvedValue({
        tenantId: T1,
        gateway: 'zibal',
        encryptedMerchantId: encrypted,
        isActive: true,
      });

      jest.spyOn(gatewayAdapter, 'verifyPayment').mockResolvedValue({
        success: true,
        paid: true,
        refNumber: 'REF-BANK-ALREADY-SETTLED',
      });

      // Existing link already has this gateway ref
      paymentRepo.findPaymentLinkByGatewayRef.mockResolvedValue({
        id: 'link-1-settled',
        tenantId: T1,
        invoiceId: 'inv-1',
        gatewayRef: 'REF-BANK-ALREADY-SETTLED',
        status: 'PAID',
      });

      const res = await service.handleCallback({ trackId: 'trk-1002', tenantId: T1 });
      expect(res.paid).toBe(true);
      expect(res.message).toContain('قبلاً ثبت شده است');
      expect(invoicingService.pay).not.toHaveBeenCalled();
    });
  });
});
