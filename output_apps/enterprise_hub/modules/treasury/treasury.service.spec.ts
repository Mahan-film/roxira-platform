import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { InvoiceDirection } from '../invoicing/enums/invoice-kind.enum';
import { InvoiceStatus } from '../invoicing/enums/invoice-status.enum';
import { TreasuryDocKind, TreasuryMethod, TreasuryPartyType } from './enums/treasury.enum';
import { TreasuryService } from './services/treasury.service';

const T = '11111111-1111-4111-8111-111111111111';
const INV_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INV_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

interface Invoice { direction: InvoiceDirection; status: InvoiceStatus; finalPayable: number; taxInvoiceNumber: string }

function build(invoices: Record<string, Invoice>, allocated: Record<string, string> = {}, tolerance = '0.00') {
  const manager = {};
  const created: any[] = [];
  const repository: any = {
    runInTransaction: jest.fn(async (_t: string, fn: (m: unknown) => Promise<unknown>) => fn(manager)),
    getTolerance: jest.fn(async () => tolerance),
    lockTargets: jest.fn(async () => undefined),
    allocatedByTarget: jest.fn(async () => new Map(Object.entries(allocated))),
    nextNumber: jest.fn(async () => 7),
    createDocument: jest.fn(async (_t: string, input: any) => { const d = { id: 1, status: 'posted', journalEntryId: null, ...input }; created.push(d); return d; }),
    addLines: jest.fn(async () => undefined),
    addAllocations: jest.fn(async () => undefined),
    updateDocument: jest.fn(async () => undefined),
    findDocument: jest.fn(async () => ({ id: 1, kind: 'receipt', status: 'posted', docNumber: 'RC-000007', partyName: 'x', partyCode: 'C1', partyType: 'customer', docDate: '2026-11-04', total: '1000.00', writeoffTotal: '0.00', advanceRemaining: '1000.00', description: null, journalEntryId: 9 })),
    findDocumentForUpdate: jest.fn(async () => ({ id: 1, kind: 'receipt', status: 'posted', docNumber: 'RC-000007', partyName: 'x', partyCode: 'C1', advanceRemaining: '1000.00', writeoffTotal: '0.00' })),
    listLines: jest.fn(async () => []),
    listAllocationsOfDocument: jest.fn(async () => []),
  };
  const posting = { postDocument: jest.fn(async () => 9), postAdvanceAllocation: jest.fn(async () => 10) };
  const banking = { listAccounts: jest.fn(async () => [{ id: 3, ledgerAccountCode: '1012' }]) };
  const cheques = { create: jest.fn(async () => ({ id: 55 })) };
  const invoicing = { findOne: jest.fn(async (_t: string, id: string) => invoices[id]) };
  const service = new TreasuryService(repository, posting as never, banking as never, cheques as never, invoicing as never);
  return { service, repository, posting, cheques, banking, invoicing };
}

const sale = (finalPayable: number): Invoice => ({ direction: InvoiceDirection.SALE, status: InvoiceStatus.ISSUED, finalPayable, taxInvoiceNumber: `N${finalPayable}` });
const doc = (over: Record<string, unknown>) => ({
  kind: TreasuryDocKind.RECEIPT,
  partyType: TreasuryPartyType.CUSTOMER,
  partyCode: 'C1',
  partyName: 'مشتری',
  docDate: '2026-11-04',
  methods: [{ method: TreasuryMethod.CASH, amount: '1500' }],
  ...over,
}) as never;

