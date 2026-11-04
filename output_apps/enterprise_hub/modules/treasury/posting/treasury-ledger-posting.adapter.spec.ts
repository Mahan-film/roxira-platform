import { ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TreasuryLedgerPostingAdapter } from './treasury-ledger-posting.adapter';
import type { AccountingService } from '../../accounting/services/accounting.service';
import { parseMinor } from '../../accounting/money';
import {
  TREASURY_ACCOUNT_DEFINITIONS,
  TREASURY_ACCOUNTS as A,
} from '../constants/treasury.constants';
import { TreasuryDocKind } from '../enums/treasury.enum';
import type {
  AdvanceAllocationInput,
  DocumentPostingInput,
} from './treasury-lines';

const TENANT = 'tenant-1';
const MANAGER = {} as EntityManager;
const CONTEXT = {
  docNumber: 'DOC-1',
  date: '2024-05-01',
  description: 'Test posting',
};

/** 100.00 in minor units, fully applied: cash against the customer's receivable. */
const receiptDocument = (
  over: Partial<DocumentPostingInput> = {},
): DocumentPostingInput => ({
  kind: TreasuryDocKind.RECEIPT,
  partyCode: 'CUST-1',
  funds: [{ accountCode: A.CASH, amount: 10_000n }],
  chequeTotal: 0n,
  applied: 10_000n,
  writeoff: 0n,
  advance: 0n,
  ...over,
});

/** 50.00 of a customer advance moved onto invoices. */
const advanceAllocation = (
  over: Partial<AdvanceAllocationInput> = {},
): AdvanceAllocationInput => ({
  kind: TreasuryDocKind.RECEIPT,
  partyCode: 'CUST-1',
  applied: 5_000n,
  writeoff: 0n,
  ...over,
});

interface PostedLine {
  accountCode: string;
  debit: string;
  credit: string;
  partyCode?: string;
}

