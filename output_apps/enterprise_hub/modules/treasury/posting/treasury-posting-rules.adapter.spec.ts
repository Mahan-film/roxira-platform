import { ConflictException } from '@nestjs/common';
import { AccountLevel, AccountType } from '../../accounting/enums/accounting.enum';
import { sumMinor } from '../../accounting/money';
import { PostingRulesService } from '../../posting_rules/services/posting-rules.service';
import { TREASURY_ACCOUNTS as A, TREASURY_ACCOUNT_DEFINITIONS } from '../constants/treasury.constants';
import { TreasuryDocKind } from '../enums/treasury.enum';
import { TreasuryLedgerPostingAdapter } from './treasury-ledger-posting.adapter';
import { AdvanceAllocationInput, DocumentPostingInput } from './treasury-lines';
import { PostingContext } from './treasury-posting.port';
import { TreasuryPostingRulesAdapter } from './treasury-posting-rules.adapter';

const T = '11111111-1111-4111-8111-111111111111';
const manager = {} as never;

const account = (code: string, accountType: AccountType) => ({ code, name: `n${code}`, accountType, level: AccountLevel.MOEIN });

type MappingRow = { docType: string; role: string; accountCode: string };

/** Real engine, stateful fake repository and accounting: exercises end-to-end posting, provisioning, and replay. */
function setup(options: { missingTreasuryAccounts?: boolean; mappings?: MappingRow[] } = {}) {
  const accounts = [
    account(A.BANK, AccountType.ASSET),
    account(A.RECEIVABLES, AccountType.ASSET),
    account(A.PAYABLES, AccountType.LIABILITY),
    account('1029', AccountType.ASSET),
    account('2079', AccountType.LIABILITY),
    account('4039', AccountType.REVENUE),
    ...(options.missingTreasuryAccounts
      ? []
      : [
          account(A.CASH, AccountType.ASSET),
          account(A.CUSTOMER_ADVANCES, AccountType.LIABILITY),
          account(A.SUPPLIER_ADVANCES, AccountType.ASSET),
          account(A.WRITEOFF_RECEIPT, AccountType.REVENUE),
          account(A.WRITEOFF_PAYMENT, AccountType.REVENUE),
        ]),
  ];

  const sources = new Map<string, { entryId: number | null; entryNumber: string | null }>();
  const mappings: MappingRow[] = options.mappings ?? [];
  const repo = {
    runInTransaction: jest.fn(async (_t: string, work: (m: unknown) => unknown) => work({})),
    listMappings: jest.fn(async (_t: string, docTypes: string[]) => mappings.filter((m) => docTypes.includes(m.docType))),
    findSource: jest.fn(async (_t: string, st: string, sid: string, dt: string) => sources.get(`${st}:${sid}:${dt}`) ?? null),
    claimSource: jest.fn(async (_t: string, st: string, sid: string, dt: string) => {
      const key = `${st}:${sid}:${dt}`;
      if (sources.has(key)) return false;
      sources.set(key, { entryId: null, entryNumber: null });
      return true;
    }),
    attachEntry: jest.fn(async (_t: string, st: string, sid: string, dt: string, entryId: number, entryNumber: string) => {
      sources.set(`${st}:${sid}:${dt}`, { entryId, entryNumber });
    }),
  };

  let nextId = 500;
  const accounting = {
    listAccounts: jest.fn(async () => accounts),
    createAccount: jest.fn(async (_t: string, dto: { code: string; name: string; accountType: AccountType }) => {
      if (accounts.some((a) => a.code === dto.code)) throw new ConflictException('duplicate');
      accounts.push(account(dto.code, dto.accountType));
      return accounts[accounts.length - 1];
    }),
    createJournalEntry: jest.fn(
      async (
        _t: string,
        dto: {
          entryNumber: string;
          date: string;
          description: string;
          lines: Array<{ accountCode: string; debit: string; credit: string; description?: string; partyCode?: string }>;
        },
      ) => ({
        id: nextId++,
        entryNumber: dto.entryNumber,
      }),
    ),
  };

  const tenantScope = {
    within: jest.fn(async (_t: string, _m: unknown, work: (m: unknown) => unknown) => work(manager)),
  };
  const postingRules = new PostingRulesService(repo as never, accounting as never);
  const adapter = new TreasuryPostingRulesAdapter(postingRules, accounting as never, tenantScope as never);
  return { adapter, accounting, accounts, tenantScope };
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
  it('posts a fully applied receipt as bank.receipt and omits line descriptions so voucher description shows', async () => {
    const { adapter, accounting } = setup();
    const id = await adapter.postDocument(T, context, doc(), manager);

    expect(id).toBe(500);
    expect(accounting.createJournalEntry).toHaveBeenCalledTimes(1);
    const dto = accounting.createJournalEntry.mock.calls[0][1];
    expect(dto.entryNumber).toBe('TRS-RC-000001-doc');
    expect(dto.date).toBe('2026-11-04T00:00:00.000Z');
    expect(dto.description).toBe('دریافت از مشتری');
    expect(dto.lines).toEqual([
      { accountCode: A.CASH, debit: '10.00', credit: '0.00' },
      { accountCode: A.RECEIVABLES, debit: '0.00', credit: '10.00', partyCode: 'C1' },
    ]);
  });

  it('posts a payment as bank.payment with the payable on the debit side', async () => {
    const { adapter, accounting } = setup();
    await adapter.postDocument(T, context, doc({ kind: TreasuryDocKind.PAYMENT }), manager);

    const dto = accounting.createJournalEntry.mock.calls[0][1];
    expect(dto.lines).toEqual([
      { accountCode: A.CASH, debit: '0.00', credit: '10.00' },
      { accountCode: A.PAYABLES, debit: '10.00', credit: '0.00', partyCode: 'C1' },
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
      { accountCode: A.CASH, debit: '10.00', credit: '0.00' },
      { accountCode: A.CUSTOMER_ADVANCES, debit: '0.00', credit: '10.00', partyCode: 'C1' },
    ]);
  });

  it('posts mixed fund accounts, cheque lines, write-offs, and applied + advance together', async () => {
    const { adapter, accounting } = setup();
    await adapter.postDocument(
      T,
      context,
      doc({
        funds: [
          { accountCode: A.CASH, amount: 500n },
          { accountCode: A.BANK, amount: 700n },
        ],
        chequeTotal: 300n,
        applied: 1050n,
        writeoff: 50n,
        advance: 450n,
      }),
      manager,
    );

    const dto = accounting.createJournalEntry.mock.calls[0][1];
    expect(dto.lines).toEqual([
      { accountCode: A.CASH, debit: '5.00', credit: '0.00' },
      { accountCode: A.BANK, debit: '7.00', credit: '0.00' },
      { accountCode: A.WRITEOFF_RECEIPT, debit: '0.50', credit: '0.00' },
      { accountCode: A.RECEIVABLES, debit: '0.00', credit: '8.00', partyCode: 'C1' },
      { accountCode: A.CUSTOMER_ADVANCES, debit: '0.00', credit: '4.50', partyCode: 'C1' },
    ]);
  });

  it('flips the party line side when chequeTotal exceeds applied + writeoff', async () => {
    const { adapter, accounting } = setup();
    await adapter.postDocument(
      T,
      context,
      doc({ funds: [{ accountCode: A.CASH, amount: 100n }], chequeTotal: 500n, applied: 200n, writeoff: 0n, advance: 400n }),
      manager,
    );

    const dto = accounting.createJournalEntry.mock.calls[0][1];
    expect(dto.lines).toEqual([
      { accountCode: A.CASH, debit: '1.00', credit: '0.00' },
      { accountCode: A.RECEIVABLES, debit: '3.00', credit: '0.00', partyCode: 'C1' },
      { accountCode: A.CUSTOMER_ADVANCES, debit: '0.00', credit: '4.00', partyCode: 'C1' },
    ]);
  });

  it('lets tenant role mappings win over defaults for party, advance, and write-off roles', async () => {
    const { adapter, accounting } = setup({
      mappings: [
        { docType: 'bank.receipt', role: 'receivable', accountCode: '1029' },
        { docType: '*', role: 'customer_advances', accountCode: '2079' },
        { docType: 'bank.receipt', role: 'writeoff_receipt', accountCode: '4039' },
      ],
    });
    await adapter.postDocument(
      T,
      context,
      doc({ funds: [{ accountCode: A.CASH, amount: 900n }], applied: 600n, writeoff: 100n, advance: 300n }),
      manager,
    );

    const dto = accounting.createJournalEntry.mock.calls[0][1];
    expect(dto.lines).toEqual([
      { accountCode: A.CASH, debit: '9.00', credit: '0.00' },
      { accountCode: '4039', debit: '1.00', credit: '0.00' },
      { accountCode: '1029', debit: '0.00', credit: '7.00', partyCode: 'C1' },
      { accountCode: '2079', debit: '0.00', credit: '3.00', partyCode: 'C1' },
    ]);
  });

  it('creates missing treasury accounts before posting', async () => {
    const { adapter, accounting } = setup({ missingTreasuryAccounts: true });
    await adapter.postDocument(
      T,
      context,
      doc({ kind: TreasuryDocKind.PAYMENT, applied: 800n, writeoff: 50n, advance: 200n, funds: [{ accountCode: A.CASH, amount: 1000n }] }),
      manager,
    );

    expect(accounting.createAccount).toHaveBeenCalledTimes(TREASURY_ACCOUNT_DEFINITIONS.length);
    expect(accounting.createJournalEntry).toHaveBeenCalledTimes(1);
  });

  it('uses deterministic sourceId including kind so receipt and payment with the same docNumber do not collide', async () => {
    const { adapter, accounting, tenantScope } = setup();
    const firstId = await adapter.postDocument(T, context, doc(), manager);
    const replayId = await adapter.postDocument(T, context, doc(), manager);
    const paymentId = await adapter.postDocument(T, context, doc({ kind: TreasuryDocKind.PAYMENT }), manager);

    expect(firstId).toBe(500);
    expect(replayId).toBe(500);
    expect(paymentId).toBe(501);
    expect(accounting.createJournalEntry).toHaveBeenCalledTimes(2);
    expect(tenantScope.within).toHaveBeenCalledWith(T, manager, expect.any(Function));
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

  it('posts an advance allocation with write-off as advance + write-off against party', async () => {
    const { adapter, accounting } = setup();
    await adapter.postAdvanceAllocation(T, context, allocation({ writeoff: 50n }), manager);

    const dto = accounting.createJournalEntry.mock.calls[0][1];
    expect(dto.entryNumber).toBe('TRS-RC-000001-adv');
    expect(dto.lines).toEqual([
      { accountCode: A.CUSTOMER_ADVANCES, debit: '7.00', credit: '0.00', partyCode: 'C1' },
      { accountCode: A.WRITEOFF_RECEIPT, debit: '0.50', credit: '0.00' },
      { accountCode: A.RECEIVABLES, debit: '0.00', credit: '7.50', partyCode: 'C1' },
    ]);
  });

  it('posts a payment advance allocation as the payable against supplier advances and write-off', async () => {
    const { adapter, accounting } = setup();
    await adapter.postAdvanceAllocation(T, context, allocation({ kind: TreasuryDocKind.PAYMENT, partyCode: 'S1', writeoff: 50n }), manager);

    const dto = accounting.createJournalEntry.mock.calls[0][1];
    expect(dto.lines).toEqual([
      { accountCode: A.PAYABLES, debit: '7.50', credit: '0.00', partyCode: 'S1' },
      { accountCode: A.SUPPLIER_ADVANCES, debit: '0.00', credit: '7.00', partyCode: 'S1' },
      { accountCode: A.WRITEOFF_PAYMENT, debit: '0.00', credit: '0.50' },
    ]);
  });

  it('produces vouchers identical to TreasuryLedgerPostingAdapter across document and advance permutations', async () => {
    const docCases: DocumentPostingInput[] = [
      doc(),
      doc({ kind: TreasuryDocKind.PAYMENT, partyCode: 'S1' }),
      doc({
        funds: [
          { accountCode: A.CASH, amount: 400n },
          { accountCode: A.BANK, amount: 600n },
        ],
        chequeTotal: 250n,
        applied: 800n,
        writeoff: 50n,
        advance: 450n,
      }),
      doc({
        kind: TreasuryDocKind.PAYMENT,
        partyCode: 'S2',
        funds: [
          { accountCode: A.CASH, amount: 300n },
          { accountCode: A.BANK, amount: 200n },
        ],
        chequeTotal: 900n,
        applied: 600n,
        writeoff: 40n,
        advance: 800n,
      }),
      doc({ applied: 0n, advance: 1000n }),
    ];

    for (const [idx, input] of docCases.entries()) {
      const rulesSetup = setup();
      const ledgerSetup = setup();
      const legacyAdapter = new TreasuryLedgerPostingAdapter(ledgerSetup.accounting as never);
      const ctx = { ...context, docNumber: `DOC-${idx}` };

      await rulesSetup.adapter.postDocument(T, ctx, input, manager);
      await legacyAdapter.postDocument(T, ctx, input, manager);

      const rulesDto = rulesSetup.accounting.createJournalEntry.mock.calls[0][1];
      const ledgerDto = ledgerSetup.accounting.createJournalEntry.mock.calls[0][1];
      expect(rulesDto.date).toBe(ledgerDto.date);
      expect(rulesDto.description).toBe(ledgerDto.description);
      expect(rulesDto.lines).toEqual(ledgerDto.lines);
    }

    const allocCases: AdvanceAllocationInput[] = [
      allocation(),
      allocation({ writeoff: 50n }),
      allocation({ kind: TreasuryDocKind.PAYMENT, partyCode: 'S1' }),
      allocation({ kind: TreasuryDocKind.PAYMENT, partyCode: 'S2', writeoff: 75n }),
    ];

    for (const [idx, input] of allocCases.entries()) {
      const rulesSetup = setup();
      const ledgerSetup = setup();
      const legacyAdapter = new TreasuryLedgerPostingAdapter(ledgerSetup.accounting as never);
      const ctx = { ...context, docNumber: `ALLOC-${idx}` };

      await rulesSetup.adapter.postAdvanceAllocation(T, ctx, input, manager);
      await legacyAdapter.postAdvanceAllocation(T, ctx, input, manager);

      const rulesDto = rulesSetup.accounting.createJournalEntry.mock.calls[0][1];
      const ledgerDto = ledgerSetup.accounting.createJournalEntry.mock.calls[0][1];
      expect(rulesDto.date).toBe(ledgerDto.date);
      expect(rulesDto.description).toBe(ledgerDto.description);
      expect(rulesDto.lines).toEqual(ledgerDto.lines);
    }
  });

  it('implements the treasury posting port surface', () => {
    const { adapter } = setup();
    expect(typeof adapter.postDocument).toBe('function');
    expect(typeof adapter.postAdvanceAllocation).toBe('function');
  });
});
