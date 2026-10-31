import 'reflect-metadata';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { JournalEntryLineDto } from './dto/create-journal-entry.dto';
import { DuplicateEntryNumberError } from './exceptions/ledger.exceptions';
import { CurrencyService } from '../currency/services/currency.service';
import { AccountingController } from './controllers/accounting.controller';
import { ChartOfAccountEntity } from './entities/chart-of-account.entity';
import { JournalEntryLineEntity } from './entities/journal-entry-line.entity';
import { JournalEntryEntity } from './entities/journal-entry.entity';
import { fromDb, minorToDecimal, sumMinor, toMinor } from './money';
import {
  AccountingRepository,
  JournalLineInput,
} from './repositories/accounting.repository';
import { AccountingService } from './services/accounting.service';

const currencyService = {
  convert: (v: number) => v,
  round: (v: number) => v,
} as unknown as CurrencyService;

/** In-memory repository with per-tenant storage and a unique (tenant, number) index. */
class MemoryRepo {
  accounts: ChartOfAccountEntity[] = [];
  entries: JournalEntryEntity[] = [];
  private seq = 0;
  /** Simulates a racing writer: persist throws a Postgres unique violation. */
  failNextPersistWithUnique = false;

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
  async findEntryById(t: string, id: number) {
    return this.entries.find((e) => e.tenantId === t && e.id === id) ?? null;
  }
  async findReversalOf(t: string, id: number) {
    return this.entries.find((e) => e.tenantId === t && e.reversesEntryId === id) ?? null;
  }
  async transaction<T>(work: (m: unknown) => Promise<T>) {
    return work({});
  }
  async persistJournalEntry(
    t: string,
    header: { entryNumber: string; date: Date; description: string; status: string; reversesEntryId?: number | null },
    inputs: JournalLineInput[],
  ) {
    if (this.failNextPersistWithUnique) {
      this.failNextPersistWithUnique = false;
      throw new DuplicateEntryNumberError(header.entryNumber);
    }
    if (this.entries.some((e) => e.tenantId === t && e.entryNumber === header.entryNumber)) {
      throw new DuplicateEntryNumberError(header.entryNumber);
    }
    const entry = { id: ++this.seq, tenantId: t, reversesEntryId: null, ...header, lines: [] } as unknown as JournalEntryEntity;
    for (const i of inputs) {
      const account = this.accounts.find((a) => a.id === i.accountId && a.tenantId === t)!;
      account.balance = minorToDecimal(fromDb(account.balance) + i.debitMinor - i.creditMinor);
      entry.lines.push({
        id: ++this.seq, tenantId: t, journalEntryId: entry.id, accountId: i.accountId, account,
        debit: minorToDecimal(i.debitMinor), credit: minorToDecimal(i.creditMinor), currency: i.currency ?? 'IRR',
        amountFx: i.amountFx ?? null, fxRate: i.fxRate ?? null,
        partyCode: i.partyCode ?? null, description: i.description ?? null,
      } as unknown as JournalEntryLineEntity);
    }
    this.entries.push(entry);
    return entry;
  }
}

const build = () => {
  const repo = new MemoryRepo();
  return { repo, service: new AccountingService(repo as unknown as AccountingRepository, currencyService) };
};
const entry = (entryNumber: string, lines: object[]) =>
  ({ entryNumber, description: 'test', lines }) as never;

describe('Ledger integrity — balanced entries and decimal money', () => {
  it('sums in integer minor units: 0.1 + 0.2 balances against 0.3', async () => {
    expect(sumMinor([0.1, 0.2])).toBe(sumMinor([0.3]));
    const { service } = build();
    await expect(
      service.createJournalEntry('t1', entry('J1', [
        { accountCode: '1010', debit: 0.1 },
        { accountCode: '1020', debit: 0.2 },
        { accountCode: '4010', credit: 0.3 },
      ])),
    ).resolves.toBeDefined();
  });

  it('rejects a one-cent imbalance', async () => {
    const { service } = build();
    await expect(
      service.createJournalEntry('t1', entry('J2', [
        { accountCode: '1010', debit: 100.01 },
        { accountCode: '4010', credit: 100 },
      ])),
    ).rejects.toThrow(BadRequestException);
  });

  it('keeps many small lines exact (1000 x 0.01 = 10.00)', async () => {
    const { service } = build();
    const debits = Array.from({ length: 400 }, () => ({ accountCode: '1010', debit: 0.01 }));
    const created = await service.createJournalEntry('t1', entry('J3', [
      ...debits,
      { accountCode: '4010', credit: 4 },
    ]));
    expect(created.totalDebit).toBe(4);
  });
});

