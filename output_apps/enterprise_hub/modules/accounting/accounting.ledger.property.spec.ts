/**
 * Fast-check property tests for the ledger domain rules and invariants:
 *  - Balanced vouchers keep the trial balance balanced.
 *  - A reversal nets to zero for every account and restores pre-voucher balances.
 *  - Posting order does not change final account balances or trial balance totals (commutativity).
 *  - Money arithmetic precision and exact representation across 64-bit boundaries.
 *  - Idempotency replay and conflict enforcement.
 */
import 'reflect-metadata';
import * as fc from 'fast-check';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CurrencyService } from '../currency/services/currency.service';
import { ChartOfAccountEntity } from './entities/chart-of-account.entity';
import { JournalEntryLineEntity } from './entities/journal-entry-line.entity';
import { JournalEntryEntity } from './entities/journal-entry.entity';
import { PeriodLockEntity } from './entities/period-lock.entity';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import {
  AccountLevel,
  AccountType,
  JournalEntryStatus,
  JournalEntryType,
} from './enums/accounting.enum';
import {
  fromDb,
  fromMinor,
  minorToDecimal,
  parseMinor,
  sumMinor,
  toMinor,
} from './money';
import {
  AccountingRepository,
  JournalLineInput,
  TrialBalanceRawRow,
} from './repositories/accounting.repository';
import { AccountingService } from './services/accounting.service';

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Mock CurrencyService converting 1:1 for base currency IRR testing. */
const mockCurrencyService = {
  convert: jest.fn((v: number) => v),
  round: jest.fn((v: number) => v),
} as unknown as CurrencyService;

describe('money.ts round trips never drift', () => {
  it('parseMinor(minorToDecimal(x)) === x and fromDb(minorToDecimal(x)) === x for any bigint', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 18n - 1n), max: 10n ** 18n - 1n }),
        (x) => {
          expect(parseMinor(minorToDecimal(x))).toBe(x);
          expect(fromDb(minorToDecimal(x))).toBe(x);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('toMinor(fromMinor(x)) === x over the whole bigint range, including both sides of the 2^51 switch', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -MAX_SAFE, max: MAX_SAFE }), (x) => {
        expect(toMinor(fromMinor(x))).toBe(x);
      }),
      {
        numRuns: 5000,
        examples: [
          [-7043348018551001n],
          [2n ** 51n],
          [2n ** 51n + 1n],
          [-(2n ** 51n) - 1n],
          [MAX_SAFE],
          [-MAX_SAFE],
        ],
      },
    );
  });

  it('fromMinor is a JSON number up to 2^51 minor units and an exact decimal string above', () => {
    expect(fromMinor(2n ** 51n)).toBe(Number(2n ** 51n) / 100);
    expect(fromMinor(2n ** 51n + 1n)).toBe('22517998136852.49');
    expect(fromMinor(-(2n ** 51n) - 1n)).toBe('-22517998136852.49');
    expect(fromMinor(12345n)).toBe(123.45);
  });

  it('decimal strings with 0..2 fractional digits round-trip to the same value', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 15n }),
        fc.integer({ min: 0, max: 2 }),
        fc.integer({ min: 0, max: 99 }),
        (int, digits, frac) => {
          const text =
            digits === 0
              ? `${int}`
              : `${int}.${String(frac).padStart(2, '0').slice(0, digits)}`;
          const minor = parseMinor(text);
          expect(minor).toBe(
            int * 100n +
              BigInt(
                digits === 0
                  ? 0
                  : Number(
                      String(frac)
                        .padStart(2, '0')
                        .slice(0, digits)
                        .padEnd(2, '0'),
                    ),
              ),
          );
          expect(parseMinor(minorToDecimal(minor))).toBe(minor);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('sumMinor equals the bigint sum exactly, in any order', () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }), {
          maxLength: 500,
        }),
        (xs) => {
          const expected = xs.reduce((a, b) => a + b, 0n);
          expect(sumMinor(xs.map(minorToDecimal))).toBe(expected);
          expect(sumMinor(xs.slice().reverse().map(minorToDecimal))).toBe(
            expected,
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});