describe('TreasuryLedgerPostingAdapter', () => {
  let accounting: {
    listAccounts: jest.Mock;
    createAccount: jest.Mock;
    createJournalEntry: jest.Mock;
  };
  let adapter: TreasuryLedgerPostingAdapter;

  const stubChart = (
    codes: string[] = TREASURY_ACCOUNT_DEFINITIONS.map((d) => d.code),
  ): void => {
    accounting.listAccounts.mockResolvedValue(codes.map((code) => ({ code })));
  };

  /** The DTO the adapter handed to AccountingService.createJournalEntry. */
  const postedDto = (): { entryNumber: string; lines: PostedLine[] } =>
    accounting.createJournalEntry.mock.calls[0][1];

  const postedLines = (): PostedLine[] => postedDto().lines;

  beforeEach(() => {
    accounting = {
      listAccounts: jest.fn(),
      createAccount: jest.fn().mockResolvedValue({}),
      createJournalEntry: jest.fn().mockResolvedValue({ id: 77 }),
    };
    stubChart();
    adapter = new TreasuryLedgerPostingAdapter(
      accounting as unknown as AccountingService,
    );
  });

  describe('postDocument', () => {
    it('creates a journal entry for the document and returns its id', async () => {
      const id = await adapter.postDocument(
        TENANT,
        CONTEXT,
        receiptDocument(),
        MANAGER,
      );

      expect(id).toBe(77);
      expect(accounting.createJournalEntry).toHaveBeenCalledTimes(1);
      expect(accounting.createJournalEntry).toHaveBeenCalledWith(
        TENANT,
        expect.objectContaining({
          entryNumber: expect.stringMatching(/^TRS-DOC-1-doc-[0-9a-f]{8}$/),
          date: '2024-05-01T00:00:00.000Z',
          description: 'Test posting',
        }),
        MANAGER,
      );
    });

    it('passes the document journal lines to createJournalEntry', async () => {
      await adapter.postDocument(TENANT, CONTEXT, receiptDocument(), MANAGER);

      expect(postedLines()).toEqual([
        { accountCode: A.CASH, debit: '100.00', credit: '0.00' },
        {
          accountCode: A.RECEIVABLES,
          debit: '0.00',
          credit: '100.00',
          partyCode: 'CUST-1',
        },
      ]);
    });

    it('sends balanced journal lines (debits equal credits)', async () => {
      await adapter.postDocument(
        TENANT,
        CONTEXT,
        receiptDocument({ applied: 6_500n, writeoff: 250n, advance: 3_500n }),
        MANAGER,
      );

      const debit = postedLines().reduce((s, l) => s + parseMinor(l.debit), 0n);
      const credit = postedLines().reduce((s, l) => s + parseMinor(l.credit), 0n);

      expect(debit).toBeGreaterThan(0n);
      expect(debit).toBe(credit);
    });

    it('sends every amount as a two-decimal string', async () => {
      await adapter.postDocument(TENANT, CONTEXT, receiptDocument(), MANAGER);

      for (const line of postedLines()) {
        expect(typeof line.debit).toBe('string');
        expect(typeof line.credit).toBe('string');
        expect(line.debit).toMatch(/^\d+\.\d{2}$/);
        expect(line.credit).toMatch(/^\d+\.\d{2}$/);
      }
    });

    it('surfaces a ledger ConflictException unchanged', async () => {
      const conflict = new ConflictException('entry number already exists');
      accounting.createJournalEntry.mockRejectedValueOnce(conflict);

      await expect(
        adapter.postDocument(TENANT, CONTEXT, receiptDocument(), MANAGER),
      ).rejects.toBe(conflict);
    });
  });

  describe('postAdvanceAllocation', () => {
    it('posts the advance allocation and returns the journal entry id', async () => {
      const id = await adapter.postAdvanceAllocation(
        TENANT,
        CONTEXT,
        advanceAllocation(),
        MANAGER,
      );

      expect(id).toBe(77);
      expect(accounting.createJournalEntry).toHaveBeenCalledWith(
        TENANT,
        expect.objectContaining({
          entryNumber: expect.stringMatching(/^TRS-DOC-1-adv-[0-9a-f]{8}$/),
          date: '2024-05-01T00:00:00.000Z',
          description: 'Test posting',
        }),
        MANAGER,
      );
      expect(postedLines()).toEqual([
        {
          accountCode: A.CUSTOMER_ADVANCES,
          debit: '50.00',
          credit: '0.00',
          partyCode: 'CUST-1',
        },
        {
          accountCode: A.RECEIVABLES,
          debit: '0.00',
          credit: '50.00',
          partyCode: 'CUST-1',
        },
      ]);
    });

    it('sends balanced advance-allocation lines as decimal strings', async () => {
      await adapter.postAdvanceAllocation(
        TENANT,
        CONTEXT,
        advanceAllocation({ applied: 4_000n, writeoff: 100n }),
        MANAGER,
      );

      const lines = postedLines();
      const debit = lines.reduce((s, l) => s + parseMinor(l.debit), 0n);
      const credit = lines.reduce((s, l) => s + parseMinor(l.credit), 0n);

      expect(debit).toBe(credit);
      for (const line of lines) {
        expect(line.debit).toMatch(/^\d+\.\d{2}$/);
        expect(line.credit).toMatch(/^\d+\.\d{2}$/);
      }
    });

    it('surfaces a ledger ConflictException unchanged', async () => {
      const conflict = new ConflictException('entry number already exists');
      accounting.createJournalEntry.mockRejectedValueOnce(conflict);

      await expect(
        adapter.postAdvanceAllocation(TENANT, CONTEXT, advanceAllocation(), MANAGER),
      ).rejects.toBe(conflict);
    });
  });

  describe('account provisioning', () => {
    it('creates only the treasury accounts missing from the chart', async () => {
      stubChart([A.CASH, A.RECEIVABLES]);

      await adapter.postDocument(TENANT, CONTEXT, receiptDocument(), MANAGER);

      const createdCodes = accounting.createAccount.mock.calls.map(
        (call) => (call[1] as { code: string }).code,
      );
      expect(createdCodes.sort()).toEqual(
        [
          A.SUPPLIER_ADVANCES,
          A.CUSTOMER_ADVANCES,
          A.WRITEOFF_RECEIPT,
          A.WRITEOFF_PAYMENT,
        ].sort(),
      );
      expect(accounting.createAccount).toHaveBeenCalledWith(
        TENANT,
        expect.objectContaining({
          code: A.CUSTOMER_ADVANCES,
          accountType: 'LIABILITY',
        }),
      );
    });

    it('tolerates a ConflictException while creating a missing account', async () => {
      stubChart([]);
      accounting.createAccount
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new ConflictException('race'))
        .mockResolvedValueOnce({});

      await expect(
        adapter.postDocument(TENANT, CONTEXT, receiptDocument(), MANAGER),
      ).resolves.toBe(77);
      expect(accounting.createJournalEntry).toHaveBeenCalledTimes(1);
    });

    it('rethrows a non-conflict error from account creation', async () => {
      stubChart([]);
      accounting.createAccount.mockRejectedValue(new Error('db down'));

      await expect(
        adapter.postDocument(TENANT, CONTEXT, receiptDocument(), MANAGER),
      ).rejects.toThrow('db down');
      expect(accounting.createJournalEntry).not.toHaveBeenCalled();
    });
  });
});
