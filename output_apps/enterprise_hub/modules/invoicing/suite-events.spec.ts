import { InvoiceJurisdiction } from './enums/invoice-jurisdiction.enum';
import 'reflect-metadata';
import { fakePostingRules } from './__fixtures__/fake-posting-rules';
import { fixtureVatRates } from './__fixtures__/vat-rate.fixture';
import { Job, Queue } from 'bullmq';
import { AccountResponseDto } from '../accounting/dto/account-response.dto';
import { CreateAccountDto } from '../accounting/dto/create-account.dto';
import { AccountType } from '../accounting/enums/accounting.enum';
import { AccountingService } from '../accounting/services/accounting.service';
import { Currency } from '../currency/enums/currency.enum';
import { CurrencyService } from '../currency/services/currency.service';
import { InventoryService } from '../inventory/services/inventory.service';
import {
  SUITE_EVENT_INVOICE_STATUS_JOB,
  SUITE_EVENTS_QUEUE,
  SuiteInvoiceStatusEvent,
} from './constants/suite-events.constants';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceEntity } from './entities/invoice.entity';
import { EInvoiceType, InvoiceDirection, InvoiceSubject } from './enums/invoice-kind.enum';
import { InvoiceStatus } from './enums/invoice-status.enum';
import { SuiteEventsProcessor } from './processors/suite-events.processor';
import { InvoicingRepository } from './repositories/invoicing.repository';
import { InvoicePostingService } from './services/invoice-posting.service';
import { InvoicingService } from './services/invoicing.service';

/** Repository درون‌حافظه‌ای مینیمال با قید مستأجر. */
class FakeInvoicingRepository {
  rows: InvoiceEntity[] = [];

  async findById(tenantId: string, id: string): Promise<InvoiceEntity | null> {
    return (
      this.rows.find((row) => row.id === id && row.tenantId === tenantId) ?? null
    );
  }

  /** No real transaction here (rollback is covered by the PostgreSQL integration spec). */
  async transaction<T>(work: (manager: unknown) => Promise<T>): Promise<T> {
    return work({});
  }

  async findByIdForPosting(tenantId: string, id: string): Promise<InvoiceEntity | null> {
    return this.findById(tenantId, id);
  }

  async updatePosting(
    tenantId: string,
    id: string,
    data: Partial<InvoiceEntity>,
  ): Promise<void> {
    const row = this.rows.find(
      (entity) => entity.id === id && entity.tenantId === tenantId,
    );
    if (row) {
      Object.assign(row, data);
    }
  }

  async create(
    tenantId: string,
    data: Partial<InvoiceEntity>,
  ): Promise<InvoiceEntity> {
    const row = {
      ...data,
      id: `inv-${this.rows.length + 1}`,
      tenantId,
      createdAt: new Date(),
    } as InvoiceEntity;
    this.rows.push(row);
    return row;
  }

  async save(tenantId: string, entity: InvoiceEntity): Promise<InvoiceEntity> {
    const index = this.rows.findIndex(
      (row) => row.id === entity.id && row.tenantId === tenantId,
    );
    if (index >= 0) {
      this.rows[index] = { ...entity, tenantId };
    }
    return entity;
  }

  async findByTaxInvoiceNumber(
    tenantId: string,
    number: string,
  ): Promise<InvoiceEntity | null> {
    return (
      this.rows.find(
        (row) => row.taxInvoiceNumber === number && row.tenantId === tenantId,
      ) ?? null
    );
  }
}

const defaultAccounts = (): AccountResponseDto[] => [
  {
    id: 1,
    code: '1010',
    name: 'موجودی نقد و بانک',
    accountType: AccountType.ASSET,
    currency: Currency.IRR,
    balance: 0,
  },
  {
    id: 2,
    code: '1020',
    name: 'حساب‌های دریافتنی تجاری',
    accountType: AccountType.ASSET,
    currency: Currency.IRR,
    balance: 0,
  },
  {
    id: 3,
    code: '2020',
    name: 'مالیات بر ارزش افزوده پرداختنی',
    accountType: AccountType.LIABILITY,
    currency: Currency.IRR,
    balance: 0,
  },
  {
    id: 4,
    code: '4010',
    name: 'درآمد فروش خدمات',
    accountType: AccountType.REVENUE,
    currency: Currency.IRR,
    balance: 0,
  },
];

