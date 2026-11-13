import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { fromMinor } from '../../accounting/money';
import { Currency } from '../../currency/enums/currency.enum';
import { InvoiceDirection } from '../../invoicing/enums/invoice-kind.enum';
import { InvoiceStatus } from '../../invoicing/enums/invoice-status.enum';
import { InvoicingRepository } from '../../invoicing/repositories/invoicing.repository';
import { InvoicingService } from '../../invoicing/services/invoicing.service';
import { VatRateResolver } from '../../invoicing/services/vat-rate.resolver';
import { PartyRole } from '../../parties/enums/party-role.enum';
import { PartiesService } from '../../parties/services/parties.service';
import { TenantsRepository } from '../../tenants/repositories/tenants.repository';
import { SalesQuotationEntity, SalesQuotationLineEntity } from '../entities/sales-quotation.entity';
import { SalesQuotationStatus } from '../enums/sales-status.enum';
import { SalesRepository } from '../repositories/sales.repository';
import { QuotationToInvoiceService } from './services/quotation-to-invoice.service';

describe('QuotationToInvoiceService (T104)', () => {
  const tenantId = '11111111-2222-3333-4444-555555555555';
  let service: QuotationToInvoiceService;
  let mockSalesRepo: Partial<SalesRepository>;
  let mockInvoicingService: Partial<InvoicingService>;
  let mockInvoicingRepo: Partial<InvoicingRepository>;
  let mockPartiesService: Partial<PartiesService>;
  let mockTenantsRepo: Partial<TenantsRepository>;
  let mockVatRateResolver: Partial<VatRateResolver>;

  let quotationsStore: SalesQuotationEntity[];
  let quotationLinesStore: SalesQuotationLineEntity[];
  let invoicesStore: any[];

  beforeEach(() => {
    quotationsStore = [];
    quotationLinesStore = [];
    invoicesStore = [];

    const mockManager = {
      getRepository: (entity: any) => {
        if (entity === SalesQuotationEntity) {
          return {
            findOne: jest.fn().mockImplementation(async ({ where }: any) => {
              return quotationsStore.find((q) => q.tenantId === where.tenantId && q.id === where.id) || null;
            }),
            update: jest.fn().mockImplementation(async ({ tenantId: tId, id }: any, patch: any) => {
              const q = quotationsStore.find((item) => item.tenantId === tId && item.id === id);
              if (q) Object.assign(q, patch);
            }),
          };
        }
        if (entity === SalesQuotationLineEntity) {
          return {
            find: jest.fn().mockImplementation(async ({ where }: any) => {
              return quotationLinesStore.filter((l) => l.tenantId === where.tenantId && l.quotationId === where.quotationId);
            }),
          };
        }
        return {} as any;
      },
    } as unknown as EntityManager;

    mockSalesRepo = {
      runInTransaction: jest.fn().mockImplementation(async (tId: string, work: (em: EntityManager) => Promise<any>) => {
        return work(mockManager);
      }),
    };

    mockPartiesService = {
      getByCode: jest.fn().mockImplementation(async (tId: string, code: string) => {
        if (code === 'CUST-001') {
          return {
            id: 10,
            code: 'CUST-001',
            name: 'شرکت فناوران البرز',
            role: PartyRole.CUSTOMER,
            nationalId: '10101010101',
            economicCode: '4111222333',
            phone: '02188889999',
            email: 'info@alborz.com',
            active: true,
            creditLimit: '100000000',
            customerGroup: 'CORPORATE' as any,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }
        return null;
      }),
    };

    mockTenantsRepo = {
      findById: jest.fn().mockResolvedValue({
        id: tenantId,
        name: 'شرکت بازرگانی کسری',
      } as any),
    };

    mockVatRateResolver = {
      generalRate: jest.fn().mockResolvedValue({ rate: 0.1, source: 'statutory' }),
    };

    mockInvoicingService = {
      create: jest.fn().mockImplementation(async (tId: string, dto: any, options?: any) => {
        const inv = {
          id: 'inv-uuid-101',
          tenantId: tId,
          taxInvoiceNumber: dto.taxInvoiceNumber || 'INV-1405-001',
          status: dto.status || InvoiceStatus.ISSUED,
          sellerInfo: dto.sellerInfo,
          buyerInfo: dto.buyerInfo,
          items: dto.items,
          currency: Currency.IRR,
          totalAmount: 1000000,
          totalDiscount: 0,
          totalTax: 100000,
          finalPayable: 1100000,
          createdAt: new Date(),
          issuedAt: options?.issuedAt || new Date(),
        };
        invoicesStore.push(inv);
        return inv;
      }),
      findOne: jest.fn().mockImplementation(async (tId: string, id: string) => {
        return invoicesStore.find((inv) => inv.tenantId === tId && inv.id === id) || null;
      }),
    };

    mockInvoicingRepo = {
      findById: jest.fn().mockImplementation(async (tId: string, id: string) => {
        return invoicesStore.find((inv) => inv.tenantId === tId && inv.id === id) || null;
      }),
    };

    service = new QuotationToInvoiceService(
      mockSalesRepo as SalesRepository,
      mockInvoicingService as InvoicingService,
      mockInvoicingRepo as InvoicingRepository,
      mockPartiesService as PartiesService,
      mockTenantsRepo as TenantsRepository,
      mockVatRateResolver as VatRateResolver,
    );
  });

  it('performs 1-click conversion from DRAFT quotation to ISSUED invoice', async () => {
    quotationsStore.push({
      id: 1,
      tenantId,
      number: 'QT-101',
      partyCode: 'CUST-001',
      quoteDate: '2026-11-01',
      validUntil: '2026-12-01',
      status: SalesQuotationStatus.DRAFT,
      note: 'پیش‌فاکتور رسمی',
      totalAmount: '1000000.00',
      convertedInvoiceId: null,
      createdBy: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    quotationLinesStore.push({
      id: 1,
      tenantId,
      quotationId: 1,
      lineNo: 1,
      itemId: 42,
      description: 'سرور ابری',
      quantity: '2.00',
      unitPrice: '500000.00',
      discount: '0.00',
      lineTotal: '1000000.00',
    });

    const result = await service.convertQuotationToInvoice(tenantId, 1, {
      invoiceDate: '2026-11-13',
    });

    expect(result.quotationId).toBe(1);
    expect(result.quotationNumber).toBe('QT-101');
    expect(result.invoiceId).toBe('inv-uuid-101');
    expect(result.replayed).toBe(false);
    expect(result.invoice.buyerInfo.partyCode).toBe('CUST-001');
    expect(result.invoice.sellerInfo.name).toBe('شرکت بازرگانی کسری');

    const updatedQuotation = quotationsStore[0];
    expect(updatedQuotation.status).toBe(SalesQuotationStatus.CONVERTED);
    expect(updatedQuotation.convertedInvoiceId).toBe('inv-uuid-101');
  });

  it('enforces idempotency: throws 409 Conflict on repeated conversion attempt without key', async () => {
    quotationsStore.push({
      id: 1,
      tenantId,
      number: 'QT-101',
      partyCode: 'CUST-001',
      quoteDate: '2026-11-01',
      validUntil: '2026-12-01',
      status: SalesQuotationStatus.CONVERTED,
      note: null,
      totalAmount: '1000000.00',
      convertedInvoiceId: 'inv-uuid-101',
      createdBy: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      service.convertQuotationToInvoice(tenantId, 1),
    ).rejects.toThrow(ConflictException);
  });

  it('safely replays already converted quotation when idempotencyKey is supplied', async () => {
    const existingInvoice = {
      id: 'inv-uuid-101',
      tenantId,
      taxInvoiceNumber: 'INV-1405-001',
      status: InvoiceStatus.ISSUED,
      sellerInfo: { name: 'شرکت بازرگانی کسری' },
      buyerInfo: { name: 'شرکت فناوران البرز', partyCode: 'CUST-001' },
      items: [],
      currency: Currency.IRR,
      totalAmount: 1000000,
      totalDiscount: 0,
      totalTax: 100000,
      finalPayable: 1100000,
      createdAt: new Date('2026-11-13T10:00:00Z'),
      issuedAt: new Date('2026-11-13T10:00:00Z'),
    };
    invoicesStore.push(existingInvoice);

    quotationsStore.push({
      id: 1,
      tenantId,
      number: 'QT-101',
      partyCode: 'CUST-001',
      quoteDate: '2026-11-01',
      validUntil: '2026-12-01',
      status: SalesQuotationStatus.CONVERTED,
      note: null,
      totalAmount: '1000000.00',
      convertedInvoiceId: 'inv-uuid-101',
      createdBy: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const replay = await service.convertQuotationToInvoice(tenantId, 1, {
      idempotencyKey: 'idemp-key-999',
    });

    expect(replay.replayed).toBe(true);
    expect(replay.invoiceId).toBe('inv-uuid-101');
    expect(replay.quotationNumber).toBe('QT-101');
  });

  it('rejects conversion and transitions status to EXPIRED when validUntil date has passed', async () => {
    quotationsStore.push({
      id: 2,
      tenantId,
      number: 'QT-102',
      partyCode: 'CUST-001',
      quoteDate: '2026-10-01',
      validUntil: '2026-10-31', // expired relative to 2026-11-13
      status: SalesQuotationStatus.SENT,
      note: null,
      totalAmount: '500000.00',
      convertedInvoiceId: null,
      createdBy: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    quotationLinesStore.push({
      id: 2,
      tenantId,
      quotationId: 2,
      lineNo: 1,
      itemId: 10,
      description: 'کالای منقضی',
      quantity: '1.00',
      unitPrice: '500000.00',
      discount: '0.00',
      lineTotal: '500000.00',
    });

    await expect(
      service.convertQuotationToInvoice(tenantId, 2, { invoiceDate: '2026-11-13' }),
    ).rejects.toThrow(BadRequestException);

    expect(quotationsStore[0].status).toBe(SalesQuotationStatus.EXPIRED);
  });

  it('rejects already EXPIRED or REJECTED quotations', async () => {
    quotationsStore.push({
      id: 3,
      tenantId,
      number: 'QT-103',
      partyCode: 'CUST-001',
      quoteDate: '2026-11-01',
      validUntil: '2026-12-01',
      status: SalesQuotationStatus.REJECTED,
      note: null,
      totalAmount: '100000.00',
      convertedInvoiceId: null,
      createdBy: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      service.convertQuotationToInvoice(tenantId, 3),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects quotations with zero lines', async () => {
    quotationsStore.push({
      id: 4,
      tenantId,
      number: 'QT-104',
      partyCode: 'CUST-001',
      quoteDate: '2026-11-01',
      validUntil: '2026-12-01',
      status: SalesQuotationStatus.DRAFT,
      note: null,
      totalAmount: '0.00',
      convertedInvoiceId: null,
      createdBy: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      service.convertQuotationToInvoice(tenantId, 4),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException when quotation does not exist', async () => {
    await expect(
      service.convertQuotationToInvoice(tenantId, 9999),
    ).rejects.toThrow(NotFoundException);
  });
});
