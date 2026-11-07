import 'reflect-metadata';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { InvoicingRepository } from '../../invoicing/repositories/invoicing.repository';
import { InvoiceEntity, InvoiceItem } from '../../invoicing/entities/invoice.entity';
import { InvoiceSubject } from '../../invoicing/enums/invoice-kind.enum';
import { InvoiceStatus } from '../../invoicing/enums/invoice-status.enum';
import { SalesReturnService } from './services/sales-return.service';
import { CreateReturnDto } from './dto/sales-return.dto';
import { SalesDeliveryRepository } from '../delivery/repositories/sales-delivery.repository';
import { SalesDeliveryLineEntity } from '../delivery/entities/sales-delivery.entity';
import { InvoicingService } from '../../invoicing/services/invoicing.service';
import { InventoryService } from '../../inventory/services/inventory.service';
import { PostingRulesService } from '../../posting_rules/services/posting-rules.service';

const TENANT = 'tenant-a';
const OTHER_TENANT = 'tenant-b';

/** In-memory invoice repository for testing returns */
class InMemoryInvoicingRepository {
  rows: InvoiceEntity[] = [];
  private n = 0;

  async transaction<T>(work: (manager: any) => Promise<T>): Promise<T> {
    return work({});
  }

  async findByIdempotencyKey(tenantId: string, key: string): Promise<InvoiceEntity | null> {
    return this.rows.find((r) => r.tenantId === tenantId && r.idempotencyKey === key) ?? null;
  }

  async findById(tenantId: string, id: string): Promise<InvoiceEntity | null> {
    return this.rows.find((r) => r.id === id && r.tenantId === tenantId) ?? null;
  }

  async findByIdForPosting(tenantId: string, id: string, manager: any): Promise<InvoiceEntity | null> {
    return this.rows.find((r) => r.id === id && r.tenantId === tenantId) ?? null;
  }

  async save(tenantId: string, entity: Partial<InvoiceEntity>): Promise<InvoiceEntity> {
    const row = {
      ...entity,
      id: `invoice-${++this.n}`,
      tenantId,
      createdAt: new Date(),
    } as InvoiceEntity;
    this.rows.push(row);
    return row;
  }

  async updatePosting(tenantId: string, id: string, data: Partial<InvoiceEntity>): Promise<void> {
    const row = this.rows.find((r) => r.id === id && r.tenantId === tenantId);
    if (row) Object.assign(row, data);
  }

  async update(tenantId: string, criteria: any, data: any): Promise<void> {
    const row = this.rows.find((r) => r.id === criteria.id && r.tenantId === tenantId);
    if (row) Object.assign(row, data);
  }
}

/** Mock InvoicingService */
class MockInvoicingService {
  describe = jest.fn().mockResolvedValue([]);
}

/** Mock InventoryService */
class MockInventoryService {
  receiveStock = jest.fn().mockResolvedValue({});
}

/** Mock PostingRulesService */
class MockPostingRulesService {
  describe = jest.fn().mockResolvedValue([]);
  post = jest.fn().mockResolvedValue({ entryId: 1, entryNumber: 'TEST-1', replayed: false });
}

/** Helper to create a delivery invoice (original sale) */
const createDeliveryInvoice = (
  id: string,
  items: InvoiceItem[],
  tenantId: string = TENANT,
): InvoiceEntity => {
  return {
    id,
    tenantId,
    taxInvoiceNumber: `DEL-${id}`,
    direction: 'SALE',
    subject: InvoiceSubject.ORIGINAL,
    relatedInvoiceId: null,
    einvoiceType: 1,
    sellerInfo: { name: 'فروشنده' },
    buyerInfo: { name: 'خریدار' },
    customerId: null,
    currency: 'IRR',
    jurisdiction: 'IR',
    exchangeRate: 1,
    fxRate: 1,
    warehouseId: null,
    status: InvoiceStatus.ISSUED,
    items,
    totalAmount: items.reduce((sum, item) => sum + item.total, 0),
    totalDiscount: items.reduce((sum, item) => sum + item.discount, 0),
    totalTax: items.reduce((sum, item) => sum + item.tax, 0),
    finalPayable: items.reduce((sum, item) => sum + item.total, 0) + items.reduce((sum, item) => sum + item.tax, 0),
    baseTotalAmount: 0,
    baseTotalTax: 0,
    baseFinalPayable: 0,
    issuedAt: new Date(),
    paidAt: null,
    journalEntryId: 1,
    paidJournalEntryId: null,
    reversalJournalEntryId: null,
    postingError: null,
    postingMeta: null,
    createdAt: new Date(),
    idempotencyKey: null,
    requestHash: null,
    payments: null,
  };
};

