import { AccountLevel, AccountType } from '../../accounting/enums/accounting.enum';
import { sumMinor } from '../../accounting/money';
import { PostingRulesService } from '../../posting_rules/services/posting-rules.service';
import { TREASURY_ACCOUNTS as A } from '../constants/treasury.constants';
import { TreasuryDocKind } from '../enums/treasury.enum';
import { AdvanceAllocationInput, DocumentPostingInput } from './treasury-lines';
import { PostingContext } from './treasury-posting.port';
import { TreasuryPostingRulesAdapter } from './treasury-posting-rules.adapter';

const T = '11111111-1111-4111-8111-111111111111';
const manager = {} as never;

const account = (code: string, accountType: AccountType) => ({ code, name: `n${code}`, accountType, level: AccountLevel.MOEIN });

/** Real engine, fake repository and accounting: the adapter is exercised end to end. */
function setup() {
  const accounts = [
    account(A.CASH, AccountType.ASSET),
    account(A.BANK, AccountType.ASSET),
    account(A.RECEIVABLES, AccountType.ASSET),
    account(A.PAYABLES, AccountType.LIABILITY),
    account(A.CUSTOMER_ADVANCES, AccountType.LIABILITY),
    account(A.SUPPLIER_ADVANCES, AccountType.ASSET),
  ];
  const repo = {
    runInTransaction: jest.fn(async (_t: string, work: (m: unknown) => unknown) => work({})),
    listMappings: jest.fn(async () => []),
    findSource: jest.fn(async () => null),
    claimSource: jest.fn(async () => true),
    attachEntry: jest.fn(async () => undefined),
  };
  let nextId = 500;
  const accounting = {
    listAccounts: jest.fn(async () => accounts),
    createJournalEntry: jest.fn(
      async (_t: string, dto: { entryNumber: string; date: string; description: string; lines: Array<{ accountCode: string; debit: string; credit: string; partyCode?: string }> }) => ({
        id: nextId++,
        entryNumber: dto.entryNumber,
      }),
    ),
  };
  const postingRules = new PostingRulesService(repo as never, accounting as never);
  const adapter = new TreasuryPostingRulesAdapter(postingRules);
  return { adapter, accounting };
}

const context: PostingContext = { docNumber: 'RC-000001', date: '2026-11-04', description: 'دریافت از مشتری' };

const doc = (over: Partial<DocumentPostingInput> = {}): DocumentPostingInput => ({
  kind: TreasuryDocKind.RECEIPT,
  partyCode: 'C1',
  funds: [{ accountCode: A.CASH, amount: 1000n }],
  chequeTotal: 0n,
  applied: 1000n,
  writeoff: 0n,
  advance: 0n,
  ...over,
});

const allocation = (over: Partial<AdvanceAllocationInput> = {}): AdvanceAllocationInput => ({
  kind: TreasuryDocKind.RECEIPT,
  partyCode: 'C1',
  applied: 700n,
  writeoff: 0n,
  ...over,
});