const buildAccounting = () => {
  let sequence = 100;
  const accounts = defaultAccounts();
  const listAccounts = jest.fn(async (_tenantId: string) => accounts);
  const createAccount = jest.fn(
    async (_tenantId: string, dto: CreateAccountDto) => {
      const created: AccountResponseDto = {
        id: ++sequence,
        code: dto.code,
        name: dto.name,
        accountType: dto.accountType,
        currency: dto.currency ?? Currency.IRR,
        balance: 0,
      };
      accounts.push(created);
      return created;
    },
  );
  const createJournalEntry = jest.fn(
    async (_tenantId: string, dto: object) => ({ id: ++sequence, ...dto }),
  );

  return {
    service: {
      listAccounts,
      createAccount,
      createJournalEntry,
    } as unknown as AccountingService,
    listAccounts,
    createAccount,
    createJournalEntry,
  };
};

const buildInventory = () => {
  const issueStock = jest.fn(async () => ({ type: 'OUTBOUND', totalCost: 600 }));
  const receiveStock = jest.fn(async () => ({ type: 'INBOUND', totalCost: 600 }));
  return {
    service: { issueStock, receiveStock } as unknown as InventoryService,
    issueStock,
    receiveStock,
  };
};

const buildInvoice = (
  overrides: Partial<InvoiceEntity> = {},
): InvoiceEntity => ({
  id: 'inv-1',
  tenantId: 'tenant-a',
  taxInvoiceNumber: 'TI-1',
  direction: InvoiceDirection.SALE,
  einvoiceType: EInvoiceType.WITH_BUYER,
  subject: InvoiceSubject.ORIGINAL,
  relatedInvoiceId: null,
  warehouseId: null,
  postingMeta: null,
  idempotencyKey: null,
  requestHash: null,
  payments: null,
  jurisdiction: InvoiceJurisdiction.IR,
  customerId: null,
  sellerInfo: { name: 'فروشنده' },
  buyerInfo: { name: 'خریدار' },
  items: [
    {
      itemId: 3,
      sku: 'SKU-3',
      description: 'کالا',
      quantity: 2,
      unitPrice: 500,
      discount: 0,
      vatRate: 0.1,
      tax: 100,
      total: 1100,
    },
    {
      itemId: null,
      sku: null,
      description: 'خدمت (بدون کالای انبار)',
      quantity: 1,
      unitPrice: 0,
      discount: 0,
      vatRate: 0,
      tax: 0,
      total: 0,
    },
  ],
  currency: Currency.IRR,
  exchangeRate: 1,
  fxRate: 1,
  amountFx: null,
  baseCurrency: Currency.USD,
  totalAmount: 1000,
  totalDiscount: 0,
  totalTax: 100,
  finalPayable: 1100,
  baseTotalAmount: 0,
  baseTotalTax: 0,
  baseFinalPayable: 0,
  status: InvoiceStatus.ISSUED,
  issuedAt: new Date('2026-01-01T00:00:00.000Z'),
  paidAt: null,
  journalEntryId: null,
  paidJournalEntryId: null,
  reversalJournalEntryId: null,
  postingError: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const buildPosting = (invoices: InvoiceEntity[] = []) => {
  const repo = new FakeInvoicingRepository();
  repo.rows.push(...invoices);
  const inventory = buildInventory();
  const accounting = buildAccounting();
  const posting = new InvoicePostingService(
    repo as unknown as InvoicingRepository,
    inventory.service,
    accounting.service,
    fakePostingRules(accounting.service),
  );
  return { repo, inventory, accounting, posting };
};

const event = (status: InvoiceStatus): SuiteInvoiceStatusEvent => ({
  tenantId: 'tenant-a',
  invoiceId: 'inv-1',
  status,
});

const journalDto = (
  mock: { mock: { calls: ReadonlyArray<ReadonlyArray<unknown>> } },
  index: number,
): { entryNumber: string; lines: Array<Record<string, unknown>> } =>
  mock.mock.calls[index][1] as {
    entryNumber: string;
    lines: Array<Record<string, unknown>>;
  };

describe('InvoicePostingService — ISSUED', () => {
  it('records outbound stock and a balanced AR / Sales + VAT entry', async () => {
    const { repo, inventory, accounting, posting } = buildPosting([
      buildInvoice(),
    ]);

    await posting.handle(event(InvoiceStatus.ISSUED));

    expect(inventory.issueStock).toHaveBeenCalledTimes(1);
    expect(inventory.issueStock).toHaveBeenCalledWith(
      'tenant-a',
      expect.objectContaining({ sku: 'SKU-3', quantity: 2 }),
      expect.anything(),
    );

    const dto = journalDto(accounting.createJournalEntry, 0);
    expect(dto.entryNumber).toBe('INV-inv-1-ISSUED');
    expect(dto.lines).toEqual([
      expect.objectContaining({ accountCode: '1020', debit: '1100.00' }),
      expect.objectContaining({ accountCode: '5101', debit: '600.00' }),
      expect.objectContaining({ accountCode: '4010', credit: '1000.00' }),
      expect.objectContaining({ accountCode: '2020', credit: '100.00' }),
      expect.objectContaining({ accountCode: '1301', credit: '600.00' }),
    ]);
    expect(repo.rows[0].postingMeta).toMatchObject({
      stockValue: 600,
      lines: [{ sku: 'SKU-3', quantity: 2, unitCost: 300, moved: 'OUT' }],
      posted: { receivable: '110000', vat: '10000', net: '100000', stock: '-60000' },
    });

    expect(repo.rows[0].journalEntryId).not.toBeNull();
    expect(repo.rows[0].postingError).toBeNull();
  });

  it('is idempotent: does nothing when already linked', async () => {
    const { inventory, accounting, posting } = buildPosting([
      buildInvoice({ journalEntryId: 7 }),
    ]);

    await posting.handle(event(InvoiceStatus.ISSUED));

    expect(inventory.issueStock).not.toHaveBeenCalled();
    expect(accounting.createJournalEntry).not.toHaveBeenCalled();
  });

  it('converts foreign-currency amounts to rial using fx_rate', async () => {
    const { accounting, posting } = buildPosting([
      buildInvoice({ currency: Currency.USD, fxRate: 920000 }),
    ]);

    await posting.handle(event(InvoiceStatus.ISSUED));

    const dto = journalDto(accounting.createJournalEntry, 0);
    expect(dto.lines).toEqual([
      expect.objectContaining({ accountCode: '1020', debit: '1012000000.00' }),
      expect.objectContaining({ accountCode: '5101', debit: '600.00' }),
      expect.objectContaining({ accountCode: '4010', credit: '920000000.00' }),
      expect.objectContaining({ accountCode: '2020', credit: '92000000.00' }),
      expect.objectContaining({ accountCode: '1301', credit: '600.00' }),
    ]);
  });

  it('surfaces inventory errors on the invoice without linking', async () => {
    const { inventory, accounting, repo, posting } = buildPosting([
      buildInvoice(),
    ]);
    inventory.issueStock.mockRejectedValueOnce(new Error('موجودی کافی نیست'));

    await posting.handle(event(InvoiceStatus.ISSUED));

    expect(accounting.createJournalEntry).not.toHaveBeenCalled();
    expect(repo.rows[0].journalEntryId).toBeNull();
    expect(repo.rows[0].postingError).toBe('موجودی کافی نیست');
  });

  it('creates missing default accounts when the chart lacks them', async () => {
    const { accounting, posting } = buildPosting([buildInvoice()]);
    accounting.listAccounts.mockResolvedValueOnce([]);

    await posting.handle(event(InvoiceStatus.ISSUED));

    expect(accounting.createAccount).toHaveBeenCalledTimes(5);
    const dto = journalDto(accounting.createJournalEntry, 0);
    expect(dto.lines.map((line) => line.accountCode)).toEqual([
      '1201',
      '5101',
      '4101',
      '2301',
      '1301',
    ]);
  });
});

describe('InvoicePostingService — PAID', () => {
  it('records a Cash/Bank debit against Accounts Receivable', async () => {
    const { repo, accounting, posting } = buildPosting([
      buildInvoice({ status: InvoiceStatus.PAID, journalEntryId: 5 }),
    ]);

    await posting.handle(event(InvoiceStatus.PAID));

    const dto = journalDto(accounting.createJournalEntry, 0);
    expect(dto.entryNumber).toBe('INV-inv-1-PAID');
    expect(dto.lines).toEqual([
      expect.objectContaining({ accountCode: '1010', debit: '1100.00' }),
      expect.objectContaining({ accountCode: '1020', credit: '1100.00' }),
    ]);
    expect(repo.rows[0].paidJournalEntryId).toBe(101);
  });

  it('is idempotent: does nothing when already settled', async () => {
    const { accounting, posting } = buildPosting([
      buildInvoice({ journalEntryId: 5, paidJournalEntryId: 9 }),
    ]);

    await posting.handle(event(InvoiceStatus.PAID));

    expect(accounting.createJournalEntry).not.toHaveBeenCalled();
  });

  it('posts the issuance first when paid directly from a draft', async () => {
    const { inventory, accounting, posting } = buildPosting([
      buildInvoice({ status: InvoiceStatus.PAID, journalEntryId: null }),
    ]);

    await posting.handle(event(InvoiceStatus.PAID));

    expect(inventory.issueStock).toHaveBeenCalledTimes(1);
    expect(accounting.createJournalEntry).toHaveBeenCalledTimes(2);
    expect(journalDto(accounting.createJournalEntry, 0).entryNumber).toBe(
      'INV-inv-1-ISSUED',
    );
    expect(journalDto(accounting.createJournalEntry, 1).entryNumber).toBe(
      'INV-inv-1-PAID',
    );
  });
});

describe('InvoicePostingService — CANCELLED', () => {
  it('reverses the entry and restores stock after issuance', async () => {
    const { repo, inventory, accounting, posting } = buildPosting([
      buildInvoice({ status: InvoiceStatus.CANCELLED, journalEntryId: 5 }),
    ]);

    await posting.handle(event(InvoiceStatus.CANCELLED));

    const dto = journalDto(accounting.createJournalEntry, 0);
    expect(dto.entryNumber).toBe('INV-inv-1-CANCEL');
    expect(dto.lines).toEqual([
      expect.objectContaining({ accountCode: '4010', debit: '1000.00' }),
      expect.objectContaining({ accountCode: '2020', debit: '100.00' }),
      expect.objectContaining({ accountCode: '1020', credit: '1100.00' }),
    ]);
    expect(inventory.receiveStock).toHaveBeenCalledWith(
      'tenant-a',
      expect.objectContaining({
        sku: 'SKU-3',
        quantity: 2,
        unitPurchaseCost: 500,
      }),
      expect.anything(),
    );
    expect(repo.rows[0].reversalJournalEntryId).not.toBeNull();
  });

  it('does nothing when the invoice was never issued', async () => {
    const { inventory, accounting, posting } = buildPosting([
      buildInvoice({ status: InvoiceStatus.CANCELLED, journalEntryId: null }),
    ]);

    await posting.handle(event(InvoiceStatus.CANCELLED));

    expect(inventory.receiveStock).not.toHaveBeenCalled();
    expect(accounting.createJournalEntry).not.toHaveBeenCalled();
  });

  it('is idempotent: does nothing when already reversed', async () => {
    const { inventory, accounting, posting } = buildPosting([
      buildInvoice({
        status: InvoiceStatus.CANCELLED,
        journalEntryId: 5,
        reversalJournalEntryId: 9,
      }),
    ]);

    await posting.handle(event(InvoiceStatus.CANCELLED));

    expect(inventory.receiveStock).not.toHaveBeenCalled();
    expect(accounting.createJournalEntry).not.toHaveBeenCalled();
  });
});

describe('SuiteEventsProcessor', () => {
  it('dispatches valid status events to the posting service', async () => {
    const handle = jest.fn(async () => undefined);
    const processor = new SuiteEventsProcessor({
      handle,
    } as unknown as InvoicePostingService);

    const result = await processor.process({
      name: SUITE_EVENT_INVOICE_STATUS_JOB,
      data: { tenantId: 'tenant-a', invoiceId: 'inv-1', status: 'ISSUED' },
    } as unknown as Job<SuiteInvoiceStatusEvent>);

    expect(result).toEqual({ ok: true });
    expect(handle).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      invoiceId: 'inv-1',
      status: 'ISSUED',
    });
  });

  it('rejects payloads without a tenant (fail-closed)', async () => {
    const handle = jest.fn(async () => undefined);
    const processor = new SuiteEventsProcessor({
      handle,
    } as unknown as InvoicePostingService);

    const result = await processor.process({
      name: SUITE_EVENT_INVOICE_STATUS_JOB,
      data: { tenantId: '', invoiceId: 'inv-1', status: 'ISSUED' },
    } as unknown as Job<SuiteInvoiceStatusEvent>);

    expect(result).toEqual({ ok: false });
    expect(handle).not.toHaveBeenCalled();
  });
});

