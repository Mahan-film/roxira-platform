import { NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { CreatePosSaleDto } from './dto/pos-sale.dto';
import { SalesReportQueryDto } from './dto/sales-report.dto';
import { InvoicingRepository } from './repositories/invoicing.repository';
import { InvoicingService } from './services/invoicing.service';
import { Currency } from '../currency/enums/currency.enum';
import { InvoiceStatus } from './enums/invoice-status.enum';
import { InvoiceDirection, InvoiceSubject } from './enums/invoice-kind.enum';
import { salesReport, salesReportTable, SalesDoc } from './reports/sales-report';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const VALID_SELLER_USER = '33333333-3333-4333-8333-333333333333';
const ALIEN_SELLER_USER = '44444444-4444-4444-8444-444444444444';

describe('Salesperson on Invoices (#440)', () => {
  describe('DTO Validation', () => {
    it('validates valid salespersonId in CreateInvoiceDto', async () => {
      const dto = plainToInstance(CreateInvoiceDto, {
        sellerInfo: { name: 'فروشنده' },
        buyerInfo: { name: 'خریدار' },
        salespersonId: VALID_SELLER_USER,
        items: [
          {
            description: 'کالا ۱',
            quantity: 1,
            unitPrice: 1000,
            vatRate: 0.1,
          },
        ],
      });
      const errors = await validate(dto);
      expect(errors.filter((e) => e.property === 'salespersonId')).toHaveLength(0);
    });

    it('rejects non-UUID salespersonId in CreateInvoiceDto', async () => {
      const dto = plainToInstance(CreateInvoiceDto, {
        sellerInfo: { name: 'فروشنده' },
        salespersonId: 'not-a-valid-uuid',
        items: [
          {
            description: 'کالا ۱',
            quantity: 1,
            unitPrice: 1000,
          },
        ],
      });
      const errors = await validate(dto);
      const sellerError = errors.find((e) => e.property === 'salespersonId');
      expect(sellerError).toBeDefined();
    });

    it('validates valid salespersonId in CreatePosSaleDto', async () => {
      const dto = plainToInstance(CreatePosSaleDto, {
        idempotencyKey: 'pos-test-12345',
        salespersonId: VALID_SELLER_USER,
        lines: [{ description: 'کالا ۱', quantity: 1, unitPrice: 1000 }],
        payments: [{ method: 'CASH', amount: 1100 }],
      });
      const errors = await validate(dto);
      expect(errors.filter((e) => e.property === 'salespersonId')).toHaveLength(0);
    });

    it('accepts groupBy=salesperson in SalesReportQueryDto', async () => {
      const dto = plainToInstance(SalesReportQueryDto, {
        groupBy: 'salesperson',
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });

  describe('InvoicingRepository fail-closed salesperson check', () => {
    it('fails closed when TenantScope is unavailable or salespersonId is malformed', async () => {
      const repo = new InvoicingRepository({} as any, {} as any, undefined);
      await expect(repo.isSalespersonInTenant(TENANT_A, VALID_SELLER_USER)).resolves.toBe(false);
      await expect(repo.isSalespersonInTenant(TENANT_A, 'not-a-uuid')).resolves.toBe(false);
    });
  });

  describe('InvoicingService round-trip and tenant isolation', () => {
    let service: InvoicingService;
    let repo: any;
    let currencyService: any;
    let rows: any[];

    beforeEach(() => {
      rows = [];
      repo = {
        rows,
        async isSalespersonInTenant(tenantId: string, salespersonId: string): Promise<boolean> {
          if (tenantId === TENANT_A && salespersonId === VALID_SELLER_USER) return true;
          if (tenantId === TENANT_B && salespersonId === ALIEN_SELLER_USER) return true;
          return false;
        },
        async save(tenantId: string, entity: any) {
          entity.tenantId = tenantId;
          if (!entity.id) {
            entity.id = 'inv-' + (rows.length + 1);
          }
          const idx = rows.findIndex((r) => r.id === entity.id);
          if (idx >= 0) rows[idx] = entity;
          else rows.push(entity);
          return entity;
        },
        async create(tenantId: string, entity: any) {
          entity.tenantId = tenantId;
          entity.id = 'inv-' + (rows.length + 1);
          rows.push(entity);
          return entity;
        },
        async findById(tenantId: string, id: string) {
          return rows.find((r) => r.tenantId === tenantId && r.id === id) ?? null;
        },
        async findByTaxInvoiceNumber(_tenantId: string, _num: string) {
          return null;
        },
      };

      currencyService = {
        getRate: () => 1,
        round: (val: number) => val,
      };

      service = new InvoicingService(
        repo as any,
        currencyService as any,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          generalRate: () => 0.1,
          resolve: () => 0.1,
        } as any,
      );
    });

    it('creates an invoice with salespersonId and round-trips it', async () => {
      const result = await service.create(TENANT_A, {
        sellerInfo: { name: 'فروشنده الف' },
        buyerInfo: { name: 'خریدار الف' },
        salespersonId: VALID_SELLER_USER,
        items: [{ description: 'خدمات مشاوره', quantity: 1, unitPrice: 5000000, vatRate: 0.1 }],
      });

      expect(result.salespersonId).toBe(VALID_SELLER_USER);
      expect(repo.rows[0].salespersonId).toBe(VALID_SELLER_USER);
    });

    it('creates an invoice without salespersonId (null round-trip)', async () => {
      const result = await service.create(TENANT_A, {
        sellerInfo: { name: 'فروشنده الف' },
        buyerInfo: { name: 'خریدار الف' },
        items: [{ description: 'خدمات مشاوره', quantity: 1, unitPrice: 5000000, vatRate: 0.1 }],
      });

      expect(result.salespersonId).toBeNull();
      expect(repo.rows[0].salespersonId).toBeNull();
    });

    it('enforces tenant isolation: rejects salesperson belonging to another tenant', async () => {
      await expect(
        service.create(TENANT_A, {
          sellerInfo: { name: 'فروشنده الف' },
          buyerInfo: { name: 'خریدار الف' },
          salespersonId: ALIEN_SELLER_USER,
          items: [{ description: 'کالا', quantity: 1, unitPrice: 1000, vatRate: 0.1 }],
        }),
      ).rejects.toThrow(NotFoundException);

      expect(repo.rows).toHaveLength(0);
    });

    it('allows updating salespersonId on an existing invoice and verifies tenant link', async () => {
      const created = await service.create(TENANT_A, {
        sellerInfo: { name: 'فروشنده' },
        buyerInfo: { name: 'خریدار' },
        items: [{ description: 'کالا', quantity: 1, unitPrice: 1000, vatRate: 0.1 }],
      });
      expect(created.salespersonId).toBeNull();

      const updated = await service.update(TENANT_A, created.id, {
        salespersonId: VALID_SELLER_USER,
      });
      expect(updated.salespersonId).toBe(VALID_SELLER_USER);

      await expect(
        service.update(TENANT_A, created.id, {
          salespersonId: ALIEN_SELLER_USER,
        }),
      ).rejects.toThrow(NotFoundException);

      const cleared = await service.update(TENANT_A, created.id, {
        salespersonId: null,
      });
      expect(cleared.salespersonId).toBeNull();
    });
  });

  describe('Sales report grouping by salesperson', () => {
    it('groups by salesperson and builds table correctly', () => {
      const repA = '00000000-0000-4000-8000-000000000001';
      const repB = '00000000-0000-4000-8000-000000000002';

      const docA: SalesDoc = {
        id: '1',
        createdAt: new Date(),
        relatedInvoiceId: null,
        direction: InvoiceDirection.SALE,
        subject: InvoiceSubject.ORIGINAL,
        status: InvoiceStatus.ISSUED,
        currency: Currency.IRR,
        fxRate: 1,
        finalPayable: 2200,
        totalTax: 200,
        buyerInfo: { name: 'خریدار ۱' },
        sellerInfo: { name: 'شرکت ما' },
        salespersonId: repA,
        items: [
          {
            description: 'کالا ۱',
            quantity: 2,
            unitPrice: 1000,
            discount: 0,
            vatRate: 0.1,
            tax: 200,
            total: 2200,
          },
        ],
      };

      const docB: SalesDoc = {
        id: '2',
        createdAt: new Date(),
        relatedInvoiceId: null,
        direction: InvoiceDirection.SALE,
        subject: InvoiceSubject.ORIGINAL,
        status: InvoiceStatus.PAID,
        currency: Currency.IRR,
        fxRate: 1,
        finalPayable: 5500,
        totalTax: 500,
        buyerInfo: { name: 'خریدار ۲' },
        sellerInfo: { name: 'شرکت ما' },
        salespersonId: repB,
        items: [
          {
            description: 'کالا ۲',
            quantity: 5,
            unitPrice: 1000,
            discount: 0,
            vatRate: 0.1,
            tax: 500,
            total: 5500,
          },
        ],
      };

      const docUnassigned: SalesDoc = {
        id: '3',
        createdAt: new Date(),
        relatedInvoiceId: null,
        direction: InvoiceDirection.SALE,
        subject: InvoiceSubject.ORIGINAL,
        status: InvoiceStatus.ISSUED,
        currency: Currency.IRR,
        fxRate: 1,
        finalPayable: 1100,
        totalTax: 100,
        buyerInfo: { name: 'خریدار ۳' },
        sellerInfo: { name: 'شرکت ما' },
        salespersonId: null,
        items: [
          {
            description: 'کالا ۳',
            quantity: 1,
            unitPrice: 1000,
            discount: 0,
            vatRate: 0.1,
            tax: 100,
            total: 1100,
          },
        ],
      };

      const groups = salesReport([docA, docB, docUnassigned], 'salesperson');
      expect(groups).toHaveLength(3);
      expect(groups.map((g) => g.key)).toEqual([repA, repB, 'بدون فروشنده']);

      const table = salesReportTable(groups, 'salesperson');
      expect(table.title).toBe('فروش به تفکیک فروشنده');
      expect(table.columns[0].title).toBe('فروشنده');
      expect(table.rows).toHaveLength(4);
      expect(table.rows[3].cells[0]).toBe('جمع');
    });
  });
});
