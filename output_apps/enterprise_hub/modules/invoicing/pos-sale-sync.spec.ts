import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PosSaleService } from './services/pos-sale.service';
import { PosSalesController } from './controllers/pos-sales.controller';
import { CreatePosSaleDto, SyncPosSalesDto } from './dto/pos-sale.dto';
import { Currency } from '../currency/enums/currency.enum';
import { InvoiceStatus } from './enums/invoice-status.enum';

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
});