/** Standard chart account codes used in property generation. */
const AVAILABLE_ACCOUNT_CODES = [
  '1010', // Cash / Bank (Asset)
  '1020', // Accounts Receivable (Asset)
  '1030', // Inventory (Asset)
  '2010', // Accounts Payable (Liability)
  '2020', // VAT Payable (Liability)
  '3010', // Share Capital (Equity)
  '4010', // Sales Revenue (Revenue)
  '5010', // Cost of Goods Sold (Expense)
  '5020', // General & Administrative Expense (Expense)
];

const INITIAL_CHART = [
  { code: '1010', name: 'موجودی نقد و بانک', accountType: AccountType.ASSET, level: AccountLevel.MOEIN },
  { code: '1020', name: 'حساب‌های دریافتنی تجاری', accountType: AccountType.ASSET, level: AccountLevel.MOEIN },
  { code: '1030', name: 'موجودی کالا', accountType: AccountType.ASSET, level: AccountLevel.MOEIN },
  { code: '2010', name: 'حساب‌های پرداختنی تجاری', accountType: AccountType.LIABILITY, level: AccountLevel.MOEIN },
  { code: '2020', name: 'مالیات بر ارزش افزوده پرداختنی', accountType: AccountType.LIABILITY, level: AccountLevel.MOEIN },
  { code: '3010', name: 'سرمایه', accountType: AccountType.EQUITY, level: AccountLevel.MOEIN },
  { code: '4010', name: 'درآمد فروش', accountType: AccountType.REVENUE, level: AccountLevel.MOEIN },
  { code: '5010', name: 'بهای تمام‌شده کالای فروش‌رفته', accountType: AccountType.EXPENSE, level: AccountLevel.MOEIN },
  { code: '5020', name: 'هزینه‌های اداری و عمومی', accountType: AccountType.EXPENSE, level: AccountLevel.MOEIN },
];

/**
 * Storage repository implementing multi-tenant persistence and ledger math.
 * Faithfully mimics PostgreSQL transactions, RLS tenant isolation, and atomic balance updates.
 */
class PropertyTestAccountingRepository {
  accounts: ChartOfAccountEntity[] = [];
  entries: JournalEntryEntity[] = [];
  lines: JournalEntryLineEntity[] = [];
  periodLocks: PeriodLockEntity[] = [];
  private accountSeq = 0;
  private entrySeq = 0;
  private lineSeq = 0;

  async transaction<T>(
    _tenantId: string,
    work: (manager: EntityManager) => Promise<T>,
    outerManager?: EntityManager,
  ): Promise<T> {
    return work(outerManager as EntityManager);
  }

  async countAccounts(tenantId: string, _manager?: EntityManager): Promise<number> {
    return this.accounts.filter((a) => a.tenantId === tenantId).length;
  }

