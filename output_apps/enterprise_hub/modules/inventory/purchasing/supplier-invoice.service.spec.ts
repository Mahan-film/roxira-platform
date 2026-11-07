import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AccessService } from '../../access/services/access.service';
import { AuditEntry, AuditService } from '../../access/services/audit.service';
import { TenantScope } from '../../access/services/tenant-scope';
import { PostingRequest, PostingRulesService } from '../../posting_rules/services/posting-rules.service';
import { policyDefault } from '../../tenants/policy/policy.registry';
import { PolicyService } from '../../tenants/policy/policy.service';
import { StockDocumentsService } from '../services/stock-documents.service';
import { PurchaseRepository, ReceiptLineForInvoice } from './purchase.repository';
import { DEFAULT_PURCHASE_SETTINGS, PurchaseOrder, PurchaseOrderStatus, PurchaseSettings } from './purchase.types';
import {
  NewSupplierInvoice,
  NewSupplierInvoiceLine,
  SupplierInvoice,
  SupplierInvoiceRepository,
} from './supplier-invoice.repository';
import { SupplierInvoiceService } from './supplier-invoice.service';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const FIXED = new Date('2026-11-05T08:00:00Z');

interface FakeState {
  orders: PurchaseOrder[];
  receiptLines: ReceiptLineForInvoice[];
  invoices: SupplierInvoice[];
  settings: Map<string, PurchaseSettings>;
  counters: Map<string, number>;
  journals: PostingRequest[];
}

function freshState(): FakeState {
  return {
    orders: [],
    receiptLines: [],
    invoices: [],
    settings: new Map<string, PurchaseSettings>(),
    counters: new Map<string, number>(),
    journals: [],
  };
}

function nextId(state: FakeState, kind: string): string {
  const key = `id:${kind}`;
  const value = (state.counters.get(key) ?? 0) + 1;
  state.counters.set(key, value);
  return `${kind}-${value}`;
}

class FakeTenantScope {
  constructor(private readonly state: FakeState) {}

  async run<T>(_tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    const snapshot = structuredClone(this.state);
    try {
      return await work({} as EntityManager);
    } catch (error) {
      Object.assign(this.state, snapshot);
      throw error;
    }
  }
}

class FakePurchaseRepository {
  constructor(private readonly state: FakeState) {}

  async getSettings(tenantId: string): Promise<PurchaseSettings> {
    return { ...(this.state.settings.get(tenantId) ?? DEFAULT_PURCHASE_SETTINGS) };
  }

  async nextNumber(tenantId: string, prefix: 'PR' | 'PO' | 'GR' | 'SI'): Promise<string> {
    const key = `number:${tenantId}:${prefix}`;
    const n = (this.state.counters.get(key) ?? 0) + 1;
    this.state.counters.set(key, n);
    return `${prefix}-${String(n).padStart(6, '0')}`;
  }

  async findOrder(tenantId: string, id: string): Promise<PurchaseOrder | null> {
    const found = this.state.orders.find((order) => order.tenantId === tenantId && order.id === id);
    return found ? structuredClone(found) : null;
  }

  async findReceiptLineForInvoice(
    tenantId: string,
    receiptLineId: string,
  ): Promise<ReceiptLineForInvoice | null> {
    const orderIds = new Set(
      this.state.orders.filter((order) => order.tenantId === tenantId).map((order) => order.id),
    );
    const found = this.state.receiptLines.find(
      (line) => line.receiptLineId === receiptLineId && orderIds.has(line.orderId),
    );
    return found ? { ...found } : null;
  }
}

class FakeSupplierInvoiceRepository {
  constructor(private readonly state: FakeState) {}

  async findIdBySupplierRef(
    tenantId: string,
    supplierCode: string,
    supplierRef: string,
  ): Promise<string | null> {
    const found = this.state.invoices.find(
      (invoice) =>
        invoice.tenantId === tenantId &&
        invoice.supplierCode === supplierCode &&
        invoice.supplierRef === supplierRef,
    );
    return found ? found.id : null;
  }

  async sumInvoicedQuantity(tenantId: string, receiptLineId: string): Promise<bigint> {
    return this.state.invoices
      .filter((invoice) => invoice.tenantId === tenantId)
      .flatMap((invoice) => invoice.lines)
      .filter((line) => line.receiptLineId === receiptLineId)
      .reduce((sum, line) => sum + line.quantity, 0n);
  }

