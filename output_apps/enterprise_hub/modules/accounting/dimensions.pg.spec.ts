import 'reflect-metadata';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { CurrencyService } from '../currency/services/currency.service';
import { DimensionKind, JournalEntryStatus } from './enums/accounting.enum';
import { AccountingRepository } from './repositories/accounting.repository';
import { DimensionRepository } from './repositories/dimension.repository';
import { AccountingService } from './services/accounting.service';
import { DimensionService } from './services/dimension.service';
import {
  createTestDatabase,
  describePg,
  TestDatabaseContext,
  TEST_T1 as T1,
  TEST_T2 as T2,
} from '../../test/support/test-pg';

describePg('Dimensions on PostgreSQL', () => {
  let testDb: TestDatabaseContext;
  let accounting: AccountingService;
  let dims: DimensionService;
  const range = { from: '2026-04-01', to: '2026-06-30' };

  const post = (tenant: string, entryNumber: string, tags: object, status = JournalEntryStatus.POSTED) =>
    accounting.createJournalEntry(tenant, {
      entryNumber,
      date: '2026-05-01',
      description: 't',
      status,
      lines: [
        { accountCode: '5020', debit: '100.00', ...tags },
        { accountCode: '1010', credit: '100.00' },
      ],
    } as never);

  beforeAll(async () => {
    testDb = await createTestDatabase('dim');
    const currency = { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService;
    accounting = new AccountingService(
      new AccountingRepository(testDb.scope),
      currency,
    );
    dims = new DimensionService(new DimensionRepository(testDb.app));
  }, 120000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('creates dimensions per kind and refuses a duplicate code', async () => {
    await dims.create(T1, { kind: DimensionKind.COST_CENTER, code: 'CC-1', name: 'Sales' });
    await dims.create(T1, { kind: DimensionKind.PROJECT, code: 'PR-1', name: 'Tower' });
    await dims.create(T1, { kind: DimensionKind.DETAIL, code: 'D-1', name: 'Ali' });
    await dims.create(T1, { kind: DimensionKind.DETAIL, code: 'CC-1', name: 'same code, other kind' });
    await expect(dims.create(T1, { kind: DimensionKind.PROJECT, code: 'PR-1', name: 'dup' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect((await dims.list(T1, DimensionKind.DETAIL)).map((d) => d.code)).toEqual(['CC-1', 'D-1']);
  });

  it('tags lines and reports balances per dimension from posted entries only', async () => {
    await post(T1, 'A1', { costCenterCode: 'CC-1', projectCode: 'PR-1', detailCode: 'D-1' });
    await post(T1, 'A2', { costCenterCode: 'CC-1' });
    await post(T1, 'A3-DRAFT', { costCenterCode: 'CC-1' }, JournalEntryStatus.DRAFT);
    const cc = await dims.balances(T1, DimensionKind.COST_CENTER, range);
    expect(cc).toEqual([{ code: 'CC-1', name: 'Sales', debit: '200.00', credit: '0.00', balance: '200.00' }]);
    const pr = await dims.balances(T1, DimensionKind.PROJECT, range);
    expect(pr[0]).toMatchObject({ code: 'PR-1', debit: '100.00' });
    expect((await dims.balances(T1, DimensionKind.COST_CENTER, { from: '2027-01-01', to: '2027-02-01' }))[0].debit).toBe(
      '0.00',
    );
  });

  it('refuses unknown codes and another tenant’s dimensions, with nothing written', async () => {
    await expect(post(T1, 'B1', { costCenterCode: 'NOPE' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(post(T2, 'B2', { costCenterCode: 'CC-1' })).rejects.toBeInstanceOf(BadRequestException);
    expect(await accounting.findJournalEntryByNumber(T1, 'B1')).toBeNull();
    expect(await dims.list(T2)).toEqual([]);
  });

  it('keeps tags when a draft is edited and rejects a foreign dimension id at the database', async () => {
    const draft = await accounting.findJournalEntryByNumber(T1, 'A3-DRAFT');
    await accounting.updateVoucher(T1, draft!.id, {
      entryNumber: 'A3-DRAFT',
      description: 'e',
      lines: [
        { accountCode: '5020', debit: '5.00', projectCode: 'PR-1' },
        { accountCode: '1010', credit: '5.00' },
      ],
    } as never);
    const rows = await testDb.rawQuery(`SELECT project_id FROM fin_journal_entry_lines WHERE journal_entry_id = $1 AND debit > 0`, [draft!.id]);
    expect(rows[0].project_id).not.toBeNull();
    await expect(
      testDb.rawQuery(`UPDATE fin_journal_entry_lines SET project_id = (SELECT id FROM fin_dimensions LIMIT 1), tenant_id = $1 WHERE journal_entry_id = $2`, [T2, draft!.id]),
    ).rejects.toThrow();
  });
});