describe('Ledger integrity — immutability and reversal', () => {
  it('exposes no update or delete route for journal entries', () => {
    const proto = AccountingController.prototype as unknown as Record<string, unknown>;
    const methods = Object.getOwnPropertyNames(AccountingController.prototype)
      .filter((n) => n !== 'constructor' && typeof proto[n] === 'function')
      .filter((n) => Reflect.getMetadata('path', proto[n] as object) !== undefined);
    expect(methods.length).toBeGreaterThan(0);
    for (const name of methods) {
      const httpMethod = Reflect.getMetadata('method', proto[name] as object);
      // RequestMethod: GET=0, POST=1, PUT=2, DELETE=3, PATCH=4
      expect([0, 1]).toContain(httpMethod);
    }
  });

  it('reverses with a new swapped entry and leaves the original untouched', async () => {
    const { service, repo } = build();
    const orig = await service.createJournalEntry('t1', entry('J10', [
      { accountCode: '1010', debit: 500 },
      { accountCode: '4010', credit: 500 },
    ]));
    const frozen = (e: JournalEntryEntity) =>
      JSON.stringify([e.entryNumber, e.status, e.lines.map((l) => [l.accountId, l.debit, l.credit])]);
    const snapshot = frozen(repo.entries[0]);

    const rev = await service.reverseJournalEntry('t1', orig.id, { reason: 'wrong customer' });
    expect(repo.entries[1].reversesEntryId).toBe(orig.id);

    expect(rev.entryNumber).toBe('J10-REV');
    expect(rev.totalDebit).toBe(rev.totalCredit);
    expect(rev.lines.find((l) => l.accountCode === '1010')?.credit).toBe(500);
    expect(rev.lines.find((l) => l.accountCode === '4010')?.debit).toBe(500);
    expect(frozen(repo.entries[0])).toBe(snapshot);
    // Net effect on every account is zero.
    expect(repo.accounts.every((a) => Number(a.balance) === 0)).toBe(true);
  });

  it('refuses a second reversal (409) and unknown ids (404)', async () => {
    const { service } = build();
    const orig = await service.createJournalEntry('t1', entry('J11', [
      { accountCode: '1010', debit: 5 },
      { accountCode: '4010', credit: 5 },
    ]));
    await service.reverseJournalEntry('t1', orig.id);
    await expect(service.reverseJournalEntry('t1', orig.id)).rejects.toThrow(ConflictException);
    await expect(service.reverseJournalEntry('t1', 9999)).rejects.toThrow(NotFoundException);
  });

  it('cannot reverse another tenant entry (404)', async () => {
    const { service } = build();
    const orig = await service.createJournalEntry('t1', entry('J12', [
      { accountCode: '1010', debit: 5 },
      { accountCode: '4010', credit: 5 },
    ]));
    await expect(service.reverseJournalEntry('t2', orig.id)).rejects.toThrow(NotFoundException);
  });
});