  async insertInvoice(
    tenantId: string,
    input: NewSupplierInvoice,
    lines: readonly NewSupplierInvoiceLine[],
  ): Promise<SupplierInvoice> {
    const duplicate = this.state.invoices.some(
      (invoice) =>
        invoice.tenantId === tenantId &&
        invoice.supplierCode === input.supplierCode &&
        invoice.supplierRef === input.supplierRef,
    );
    if (duplicate) throw Object.assign(new Error('duplicate'), { code: '23505' });

    const invoice: SupplierInvoice = {
      id: nextId(this.state, 'invoice'),
      tenantId,
      number: input.number,
      orderId: input.orderId,
      supplierCode: input.supplierCode,
      supplierRef: input.supplierRef,
      invoiceDate: input.invoiceDate,
      status: input.status,
      accepted: false,
      acceptedBy: null,
      acceptedAt: null,
      acceptNote: null,
      createdBy: input.createdBy,
      vat: input.vat,
      subtotal: input.subtotal,
      total: input.total,
      journalEntryId: null,
      createdAt: FIXED,
      lines: lines.map((line) => ({ ...line, id: nextId(this.state, 'invoice-line') })),
    };
    this.state.invoices.push(invoice);
    return structuredClone(invoice);
  }

  async findInvoice(tenantId: string, id: string): Promise<SupplierInvoice | null> {
    const found = this.state.invoices.find(
      (invoice) => invoice.tenantId === tenantId && invoice.id === id,
    );
    return found ? structuredClone(found) : null;
  }

  async listInvoices(tenantId: string): Promise<SupplierInvoice[]> {
    return structuredClone(
      this.state.invoices.filter((invoice) => invoice.tenantId === tenantId),
    );
  }

  async acceptInvoice(
    tenantId: string,
    id: string,
    acceptedBy: string,
    acceptedAt: Date,
    note: string,
  ): Promise<void> {
    const invoice = this.state.invoices.find(
      (row) => row.tenantId === tenantId && row.id === id,
    );
    if (!invoice) return;
    invoice.accepted = true;
    invoice.acceptedBy = acceptedBy;
    invoice.acceptedAt = acceptedAt;
    invoice.acceptNote = note;
    invoice.status = 'MATCHED';
  }

  async markPosted(tenantId: string, id: string, journalEntryId: string): Promise<void> {
    const invoice = this.state.invoices.find(
      (row) => row.tenantId === tenantId && row.id === id,
    );
    if (!invoice) return;
    invoice.status = 'POSTED';
    invoice.journalEntryId = journalEntryId;
  }
}

class FakeStockDocuments {
  async resolveAccounts(): Promise<string[]> {
    return ['2013', '5120', '2101', '1401'];
  }
}

class FakePostingRules {
  constructor(private readonly state: FakeState) {}

  async describe(): Promise<never[]> {
    return [];
  }

  /** Like the engine: one voucher per (sourceType, sourceId, docType); a replay returns the first. */
  async post(
    _tenantId: string,
    request: PostingRequest,
  ): Promise<{ entryId: number; entryNumber: string; replayed: boolean }> {
    const index = this.state.journals.findIndex(
      (journal) =>
        journal.sourceType === request.sourceType &&
        journal.sourceId === request.sourceId &&
        journal.docType === request.docType,
    );
    if (index >= 0) {
      return {
        entryId: index + 1,
        entryNumber: this.state.journals[index].entryNumber ?? '',
        replayed: true,
      };
    }
    this.state.journals.push(request);
    return {
      entryId: this.state.journals.length,
      entryNumber: request.entryNumber ?? '',
      replayed: false,
    };
  }
}

class FakePolicy {
  private readonly overrides = new Map<string, unknown>();

  set(key: string, value: unknown): void {
    this.overrides.set(key, value);
  }

  async get(_tenantId: string, key: string): Promise<unknown> {
    return this.overrides.has(key) ? this.overrides.get(key) : policyDefault(key);
  }
}

class FakeAudit {
  readonly entries: AuditEntry[] = [];

  async record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
}

class FakeAccess {
  otherApprovers = 0;
  readonly calls: string[] = [];

  async countEligibleApprovers(_tenantId: string, _userId: string, permission: string): Promise<number> {
    this.calls.push(permission);
    return this.otherApprovers;
  }
}

