import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { QueryJournalEntryDto } from './dto/query-journal-entry.dto';
import { AccountingRepository } from './repositories/accounting.repository';
import { journalSearchWhere, likeContains, needsSearch } from './repositories/journal-search.sql';
import { AccountingService } from './services/accounting.service';
import { CurrencyService } from '../currency/services/currency.service';

const T = '11111111-1111-4111-8111-111111111111';

describe('journal search SQL', () => {
  it('binds every value and starts with the tenant', () => {
    const { where, params } = journalSearchWhere(T, {
      status: 'POSTED',
      fromDate: '2026-04-01',
      toDate: '2026-04-30',
      accountCode: '1010',
      partyCode: 'C-7',
      minAmount: '5000000',
      maxAmount: '5000000.00',
      text: 'فروش',
    });
    expect(where.startsWith('e.tenant_id = $1')).toBe(true);
    expect(params).toEqual([T, 'POSTED', '2026-04-01', '2026-04-30', '1010', 'C-7', '5000000', '5000000.00', '%فروش%']);
    for (const value of ['1010', 'C-7', '5000000', 'فروش', '2026-04-01']) {
      expect(where).not.toContain(value);
    }
    // $1..$9 each used, the text parameter twice (entry and line description).
    expect(where.match(/\$9\b/g)).toHaveLength(2);
  });

  it('puts all line filters on one line', () => {
    const { where } = journalSearchWhere(T, { accountCode: '1010', minAmount: '1' });
    expect(where.match(/FROM fin_journal_entry_lines l /g)).toHaveLength(1);
    expect(where).toContain('a.code = $2) AND GREATEST(l.debit, l.credit) >= CAST($3 AS numeric))');
  });

  it('has no line subquery when only entry filters are given', () => {
    const { where, params } = journalSearchWhere(T, { fromDate: '2026-04-01' });
    expect(where).toBe('e.tenant_id = $1 AND CAST(e.date AS date) >= CAST($2 AS date)');
    expect(params).toEqual([T, '2026-04-01']);
  });

  it('escapes LIKE wildcards', () => {
    expect(likeContains('50%')).toBe('%50\\%%');
    expect(likeContains('a_b\\c')).toBe('%a\\_b\\\\c%');
  });

  it('only the new filters switch to the search query', () => {
    expect(needsSearch({ status: 'POSTED', entryNumber: 'S-' })).toBe(false);
    expect(needsSearch({ minAmount: '0' })).toBe(true);
    expect(needsSearch({ text: 'x' })).toBe(true);
  });
});

describe('QueryJournalEntryDto search fields', () => {
  const errors = (plain: object) =>
    validateSync(plainToInstance(QueryJournalEntryDto, plain)).map((e) => e.property);

  it('accepts dates and decimal amounts', () => {
    expect(errors({ fromDate: '2026-04-01', toDate: '2026-04-30', minAmount: '5000000', maxAmount: '12.50' })).toEqual([]);
  });

  it('rejects bad dates, signs, grouping and more than 2 decimals', () => {
    expect(errors({ fromDate: '1405/01/12' })).toEqual(['fromDate']);
    expect(errors({ minAmount: '-1' })).toEqual(['minAmount']);
    expect(errors({ minAmount: '5,000,000' })).toEqual(['minAmount']);
    expect(errors({ maxAmount: '1.005' })).toEqual(['maxAmount']);
    expect(errors({ text: 'x'.repeat(201) })).toEqual(['text']);
  });

  it('rejects impossible calendar dates with a Persian message (#127)', () => {
    for (const bad of ['2026-13-45', '2026-02-30', '2026-04-31', '2026-00-10', '2026-01-00', '2025-02-29', '0000-01-01']) {
      expect(errors({ fromDate: bad })).toEqual(['fromDate']);
      expect(errors({ toDate: bad })).toEqual(['toDate']);
    }
    const [error] = validateSync(plainToInstance(QueryJournalEntryDto, { toDate: '2026-02-30' }));
    expect(Object.values(error.constraints ?? {})).toEqual(['«تا تاریخ» باید یک روز واقعی به شکل YYYY-MM-DD باشد.']);
  });

  it('accepts real edge days: leap day, month ends, year ends', () => {
    expect(errors({ fromDate: '2024-02-29', toDate: '2026-12-31' })).toEqual([]);
    expect(errors({ fromDate: '2000-02-29', toDate: '2026-04-30' })).toEqual([]);
    expect(errors({ fromDate: '1900-02-29' })).toEqual(['fromDate']);
  });
});

describe('AccountingService.findAllJournalEntries search routing', () => {
  const setup = () => {
    const repo = {
      searchEntries: jest.fn().mockResolvedValue([[], 0]),
      findAndCountEntries: jest.fn().mockResolvedValue([[], 0]),
    };
    const service = new AccountingService(repo as unknown as AccountingRepository, {} as CurrencyService);
    return { repo, service };
  };
  const query = (extra: Partial<QueryJournalEntryDto>) => ({ page: 2, limit: 10, ...extra }) as QueryJournalEntryDto;

  it('keeps the old path for status and entry number', async () => {
    const { repo, service } = setup();
    await service.findAllJournalEntries(T, query({ entryNumber: 'S-' }));
    expect(repo.findAndCountEntries).toHaveBeenCalled();
    expect(repo.searchEntries).not.toHaveBeenCalled();
  });

  it('escapes entry number wildcards on the old path like the search path (#128)', async () => {
    const { repo, service } = setup();
    await service.findAllJournalEntries(T, query({ entryNumber: '50%_a' }));
    const [, options] = repo.findAndCountEntries.mock.calls[0];
    expect(options.where.entryNumber.value).toBe(likeContains('50%_a'));
    expect(options.where.entryNumber.value).toBe('%50\\%\\_a%');
  });

  it('uses the search with trimmed values and the page window', async () => {
    const { repo, service } = setup();
    const page = await service.findAllJournalEntries(T, query({ accountCode: ' 1010 ', text: '  ', minAmount: '5' }));
    expect(repo.searchEntries).toHaveBeenCalledWith(
      T,
      expect.objectContaining({ accountCode: '1010', text: undefined, minAmount: '5' }),
      { skip: 10, take: 10 },
    );
    expect(page).toEqual({ data: [], total: 0, page: 2, limit: 10 });
  });

  it('refuses reversed ranges, comparing amounts exactly', async () => {
    const { repo, service } = setup();
    await expect(service.findAllJournalEntries(T, query({ fromDate: '2026-05-01', toDate: '2026-04-30' }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.findAllJournalEntries(T, query({ minAmount: '90000000000000.01', maxAmount: '90000000000000.00' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    await service.findAllJournalEntries(T, query({ minAmount: '90000000000000.00', maxAmount: '90000000000000.01' }));
    expect(repo.searchEntries).toHaveBeenCalledTimes(1);
  });
});