describe('InvoicingService — enqueues suite events', () => {
  const buildInvoicing = () => {
    const repo = new FakeInvoicingRepository();
    const queue = { add: jest.fn(async () => undefined) };
    const currencyService = {
      getRate: jest.fn(() => 1),
      round: jest.fn((value: number) => value),
    } as unknown as CurrencyService;
    const service = new InvoicingService(
      repo as unknown as InvoicingRepository,
      currencyService,
      undefined,
      undefined,
      undefined,
      queue as unknown as Queue,
      undefined,
      fixtureVatRates(),
    );
    return { service, repo, queue };
  };

  const dto = (
    taxInvoiceNumber: string,
    status?: InvoiceStatus,
  ): CreateInvoiceDto => ({
    taxInvoiceNumber,
    sellerInfo: { name: 'فروشنده' },
    buyerInfo: { name: 'خریدار' },
    items: [{ description: 'خدمت', quantity: 1, unitPrice: 1000, discount: 0 }],
    ...(status ? { status } : {}),
  });

  it('enqueues an ISSUED event when created as issued', async () => {
    const { service, queue } = buildInvoicing();

    await service.create('tenant-a', dto('TI-1', InvoiceStatus.ISSUED));

    expect(queue.add).toHaveBeenCalledWith(
      SUITE_EVENT_INVOICE_STATUS_JOB,
      expect.objectContaining({
        tenantId: 'tenant-a',
        invoiceId: 'inv-1',
        status: InvoiceStatus.ISSUED,
      }),
      expect.any(Object),
    );
  });

  it('enqueues a PAID event on payment', async () => {
    const { service, queue } = buildInvoicing();
    const created = await service.create(
      'tenant-a',
      dto('TI-1', InvoiceStatus.ISSUED),
    );
    queue.add.mockClear();

    await service.pay('tenant-a', created.id);

    expect(queue.add).toHaveBeenCalledWith(
      SUITE_EVENT_INVOICE_STATUS_JOB,
      expect.objectContaining({
        invoiceId: created.id,
        status: InvoiceStatus.PAID,
      }),
      expect.any(Object),
    );
  });

  it('enqueues a CANCELLED event only when cancelling an issued invoice', async () => {
    const { service, queue } = buildInvoicing();
    const issued = await service.create(
      'tenant-a',
      dto('TI-1', InvoiceStatus.ISSUED),
    );
    const draft = await service.create('tenant-a', dto('TI-2'));
    queue.add.mockClear();

    await service.cancel('tenant-a', draft.id);
    expect(queue.add).not.toHaveBeenCalled();

    await service.cancel('tenant-a', issued.id);
    expect(queue.add).toHaveBeenCalledWith(
      SUITE_EVENT_INVOICE_STATUS_JOB,
      expect.objectContaining({
        invoiceId: issued.id,
        status: InvoiceStatus.CANCELLED,
      }),
      expect.any(Object),
    );
  });

  it('does not enqueue when no queue is configured', async () => {
    const repo = new FakeInvoicingRepository();
    const currencyService = {
      getRate: jest.fn(() => 1),
      round: jest.fn((value: number) => value),
    } as unknown as CurrencyService;
    const service = new InvoicingService(
      repo as unknown as InvoicingRepository,
      currencyService,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      fixtureVatRates(),
    );

    await expect(
      service.create('tenant-a', dto('TI-1', InvoiceStatus.ISSUED)),
    ).resolves.toBeDefined();
  });

  it('uses the suite-events queue name', () => {
    expect(SUITE_EVENTS_QUEUE).toBe('suite-events');
  });
});