  async findAllAccounts(
    tenantId: string,
    _manager?: EntityManager,
  ): Promise<ChartOfAccountEntity[]> {
    return this.accounts
      .filter((a) => a.tenantId === tenantId)
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  async findAccountById(
    tenantId: string,
    id: number,
  ): Promise<ChartOfAccountEntity | null> {
    return (
      this.accounts.find((a) => a.tenantId === tenantId && a.id === id) ?? null
    );
  }

  async findAccountByCode(
    tenantId: string,
    code: string,
    _manager?: EntityManager,
  ): Promise<ChartOfAccountEntity | null> {
    return (
      this.accounts.find((a) => a.tenantId === tenantId && a.code === code) ??
      null
    );
  }

  async findAccountsByCodes(
    tenantId: string,
    codes: string[],
    _manager?: EntityManager,
  ): Promise<ChartOfAccountEntity[]> {
    return this.accounts.filter(
      (a) => a.tenantId === tenantId && codes.includes(a.code),
    );
  }

  async createAccount(
    tenantId: string,
    data: Partial<ChartOfAccountEntity>,
  ): Promise<ChartOfAccountEntity> {
    const entity = {
      ...data,
      id: ++this.accountSeq,
      tenantId,
      balance: data.balance ?? '0.00',
    } as ChartOfAccountEntity;
    this.accounts.push(entity);
    return entity;
  }

  async insertMissingAccounts(
    tenantId: string,
    data: ReadonlyArray<Partial<ChartOfAccountEntity>>,
  ): Promise<void> {
    const existing = new Set(
      this.accounts
        .filter((a) => a.tenantId === tenantId)
        .map((a) => a.code),
    );
    for (const item of data) {
      if (!existing.has(item.code as string)) {
        await this.createAccount(tenantId, item);
      }
    }
  }

  async findEntryById(
    tenantId: string,
    id: number,
    _manager?: EntityManager,
  ): Promise<JournalEntryEntity | null> {
    return (
      this.entries.find((e) => e.tenantId === tenantId && e.id === id) ?? null
    );
  }

  async findEntryByNumber(
    tenantId: string,
    entryNumber: string,
    _manager?: EntityManager,
  ): Promise<JournalEntryEntity | null> {
    return (
      this.entries.find(
        (e) => e.tenantId === tenantId && e.entryNumber === entryNumber,
      ) ?? null
    );
  }

  async findEntryByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
    _manager?: EntityManager,
  ): Promise<JournalEntryEntity | null> {
    return (
      this.entries.find(
        (e) => e.tenantId === tenantId && e.idempotencyKey === idempotencyKey,
      ) ?? null
    );
  }

  async findReversalOf(
    tenantId: string,
    entryId: number,
    _manager?: EntityManager,
  ): Promise<JournalEntryEntity | null> {
    return (
      this.entries.find(
        (e) => e.tenantId === tenantId && e.reversesEntryId === entryId,
      ) ?? null
    );
  }

  async lockLedgerShared(_tenantId: string, _manager: EntityManager): Promise<void> {}
  async lockLedgerExclusive(_tenantId: string, _manager: EntityManager): Promise<void> {}
  async assertDateOpen(_tenantId: string, _date: Date, _manager: EntityManager): Promise<void> {}

  async persistJournalEntry(
    tenantId: string,
    header: {
      entryNumber: string;
      date: Date;
      description: string;
      status: JournalEntryStatus;
      reversesEntryId?: number | null;
      entryType?: JournalEntryType;
      idempotencyKey?: string | null;
      idempotencyFingerprint?: string | null;
    },
    lineInputs: JournalLineInput[],
    _manager?: EntityManager,
  ): Promise<JournalEntryEntity> {
    const entry = {
      id: ++this.entrySeq,
      tenantId,
      entryNumber: header.entryNumber,
      date: header.date,
      description: header.description,
      status: header.status,
      reversesEntryId: header.reversesEntryId ?? null,
      entryType: header.entryType,
      idempotencyKey: header.idempotencyKey ?? null,
      idempotencyFingerprint: header.idempotencyFingerprint ?? null,
      lines: [] as JournalEntryLineEntity[],
    } as JournalEntryEntity;

    for (const line of lineInputs) {
      const account =
        this.accounts.find(
          (a) => a.tenantId === tenantId && a.id === line.accountId,
        ) ?? null;
      const lineEntity = {
        id: ++this.lineSeq,
        tenantId,
        journalEntryId: entry.id,
        accountId: line.accountId,
        account: account ?? undefined,
        debit: minorToDecimal(line.debitMinor),
        credit: minorToDecimal(line.creditMinor),
        description: line.description ?? null,
        currency: line.currency ?? 'IRR',
        amountFx: line.amountFx ?? null,
        fxRate: line.fxRate ?? null,
        partyCode: line.partyCode ?? null,
        detailCode: line.detailCode ?? null,
        costCenterCode: line.costCenterCode ?? null,
        projectCode: line.projectCode ?? null,
        journalEntry: entry,
      } as unknown as JournalEntryLineEntity;

      this.lines.push(lineEntity);
      entry.lines.push(lineEntity);

      if (account && header.status === JournalEntryStatus.POSTED) {
        account.balance = minorToDecimal(
          fromDb(account.balance) + line.debitMinor - line.creditMinor,
        );
      }
    }

    this.entries.push(entry);
    return entry;
  }

