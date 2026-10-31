import 'reflect-metadata';
import { CurrencyService } from '../currency/services/currency.service';
import { ChartOfAccountEntity } from './entities/chart-of-account.entity';
import { AccountType } from './enums/accounting.enum';
import {
  AccountingRepository,
  TrialBalanceRawRow,
} from './repositories/accounting.repository';
import { AccountingService } from './services/accounting.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
const ACCOUNTS = 42;
const ENTRIES = 20_000; // two lines each = 40,000 lines

const currencyService = {
  convert: jest.fn((value: number) => value),
  round: jest.fn((value: number) => value),
} as unknown as CurrencyService;

/**
 * Production-sized ledger (20,000 entries, 40,000 lines, 42 accounts). The database
 * aggregates the lines per account, so the service sees 42 raw rows: the test checks
 * that every account is reported and that totals over a very large ledger stay exact.
 */
function buildLargeLedger() {
  const debit = new Array<number>(ACCOUNTS).fill(0);
  const credit = new Array<number>(ACCOUNTS).fill(0);
  for (let i = 0; i < ENTRIES; i += 1) {
    const amount = 1_000_000 + ((i * 7919) % 99_991_000);
    debit[i % ACCOUNTS] += amount;
    credit[(i * 5 + 1) % ACCOUNTS] += amount;
  }
  const accounts = Array.from({ length: ACCOUNTS }, (_, index) => ({
    id: index + 1,
    tenantId: TENANT,
    code: String(1000 + index),
    name: `حساب ${index + 1}`,
    accountType: AccountType.ASSET,
    currency: 'IRR',
    balance: 0,
  })) as unknown as ChartOfAccountEntity[];
  const raw: TrialBalanceRawRow[] = accounts.map((account, index) => ({
    code: account.code,
    name: account.name,
    accountType: account.accountType,
    totalDebit: String(debit[index]),
    totalCredit: String(credit[index]),
  })) as TrialBalanceRawRow[];
  return { accounts, raw, debit, credit };
}

describe('AccountingService.getTrialBalance — large ledger', () => {
  it('reports all 42 accounts with exact, balanced totals for 40,000 lines', async () => {
    const { accounts, raw, debit, credit } = buildLargeLedger();
    const repository = {
      countAccounts: jest.fn(async () => accounts.length),
      findAllAccounts: jest.fn(async () => accounts),
      getTrialBalance: jest.fn(async () => raw),
    } as unknown as AccountingRepository;
    const service = new AccountingService(repository, currencyService);

    const result = await service.getTrialBalance(TENANT);

    expect(result.rows).toHaveLength(ACCOUNTS);
    const expectedDebit = debit.reduce((a, b) => a + b, 0);
    const expectedCredit = credit.reduce((a, b) => a + b, 0);
    expect(expectedDebit).toBe(expectedCredit);
    expect(result.totalDebit).toBe(expectedDebit);
    expect(result.totalCredit).toBe(expectedCredit);
    expect(result.totalDebit).toBeGreaterThan(0);
    expect(result.balanced).toBe(true);
    expect(repository.getTrialBalance).toHaveBeenCalledWith(TENANT, undefined);
  });

  it('an account without postings is listed with zero totals', async () => {
    const { accounts, raw } = buildLargeLedger();
    const repository = {
      countAccounts: jest.fn(async () => accounts.length),
      findAllAccounts: jest.fn(async () => accounts),
      getTrialBalance: jest.fn(async () => raw.slice(1)),
    } as unknown as AccountingRepository;
    const service = new AccountingService(repository, currencyService);

    const result = await service.getTrialBalance(TENANT);

    expect(result.rows).toHaveLength(ACCOUNTS);
    expect(result.rows[0]).toMatchObject({ totalDebit: 0, totalCredit: 0, balance: 0 });
  });

  it('an empty ledger is balanced with zero totals', async () => {
    const { accounts } = buildLargeLedger();
    const repository = {
      countAccounts: jest.fn(async () => accounts.length),
      findAllAccounts: jest.fn(async () => accounts),
      getTrialBalance: jest.fn(async () => []),
    } as unknown as AccountingRepository;
    const service = new AccountingService(repository, currencyService);

    const result = await service.getTrialBalance(TENANT);

    expect(result.totalDebit).toBe(0);
    expect(result.totalCredit).toBe(0);
    expect(result.balanced).toBe(true);
  });
});