function makeService(state: FakeState) {
  const policy = new FakePolicy();
  const audit = new FakeAudit();
  const access = new FakeAccess();
  const service = new SupplierInvoiceService(
    new FakeTenantScope(state) as unknown as TenantScope,
    new FakePurchaseRepository(state) as unknown as PurchaseRepository,
    new FakeSupplierInvoiceRepository(state) as unknown as SupplierInvoiceRepository,
    new FakeStockDocuments() as unknown as StockDocumentsService,
    new FakePostingRules(state) as unknown as PostingRulesService,
    policy as unknown as PolicyService,
    audit as unknown as AuditService,
    access as unknown as AccessService,
  );
  return { service, policy, audit, access };
}

function seedOrder(
  state: FakeState,
  tenantId: string,
  orderId: string,
  orderLineId: string,
  receiptLineId: string,
): void {
  state.orders.push({
    id: orderId,
    tenantId,
    number: `PO-${orderId}`,
    supplierCode: 'SUP',
    status: PurchaseOrderStatus.RECEIVED,
    warehouseId: null,
    lines: [
      {
        id: orderLineId,
        sku: 'A',
        quantity: 1000n,
        unitPrice: 5_000_000n,
        receivedQuantity: 1000n,
      },
    ],
    requestId: null,
    orderDate: '2026-11-05',
    approvedBy: 'u1',
    approvedAt: FIXED,
    createdAt: FIXED,
  });
  state.receiptLines.push({
    receiptLineId,
    receiptId: `receipt-${orderId}`,
    orderId,
    sku: 'A',
    receivedQuantity: 1000n,
    orderUnitPrice: 5_000_000n,
  });
}

