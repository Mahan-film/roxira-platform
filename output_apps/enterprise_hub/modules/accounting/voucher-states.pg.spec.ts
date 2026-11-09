import { TenantScope } from '../access/services/tenant-scope';
/**
 * Voucher states (DRAFT, TEMPORARY, POSTED) on a REAL PostgreSQL. Opt-in like the other pg specs:
 * skipped unless ROXIRA_TEST_PG_HOST is set; each run creates and drops its own database.
 */
import 'reflect-metadata';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { CurrencyService } from '../currency/services/currency.service';
import { JournalEntryStatus } from './enums/accounting.enum';
import { AccountingRepository } from './repositories/accounting.repository';
import { AccountingService } from './services/accounting.service';
import {
  createTestDatabase,
  describePg,
  TestDatabaseContext,
  TEST_T1 as T1,
  TEST_T2 as T2,
} from '../../test/support/test-pg';

describePg('Voucher states on PostgreSQL', () => {
  let testDb: TestDatabaseContext;
  let accounting: AccountingService;

  const lines = (amount: string, extra = '0.00') => [
    { accountCode: '1010', debit: amount },
    { accountCode: '4010', credit: extra === '0.00' ? amount : extra },
  ];
  const make = (
    tenant: string,
    entryNumber: string,
    status: JournalEntryStatus,
    body = lines('100.00'),
    date = '2026-05-01',
  ) => accounting.createJournalEntry(tenant, { entryNumber, date, description: 't', status, lines: body } as never);
  const balance = async (tenant: string, code: string): Promise<string> =>
    (await testDb.rawQuery(`SELECT balance FROM fin_chart_of_accounts WHERE tenant_id = $1 AND code = $2`, [tenant, code]))[0]
      ?.balance;

  beforeAll(async () => {
    testDb = await createTestDatabase('vs');
    const currency = { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService;
    accounting = new AccountingService(
      new AccountingRepository(testDb.scope),
      currency,
    );
  }, 120000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('keeps an unbalanced draft out of balances, trial balance and ledger', async () => {
    const draft = await make(T1, 'D-1', JournalEntryStatus.DRAFT, lines('100.00', '60.00'));
    expect(draft.status).toBe('DRAFT');
    const tb = await accounting.getTrialBalance(T1);
    expect(tb.rows.every((r) => r.totalDebit === 0 && r.totalCredit === 0)).toBe(true);
    expect(await balance(T1, '1010')).toBe('0.00');
  });

  it('refuses an unbalanced temporary or final voucher', async () => {
    await expect(make(T1, 'T-BAD', JournalEntryStatus.TEMPORARY, lines('100.00', '60.00'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(make(T1, 'P-BAD', JournalEntryStatus.POSTED, lines('100.00', '60.00'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('edits a draft, then refuses to leave DRAFT until it balances', async () => {
    const draft = await accounting.findJournalEntryByNumber(T1, 'D-1');
    await expect(accounting.changeVoucherStatus(T1, draft!.id, JournalEntryStatus.TEMPORARY)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const edited = await accounting.updateVoucher(T1, draft!.id, {
      entryNumber: 'D-1',
      description: 'fixed',
      lines: lines('100.00'),
    } as never);
    expect(edited.status).toBe('DRAFT');
    expect(edited.totalDebit).toBe(100);
    const temp = await accounting.changeVoucherStatus(T1, draft!.id, JournalEntryStatus.TEMPORARY);
    expect(temp.status).toBe('TEMPORARY');
    expect(await balance(T1, '1010')).toBe('0.00');
  });

  it('finalises once: balances move exactly one time and the voucher becomes immutable', async () => {
    const entry = await accounting.findJournalEntryByNumber(T1, 'D-1');
    const settled = await Promise.allSettled([
      accounting.changeVoucherStatus(T1, entry!.id, JournalEntryStatus.POSTED),
      accounting.changeVoucherStatus(T1, entry!.id, JournalEntryStatus.POSTED),
    ]);
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await balance(T1, '1010')).toBe('100.00');
    const tb = await accounting.getTrialBalance(T1);
    expect(tb.rows.find((r) => r.code === '1010')).toMatchObject({ totalDebit: 100, totalCredit: 0 });

    await expect(
      accounting.updateVoucher(T1, entry!.id, { entryNumber: 'D-1', description: 'x', lines: lines('5.00') } as never),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(accounting.deleteVoucher(T1, entry!.id)).rejects.toBeInstanceOf(ConflictException);
    await expect(accounting.changeVoucherStatus(T1, entry!.id, JournalEntryStatus.DRAFT)).rejects.toBeInstanceOf(
      ConflictException,
    );
    // Even raw SQL cannot edit it.
    await expect(testDb.rawQuery(`UPDATE fin_journal_entries SET description = 'x' WHERE id = $1`, [entry!.id])).rejects.toThrow(
      /immutable/,
    );
  });

  it('deletes a draft and a temporary voucher; the entry number is free again', async () => {
    const a = await make(T1, 'D-2', JournalEntryStatus.DRAFT);
    const b = await make(T1, 'T-2', JournalEntryStatus.TEMPORARY);
    await accounting.deleteVoucher(T1, a.id);
    await accounting.deleteVoucher(T1, b.id);
    const again = await make(T1, 'D-2', JournalEntryStatus.DRAFT);
    expect(again.status).toBe('DRAFT');
    expect(await testDb.rawQuery(`SELECT count(*)::int AS n FROM fin_journal_entry_lines WHERE journal_entry_id = $1`, [a.id])).toEqual([
      { n: 0 },
    ]);
  });

  it('refuses to finalise into a locked period and to edit across tenants', async () => {
    const draft = await make(T1, 'D-LOCK', JournalEntryStatus.DRAFT, lines('10.00'), '2026-08-10');
    await accounting.lockPeriod(T1, 'u', { periodStart: '2026-08-01', periodEnd: '2026-08-31' } as never);
    await expect(accounting.changeVoucherStatus(T1, draft.id, JournalEntryStatus.POSTED)).rejects.toMatchObject({
      status: 423,
    });
    await expect(accounting.deleteVoucher(T2, draft.id)).rejects.toMatchObject({ status: 404 });
    await expect(
      accounting.updateVoucher(T2, draft.id, { entryNumber: 'X', description: 'x', lines: lines('1.00') } as never),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects an invalid status at the database', async () => {
    await expect(testDb.rawQuery(`UPDATE fin_journal_entries SET status = 'WEIRD' WHERE entry_number = 'D-2'`)).rejects.toThrow(
      /CHK_fin_journal_entries_status/,
    );
  });
});
