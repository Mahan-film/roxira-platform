/**
 * Journal entry search (GET journal-entries with amount, date, account, party and text filters)
 * on a REAL PostgreSQL. Opt-in like the other pg specs: skipped unless ROXIRA_TEST_PG_HOST is set;
 * each run creates and drops its own database.
 */
import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { CurrencyService } from '../currency/services/currency.service';
import { QueryJournalEntryDto } from './dto/query-journal-entry.dto';
import { AccountingRepository } from './repositories/accounting.repository';
import { AccountingService } from './services/accounting.service';
import {
  createTestDatabase,
  describePg,
  TestDatabaseContext,
  TEST_T1 as T1,
  TEST_T2 as T2,
} from '../../test/support/test-pg';

describePg('Journal entry search on PostgreSQL', () => {
  let testDb: TestDatabaseContext;
  let accounting: AccountingService;

  const entry = (
    tenant: string,
    entryNumber: string,
    date: string,
    amount: string,
    description: string,
    extra: { partyCode?: string; lineDescription?: string } = {},
  ) =>
    accounting.createJournalEntry(tenant, {
      entryNumber,
      date,
      description,
      lines: [
        { accountCode: '1010', debit: amount, partyCode: extra.partyCode, description: extra.lineDescription },
        { accountCode: '4010', credit: amount },
      ],
    } as never);
  const search = async (tenant: string, filter: Partial<QueryJournalEntryDto>) =>
    accounting.findAllJournalEntries(tenant, { page: 1, limit: 20, ...filter } as QueryJournalEntryDto);
  const numbers = async (tenant: string, filter: Partial<QueryJournalEntryDto>) =>
    (await search(tenant, filter)).data.map((e) => e.entryNumber);

  beforeAll(async () => {
    testDb = await createTestDatabase('js');
    const currency = { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService;
    accounting = new AccountingService(new AccountingRepository(testDb.scope), currency);
    await entry(T1, 'S-1', '2026-04-01', '5000000.00', 'فروش نقدی', { partyCode: 'C-7' });
    await entry(T1, 'S-2', '2026-04-15', '120000.50', 'تخفیف 50% مشتری');
    await entry(T1, 'S-3', '2026-05-02', '5000000.00', 'خرید', { lineDescription: 'بابت فاکتور ۱۲۳' });
    await entry(T2, 'S-1', '2026-04-01', '5000000.00', 'فروش نقدی', { partyCode: 'C-7' });
  }, 120000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('finds entries by line amount, newest first, with an exact total', async () => {
    const page = await search(T1, { minAmount: '5000000', maxAmount: '5000000' });
    expect(page.data.map((e) => e.entryNumber)).toEqual(['S-3', 'S-1']);
    expect(page.total).toBe(2);
    expect(page.data[0].lines).toHaveLength(2);
    expect(await numbers(T1, { minAmount: '120000.50', maxAmount: '120000.50' })).toEqual(['S-2']);
    expect(await numbers(T1, { minAmount: '120000.51', maxAmount: '4999999.99' })).toEqual([]);
  });

  it('filters by inclusive calendar days', async () => {
    expect(await numbers(T1, { fromDate: '2026-04-01', toDate: '2026-04-15' })).toEqual(['S-2', 'S-1']);
    expect(await numbers(T1, { fromDate: '2026-04-16' })).toEqual(['S-3']);
  });

  it('matches account, party and amount on the same line', async () => {
    expect(await numbers(T1, { accountCode: '1010', partyCode: 'C-7' })).toEqual(['S-1']);
    expect(await numbers(T1, { accountCode: '4010', partyCode: 'C-7' })).toEqual([]);
    expect(await numbers(T1, { accountCode: '4010', minAmount: '1000000' })).toEqual(['S-3', 'S-1']);
  });

  it('searches entry and line descriptions, with % taken literally', async () => {
    expect(await numbers(T1, { text: '50%' })).toEqual(['S-2']);
    expect(await numbers(T1, { text: '%' })).toEqual(['S-2']);
    expect(await numbers(T1, { text: 'فاکتور ۱۲۳' })).toEqual(['S-3']);
  });

  it('takes % and _ in the entry number literally on both paths (#128)', async () => {
    // Old path (entry number alone) and search path (with another filter) must agree.
    expect(await numbers(T1, { entryNumber: '%' })).toEqual([]);
    expect(await numbers(T1, { entryNumber: '%', text: 'ف' })).toEqual([]);
    expect(await numbers(T1, { entryNumber: '_' })).toEqual([]);
    expect(await numbers(T1, { entryNumber: 's-' })).toEqual(['S-3', 'S-2', 'S-1']);
    expect(await numbers(T1, { entryNumber: 'S-2', fromDate: '2026-01-01' })).toEqual(['S-2']);
  });

  it('pages the results and never returns another tenant', async () => {
    const first = await search(T1, { fromDate: '2026-01-01', limit: 2 });
    const second = await search(T1, { fromDate: '2026-01-01', limit: 2, page: 2 });
    expect(first.total).toBe(3);
    expect([...first.data, ...second.data].map((e) => e.entryNumber)).toEqual(['S-3', 'S-2', 'S-1']);
    expect(await numbers(T2, { fromDate: '2026-01-01' })).toEqual(['S-1']);
  });

  it('refuses reversed ranges', async () => {
    await expect(search(T1, { fromDate: '2026-05-01', toDate: '2026-04-01' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(search(T1, { minAmount: '10', maxAmount: '9.99' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