describe('SupplierInvoiceService (#227 T2)', () => {
  let state: FakeState;
  let service: SupplierInvoiceService;
  let policy: FakePolicy;
  let audit: FakeAudit;
  let access: FakeAccess;

  beforeEach(() => {
    state = freshState();
    ({ service, policy, audit, access } = makeService(state));
    seedOrder(state, T1, 'order-1', 'order-line-1', 'receipt-line-1');
  });

  const createFirst = (supplierRef = 'INV-1') =>
    service.createInvoice(T1, 'creator', 'order-1', {
      supplierRef,
      invoiceDate: '2026-11-05',
      vat: '4590000',
      lines: [{ receiptLineId: 'receipt-line-1', quantity: '1000', unitPrice: '5100000' }],
    });

  it('holds a price mismatch, refuses posting and lets another user accept it', async () => {
    const invoice = await createFirst();
    expect(invoice.status).toBe('HELD');
    expect(invoice.lines).toHaveLength(1);
    expect(invoice.lines[0]).toMatchObject({
      matchStatus: 'PRICE_MISMATCH',
      priceDifference: '1000000',
      orderValue: '50000000',
      invoiceValue: '51000000',
    });

    await expect(service.postInvoice(T1, invoice.id)).rejects.toBeInstanceOf(ConflictException);
    expect(state.journals).toHaveLength(0);

    await expect(
      service.acceptInvoice(T1, 'creator', invoice.id, { note: 'same user' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const accepted = await service.acceptInvoice(T1, 'reviewer', invoice.id, {
      note: 'difference approved',
    });
    expect(accepted.status).toBe('MATCHED');
    expect(accepted.accepted).toBe(true);
    expect(accepted.acceptedBy).toBe('reviewer');
    expect(accepted.acceptNote).toBe('difference approved');

    const posted = await service.postInvoice(T1, invoice.id);
    expect(posted.status).toBe('POSTED');
    expect(state.journals).toHaveLength(1);
    expect(state.journals[0]).toMatchObject({
      docType: 'purchase.invoice',
      sourceType: 'supplier_invoice',
      sourceId: invoice.id,
      entryNumber: `PINV-${invoice.number}`,
      partyCode: 'SUP',
      amounts: {
        grni: 50_000_000n,
        variance_debit: 1_000_000n,
        variance_credit: 0n,
        vat: 4_590_000n,
        payable: 55_590_000n,
      },
    });
    expect(state.journals[0].overrides).toMatchObject({
      grni: '2013',
      price_variance: '5120',
      payable: '2101',
      vat_input: '1401',
    });

    const again = await service.postInvoice(T1, invoice.id);
    expect(again.journalEntryId).toBe(posted.journalEntryId);
    expect(state.journals).toHaveLength(1);
  });

  it('holds a second invoice that exceeds the quantity already received', async () => {
    await createFirst();
    const second = await service.createInvoice(T1, 'creator', 'order-1', {
      supplierRef: 'INV-2',
      invoiceDate: '2026-11-05',
      lines: [{ receiptLineId: 'receipt-line-1', quantity: '100', unitPrice: '5000000' }],
    });
    expect(second.status).toBe('HELD');
    expect(second.lines[0].matchStatus).toBe('QTY_MISMATCH');
  });

  it('accepts a price difference inside the absolute tolerance and posts without review', async () => {
    state.settings.set(T1, {
      ...DEFAULT_PURCHASE_SETTINGS,
      priceToleranceAbs: 1_000_000n,
    });
    seedOrder(state, T1, 'order-2', 'order-line-2', 'receipt-line-2');

    const invoice = await service.createInvoice(T1, 'creator', 'order-2', {
      supplierRef: 'INV-TOL',
      invoiceDate: '2026-11-05',
      lines: [{ receiptLineId: 'receipt-line-2', quantity: '1000', unitPrice: '5100000' }],
    });
    expect(invoice.status).toBe('MATCHED');
    expect(invoice.accepted).toBe(false);

    const posted = await service.postInvoice(T1, invoice.id);
    expect(posted.status).toBe('POSTED');
    expect(state.journals).toHaveLength(1);
    expect(state.journals[0].amounts).toMatchObject({
      grni: 50_000_000n,
      variance_debit: 1_000_000n,
      variance_credit: 0n,
      payable: 51_000_000n,
    });
  });

  it('rejects a duplicate supplier reference and hides the invoice from another tenant', async () => {
    const invoice = await createFirst();
    await expect(createFirst()).rejects.toBeInstanceOf(ConflictException);
    await expect(service.getInvoice(T2, invoice.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  // ------------------------------------------------- reviewer rule (#585)

  const creatorAccept = (id: string, note = 'self approval') =>
    service.acceptInvoice(T1, 'creator', id, { note });

  it('lets another user accept under every reviewer rule, with no creator audit', async () => {
    for (const rule of ['always_differs', 'differs_unless_sole_approver', 'creator_may_accept']) {
      policy.set('purchase.invoice_review.reviewer_rule', rule);
      const invoice = await createFirst(`INV-${rule}`);
      const accepted = await service.acceptInvoice(T1, 'reviewer', invoice.id, { note: 'reviewer ok' });
      expect(accepted.status).toBe('MATCHED');
      expect(accepted.acceptedByCreator).toBe(false);
      expect(audit.entries).toHaveLength(0);
    }
  });

  it('refuses the creator under always_differs', async () => {
    policy.set('purchase.invoice_review.reviewer_rule', 'always_differs');
    const invoice = await createFirst('INV-DIFF');
    await expect(creatorAccept(invoice.id)).rejects.toBeInstanceOf(ForbiddenException);
    expect(audit.entries).toHaveLength(0);
  });

  it('lets the creator accept under creator_may_accept and audits the other-approver count', async () => {
    policy.set('purchase.invoice_review.reviewer_rule', 'creator_may_accept');
    access.otherApprovers = 2;
    const invoice = await createFirst('INV-MAY');
    const accepted = await creatorAccept(invoice.id);
    expect(accepted.acceptedByCreator).toBe(true);
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]).toMatchObject({
      action: 'purchase.invoice.accepted_by_creator',
      resourceType: 'supplier_invoice',
      resourceId: invoice.id,
    });
    expect(audit.entries[0].metadata).toMatchObject({ rule: 'creator_may_accept', otherApprovers: 2 });
  });

  it('differs_unless_sole_approver lets the creator accept only when no other approver exists', async () => {
    policy.set('purchase.invoice_review.reviewer_rule', 'differs_unless_sole_approver');

    access.otherApprovers = 0;
    const sole = await createFirst('INV-SOLE');
    const accepted = await creatorAccept(sole.id);
    expect(accepted.acceptedByCreator).toBe(true);
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0].metadata).toMatchObject({ rule: 'differs_unless_sole_approver', otherApprovers: 0 });

    access.otherApprovers = 1;
    const shared = await createFirst('INV-SHARED');
    await expect(creatorAccept(shared.id)).rejects.toBeInstanceOf(ForbiddenException);
    expect(audit.entries).toHaveLength(1); // still only the sole-approver audit
  });
});