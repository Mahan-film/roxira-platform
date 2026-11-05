import { EntityManager } from 'typeorm';
import { AccountLevel } from '../accounting/enums/accounting.enum';
import { AccountingService } from '../accounting/services/accounting.service';
import { buildProposal, toJournalLines } from '../posting_rules/domain/posting-engine';
import {
  STOCK_SOURCE_TYPE,
  stockPostingDocType,
  stockPostingOverrides,
  StockValueKind,
} from './posting/stock-posting';
import {
  legacyStockEntryNumber,
  legacyStockValueLines,
} from './__fixtures__/legacy-stock-posting';
import { fakePostingRules } from './__fixtures__/fake-posting-rules';
import { StockDocumentsService } from './services/stock-documents.service';

/**
 * Old vs new: the posting rules engine, given the legacy account codes as `overrides`, must post
 * the same stock vouchers as the hardcoded lines it replaced (frozen in
 * __fixtures__/legacy-stock-posting.ts) for every net shape.
 */

const POSITIVE_NETS = [1n, 100n, 123456789n, 99999999999n];
const ALL_NETS = [1n, 100n, 123456789n, -1n, -100n, -123456789n, 99999999999n];

const proposalLines = (kind: StockValueKind, net: bigint, accounts: string[]) =>
  toJournalLines(
    buildProposal({
      docType: stockPostingDocType(kind, net),
      amounts: { amount: net < 0n ? -net : net },
      overrides: stockPostingOverrides(kind, accounts),
    }),
  );

type ComparableLine = { accountCode: string; debit: string; credit: string };

const engineShape = (
  lines: ReturnType<typeof proposalLines>,
): ComparableLine[] =>
  lines.map((l) => ({ accountCode: l.accountCode, debit: l.debit, credit: l.credit }));

const legacyShape = (
  lines: ReturnType<typeof legacyStockValueLines>,
): ComparableLine[] =>
  lines.map((l) => ({
    accountCode: l.accountCode,
    debit: l.debit ?? '0.00',
    credit: l.credit ?? '0.00',
  }));

const engineDescriptions = (kind: StockValueKind, net: bigint, accounts: string[]) =>
  proposalLines(kind, net, accounts).map((l) => l.description ?? '');

const legacyDescriptions = (accounts: string[], net: bigint) =>
  legacyStockValueLines(accounts, net).map((l) => l.description);

describe('stock postings: legacy lines vs posting rules engine', () => {
  it('opening vouchers are identical (accounts, sides, amounts, order) for every positive net', () => {
    const accounts = ['1301', '3030'];
    for (const net of POSITIVE_NETS) {
      expect(engineShape(proposalLines('opening', net, accounts))).toEqual(
        legacyShape(legacyStockValueLines(accounts, net)),
      );
      expect(engineDescriptions('opening', net, accounts)).toEqual(
        legacyDescriptions(accounts, net),
      );
    }
  });

  it('adjustment vouchers are identical in codes, sides and amounts for every net', () => {
    const accounts = ['1301', '5301'];
    for (const net of ALL_NETS) {
      expect(engineShape(proposalLines('adjustment', net, accounts))).toEqual(
        legacyShape(legacyStockValueLines(accounts, net)),
      );
      const engine = engineDescriptions('adjustment', net, accounts);
      const legacy = legacyDescriptions(accounts, net);
      if (net > 0n) {
        // Gain: the credit line description differs on purpose ('اضافه انبار' from the template
        // vs the legacy 'مابه‌ازای ثبت موجودی'); codes and amounts still match.
        expect(engine[0]).toBe(legacy[0]);
        expect(engine[1]).toBe('اضافه انبار');
        expect(legacy[1]).toBe('مابه‌ازای ثبت موجودی');
      } else {
        // Loss: descriptions are identical to the legacy lines.
        expect(engine).toEqual(legacy);
      }
    }
  });

  it('a custom account pair lands on those codes', () => {
    const accounts = ['1399', '5399'];
    expect(proposalLines('adjustment', 500n, accounts).map((l) => l.accountCode)).toEqual([
      '1399',
      '5399',
    ]);
    expect(proposalLines('adjustment', -500n, accounts).map((l) => l.accountCode)).toEqual([
      '5399',
      '1399',
    ]);
    expect(proposalLines('opening', 500n, accounts).map((l) => l.accountCode)).toEqual([
      '1399',
      '5399',
    ]);
  });
});