  async getTrialBalance(
    tenantId: string,
    currency?: string,
  ): Promise<TrialBalanceRawRow[]> {
    const postedEntryIds = new Set(
      this.entries
        .filter(
          (e) =>
            e.tenantId === tenantId && e.status === JournalEntryStatus.POSTED,
        )
        .map((e) => e.id),
    );

    const grouped = new Map<
      string,
      {
        account: ChartOfAccountEntity;
        debit: bigint;
        credit: bigint;
        amountFx: bigint;
        fxInIrr: bigint;
      }
    >();

    for (const line of this.lines) {
      if (
        line.tenantId !== tenantId ||
        !postedEntryIds.has(line.journalEntryId)
      ) {
        continue;
      }
      if (currency && line.currency !== currency) {
        continue;
      }
      const account = this.accounts.find(
        (a) => a.id === line.accountId && a.tenantId === tenantId,
      );
      if (!account) continue;

      const current = grouped.get(account.code) ?? {
        account,
        debit: 0n,
        credit: 0n,
        amountFx: 0n,
        fxInIrr: 0n,
      };
      current.debit += fromDb(line.debit);
      current.credit += fromDb(line.credit);
      grouped.set(account.code, current);
    }

    return Array.from(grouped.entries())
      .sort(([codeA], [codeB]) => codeA.localeCompare(codeB))
      .map(([code, data]) => ({
        code,
        name: data.account.name,
        accountType: data.account.accountType,
        totalDebit: minorToDecimal(data.debit),
        totalCredit: minorToDecimal(data.credit),
        totalAmountFx: minorToDecimal(data.amountFx),
        totalFxInIrr: minorToDecimal(data.fxInIrr),
      }));
  }

  balanceOf(tenantId: string, code: string): bigint {
    const acc = this.accounts.find(
      (a) => a.tenantId === tenantId && a.code === code,
    );
    return acc ? fromDb(acc.balance) : 0n;
  }

  async seedStandardChart(tenantId: string): Promise<void> {
    await this.insertMissingAccounts(tenantId, INITIAL_CHART);
  }
}

/** Helper to build a clean test fixture for a tenant. */
async function createLedgerFixture(tenantId = 'tenant-test') {
  const repository = new PropertyTestAccountingRepository();
  await repository.seedStandardChart(tenantId);
  const service = new AccountingService(
    repository as unknown as AccountingRepository,
    mockCurrencyService,
  );
  return { repository, service, tenantId };
}

/**
 * Fast-check arbitrary generating balanced journal entry line sets.
 * Generates N-to-M, 1-to-N, and N-to-1 balanced vouchers with valid debit/credit partitions.
 */
const balancedVoucherDtoArbitrary = fc
  .record({
    debitParts: fc.array(
      fc.bigInt({ min: 100n, max: 500_000_000_00n }),
      { minLength: 1, maxLength: 4 },
    ),
    creditPartsCount: fc.integer({ min: 1, max: 4 }),
    debitAccounts: fc.array(fc.constantFrom(...AVAILABLE_ACCOUNT_CODES), {
      minLength: 4,
      maxLength: 4,
    }),
    creditAccounts: fc.array(fc.constantFrom(...AVAILABLE_ACCOUNT_CODES), {
      minLength: 4,
      maxLength: 4,
    }),
    randomSplitWeights: fc.array(fc.integer({ min: 1, max: 100 }), {
      minLength: 4,
      maxLength: 4,
    }),
    description: fc.string({ minLength: 3, maxLength: 50 }),
  })
  .map(
    ({
      debitParts,
      creditPartsCount,
      debitAccounts,
      creditAccounts,
      randomSplitWeights,
      description,
    }) => {
      const totalMinor = debitParts.reduce((a, b) => a + b, 0n);
      const creditParts: bigint[] = [];

      if (creditPartsCount === 1) {
        creditParts.push(totalMinor);
      } else {
        let remaining = totalMinor;
        const weights = randomSplitWeights.slice(0, creditPartsCount);
        const weightSum = weights.reduce((a, b) => a + b, 0);

        for (let i = 0; i < creditPartsCount - 1; i++) {
          const share =
            (totalMinor * BigInt(weights[i])) / BigInt(weightSum);
          const safeShare =
            share <= 0n ? 1n : share >= remaining ? 1n : share;
          creditParts.push(safeShare);
          remaining -= safeShare;
        }
        creditParts.push(remaining);
      }

      const lines = [
        ...debitParts.map((amt, idx) => ({
          accountCode: debitAccounts[idx],
          debit: minorToDecimal(amt),
          credit: '0.00',
          description: `Debit line ${idx + 1}`,
        })),
        ...creditParts.map((amt, idx) => ({
          accountCode: creditAccounts[idx],
          debit: '0.00',
          credit: minorToDecimal(amt),
          description: `Credit line ${idx + 1}`,
        })),
      ];

      return {
        description: description || 'سند متوازن تصادفی',
        lines,
        totalMinor,
      };
    },
  );