/** Helper to create delivery lines */
const createDeliveryLine = (
  id: number,
  lineNo: number,
  sku: string,
  quantity: number,
  invoicedQuantity: number,
  returnedQuantity: number = 0,
): SalesDeliveryLineEntity => {
  return {
    id,
    tenantId: TENANT,
    deliveryId: 1,
    lineNo,
    orderLineId: id,
    itemId: id,
    sku,
    quantity: quantity.toString(),
    lineCost: (quantity * 1000).toString(),
    invoicedQuantity: invoicedQuantity.toString(),
    returnedQuantity: returnedQuantity.toString(),
  } as SalesDeliveryLineEntity;
};

/** Helper to create return lines */
const createReturnLines = (lines: Array<{ deliveryLineId: number; quantity: number }>): CreateReturnDto => {
  return {
    lines,
    returnDate: '2026-01-07',
  };
};

/** Test setup for returns */
function setup(): { service: SalesReturnService; repo: InMemoryInvoicingRepository } {
  const repo = new InMemoryInvoicingRepository();
  const invoicingRepo = repo as unknown as InvoicingRepository;
  const mockInvoicingService = new MockInvoicingService() as unknown as InvoicingService;
  const mockInventoryService = new MockInventoryService() as unknown as InventoryService;
  const mockPostingRules = new MockPostingRulesService() as unknown as PostingRulesService;

  const mockDeliveries = {
    lockDeliveryLinesForReturn: async (
      tenantId: string,
      invoiceId: string,
      lines: Array<{ deliveryLineId: number; quantity: number }>,
      manager: any,
    ) => {
      const deliveryLines = [
        createDeliveryLine(101, 1, 'SKU-1', 5.00, 5.00),
        createDeliveryLine(102, 2, 'SKU-2', 3.00, 3.00),
      ];
      const errors: Array<{ deliveryLineId: number; code: string; message: string }> = [];

      for (const line of lines) {
        const deliveryLine = deliveryLines.find((dl) => dl.id === line.deliveryLineId);
        if (!deliveryLine) {
          errors.push({
            deliveryLineId: line.deliveryLineId,
            code: '400',
            message: `خط برگشتی ${line.deliveryLineId} به صورتحباب مرجع تعلق ندارد.`,
          });
        }
      }

      if (errors.length === 0) {
        for (const line of lines) {
          const deliveryLine = deliveryLines.find((dl) => dl.id === line.deliveryLineId);
          if (!deliveryLine) continue;

          const invoicedQuantity = parseFloat(deliveryLine.invoicedQuantity);
          const returnedQuantity = parseFloat(deliveryLine.returnedQuantity);
          const maxReturnable = invoicedQuantity - returnedQuantity;
          const requested = line.quantity;

          if (requested > maxReturnable + 1e-9) {
            errors.push({
              deliveryLineId: line.deliveryLineId,
              code: '409',
              message: `مقدار برگشتی خط ${line.deliveryLineId} از باقی‌ماندهٔ قابل برگشت (${maxReturnable}) بیشتر است.`,
            });
          }
        }
      }

      return { deliveryLines, errors };
    },
  } as unknown as SalesDeliveryRepository;

  const service = new SalesReturnService(
    mockDeliveries,
    invoicingRepo,
    mockInvoicingService,
    mockInventoryService,
    mockPostingRules,
  );
  return { service, repo };
}