/** Accounting fake: a posting-level chart and one recorded entry per call. */
class FakeAccounting {
  entries: Array<{
    tenantId: string;
    entryNumber: string;
    date: string;
    description: string;
    lines: Array<{
      accountCode: string;
      debit?: string | number;
      credit?: string | number;
      description?: string;
    }>;
  }> = [];

  listAccounts = jest.fn(async () => [
    { code: '1301', level: AccountLevel.MOEIN },
    { code: '3030', level: AccountLevel.MOEIN },
    { code: '5301', level: AccountLevel.MOEIN },
  ]);

  createJournalEntry = jest.fn(
    async (
      tenantId: string,
      dto: {
        entryNumber: string;
        date: string;
        description: string;
        lines: Array<{
          accountCode: string;
          debit?: string | number;
          credit?: string | number;
          description?: string;
        }>;
      },
    ) => {
      this.entries.push({ tenantId, ...dto });
      return { id: this.entries.length, entryNumber: dto.entryNumber };
    },
  );
}

const setup = () => {
  const accounting = new FakeAccounting();
  const postingRules = fakePostingRules(accounting as unknown as AccountingService);
  const documents = new StockDocumentsService(
    {} as never,
    undefined,
    undefined,
    postingRules,
  );
  return { accounting, postingRules, documents };
};

describe('stock value vouchers through PostingRulesService', () => {
  const source = { id: 7, docNumber: 'ADJ-20260101-00001', docDate: '2026-01-01' };
  const net = -25050n; // 250.50 rial
  const accounts = ['1301', '5301'];

  it('posts once for a stock_document id, replays the same source, and keeps the legacy shape', async () => {
    const { accounting, postingRules, documents } = setup();
    const manager = {} as EntityManager;

    const first = await documents.postValueEntry(
      'tenant-a',
      source,
      'adjustment',
      'تعدیل موجودی',
      accounts,
      net,
      manager,
    );
    const second = await documents.postValueEntry(
      'tenant-a',
      source,
      'adjustment',
      'تعدیل موجودی',
      accounts,
      net,
      manager,
    );

    expect(accounting.createJournalEntry).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(accounting.entries).toHaveLength(1);
    const entry = accounting.entries[0];
    expect(entry.entryNumber).toBe(legacyStockEntryNumber(source.docNumber));
    expect(entry.date).toBe('2026-01-01T12:00:00.000Z');
    expect(entry.lines).toEqual(
      legacyStockValueLines(accounts, net).map((l) => ({
        accountCode: l.accountCode,
        debit: l.debit ?? '0.00',
        credit: l.credit ?? '0.00',
        description: l.description,
      })),
    );

    const replay = await postingRules.post(
      'tenant-a',
      {
        docType: stockPostingDocType('adjustment', net),
        sourceType: STOCK_SOURCE_TYPE,
        sourceId: String(source.id),
        date: `${source.docDate}T12:00:00.000Z`,
        amounts: { amount: -net },
        description: 'تعدیل موجودی',
        entryNumber: legacyStockEntryNumber(source.docNumber),
        overrides: stockPostingOverrides('adjustment', accounts),
      },
      manager,
    );
    expect(replay).toEqual({
      entryId: first.id,
      entryNumber: legacyStockEntryNumber(source.docNumber),
      replayed: true,
    });
    expect(accounting.createJournalEntry).toHaveBeenCalledTimes(1);
  });
});
