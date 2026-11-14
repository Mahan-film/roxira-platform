import * as crypto from 'crypto';
import { BadRequestException, ConflictException, InternalServerErrorException } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { InvoiceDirection } from '../enums/invoice-kind.enum';
import { InvoiceStatus } from '../enums/invoice-status.enum';
import { PaymentCallbackQueryDto } from '../dto/payment-link-response.dto';
import { ConfigurePaymentGatewayDto } from '../dto/configure-payment-gateway.dto';
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
    process.env.PAYMENT_GATEWAY_ENCRYPTION_KEY =
      process.env.PAYMENT_GATEWAY_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
    process.env.PAYMENT_GATEWAY_CALLBACK_BASE_URL = 'https://app.example.test';
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

    it('masks merchant key revealing at most last 4 characters', () => {
      expect(maskMerchantId('zibal_merchant_12345')).toBe('****2345');
      expect(maskMerchantId('1234')).toBe('****');
      expect(maskMerchantId('')).toBe('');
    });

    it('validates PaymentCallbackQueryDto and forbids unknown fields like tenantId', async () => {
      const pipe = new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      });

      await expect(
        pipe.transform({ trackId: '' }, { type: 'query', metatype: PaymentCallbackQueryDto }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        pipe.transform(
          { trackId: 'trk-1', tenantId: T1 },
          { type: 'query', metatype: PaymentCallbackQueryDto },
        ),
      ).rejects.toThrow(BadRequestException);

      const valid = await pipe.transform(
        { trackId: 'trk-1', status: 2, success: 1, orderId: 'inv-1' },
        { type: 'body', metatype: PaymentCallbackQueryDto },
      );
      expect(valid).toEqual({ trackId: 'trk-1', status: '2', success: '1', orderId: 'inv-1' });
    });

    it('restricts ConfigurePaymentGatewayDto.gateway to supported gateways', async () => {
      const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
      await expect(
        pipe.transform(
          { merchantId: 'm1', gateway: 'unknown' },
          { type: 'body', metatype: ConfigurePaymentGatewayDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('InvoicePaymentLinkService Unit Tests', () => {
    let service: InvoicePaymentLinkService;
    let paymentRepo: any;
    let invoicingRepo: any;
    let invoicingService: any;
    let gatewayAdapter: PaymentGatewayAdapter;
    let tenantScope: any;
    let storedLinks: Map<string, any>;

    beforeEach(() => {
      storedLinks = new Map();
      paymentRepo = {
        findConfig: jest.fn(),
        saveConfig: jest.fn(),
        createPaymentLink: jest.fn(),
        updatePaymentLink: jest.fn(),
        findPaymentLinkByTrackId: jest.fn(async (_t: string, trackId: string) =>
          storedLinks.get(trackId) ?? null,
        ),
        findPaymentLinkByGatewayRef: jest.fn().mockResolvedValue(null),
        findPaymentLinksByInvoiceId: jest.fn(async (_t: string, invoiceId: string) =>
          Array.from(storedLinks.values()).filter((l) => l.invoiceId === invoiceId),
        ),
        lookupTenantByTrackId: jest.fn().mockResolvedValue({
          tenantId: T1,
          invoiceId: 'inv-1',
          status: 'PENDING',
        }),
        claimPaymentLinkForVerification: jest.fn(async (_t: string, trackId: string) => {
          const link = storedLinks.get(trackId);
          if (!link || !['PENDING', 'UNVERIFIED', 'FAILED'].includes(link.status)) {
            return null;
          }
          link.status = 'VERIFYING';
          return { ...link };
        }),
        claimUnsettledPaymentLink: jest.fn(async (_t: string, trackId: string) => {
          const link = storedLinks.get(trackId);
          if (!link || link.status !== 'PAID_UNSETTLED') {
            return null;
          }
          link.status = 'SETTLING';
          return { ...link };
        }),
        markPaymentLinkPaidUnsettled: jest.fn(async (_t: string, id: string, data: any) => {
          for (const link of storedLinks.values()) {
            if (link.id === id && ['VERIFYING', 'SETTLING'].includes(link.status)) {
              link.status = 'PAID_UNSETTLED';
              link.gatewayRef = data.gatewayRef;
              link.cardNumber = data.cardNumber;
              link.paidAt = data.paidAt;
              return true;
            }
          }
          return false;
        }),
        markPaymentLinkReconciliationRequired: jest.fn(async (_t: string, id: string, data: any) => {
          for (const link of storedLinks.values()) {
            if (link.id === id && ['VERIFYING', 'PAID_UNSETTLED', 'SETTLING'].includes(link.status)) {
              link.status = 'RECONCILIATION_REQUIRED';
              link.gatewayRef = data.gatewayRef;
              link.cardNumber = data.cardNumber;
              link.paidAt = data.paidAt;
              return true;
            }
          }
          return false;
        }),
        markPaymentLinkPaid: jest.fn(async (_t: string, id: string, data: any) => {
          for (const link of storedLinks.values()) {
            if (link.id === id && ['VERIFYING', 'PAID_UNSETTLED', 'SETTLING'].includes(link.status)) {
              link.status = 'PAID';
              link.gatewayRef = data.gatewayRef;
              link.cardNumber = data.cardNumber;
              link.paidAt = data.paidAt;
              return true;
            }
          }
          return false;
        }),
        markPaymentLinkStatus: jest.fn(async (_t: string, id: string, status: string) => {
          for (const link of storedLinks.values()) {
            if (link.id === id && ['VERIFYING', 'SETTLING', 'PAID_UNSETTLED'].includes(link.status)) {
              link.status = status;
            }
          }
        }),
      };
      invoicingRepo = {
        findById: jest.fn(),
      };
      invoicingService = {
        pay: jest.fn(),
      };
      gatewayAdapter = new PaymentGatewayAdapter();
      tenantScope = {
        run: jest.fn((_tenantId, fn) => fn()),
      };

      service = new InvoicePaymentLinkService(
        paymentRepo,
        invoicingRepo,
        invoicingService,
        gatewayAdapter,
        tenantScope,
      );
    });

    it('fails closed when callback base URL env is missing', async () => {
      const prevPayUrl = process.env.PAYMENT_GATEWAY_CALLBACK_BASE_URL;
      const prevAppUrl = process.env.APP_BASE_URL;
      delete process.env.PAYMENT_GATEWAY_CALLBACK_BASE_URL;
      delete process.env.APP_BASE_URL;
      try {
        await expect(service.createPaymentLink(T1, 'inv-1')).rejects.toThrow(
          InternalServerErrorException,
        );
      } finally {
        process.env.PAYMENT_GATEWAY_CALLBACK_BASE_URL = prevPayUrl;
        if (prevAppUrl !== undefined) process.env.APP_BASE_URL = prevAppUrl;
      }
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

    it('rejects non-IRR invoices to avoid currency undercharge bugs', async () => {
      invoicingRepo.findById.mockResolvedValueOnce({
        id: 'inv-irt',
        direction: InvoiceDirection.SALE,
        status: InvoiceStatus.ISSUED,
        currency: 'IRT',
        finalPayable: 250000,
      });

      await expect(service.createPaymentLink(T1, 'inv-irt')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('handles race conditions via unique index conflict (code 23505) and throws ConflictException', async () => {
      invoicingRepo.findById.mockResolvedValueOnce({
        id: 'inv-race',
        direction: InvoiceDirection.SALE,
        status: InvoiceStatus.ISSUED,
        currency: 'IRR',
        finalPayable: 500000,
      });

      const encrypted = sealMerchantId('zibal_test_merchant', T1);
      paymentRepo.findConfig.mockResolvedValueOnce({
        tenantId: T1,
        gateway: 'zibal',
        encryptedMerchantId: encrypted,
        isActive: true,
      });

      jest.spyOn(gatewayAdapter, 'requestPayment').mockResolvedValueOnce({
        success: true,
        trackId: 'trk-race',
        paymentUrl: 'https://gateway.zibal.ir/start/trk-race',
      });

      paymentRepo.createPaymentLink.mockRejectedValueOnce({
        code: '23505',
        driverError: { code: '23505' },
      });

      await expect(service.createPaymentLink(T1, 'inv-race')).rejects.toThrow(
        ConflictException,
      );
    });

    it('creates payment link on issued sales invoice using configured callback base URL', async () => {
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

      const reqSpy = jest.spyOn(gatewayAdapter, 'requestPayment').mockResolvedValue({
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
      expect(reqSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          callbackUrl: 'https://app.example.test/enterprise-hub/invoicing/payment-links/callback',
        }),
      );
    });

    it('handles callback verification, trims public output, and is idempotent', async () => {
      const link = {
        id: 'link-1',
        tenantId: T1,
        invoiceId: 'inv-1',
        trackId: 'trk-1001',
        amount: 50000000n,
        status: 'PENDING',
        gateway: 'zibal',
      };
      storedLinks.set('trk-1001', link);

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

      invoicingRepo.findById.mockResolvedValue({
        id: 'inv-1',
        status: InvoiceStatus.ISSUED,
      });

      const res = await service.handleCallback({ trackId: 'trk-1001' });
      expect(res.paid).toBe(true);
      expect((res as any).invoiceId).toBeUndefined();
      expect((res as any).refNumber).toBeUndefined();
      expect(link.status).toBe('PAID');
      expect(invoicingService.pay).toHaveBeenCalledTimes(1);
      expect(invoicingService.pay).toHaveBeenCalledWith(T1, 'inv-1');

      invoicingService.pay.mockClear();
      const secondCall = await service.handleCallback({ trackId: 'trk-1001' });
      expect(secondCall.paid).toBe(true);
      expect(invoicingService.pay).not.toHaveBeenCalled();
    });

    it('fails closed when gateway verify omits amountRials or returns wrong amount', async () => {
      const linkMissing = {
        id: 'link-missing',
        tenantId: T1,
        invoiceId: 'inv-1',
        trackId: 'trk-missing-amt',
        amount: 50000000n,
        status: 'PENDING',
        gateway: 'zibal',
      };
      storedLinks.set('trk-missing-amt', linkMissing);

      const linkMismatch = {
        id: 'link-mismatch',
        tenantId: T1,
        invoiceId: 'inv-1',
        trackId: 'trk-mismatch-amt',
        amount: 50000000n,
        status: 'PENDING',
        gateway: 'zibal',
      };
      storedLinks.set('trk-mismatch-amt', linkMismatch);

      const encrypted = sealMerchantId('zibal_test_merchant', T1);
      paymentRepo.findConfig.mockResolvedValue({
        tenantId: T1,
        gateway: 'zibal',
        encryptedMerchantId: encrypted,
        isActive: true,
      });

      const verifySpy = jest.spyOn(gatewayAdapter, 'verifyPayment');
      verifySpy.mockResolvedValueOnce({
        success: true,
        paid: true,
        amountRials: undefined,
        refNumber: 'REF-NO-AMT',
      });
      const resMissing = await service.handleCallback({ trackId: 'trk-missing-amt' });
      expect(resMissing.paid).toBe(false);
      expect(linkMissing.status).toBe('RECONCILIATION_REQUIRED');
      expect(invoicingService.pay).not.toHaveBeenCalled();

      verifySpy.mockResolvedValueOnce({
        success: true,
        paid: true,
        amountRials: 1000n,
        refNumber: 'REF-LOW-AMT',
      });
      const resMismatch = await service.handleCallback({ trackId: 'trk-mismatch-amt' });
      expect(resMismatch.paid).toBe(false);
      expect(linkMismatch.status).toBe('RECONCILIATION_REQUIRED');
      expect(invoicingService.pay).not.toHaveBeenCalled();
    });

    it('marks transient verify error as UNVERIFIED instead of FAILED', async () => {
      const link = {
        id: 'link-net',
        tenantId: T1,
        invoiceId: 'inv-1',
        trackId: 'trk-net',
        amount: 50000000n,
        status: 'PENDING',
        gateway: 'zibal',
      };
      storedLinks.set('trk-net', link);

      const encrypted = sealMerchantId('zibal_test_merchant', T1);
      paymentRepo.findConfig.mockResolvedValue({
        tenantId: T1,
        gateway: 'zibal',
        encryptedMerchantId: encrypted,
        isActive: true,
      });

      jest.spyOn(gatewayAdapter, 'verifyPayment').mockResolvedValue({
        success: false,
        paid: false,
        message: 'Zibal verify returned HTTP status 502',
      });

      const res = await service.handleCallback({ trackId: 'trk-net' });
      expect(res.paid).toBe(false);
      expect(link.status).toBe('UNVERIFIED');
      expect(invoicingService.pay).not.toHaveBeenCalled();
    });

    it('claims link atomically so concurrent callbacks execute verify and pay only once', async () => {
      const link = {
        id: 'link-conc',
        tenantId: T1,
        invoiceId: 'inv-1',
        trackId: 'trk-conc',
        amount: 50000000n,
        status: 'PENDING',
        gateway: 'zibal',
      };
      storedLinks.set('trk-conc', link);

      const encrypted = sealMerchantId('zibal_test_merchant', T1);
      paymentRepo.findConfig.mockResolvedValue({
        tenantId: T1,
        gateway: 'zibal',
        encryptedMerchantId: encrypted,
        isActive: true,
      });

      let releaseVerify!: () => void;
      const verifyGate = new Promise<void>((resolve) => {
        releaseVerify = resolve;
      });
      const verifySpy = jest.spyOn(gatewayAdapter, 'verifyPayment').mockImplementation(async () => {
        await verifyGate;
        return {
          success: true,
          paid: true,
          amountRials: 500000n,
          refNumber: 'REF-CONC-1',
        };
      });

      invoicingRepo.findById.mockResolvedValue({
        id: 'inv-1',
        status: InvoiceStatus.ISSUED,
      });

      const p1 = service.handleCallback({ trackId: 'trk-conc' });
      const p2 = service.handleCallback({ trackId: 'trk-conc' });
      await new Promise((r) => setTimeout(r, 15));
      releaseVerify();
      const [r1, r2] = await Promise.all([p1, p2]);

      expect(verifySpy).toHaveBeenCalledTimes(1);
      expect(invoicingService.pay).toHaveBeenCalledTimes(1);
      expect([r1.paid, r2.paid].filter(Boolean)).toHaveLength(1);
    });

    it('enforces idempotency when gatewayRef is already settled on another link', async () => {
      const link = {
        id: 'link-2',
        tenantId: T1,
        invoiceId: 'inv-1',
        trackId: 'trk-1002',
        amount: 50000000n,
        status: 'PENDING',
        gateway: 'zibal',
      };
      storedLinks.set('trk-1002', link);

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
        refNumber: 'REF-BANK-ALREADY-SETTLED',
      });

      paymentRepo.findPaymentLinkByGatewayRef.mockResolvedValue({
        id: 'link-1-settled',
        tenantId: T1,
        invoiceId: 'inv-1',
        gatewayRef: 'REF-BANK-ALREADY-SETTLED',
        status: 'PAID',
      });

      const res = await service.handleCallback({ trackId: 'trk-1002' });
      expect(res.paid).toBe(true);
      expect(res.message).toContain('قبلاً ثبت شده است');
      expect(invoicingService.pay).not.toHaveBeenCalled();
    });

    it('refuses creating a second payment link when a PENDING or PAID link already exists', async () => {
      invoicingRepo.findById.mockResolvedValue({
        id: 'inv-1',
        direction: InvoiceDirection.SALE,
        status: InvoiceStatus.ISSUED,
        finalPayable: 500000,
      });
      storedLinks.set('trk-existing', {
        id: 'link-existing',
        tenantId: T1,
        invoiceId: 'inv-1',
        trackId: 'trk-existing',
        status: 'PENDING',
      });

      await expect(service.createPaymentLink(T1, 'inv-1')).rejects.toThrow(ConflictException);
    });

    it('flags RECONCILIATION_REQUIRED and returns failure if invoice is already PAID at settlement time', async () => {
      const link = {
        id: 'link-dup-pay',
        tenantId: T1,
        invoiceId: 'inv-1',
        trackId: 'trk-dup-pay',
        amount: 50000000n,
        status: 'PENDING',
        gateway: 'zibal',
      };
      storedLinks.set('trk-dup-pay', link);

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
        refNumber: 'REF-OVERPAY',
      });
      invoicingRepo.findById.mockResolvedValue({
        id: 'inv-1',
        status: InvoiceStatus.PAID,
      });

      const res = await service.handleCallback({ trackId: 'trk-dup-pay' });
      expect(res.success).toBe(false);
      expect(res.paid).toBe(false);
      expect(link.status).toBe('RECONCILIATION_REQUIRED');
      expect((link as any).gatewayRef).toBe('REF-OVERPAY');
      expect(invoicingService.pay).not.toHaveBeenCalled();
    });

    it('preserves PAID_UNSETTLED when pay() fails and completes settlement on retry without re-verifying', async () => {
      const link = {
        id: 'link-retry',
        tenantId: T1,
        invoiceId: 'inv-1',
        trackId: 'trk-retry',
        amount: 50000000n,
        status: 'PENDING',
        gateway: 'zibal',
      };
      storedLinks.set('trk-retry', link);

      const encrypted = sealMerchantId('zibal_test_merchant', T1);
      paymentRepo.findConfig.mockResolvedValue({
        tenantId: T1,
        gateway: 'zibal',
        encryptedMerchantId: encrypted,
        isActive: true,
      });
      const verifySpy = jest.spyOn(gatewayAdapter, 'verifyPayment').mockResolvedValue({
        success: true,
        paid: true,
        amountRials: 500000n,
        refNumber: 'REF-RETRY-1',
      });
      invoicingRepo.findById.mockResolvedValue({
        id: 'inv-1',
        status: InvoiceStatus.ISSUED,
      });
      invoicingService.pay.mockRejectedValueOnce(new Error('transient db outage'));

      await expect(service.handleCallback({ trackId: 'trk-retry' })).rejects.toThrow(
        'transient db outage',
      );
      expect(link.status).toBe('PAID_UNSETTLED');
      expect((link as any).gatewayRef).toBe('REF-RETRY-1');

      invoicingService.pay.mockResolvedValueOnce({ id: 'inv-1', status: InvoiceStatus.PAID });
      const retryRes = await service.handleCallback({ trackId: 'trk-retry' });
      expect(retryRes.success).toBe(true);
      expect(retryRes.paid).toBe(true);
      expect(link.status).toBe('PAID');
      expect(verifySpy).toHaveBeenCalledTimes(1);
      expect(invoicingService.pay).toHaveBeenCalledTimes(2);
    });

    it('recovers when pay() persists PAID but markPaymentLinkPaid threw: marks PAID on retry without re-paying', async () => {
      const link = {
        id: 'link-settle-crash',
        tenantId: T1,
        invoiceId: 'inv-paid-recovery',
        trackId: 'trk-settle-crash',
        amount: 30000000n,
        status: 'PENDING',
        gateway: 'zibal',
      };
      storedLinks.set('trk-settle-crash', link);

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
        amountRials: 300000n,
        refNumber: 'REF-CRASH-1',
      });

      invoicingRepo.findById.mockResolvedValueOnce({
        id: 'inv-paid-recovery',
        status: InvoiceStatus.ISSUED,
      });
      invoicingService.pay.mockResolvedValueOnce({ id: 'inv-paid-recovery', status: InvoiceStatus.PAID });
      // Simulate transient DB failure when persisting link PAID status
      paymentRepo.markPaymentLinkPaid.mockRejectedValueOnce(new Error('transient write failure on link'));

      await expect(service.handleCallback({ trackId: 'trk-settle-crash' })).rejects.toThrow(
        'transient write failure on link',
      );
      // Link remained in PAID_UNSETTLED
      expect(link.status).toBe('PAID_UNSETTLED');

      // Next retry attempt: invoice is now PAID in DB
      invoicingRepo.findById.mockResolvedValueOnce({
        id: 'inv-paid-recovery',
        status: InvoiceStatus.PAID,
      });

      const retryRes = await service.handleCallback({ trackId: 'trk-settle-crash' });
      expect(retryRes.success).toBe(true);
      expect(retryRes.paid).toBe(true);
      expect(link.status).toBe('PAID');
      // invoicingService.pay was NOT called again because invoice was already settled
      expect(invoicingService.pay).toHaveBeenCalledTimes(1);
    });

    it('passes AbortSignal timeout when calling Zibal endpoints', async () => {
      const fetchMock = jest
        .spyOn(global, 'fetch' as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ result: 100, trackId: '999999' }),
        } as any);
      try {
        const res = await gatewayAdapter.requestPayment({
          merchantId: 'm1',
          amountRials: 10000n,
          orderId: 'o1',
          description: 'desc',
          callbackUrl: 'https://app.example.test/cb',
        });
        expect(res.success).toBe(true);
        expect(fetchMock).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
      } finally {
        fetchMock.mockRestore();
      }
    });
  });
});
