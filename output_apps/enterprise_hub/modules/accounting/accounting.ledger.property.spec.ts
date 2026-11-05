/**
 * Pure fast-check properties on the real ledger rules that need no database: the money module
 * (integer minor units, MONEY_SCALE = 2) and the service's balance rule. The expected values are
 * computed with bigint, independently of the code under test. Database-backed invariants live in
 * accounting.ledger.property.pg.spec.ts.
 */
import 'reflect-metadata';
import * as fc from 'fast-check';
import { BadRequestException } from '@nestjs/common';
import { CurrencyService } from '../currency/services/currency.service';
import { ChartOfAccountEntity } from './entities/chart-of-account.entity';
import { JournalEntryEntity } from './entities/journal-entry.entity';
import { fromDb, fromMinor, minorToDecimal, parseMinor, sumMinor, toMinor } from './money';
import { AccountingRepository, JournalLineInput } from './repositories/accounting.repository';
import { AccountingService } from './services/accounting.service';

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const currencyService = { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService;

describe('money.ts round trips never drift', () => {
  it('parseMinor(minorToDecimal(x)) === x and fromDb(minorToDecimal(x)) === x for any bigint', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 18n - 1n), max: 10n ** 18n - 1n }), (x) => {
        expect(parseMinor(minorToDecimal(x))).toBe(x);
        expect(fromDb(minorToDecimal(x))).toBe(x);
      }),
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
        // the counterexample that drifted before the fix, and the switch boundary
        examples: [[-7043348018551001n], [2n ** 51n], [2n ** 51n + 1n], [-(2n ** 51n) - 1n], [MAX_SAFE], [-MAX_SAFE]],
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
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 15n }), fc.integer({ min: 0, max: 2 }), fc.integer({ min: 0, max: 99 }), (int, digits, frac) => {
        const text = digits === 0 ? `${int}` : `${int}.${String(frac).padStart(2, '0').slice(0, digits)}`;
        const minor = parseMinor(text);
        expect(minor).toBe(int * 100n + BigInt(digits === 0 ? 0 : Number(String(frac).padStart(2, '0').slice(0, digits).padEnd(2, '0'))));
        expect(parseMinor(minorToDecimal(minor))).toBe(minor);
      }),
      { numRuns: 500 },
    );
  });

  it('sumMinor equals the bigint sum exactly, in any order', () => {
    fc.assert(
      fc.property(fc.array(fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }), { maxLength: 500 }), (xs) => {
        const expected = xs.reduce((a, b) => a + b, 0n);
        expect(sumMinor(xs.map(minorToDecimal))).toBe(expected);
        expect(sumMinor(xs.slice().reverse().map(minorToDecimal))).toBe(expected);
      }),
      { numRuns: 200 },
    );
  });
});

/** Storage-only repository: the balance rule and the stored values come from the real service. */
class MemoryRepo {
  accounts: ChartOfAccountEntity[] = [];
  entries: JournalEntryEntity[] = [];
  private seq = 0;
  async countAccounts(t: string) {
    return this.accounts.filter((a) => a.tenantId === t).length;
  }
  async findAllAccounts(t: string) {
    return this.accounts.filter((a) => a.tenantId === t);
  }
  async insertMissingAccounts(t: string, data: Partial<ChartOfAccountEntity>[]) {
    const have = new Set(this.accounts.filter((a) => a.tenantId === t).map((a) => a.code));
    for (const d of data.filter((x) => !have.has(x.code as string))) {
      this.accounts.push({ ...d, id: ++this.seq, tenantId: t, balance: '0.00' } as ChartOfAccountEntity);
    }
  }
  async findAccountsByCodes(t: string, codes: string[]) {
    return this.accounts.filter((a) => a.tenantId === t && codes.includes(a.code));
  }
  async findEntryByNumber(t: string, n: string) {
    return this.entries.find((e) => e.tenantId === t && e.entryNumber === n) ?? null;
  }
  async transaction<T>(_t: string, work: (m: unknown) => Promise<T>) {
    return work({});
  }
  async persistJournalEntry(t: string, header: Record<string, unknown>, inputs: JournalLineInput[]) {
    const entry = { id: ++this.seq, tenantId: t, ...header, lines: [] } as unknown as JournalEntryEntity;
    for (const i of inputs) {
      (entry.lines as unknown as Array<Record<string, unknown>>).push({
        accountId: i.accountId,
        debit: minorToDecimal(i.debitMinor),
        credit: minorToDecimal(i.creditMinor),
      });
    }
    this.entries.push(entry);
    return entry;
  }
}

const amountArb = fc.bigInt({ min: 1n, max: 10n ** 12n });
const sideArb = fc.record({ debitSide: fc.boolean(), amount: amountArb, account: fc.constantFrom('1010', '1020', '4010', '4020') });

describe('the service posts only vouchers that balance to the minor unit', () => {
  const lineOf = (s: { debitSide: boolean; amount: bigint; account: string }) =>
    s.debitSide ? { accountCode: s.account, debit: minorToDecimal(s.amount) } : { accountCode: s.account, credit: minorToDecimal(s.amount) };

  it('any generated voucher closed to zero is accepted and stored balanced; off by one minor unit is refused', async () => {
    let n = 0;
    await fc.assert(
      fc.asyncProperty(fc.array(sideArb, { minLength: 1, maxLength: 7 }), fc.boolean(), async (sides, wrongByOne) => {
        const repo = new MemoryRepo();
        const service = new AccountingService(repo as unknown as AccountingRepository, currencyService);
        const diff = sides.reduce((s, l) => s + (l.debitSide ? l.amount : -l.amount), 0n);
        const lines = sides.map(lineOf);
        const closing = diff === 0n ? 0n : diff > 0n ? diff : -diff;
        if (diff > 0n) lines.push({ accountCode: '4010', credit: minorToDecimal(closing + (wrongByOne ? 1n : 0n)) } as never);
        else if (diff < 0n) lines.push({ accountCode: '1010', debit: minorToDecimal(closing + (wrongByOne ? 1n : 0n)) } as never);
        else if (wrongByOne) lines.push({ accountCode: '1010', debit: minorToDecimal(1n) } as never);
        const attempt = service.createJournalEntry('t', { entryNumber: `E-${++n}`, date: '2026-05-01', description: 'p', lines } as never);
        const unbalanced = wrongByOne || false;
        if (unbalanced) {
          await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
          expect(repo.entries).toHaveLength(0);
        } else {
          await expect(attempt).resolves.toBeDefined();
          const stored = repo.entries[0].lines as unknown as Array<{ debit: string; credit: string }>;
          expect(stored.reduce((s, l) => s + fromDb(l.debit), 0n)).toBe(stored.reduce((s, l) => s + fromDb(l.credit), 0n));
        }
      }),
      { numRuns: 200 },
    );
  });
});
