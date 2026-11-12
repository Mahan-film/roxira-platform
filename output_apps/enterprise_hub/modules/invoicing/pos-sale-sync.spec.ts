import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessGuard } from '../access/access.guard';
import { AccessStub } from '../../test/support/access-stub';
import { PosSaleService } from './services/pos-sale.service';
import { InvoicingService } from './services/invoicing.service';
import { fixtureVatRates } from './__fixtures__/vat-rate.fixture';
import { PosSalesController } from './controllers/pos-sales.controller';
import { CreatePosSaleDto, SyncPosSalesDto } from './dto/pos-sale.dto';
import { Currency } from '../currency/enums/currency.enum';
import { InvoiceStatus } from './enums/invoice-status.enum';
import { computePosCartTotals } from '../../frontend/src/lib/pos-money';

describe('Offline Counter Sales Sync & Conflict Detection (#782 / T93)', () => {
  let posSaleService: PosSaleService;
  let controller: PosSalesController;
  let mockInvoicing: any;
  let mockInvoicingRepo: any;
  let mockInventoryRepo: any;
  let mockCustomerIdentity: any;
  let mockTenantsRepo: any;

  const TENANT_ID = 'tenant-test-123';

  beforeEach(() => {
    mockInvoicing = {
      create: jest.fn(),
      findOne: jest.fn(),
      quote: jest.fn().mockResolvedValue({
        totals: { finalPayable: 1100000 },
        currency: Currency.IRR,
      }),
    };
    mockInvoicingRepo = {
      findByIdempotencyKey: jest.fn().mockResolvedValue(null),
      findById: jest.fn(),
      findByRelated: jest.fn(),
    };
    mockInventoryRepo = {
      findStockItemByCode: jest.fn().mockImplementation((_t, code) => {
        if (code === 'SKU-OUT-OF-STOCK') {
          return Promise.resolve({ id: 10, sku: 'SKU-OUT-OF-STOCK', name: 'کالای ناموجود' });
        }
        if (code === 'SKU-VALID') {
          return Promise.resolve({ id: 11, sku: 'SKU-VALID', name: 'کالای موجود' });
        }
        return Promise.resolve(null);
      }),
      availableQuantity: jest.fn().mockImplementation((_t, sku) => {
        if (sku === 'SKU-OUT-OF-STOCK') {
          return Promise.resolve(0); // Out of stock!
        }
        return Promise.resolve(50);
      }),
    };
    mockCustomerIdentity = {
      resolve: jest.fn().mockResolvedValue({
        level: 'anonymous',
        lead: { id: 1 },
        created: false,
      }),
      walkIn: jest.fn().mockResolvedValue({ id: 1 }),
    };
    mockTenantsRepo = {
      findById: jest.fn().mockResolvedValue({ id: TENANT_ID, name: 'فروشگاه تست', countryCode: 'IR' }),
    };

    posSaleService = new PosSaleService(
      mockInvoicing,
      mockInvoicingRepo,
      mockInventoryRepo,
      mockCustomerIdentity,
      mockTenantsRepo,
    );
    controller = new PosSalesController(posSaleService);
  });

  const makeSaleDto = (key: string, sku = 'SKU-VALID', qty = 1): CreatePosSaleDto => ({
    idempotencyKey: key,
    lines: [
      {
        code: sku,
        quantity: qty,
        unitPrice: 1000000,
      },
    ],
    payments: [{ method: 'CASH', amount: 1100000 }],
  });

  it('successfully synchronises batch of queued offline counter sales', async () => {
    mockInvoicing.create.mockResolvedValue({
      id: 'inv-1',
      taxInvoiceNumber: 'TI-001',
      status: InvoiceStatus.PAID,
    });

    const syncDto: SyncPosSalesDto = {
      sales: [makeSaleDto('pos-uuid-1'), makeSaleDto('pos-uuid-2')],
    };

    const res = await posSaleService.syncSales(TENANT_ID, syncDto);

    expect(res.totalProcessed).toBe(2);
    expect(res.synced).toHaveLength(2);
    expect(res.conflicts).toHaveLength(0);
    expect(res.synced[0].clientUuid).toBe('pos-uuid-1');
    expect(res.synced[1].clientUuid).toBe('pos-uuid-2');
    expect(res.synced[0].replayed).toBe(false);
  });

  it('replays previously synced sales idempotently on client UUID without double posting', async () => {
    // Second sale was already recorded on server during earlier partial sync
    const sale2 = makeSaleDto('pos-uuid-replayed');
    const hash = (posSaleService as any).hashOf(sale2);

    mockInvoicingRepo.findByIdempotencyKey.mockImplementation((_t: string, key: string) => {
      if (key === 'pos-uuid-replayed') {
        return Promise.resolve({
          id: 'inv-replayed',
          requestHash: hash,
          customerId: null,
        });
      }
      return Promise.resolve(null);
    });

    mockInvoicing.findOne.mockResolvedValue({
      id: 'inv-replayed',
      taxInvoiceNumber: 'TI-REPLAY',
      status: InvoiceStatus.PAID,
    });
    mockInvoicing.create.mockResolvedValue({
      id: 'inv-fresh',
      taxInvoiceNumber: 'TI-FRESH',
      status: InvoiceStatus.PAID,
    });

    const syncDto: SyncPosSalesDto = {
      sales: [makeSaleDto('pos-uuid-fresh'), sale2],
    };

    const res = await posSaleService.syncSales(TENANT_ID, syncDto);

    expect(res.synced).toHaveLength(2);
    expect(res.conflicts).toHaveLength(0);
    expect(res.synced[0].replayed).toBe(false);
    expect(res.synced[1].clientUuid).toBe('pos-uuid-replayed');
    expect(res.synced[1].replayed).toBe(true);
  });

  it('records structured conflict when item went out of stock before sync', async () => {
    const outOfStockSale = makeSaleDto('pos-uuid-oos', 'SKU-OUT-OF-STOCK', 5);
    const validSale = makeSaleDto('pos-uuid-ok', 'SKU-VALID', 1);

    mockInvoicing.create.mockResolvedValue({
      id: 'inv-ok',
      taxInvoiceNumber: 'TI-OK',
      status: InvoiceStatus.PAID,
    });

    const syncDto: SyncPosSalesDto = {
      sales: [validSale, outOfStockSale],
    };

    const res = await posSaleService.syncSales(TENANT_ID, syncDto);

    expect(res.totalProcessed).toBe(2);
    expect(res.synced).toHaveLength(1);
    expect(res.synced[0].clientUuid).toBe('pos-uuid-ok');

    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0].clientUuid).toBe('pos-uuid-oos');
    expect(res.conflicts[0].code).toBe('OUT_OF_STOCK');
    expect(res.conflicts[0].error).toContain('موجودی کالای SKU-OUT-OF-STOCK کافی نیست');
    expect(res.conflicts[0].missingItems).toContain('SKU-OUT-OF-STOCK');
  });

  it('records ITEM_NOT_FOUND conflict when code does not exist in inventory', async () => {
    const unknownItemSale = makeSaleDto('pos-uuid-unknown', 'SKU-NON-EXISTENT', 1);

    const syncDto: SyncPosSalesDto = {
      sales: [unknownItemSale],
    };

    const res = await posSaleService.syncSales(TENANT_ID, syncDto);

    expect(res.synced).toHaveLength(0);
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0].clientUuid).toBe('pos-uuid-unknown');
    expect(res.conflicts[0].code).toBe('ITEM_NOT_FOUND');
    expect(res.conflicts[0].error).toContain('یافت نشد');
  });

  it('delegates through PosSalesController.sync endpoint extracting tenant from JWT', async () => {
    mockInvoicing.create.mockResolvedValue({
      id: 'inv-sync-1',
      taxInvoiceNumber: 'TI-SYNC-1',
      status: InvoiceStatus.PAID,
    });

    const req = {
      user: { sub: 'u1', tenantId: TENANT_ID, role: 'owner' },
    } as any;

    const syncDto: SyncPosSalesDto = {
      sales: [makeSaleDto('pos-uuid-ctrl')],
    };

    const res = await controller.sync(req, syncDto);
    expect(res.totalProcessed).toBe(1);
    expect(res.synced).toHaveLength(1);
    expect(res.synced[0].clientUuid).toBe('pos-uuid-ctrl');
  });

  it('reports only out-of-stock SKUs in missingItems when a multi-line sale has valid + OOS lines', async () => {
    const mixedSale: CreatePosSaleDto = {
      idempotencyKey: 'pos-uuid-mixed-oos',
      lines: [
        { code: 'SKU-VALID', quantity: 1, unitPrice: 1000000 },
        { code: 'SKU-OUT-OF-STOCK', quantity: 3, unitPrice: 500000 },
      ],
      payments: [{ method: 'CASH', amount: 2500000 }],
    };

    const res = await posSaleService.syncSales(TENANT_ID, { sales: [mixedSale] });

    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0].code).toBe('OUT_OF_STOCK');
    expect(res.conflicts[0].missingItems).toEqual(['SKU-OUT-OF-STOCK']);
  });

  it('isolates an invalid DTO item as VALIDATION_FAILED without rejecting valid items in the batch', async () => {
    mockInvoicing.create.mockResolvedValue({
      id: 'inv-valid-after-bad',
      taxInvoiceNumber: 'TI-OK-2',
      status: InvoiceStatus.PAID,
    });

    const badSale = {
      idempotencyKey: 'pos-uuid-bad-dto',
      customer: { name: 'آ'.repeat(121) }, // exceeds @MaxLength(120)
      lines: [{ code: 'SKU-VALID', quantity: 1, unitPrice: 1000000 }],
      payments: [{ method: 'CASH', amount: 1000000 }],
    } as CreatePosSaleDto;

    const validSale = makeSaleDto('pos-uuid-valid-2');

    const res = await posSaleService.syncSales(TENANT_ID, { sales: [badSale, validSale] });

    expect(res.totalProcessed).toBe(2);
    expect(res.synced).toHaveLength(1);
    expect(res.synced[0].clientUuid).toBe('pos-uuid-valid-2');
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0].clientUuid).toBe('pos-uuid-bad-dto');
    expect(res.conflicts[0].code).toBe('VALIDATION_FAILED');
    expect(res.conflicts[0].missingItems).toBeUndefined();
  });

  it('marks key-reuse ConflictException as CONFLICT without misreporting missingItems', async () => {
    const conflictSale = makeSaleDto('pos-uuid-key-conflict');
    mockInvoicingRepo.findByIdempotencyKey.mockResolvedValue({
      id: 'inv-existing',
      requestHash: 'different-hash',
      customerId: null,
    });

    const res = await posSaleService.syncSales(TENANT_ID, { sales: [conflictSale] });

    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0].code).toBe('CONFLICT');
    expect(res.conflicts[0].missingItems).toBeUndefined();
  });

  it('rethrows transient 5xx / DB / 403 errors instead of turning them into permanent conflicts', async () => {
    mockInvoicing.create.mockRejectedValueOnce(
      new InternalServerErrorException('Database connection lost'),
    );

    await expect(
      posSaleService.syncSales(TENANT_ID, { sales: [makeSaleDto('pos-uuid-db-down')] }),
    ).rejects.toThrow(InternalServerErrorException);

    mockInvoicing.create.mockRejectedValueOnce(new ForbiddenException('Forbidden'));

    await expect(
      posSaleService.syncSales(TENANT_ID, { sales: [makeSaleDto('pos-uuid-403')] }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('enforces AccessGuard invoicing:create permission on PosSalesController.sync (403 read_only, allow sales)', async () => {
    const accessStub = new AccessStub();
    accessStub.grant('u-readonly', TENANT_ID, 'read_only');
    accessStub.grant('u-sales', TENANT_ID, 'sales');

    const mockLoginWindow = { assertAllowed: jest.fn().mockResolvedValue(undefined) } as any;
    const guard = new AccessGuard(new Reflector(), accessStub as any, mockLoginWindow);
    const makeCtx = (sub: string) =>
      ({
        getHandler: () => PosSalesController.prototype.sync,
        getClass: () => PosSalesController,
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'POST',
            url: '/enterprise-hub/invoicing/pos-sales/sync',
            user: { sub, tenantId: TENANT_ID },
          }),
        }),
      }) as any;

    await expect(guard.canActivate(makeCtx('u-readonly'))).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(makeCtx('u-sales'))).resolves.toBe(true);
  });

  it('does not flag innocent cart SKUs as missingItems when error message has no SKU match', async () => {
    mockInvoicing.create.mockRejectedValueOnce(new BadRequestException('خطای عمومی پرداخت یا تاریخ'));
    const multiSkuSale: CreatePosSaleDto = {
      idempotencyKey: 'pos-uuid-unrelated-err',
      lines: [
        { code: 'SKU-VALID', description: 'کالای ۱', quantity: 1, unitPrice: 1000000 },
        { code: 'SKU-VALID-2', description: 'کالای ۲', quantity: 1, unitPrice: 1000000 },
      ],
      payments: [{ method: 'CASH', amount: 2200000 }],
    };
    mockInvoicingRepo.findByIdempotencyKey.mockResolvedValue(null);
    mockInventoryRepo.findStockItemByCode.mockResolvedValue({ id: 11, sku: 'SKU-VALID', name: 'کالای موجود' });
    mockInventoryRepo.availableQuantity.mockResolvedValue(50);

    const res = await posSaleService.syncSales(TENANT_ID, { sales: [multiSkuSale] });
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0].code).toBe('VALIDATION_FAILED');
    expect(res.conflicts[0].missingItems).toBeUndefined();
  });

  it('computes identical finalPayable between frontend computePosCartTotals and real InvoicingService.quote on multi-line odd-rounding carts', async () => {
    const cases = [
      {
        vatPercent: 10,
        lines: [
          { quantity: 1, unitPrice: 105 },
          { quantity: 1, unitPrice: 105 },
        ],
      },
      {
        vatPercent: 9,
        lines: [
          { quantity: 1, unitPrice: 333 },
          { quantity: 1, unitPrice: 333 },
          { quantity: 1, unitPrice: 333 },
        ],
      },
      {
        vatPercent: 10,
        lines: [
          { quantity: 1.5, unitPrice: 15 },
          { quantity: 1.5, unitPrice: 15 },
        ],
      },
      {
        vatPercent: 10,
        lines: [
          { quantity: 1.25, unitPrice: 1001 },
          { quantity: 2.75, unitPrice: 777 },
          { quantity: 1, unitPrice: 999 },
        ],
      },
      {
        vatPercent: 10,
        lines: [
          { quantity: 1.1, unitPrice: 2500 },
          { quantity: 0.3, unitPrice: 10000 },
        ],
      },
    ];

    for (const c of cases) {
      const realInvoicing = new InvoicingService(
        mockInvoicingRepo,
        {
          getRate: () => 1,
          round: (val: number) => Math.round(val),
        } as any,
        undefined,
        undefined,
        mockTenantsRepo,
        undefined,
        undefined,
        fixtureVatRates(c.vatPercent / 100),
      );

      const clientTotals = computePosCartTotals(
        c.lines.map((l) => ({ quantity: String(l.quantity), unitPrice: String(l.unitPrice) })),
        c.vatPercent,
      );
      const quote = await realInvoicing.quote(TENANT_ID, {
        items: c.lines.map((l, idx) => ({
          description: `کالا ${idx + 1}`,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
        })),
        currency: Currency.IRR,
      });

      expect(Number(clientTotals.payableTotal)).toBe(quote.totals.finalPayable);
      expect(Number(clientTotals.vatTotal)).toBe(quote.totals.totalTax);

      // Verify PosSaleService.createSale accepts client payable without 1-Rial mismatch
      const realPosService = new PosSaleService(
        {
          create: jest.fn().mockResolvedValue({
            id: 'inv-parity',
            taxInvoiceNumber: 'TI-PARITY',
            status: InvoiceStatus.PAID,
          }),
          findOne: jest.fn(),
          quote: realInvoicing.quote.bind(realInvoicing),
        } as any,
        mockInvoicingRepo,
        mockInventoryRepo,
        mockCustomerIdentity,
        mockTenantsRepo,
      );

      const created = await realPosService.createSale(TENANT_ID, {
        idempotencyKey: `pos-parity-${c.vatPercent}-${c.lines.length}`,
        lines: c.lines.map((l, idx) => ({
          description: `کالا ${idx + 1}`,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
        })),
        payments: [{ method: 'CASH', amount: Number(clientTotals.payableTotal) }],
      });
      expect(created.invoice.taxInvoiceNumber).toBe('TI-PARITY');
    }
  });
});