describe('TreasuryPostingRulesAdapter', () => {
  it('posts a fully applied receipt as bank.receipt and returns the entry id', async () => {
    const { adapter, accounting } = setup();
    const id = await adapter.postDocument(T, context, doc(), manager);

    expect(id).toBe(500);
    expect(accounting.createJournalEntry).toHaveBeenCalledTimes(1);
    const dto = accounting.createJournalEntry.mock.calls[0][1];
    expect(dto.entryNumber).toMatch(/^TRS-RC-000001-doc-/);
    expect(dto.date).toBe('2026-11-04T00:00:00.000Z');
    expect(dto.description).toBe('دریافت از مشتری');
    expect(dto.lines).toEqual([
      expect.objectContaining({ accountCode: A.CASH, debit: '10.00', credit: '0.00' }),
      expect.objectContaining({ accountCode: A.RECEIVABLES, debit: '0.00', credit: '10.00', partyCode: 'C1' }),
    ]);
  });

  it('posts a payment as bank.payment with the payable on the debit side', async () => {
    const { adapter, accounting } = setup();
    await adapter.postDocument(T, context, doc({ kind: TreasuryDocKind.PAYMENT }), manager);

    const dto = accounting.createJournalEntry.mock.calls[0][1];
    expect(dto.lines).toEqual([
      expect.objectContaining({ accountCode: A.PAYABLES, debit: '10.00', credit: '0.00', partyCode: 'C1' }),
      expect.objectContaining({ accountCode: A.CASH, debit: '0.00', credit: '10.00' }),
    ]);
  });

  it('always posts a balanced voucher: debits equal credits', async () => {
    const { adapter, accounting } = setup();
    await adapter.postDocument(T, context, doc(), manager);

    const dto = accounting.createJournalEntry.mock.calls[0][1];
    const debit = sumMinor(dto.lines.map((l) => l.debit));
    const credit = sumMinor(dto.lines.map((l) => l.credit));
    expect(debit).toBe(credit);
    expect(debit).toBe(1000n);
  });

  it('credits customer advances when the receipt is left entirely as an advance', async () => {
    const { adapter, accounting } = setup();
    await adapter.postDocument(T, context, doc({ applied: 0n, advance: 1000n }), manager);

    const dto = accounting.createJournalEntry.mock.calls[0][1];
    expect(dto.lines).toEqual([
      expect.objectContaining({ accountCode: A.CASH, debit: '10.00' }),
      expect.objectContaining({ accountCode: A.CUSTOMER_ADVANCES, credit: '10.00', partyCode: 'C1' }),
    ]);
  });

  it('refuses a document with nothing to post and writes nothing', async () => {
    const { adapter, accounting } = setup();
    await expect(adapter.postDocument(T, context, doc({ funds: [], applied: 0n, advance: 0n }), manager)).rejects.toThrow(/مبلغی برای ثبت ندارد/);
    expect(accounting.createJournalEntry).not.toHaveBeenCalled();
  });

  it('refuses a negative amount through the engine and writes nothing', async () => {
    const { adapter, accounting } = setup();
    await expect(adapter.postDocument(T, context, doc({ funds: [{ accountCode: A.CASH, amount: -100n }] }), manager)).rejects.toThrow(/منفی/);
    expect(accounting.createJournalEntry).not.toHaveBeenCalled();
  });

  it('refuses a document that both allocates and leaves an advance', async () => {
    const { adapter, accounting } = setup();
    await expect(adapter.postDocument(T, context, doc({ applied: 600n, advance: 400n }), manager)).rejects.toThrow(/پشتیبانی نمی‌شود/);
    expect(accounting.createJournalEntry).not.toHaveBeenCalled();
  });

  it('refuses a cheque, a write-off and multiple fund accounts', async () => {
    const { adapter, accounting } = setup();
    await expect(adapter.postDocument(T, context, doc({ chequeTotal: 500n }), manager)).rejects.toThrow(/چک/);
    await expect(adapter.postDocument(T, context, doc({ writeoff: 5n }), manager)).rejects.toThrow(/تخفیف/);
    await expect(
      adapter.postDocument(
        T,
        context,
        doc({ funds: [{ accountCode: A.CASH, amount: 500n }, { accountCode: A.BANK, amount: 500n }] }),
        manager,
      ),
    ).rejects.toThrow(/چند حساب/);
    expect(accounting.createJournalEntry).not.toHaveBeenCalled();
  });

  it('posts an advance allocation as the advance against the receivable', async () => {
    const { adapter, accounting } = setup();
    await adapter.postAdvanceAllocation(T, context, allocation(), manager);

    const dto = accounting.createJournalEntry.mock.calls[0][1];
    expect(dto.entryNumber).toMatch(/^TRS-RC-000001-adv-/);
    expect(dto.lines).toEqual([
      expect.objectContaining({ accountCode: A.CUSTOMER_ADVANCES, debit: '7.00' }),
      expect.objectContaining({ accountCode: A.RECEIVABLES, credit: '7.00', partyCode: 'C1' }),
    ]);
  });

  it('posts a payment advance allocation as the payable against supplier advances', async () => {
    const { adapter, accounting } = setup();
    await adapter.postAdvanceAllocation(T, context, allocation({ kind: TreasuryDocKind.PAYMENT, partyCode: 'S1' }), manager);

    const dto = accounting.createJournalEntry.mock.calls[0][1];
    expect(dto.lines).toEqual([
      expect.objectContaining({ accountCode: A.PAYABLES, debit: '7.00', partyCode: 'S1' }),
      expect.objectContaining({ accountCode: A.SUPPLIER_ADVANCES, credit: '7.00' }),
    ]);
  });

  it('refuses a write-off on an advance allocation', async () => {
    const { adapter, accounting } = setup();
    await expect(adapter.postAdvanceAllocation(T, context, allocation({ writeoff: 5n }), manager)).rejects.toThrow(/تخفیف/);
    expect(accounting.createJournalEntry).not.toHaveBeenCalled();
  });

  it('implements the treasury posting port surface', () => {
    const { adapter } = setup();
    expect(typeof adapter.postDocument).toBe('function');
    expect(typeof adapter.postAdvanceAllocation).toBe('function');
  });
});