describe('SalesReturnService - Delivery Invoice Returns', () => {
  it('creates a RETURN invoice for a valid delivery invoice', async () => {
    const { service } = setup();
    const deliveryInvoice = createDeliveryInvoice(
      'inv-001',
      [
        { itemId: 1, sku: 'SKU-1', description: 'کالای 1', quantity: 5.00, unitPrice: 1000, discount: 0, vatRate: 0.1, tax: 500, total: 5500, originalLine: 0 },
        { itemId: 2, sku: 'SKU-2', description: 'کالای 2', quantity: 3.00, unitPrice: 1000, discount: 0, vatRate: 0.1, tax: 300, total: 3300, originalLine: 1 },
      ],
    );

    const savedInvoice = await repo.save(TENANT, deliveryInvoice);

    const returnDto = createReturnLines([
      { deliveryLineId: 101, quantity: 2.00 },
      { deliveryLineId: 102, quantity: 1.00 },
    ]);

    const result = await service.createReturn(TENANT, savedInvoice.id, returnDto);

    expect(result.id).toBeTruthy();
    expect(result.relatedInvoiceId).toBe(savedInvoice.id);
    expect(result.status).toBe('ISSUED');
    expect(result.items.length).toBe(2);
  });

  it('refuses quantity above invoiced minus already returned', async () => {
    const { service } = setup();
    const deliveryInvoice = createDeliveryInvoice(
      'inv-002',
      [
        { itemId: 1, sku: 'SKU-1', description: 'کالای 1', quantity: 5.00, unitPrice: 1000, discount: 0, vatRate: 0.1, tax: 500, total: 5500, originalLine: 0 },
      ],
    );

    const savedInvoice = await repo.save(TENANT, deliveryInvoice);

    await service.createReturn(TENANT, savedInvoice.id, createReturnLines([
      { deliveryLineId: 101, quantity: 3.00 },
    ]));

    await expect(service.createReturn(TENANT, savedInvoice.id, createReturnLines([
      { deliveryLineId: 101, quantity: 6.00 },
    ]))).rejects.toThrow(/از باقی‌ماندهٔ قابل برگشت/);
  });

  it('refuses delivery line not on the invoice', async () => {
    const { service } = setup();
    const deliveryInvoice = createDeliveryInvoice(
      'inv-003',
      [
        { itemId: 1, sku: 'SKU-1', description: 'کالای 1', quantity: 5.00, unitPrice: 1000, discount: 0, vatRate: 0.1, tax: 500, total: 5500, originalLine: 0 },
      ],
    );

    const savedInvoice = await repo.save(TENANT, deliveryInvoice);

    await expect(service.createReturn(TENANT, savedInvoice.id, createReturnLines([
      { deliveryLineId: 999, quantity: 2.00 },
    ]))).rejects.toThrow(/تعلق ندارد/);
  });

  it('handles idempotency with same key', async () => {
    const { service } = setup();
    const deliveryInvoice = createDeliveryInvoice(
      'inv-004',
      [
        { itemId: 1, sku: 'SKU-1', description: 'کالای 1', quantity: 5.00, unitPrice: 1000, discount: 0, vatRate: 0.1, tax: 500, total: 5500, originalLine: 0 },
      ],
    );

    const savedInvoice = await repo.save(TENANT, deliveryInvoice);

    const returnDto = createReturnLines([
      { deliveryLineId: 101, quantity: 2.00 },
    ]);
    returnDto.idempotencyKey = 'retry-key-001';

    const first = await service.createReturn(TENANT, savedInvoice.id, returnDto);
    const second = await service.createReturn(TENANT, savedInvoice.id, returnDto);

    expect(first.id).toBe(second.id);
  });
});