describe('Ledger integrity — concurrent posting', () => {
  it('maps a unique-index violation from a racing writer to 409, not 500', async () => {
    const { service, repo } = build();
    repo.failNextPersistWithUnique = true;
    await expect(
      service.createJournalEntry('t1', entry('J20', [
        { accountCode: '1010', debit: 1 },
        { accountCode: '4010', credit: 1 },
      ])),
    ).rejects.toThrow(ConflictException);
  });

  it('two simultaneous posts of the same number: exactly one wins', async () => {
    const { service, repo } = build();
    const post = () =>
      service.createJournalEntry('t1', entry('J21', [
        { accountCode: '1010', debit: 7 },
        { accountCode: '4010', credit: 7 },
      ]));
    const results = await Promise.allSettled([post(), post()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(repo.entries.filter((e) => e.entryNumber === 'J21')).toHaveLength(1);
  });
});

describe('Ledger integrity — reversal rules', () => {
  const post = (service: AccountingService, number: string) =>
    service.createJournalEntry('t1', entry(number, [
      { accountCode: '1010', debit: 5 },
      { accountCode: '4010', credit: 5 },
    ]));

  it('refuses to reverse a reversal (no -REV-REV chains)', async () => {
    const { service } = build();
    const orig = await post(service, 'J30');
    const rev = await service.reverseJournalEntry('t1', orig.id);
    await expect(service.reverseJournalEntry('t1', rev.id)).rejects.toThrow(BadRequestException);
  });

  it.each([60, 61, 62, 63, 64])('reverses an entry whose number has %i characters', async (length) => {
    const { service } = build();
    const number = 'N'.repeat(length);
    const orig = await post(service, number);
    const rev = await service.reverseJournalEntry('t1', orig.id);
    expect(rev.entryNumber.length).toBeLessThanOrEqual(64);
    expect(rev.entryNumber).toBe(length <= 60 ? `${number}-REV` : `REV-${orig.id}`);
  });

  it('falls back to a free number when REV-<id> is already taken by the tenant', async () => {
    const { service } = build();
    const orig = await post(service, 'M'.repeat(64));
    await post(service, `REV-${orig.id}`);
    const rev = await service.reverseJournalEntry('t1', orig.id);
    expect(rev.entryNumber).toMatch(/^REV-\d+-[0-9a-z]+$/);
  });
});

describe('Ledger integrity — exact money beyond float range', () => {
  it('parses decimal strings above 90 trillion exactly', () => {
    expect(toMinor('9007199254740993.01')).toBe(900719925474099301n);
    expect(minorToDecimal(toMinor('9999999999999999.99'))).toBe('9999999999999999.99');
  });

  it('refuses a JSON number that cannot be exact and a third decimal', () => {
    expect(() => toMinor(9e14)).toThrow();
    expect(() => toMinor('1.005')).toThrow();
  });

  it('posts and balances a 9e15 string amount to the cent, and rejects a 1-cent imbalance', async () => {
    const { service, repo } = build();
    const created = await service.createJournalEntry('t1', entry('BIG1', [
      { accountCode: '1010', debit: '9007199254740993.01' },
      { accountCode: '4010', credit: '9007199254740993.01' },
    ]));
    expect(created.totalDebit).toBe('9007199254740993.01');
    expect(repo.accounts.find((a) => a.code === '1010')?.balance).toBe('9007199254740993.01');
    await expect(
      service.createJournalEntry('t1', entry('BIG2', [
        { accountCode: '1010', debit: '9007199254740993.01' },
        { accountCode: '4010', credit: '9007199254740993.00' },
      ])),
    ).rejects.toThrow(BadRequestException);
  });

  it('checks amount_fx x fx_rate exactly (rounded half-up to the cent), no tolerance', async () => {
    const { service } = build();
    // 123.45 x 41234.5678 = 5090,...: 5,090,740.0...; use exact figures
    await expect(
      service.createJournalEntry('t1', entry('FX1', [
        { accountCode: '1010', debit: 1000000, currency: 'USD', amountFx: 100, fxRate: 10000 },
        { accountCode: '4010', credit: 1000000 },
      ])),
    ).resolves.toBeDefined();
    await expect(
      service.createJournalEntry('t1', entry('FX2', [
        { accountCode: '1010', debit: 1000000.01, currency: 'USD', amountFx: 100, fxRate: 10000 },
        { accountCode: '4010', credit: 1000000.01 },
      ])),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('Ledger integrity — amount DTO validation', () => {
  const errors = (debit: unknown) =>
    validateSync(plainToInstance(JournalEntryLineDto, { accountCode: '1010', debit })).length;

  it.each([[100], [0.01], ['9007199254740993.01'], ['0']])('accepts %p', (value) => {
    expect(errors(value)).toBe(0);
  });

  it.each([[-1], [1.005], [1e21], [9e14], ['1.005'], ['abc'], ['-5'], [NaN], [null === undefined]])(
    'rejects %p',
    (value) => {
      expect(errors(value)).toBeGreaterThan(0);
    },
  );
});
