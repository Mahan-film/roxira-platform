import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { CurrencyService } from '../currency/services/currency.service';
import { JournalEntryStatus, JournalEntryType } from './enums/accounting.enum';
import { AccountingRepository } from './repositories/accounting.repository';
import { FiscalYearRepository } from './repositories/fiscal-year.repository';
import { FixedAssetRepository } from './repositories/fixed-asset.repository';
import { LedgerReportRepository } from './repositories/ledger-report.repository';
import { PettyCashRepository } from './repositories/petty-cash.repository';
import { AccountingService } from './services/accounting.service';
import { ChartTemplateService } from './services/chart-template.service';
import { FiscalYearService } from './services/fiscal-year.service';
import { FixedAssetService } from './services/fixed-asset.service';
import { PettyCashService } from './services/petty-cash.service';
import { PostingRulesRepository } from '../posting_rules/repositories/posting-rules.repository';
import { PostingRulesService } from '../posting_rules/services/posting-rules.service';
import {
  createTestDatabase,
  describePg,
  TestDatabaseContext,
  TEST_T1 as T1,
} from '../../test/support/test-pg';

describePg('Closed fiscal year is read-only on PostgreSQL', () => {
  let testDb: TestDatabaseContext;
  let accounting: AccountingService;
  let years: FiscalYearService;
  let petty: PettyCashService;
  let assets: FixedAssetService;

  const midDay = (day: string) => `${day}T12:00:00.000Z`;
  const pair = (entryNumber: string, date: string, amount: string, a = '1010', b = '4010') => ({
    entryNumber,
    date,
    description: 'test',
    lines: [
      { accountCode: a, debit: amount },
      { accountCode: b, credit: amount },
    ],
  });
  const balance = async (code: string): Promise<string> =>
    (
      await testDb.rawQuery(`SELECT balance FROM fin_chart_of_accounts WHERE tenant_id = $1 AND code = $2`, [T1, code])
    )[0]?.balance;

  let y1Id = 0;
  let lockId = 0;
  let draftId = 0;
  let reversalSourceId = 0;
  let closingEntryId = 0;
  let fundId = 0;
  let cashAfterClose = 0;

  beforeAll(async () => {
    testDb = await createTestDatabase('cf');
    const currency = { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService;
    const repo = new AccountingRepository(testDb.scope);
    accounting = new AccountingService(repo, currency);
    years = new FiscalYearService(repo, new FiscalYearRepository(testDb.app), new LedgerReportRepository(testDb.scope), accounting);
    const engine = new PostingRulesService(new PostingRulesRepository(testDb.scope), accounting);
    petty = new PettyCashService(new PettyCashRepository(testDb.app), repo, accounting, engine);
    assets = new FixedAssetService(new FixedAssetRepository(testDb.app), repo, engine, { get: async () => 'refuse' } as never);
    await new ChartTemplateService(repo).apply(T1, 'iran-trading');
  }, 120000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('closes Jalali 1405, carries the balances into 1406 and locks every day of the year', async () => {
    await accounting.createJournalEntry(T1, pair('SEED', midDay('2026-04-01'), '1000.00', '1010', '3010') as never);
    await accounting.createJournalEntry(T1, pair('IN-1', midDay('2026-05-01'), '100.00') as never);
    reversalSourceId = (
      await accounting.createJournalEntry(T1, pair('IN-2', midDay('2026-06-15'), '50.00') as never)
    ).id;
    draftId = (
      await accounting.createJournalEntry(T1, {
        ...pair('DRAFT-IN', midDay('2026-08-10'), '10.00'),
        status: JournalEntryStatus.DRAFT,
      } as never)
    ).id;
    fundId = (
      await petty.createFund(T1, { name: 'تنخواه سال بسته', custodianName: 'مسئول', imprestAmount: '500000' })
    ).id;
    await assets.create(T1, 'u', {
      category: 'FURNITURE',
      assetAccountCode: '1113',
      accumulatedAccountCode: '1120',
      expenseAccountCode: '5060',
      code: 'FA-CLOSED',
      name: 'FA-CLOSED',
      acquisitionDate: '2026-04-10',
      cost: '1200.00',
      method: 'STRAIGHT_LINE',
      lifeMonths: 12,
    } as never);

    const y1 = await years.create(T1, { name: '1405', startDate: '2026-03-21', endDate: '2027-03-20' });
    const result = await years.close(T1, 'u', y1.id, {
      nextYear: { name: '1406', startDate: '2027-03-21', endDate: '2028-03-19' },
    });
    expect(result.year.status).toBe('CLOSED');
    expect(result.entryNumbers).toHaveLength(4);
    y1Id = y1.id;
    closingEntryId = (await accounting.findJournalEntryByNumber(T1, `FC-${y1.id}-1-3`))!.id;

    const active = (await accounting.listPeriodLocks(T1)).find((l) => l.active);
    expect(active).toBeDefined();
    lockId = active!.id;

    cashAfterClose = Number(await balance('1010'));
    expect(cashAfterClose).toBe(1150);
  }, 60000);

  it('refuses every posting dated inside the closed year with 423 and the Persian message', async () => {
    await expect(
      accounting.createJournalEntry(T1, pair('LATE-1', midDay('2026-07-01'), '1.00') as never),
    ).rejects.toMatchObject({ status: 423, message: expect.stringMatching(/قفل.*2026-07-01/) });
    // A draft never touches balances, but its date is still inside the closed year: refused too.
    await expect(
      accounting.createJournalEntry(T1, {
        ...pair('LATE-DRAFT', midDay('2026-09-01'), '1.00'),
        status: JournalEntryStatus.DRAFT,
      } as never),
    ).rejects.toMatchObject({ status: 423, message: expect.stringMatching(/قفل|بسته/) });
    await testDb.app.transaction(async (manager) => {
      await expect(
        accounting.postTypedEntry(
          T1,
          pair('LATE-TYPED', midDay('2026-10-01'), '1.00') as never,
          JournalEntryType.NORMAL,
          manager,
        ),
      ).rejects.toMatchObject({ status: 423 });
    });
    expect(
      await testDb.rawQuery(`SELECT count(*)::int AS n FROM fin_journal_entries WHERE tenant_id = $1 AND entry_number LIKE 'LATE-%'`, [T1]),
    ).toEqual([{ n: 0 }]);
  });

  it('refuses petty cash and depreciation postings dated inside the closed year', async () => {
    await expect(
      petty.charge(T1, 'u', fundId, { date: '2026-05-02', accountCode: '1012', amount: '10000' } as never),
    ).rejects.toMatchObject({ status: 423, message: expect.stringMatching(/قفل|بسته/) });
    await expect(assets.runMonth(T1, { year: 1405, month: 1 })).rejects.toMatchObject({
      status: 423,
      message: expect.stringMatching(/قفل|بسته/),
    });
    expect(
      (await testDb.rawQuery(`SELECT months_depreciated FROM fin_fixed_assets WHERE tenant_id = $1 AND code = 'FA-CLOSED'`, [T1]))[0],
    ).toMatchObject({ months_depreciated: 0 });
  }, 60000);

  it('refuses to edit, finalise, move or delete a voucher that sits in the closed year', async () => {
    const edit = {
      entryNumber: 'DRAFT-IN',
      description: 'x',
      lines: [
        { accountCode: '1010', debit: '10.00' },
        { accountCode: '4010', credit: '10.00' },
      ],
    };
    await expect(accounting.updateVoucher(T1, draftId, edit as never)).rejects.toMatchObject({
      status: 423,
      message: expect.stringMatching(/2026-08-10/),
    });
    // Moving it out of the closed year is refused too: the CURRENT date is locked.
    await expect(
      accounting.updateVoucher(T1, draftId, { ...edit, date: midDay('2027-05-01') } as never),
    ).rejects.toMatchObject({ status: 423, message: expect.stringMatching(/2026-08-10/) });
    await expect(accounting.changeVoucherStatus(T1, draftId, JournalEntryStatus.POSTED)).rejects.toMatchObject({
      status: 423,
    });
    await expect(accounting.deleteVoucher(T1, draftId)).rejects.toMatchObject({
      status: 423,
      message: expect.stringMatching(/قفل|بسته/),
    });

    // And a voucher of the open next year cannot be moved INTO the closed year.
    const next = await accounting.createJournalEntry(T1, {
      ...pair('NEXT-1', midDay('2027-04-01'), '5.00'),
      status: JournalEntryStatus.DRAFT,
    } as never);
    await expect(
      accounting.updateVoucher(T1, next.id, { ...edit, entryNumber: 'NEXT-1', date: midDay('2026-07-01') } as never),
    ).rejects.toMatchObject({ status: 423, message: expect.stringMatching(/2026-07-01/) });
    const untouched = (await testDb.rawQuery(`SELECT date FROM fin_journal_entries WHERE id = $1`, [next.id]))[0];
    expect(new Date(untouched.date).toISOString()).toContain('2027-04-01');
  });

  it('refuses a reversal dated inside the closed year and allows one into the open next year', async () => {
    await expect(
      accounting.reverseJournalEntry(T1, reversalSourceId, { date: midDay('2026-07-02') }),
    ).rejects.toMatchObject({ status: 423, message: expect.stringMatching(/2026-07-02/) });

    const reversal = await accounting.reverseJournalEntry(T1, reversalSourceId, {
      date: midDay('2027-04-10'),
      reason: 'correction',
    });
    expect(reversal.entryNumber).toBe('IN-2-REV');
    // The original and its reversal net to zero on every account they touch.
    const nets: Array<{ code: string; net: string }> = await testDb.rawQuery(
      `SELECT a.code, SUM(l.debit - l.credit) AS net
         FROM fin_journal_entry_lines l
         JOIN fin_journal_entries e ON e.id = l.journal_entry_id
         JOIN fin_chart_of_accounts a ON a.id = l.account_id
        WHERE e.tenant_id = $1 AND e.entry_number IN ('IN-2', 'IN-2-REV')
        GROUP BY a.code`,
      [T1],
    );
    expect(nets.map((row) => row.code).sort()).toEqual(['1010', '4010']);
    for (const row of nets) {
      expect(Number(row.net)).toBe(0);
    }
    expect(Number(await balance('1010'))).toBe(cashAfterClose - 50);

    // Reversing a closing entry through the normal endpoint stays refused (400).
    await expect(accounting.reverseJournalEntry(T1, closingEntryId)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses the plain unlock of the year lock and makes everything writable again after reopen', async () => {
    await expect(accounting.unlockPeriod(T1, 'u', lockId, { reason: 'quick fix' })).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/ابتدا سال مالی را بازگشایی کنید/),
    });
    await expect(
      accounting.createJournalEntry(T1, pair('STILL-LOCKED', midDay('2026-07-03'), '1.00') as never),
    ).rejects.toMatchObject({ status: 423 });

    const reopened = await years.reopen(T1, 'u', y1Id, { reason: 'audit adjustment' });
    expect(reopened.status).toBe('OPEN');
    expect((await accounting.listPeriodLocks(T1)).every((l) => !l.active)).toBe(true);

    const posted = await accounting.createJournalEntry(T1, pair('AFTER-REOPEN', midDay('2026-05-20'), '7.00') as never);
    expect(posted.status).toBe('POSTED');
    const edited = await accounting.updateVoucher(T1, draftId, {
      entryNumber: 'DRAFT-IN',
      description: 'fixed',
      lines: [
        { accountCode: '1010', debit: '10.00' },
        { accountCode: '4010', credit: '10.00' },
      ],
    } as never);
    expect(edited.status).toBe('DRAFT');
    const final = await accounting.changeVoucherStatus(T1, draftId, JournalEntryStatus.POSTED);
    expect(final.status).toBe('POSTED');
    expect(Number(await balance('1010'))).toBe(cashAfterClose - 50 + 7 + 10);
    const disposable = await accounting.createJournalEntry(T1, {
      ...pair('AFTER-REOPEN-DRAFT', midDay('2026-06-01'), '3.00'),
      status: JournalEntryStatus.DRAFT,
    } as never);
    await expect(accounting.deleteVoucher(T1, disposable.id)).resolves.toBeUndefined();
  }, 60000);
});