describe('TreasuryService.createDocument', () => {
  it('one receipt against two invoices posts once and stores both allocations', async () => {
    const { service, repository, posting } = build({ [INV_A]: sale(1000), [INV_B]: sale(500) });
    await service.createDocument(T, doc({ allocations: [{ invoiceId: INV_A, amount: '1000' }, { invoiceId: INV_B, amount: '500' }] }));
    expect(posting.postDocument).toHaveBeenCalledTimes(1);
    const input = (posting.postDocument.mock.calls[0] as any)[2];
    expect(input).toMatchObject({ applied: 150000n, writeoff: 0n, advance: 0n, chequeTotal: 0n });
    const rows = repository.addAllocations.mock.calls[0][2];
    expect(rows.map((r: any) => [r.targetId, r.amount])).toEqual([[INV_A, '1000.00'], [INV_B, '500.00']]);
    expect(repository.createDocument.mock.calls[0][1]).toMatchObject({ docNumber: 'RC-000007', advanceRemaining: '0.00', total: '1500.00' });
  });

  it('a second payment sees the first payment already allocated', async () => {
    const { service } = build({ [INV_A]: sale(1000) }, { [INV_A]: '800.00' });
    await expect(
      service.createDocument(T, doc({ methods: [{ method: 'cash', amount: '500' }], allocations: [{ invoiceId: INV_A, amount: '500' }] })),
    ).rejects.toThrow('مانده صورتحساب');
  });

  it('keeps an unallocated payment as an advance', async () => {
    const { service, posting, repository } = build({});
    await service.createDocument(T, doc({}));
    expect((posting.postDocument.mock.calls[0] as any)[2]).toMatchObject({ applied: 0n, advance: 150000n });
    expect(repository.createDocument.mock.calls[0][1].advanceRemaining).toBe('1500.00');
  });

  it('writes off a small difference only under the tenant tolerance', async () => {
    const dto = doc({ methods: [{ method: 'cash', amount: '990' }], allocations: [{ invoiceId: INV_A, amount: '990', writeoff: '10' }] });
    await expect(build({ [INV_A]: sale(1000) }, {}, '0.00').service.createDocument(T, dto)).rejects.toThrow('حد مجاز');
    const ok = build({ [INV_A]: sale(1000) }, {}, '50.00');
    await ok.service.createDocument(T, dto);
    expect((ok.posting.postDocument.mock.calls[0] as any)[2]).toMatchObject({ applied: 99000n, writeoff: 1000n });
  });

  it('registers a cheque line through the cheques module and posts only the rest', async () => {
    const { service, cheques, posting, repository } = build({ [INV_A]: sale(1000) });
    await service.createDocument(
      T,
      doc({
        methods: [
          { method: 'cash', amount: '400' },
          { method: 'cheque', amount: '600', chequeNumber: '123', dueDate: '2026-12-20' },
        ],
        allocations: [{ invoiceId: INV_A, amount: '1000' }],
      }),
    );
    expect(cheques.create).toHaveBeenCalledWith(T, expect.objectContaining({ direction: 'received', partyCode: 'C1', amount: '600' }));
    const input = (posting.postDocument.mock.calls[0] as any)[2];
    expect(input.chequeTotal).toBe(60000n);
    expect(input.funds).toEqual([{ accountCode: '1011', amount: 40000n }]);
    expect(repository.addLines.mock.calls[0][2][1].chequeId).toBe(55);
  });

  it('does not register a cheque when the allocation is invalid', async () => {
    const { service, cheques } = build({ [INV_A]: sale(100) });
    await expect(
      service.createDocument(T, doc({ methods: [{ method: 'cheque', amount: '600', chequeNumber: '1', dueDate: '2026-12-20' }], allocations: [{ invoiceId: INV_A, amount: '600' }] })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(cheques.create).not.toHaveBeenCalled();
  });

  it('uses the ledger account of the chosen bank account and rejects an unknown one', async () => {
    const { service, posting } = build({});
    await service.createDocument(T, doc({ methods: [{ method: 'bank_transfer', amount: '10', bankAccountId: 3 }] }));
    expect((posting.postDocument.mock.calls[0] as any)[2].funds).toEqual([{ accountCode: '1012', amount: 1000n }]);
    await expect(service.createDocument(T, doc({ methods: [{ method: 'card', amount: '10', bankAccountId: 99 }] }))).rejects.toThrow('حساب بانکی یافت نشد');
    await expect(service.createDocument(T, doc({ methods: [{ method: 'card', amount: '10' }] }))).rejects.toThrow('حساب بانکی لازم');
  });

  it('rejects the wrong invoice direction and an invoice that is not open', async () => {
    const purchase = { ...sale(100), direction: InvoiceDirection.PURCHASE };
    await expect(build({ [INV_A]: purchase }).service.createDocument(T, doc({ allocations: [{ invoiceId: INV_A, amount: '1' }] }))).rejects.toThrow('فاکتور فروش');
    const draft = { ...sale(100), status: InvoiceStatus.DRAFT };
    await expect(build({ [INV_A]: draft }).service.createDocument(T, doc({ allocations: [{ invoiceId: INV_A, amount: '1' }] }))).rejects.toThrow('صادر نشده');
  });

  it('rejects a zero-amount method line and a cheque without number', async () => {
    const { service } = build({});
    await expect(service.createDocument(T, doc({ methods: [{ method: 'cash', amount: '0' }] }))).rejects.toThrow('بزرگ‌تر از صفر');
    await expect(service.createDocument(T, doc({ methods: [{ method: 'cheque', amount: '5' }] }))).rejects.toThrow('شماره چک');
  });
});

describe('TreasuryService.allocateAdvance', () => {
  it('moves the advance onto an invoice, posts one entry and lowers the remainder', async () => {
    const { service, repository, posting } = build({ [INV_A]: sale(600) });
    await service.allocateAdvance(T, 1, { allocations: [{ invoiceId: INV_A, amount: '600' }], date: '2026-11-05' });
    expect((posting.postAdvanceAllocation.mock.calls[0] as any)[2]).toMatchObject({ applied: 60000n, writeoff: 0n });
    expect(repository.updateDocument.mock.calls[0][2]).toEqual({ advanceRemaining: '400.00', writeoffTotal: '0.00' });
    expect(repository.addAllocations.mock.calls[0][2][0]).toMatchObject({ journalEntryId: 10, allocatedDate: '2026-11-05' });
  });

  it('cannot allocate more than the remaining advance', async () => {
    const { service } = build({ [INV_A]: sale(5000) });
    await expect(service.allocateAdvance(T, 1, { allocations: [{ invoiceId: INV_A, amount: '1500' }] })).rejects.toThrow('از مبلغ سند');
  });
});