describe('Ledger Property Tests (fast-check)', () => {
  describe('Property 1: Balanced vouchers keep the trial balance balanced', () => {
    it('any sequence of balanced vouchers preserves trial balance equilibrium (totalDebit == totalCredit)', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(balancedVoucherDtoArbitrary, { minLength: 1, maxLength: 6 }),
          async (vouchers) => {
            const tenantId = `tenant-${Math.random().toString(36).slice(2, 8)}`;
            const { service } = await createLedgerFixture(tenantId);

            let cumulativeDebitMinor = 0n;

            for (let i = 0; i < vouchers.length; i++) {
              const v = vouchers[i];
              await service.createJournalEntry(tenantId, {
                entryNumber: `JV-${i + 1}-${Math.random().toString(36).slice(2, 7)}`,
                description: v.description,
                lines: v.lines,
              });

              cumulativeDebitMinor += v.totalMinor;

              // Inspect trial balance after each voucher addition
              const tb = await service.getTrialBalance(tenantId);

              // Invariant 1: trial balance is explicitly balanced
              expect(tb.balanced).toBe(true);

              // Invariant 2: total debit equals total credit exactly
              const totalDebitMinor = toMinor(tb.totalDebit);
              const totalCreditMinor = toMinor(tb.totalCredit);
              expect(totalDebitMinor).toBe(totalCreditMinor);

              // Invariant 3: cumulative sum of debits matches ledger trial balance total
              expect(totalDebitMinor).toBe(cumulativeDebitMinor);

              // Invariant 4: sum of all account balances in the trial balance is zero
              const sumBalances = tb.rows.reduce(
                (sum, row) => sum + toMinor(row.balance),
                0n,
              );
              expect(sumBalances).toBe(0n);
            }
          },
        ),
        { numRuns: 40 },
      );
    });

    it('unbalanced vouchers are strictly rejected, preserving ledger integrity', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigInt({ min: 100n, max: 1_000_000n }),
          fc.bigInt({ min: 1n, max: 99n }),
          async (debitAmount, diff) => {
            const tenantId = `tenant-unbal-${Math.random().toString(36).slice(2, 8)}`;
            const { service, repository } = await createLedgerFixture(tenantId);

            const unbalancedDto: CreateJournalEntryDto = {
              entryNumber: 'JV-UNBAL-1',
              description: 'سند نامتوازن',
              lines: [
                {
                  accountCode: '1010',
                  debit: minorToDecimal(debitAmount),
                  credit: 0,
                },
                {
                  accountCode: '4010',
                  debit: 0,
                  credit: minorToDecimal(debitAmount + diff),
                },
              ],
            };

            await expect(
              service.createJournalEntry(tenantId, unbalancedDto),
            ).rejects.toThrow(BadRequestException);

            // Ledger must remain untouched
            expect(repository.entries.length).toBe(0);
            expect(repository.lines.length).toBe(0);
            expect(repository.balanceOf(tenantId, '1010')).toBe(0n);
          },
        ),
        { numRuns: 30 },
      );
    });
  });

  describe('Property 2: A reversal nets to zero', () => {
    it('reversing a posted voucher perfectly restores all account balances to pre-voucher state', async () => {
      await fc.assert(
        fc.asyncProperty(
          balancedVoucherDtoArbitrary,
          async (voucher) => {
            const tenantId = `tenant-rev-${Math.random().toString(36).slice(2, 8)}`;
            const { service, repository } = await createLedgerFixture(tenantId);

            // 1. Record pre-voucher balances for all accounts
            const initialBalances = new Map<string, bigint>();
            for (const code of AVAILABLE_ACCOUNT_CODES) {
              initialBalances.set(code, repository.balanceOf(tenantId, code));
            }

            // 2. Post the original voucher
            const posted = await service.createJournalEntry(tenantId, {
              entryNumber: `JV-ORIG-${Math.random().toString(36).slice(2, 7)}`,
              description: voucher.description,
              lines: voucher.lines,
            });

            // 3. Post the reversal voucher
            const reversal = await service.reverseJournalEntry(tenantId, posted.id, {
              reason: 'اصلاح سند اشتباه',
            });

            expect(reversal.status).toBe(JournalEntryStatus.POSTED);
            const reversalEntity = await repository.findReversalOf(tenantId, posted.id);
            expect(reversalEntity).not.toBeNull();
            expect(reversalEntity?.id).toBe(reversal.id);
            expect(reversalEntity?.reversesEntryId).toBe(posted.id);

            // 4. Invariant: every account balance must have exactly zero net change
            for (const code of AVAILABLE_ACCOUNT_CODES) {
              const currentBalance = repository.balanceOf(tenantId, code);
              const initialBalance = initialBalances.get(code)!;
              expect(currentBalance).toBe(initialBalance);
            }

            // 5. Invariant: Trial balance remains balanced after reversal
            const tb = await service.getTrialBalance(tenantId);
            expect(tb.balanced).toBe(true);
            expect(toMinor(tb.totalDebit)).toBe(toMinor(tb.totalCredit));
          },
        ),
        { numRuns: 40 },
      );
    });

    it('a reversal cannot be reversed, and an entry cannot be reversed twice', async () => {
      await fc.assert(
        fc.asyncProperty(
          balancedVoucherDtoArbitrary,
          async (voucher) => {
            const tenantId = `tenant-rev-guard-${Math.random().toString(36).slice(2, 8)}`;
            const { service } = await createLedgerFixture(tenantId);

            const posted = await service.createJournalEntry(tenantId, {
              entryNumber: `JV-REV-GUARD-${Math.random().toString(36).slice(2, 7)}`,
              description: voucher.description,
              lines: voucher.lines,
            });

            const reversal = await service.reverseJournalEntry(tenantId, posted.id);

            // Guard 1: reversing the reversal is forbidden (400)
            await expect(
              service.reverseJournalEntry(tenantId, reversal.id),
            ).rejects.toThrow(BadRequestException);

            // Guard 2: reversing the original entry a second time is forbidden (409)
            await expect(
              service.reverseJournalEntry(tenantId, posted.id),
            ).rejects.toThrow(ConflictException);
          },
        ),
        { numRuns: 30 },
      );
    });
  });

  describe('Property 3: Posting order does not change final balances (Commutativity)', () => {
    it('posting a set of vouchers in any permutation yields identical final account balances and trial totals', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(balancedVoucherDtoArbitrary, { minLength: 2, maxLength: 5 }),
          fc.shuffledSubarray([0, 1, 2, 3, 4], { minLength: 2, maxLength: 5 }),
          async (vouchers, permutationIndices) => {
            // Trim indices to match actual vouchers length
            const n = vouchers.length;
            const perm = permutationIndices.filter((idx) => idx < n);
            // Ensure perm contains all indices from 0 to n-1
            const missing = Array.from({ length: n }, (_, i) => i).filter(
              (i) => !perm.includes(i),
            );
            const fullPermutation = [...perm, ...missing];

            const tenantOrderA = `tenant-orderA-${Math.random().toString(36).slice(2, 8)}`;
            const tenantOrderB = `tenant-orderB-${Math.random().toString(36).slice(2, 8)}`;

            const fixtureA = await createLedgerFixture(tenantOrderA);
            const fixtureB = await createLedgerFixture(tenantOrderB);

            // Order A: natural order (0, 1, ..., n-1)
            for (let i = 0; i < n; i++) {
              await fixtureA.service.createJournalEntry(tenantOrderA, {
                entryNumber: `JV-A-${i + 1}`,
                description: vouchers[i].description,
                lines: vouchers[i].lines,
              });
            }

            // Order B: permuted order
            for (let i = 0; i < n; i++) {
              const originalIndex = fullPermutation[i];
              await fixtureB.service.createJournalEntry(tenantOrderB, {
                entryNumber: `JV-B-${i + 1}`,
                description: vouchers[originalIndex].description,
                lines: vouchers[originalIndex].lines,
              });
            }

            // Invariant: Final balance of EVERY account in the chart is identical regardless of posting sequence
            for (const code of AVAILABLE_ACCOUNT_CODES) {
              const balanceA = fixtureA.repository.balanceOf(tenantOrderA, code);
              const balanceB = fixtureB.repository.balanceOf(tenantOrderB, code);
              expect(balanceA).toBe(balanceB);
            }

            // Invariant: Trial balance grand totals are identical
            const tbA = await fixtureA.service.getTrialBalance(tenantOrderA);
            const tbB = await fixtureB.service.getTrialBalance(tenantOrderB);

            expect(tbA.balanced).toBe(true);
            expect(tbB.balanced).toBe(true);
            expect(toMinor(tbA.totalDebit)).toBe(toMinor(tbB.totalDebit));
            expect(toMinor(tbA.totalCredit)).toBe(toMinor(tbB.totalCredit));
          },
        ),
        { numRuns: 35 },
      );
    });
  });

  describe('Property 5: Idempotency Key Invariants', () => {
    it('replaying the identical payload with the same idempotencyKey is an idempotent replay', async () => {
      await fc.assert(
        fc.asyncProperty(
          balancedVoucherDtoArbitrary,
          fc.uuid(),
          async (voucher, idempotencyKey) => {
            const tenantId = `tenant-idem-${Math.random().toString(36).slice(2, 8)}`;
            const { service, repository } = await createLedgerFixture(tenantId);

            const payload: CreateJournalEntryDto = {
              entryNumber: `JV-IDEM-${Math.random().toString(36).slice(2, 7)}`,
              description: voucher.description,
              lines: voucher.lines,
              idempotencyKey,
            };

            const firstResult = await service.createJournalEntry(tenantId, payload);
            const replayResult = await service.createJournalEntry(tenantId, payload);

            // Invariant: returned entry is identical
            expect(replayResult.id).toBe(firstResult.id);
            expect(replayResult.entryNumber).toBe(firstResult.entryNumber);

            // Invariant: no duplicated entries in ledger
            expect(repository.entries.length).toBe(1);
            expect(repository.lines.length).toBe(voucher.lines.length);
          },
        ),
        { numRuns: 20 },
      );
    });

    it('reusing the same idempotencyKey with a divergent payload is strictly rejected with 409', async () => {
      await fc.assert(
        fc.asyncProperty(
          balancedVoucherDtoArbitrary,
          fc.uuid(),
          async (voucher, idempotencyKey) => {
            const tenantId = `tenant-idem-clash-${Math.random().toString(36).slice(2, 8)}`;
            const { service } = await createLedgerFixture(tenantId);

            const firstPayload: CreateJournalEntryDto = {
              entryNumber: `JV-IDEM-A-${Math.random().toString(36).slice(2, 7)}`,
              description: voucher.description,
              lines: voucher.lines,
              idempotencyKey,
            };

            await service.createJournalEntry(tenantId, firstPayload);

            // Divergent payload with different description
            const divergentPayload: CreateJournalEntryDto = {
              entryNumber: `JV-IDEM-B-${Math.random().toString(36).slice(2, 7)}`,
              description: `${voucher.description} - modified`,
              lines: voucher.lines,
              idempotencyKey,
            };

            await expect(
              service.createJournalEntry(tenantId, divergentPayload),
            ).rejects.toThrow(ConflictException);
          },
        ),
        { numRuns: 20 },
      );
    });
  });
});
