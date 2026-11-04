import { TenantScope } from '../access/services/tenant-scope';
/**
 * Voucher states (DRAFT, TEMPORARY, POSTED) on a REAL PostgreSQL. Opt-in like the other pg specs:
 * skipped unless ROXIRA_TEST_PG_HOST is set; each run creates and drops its own database.
 */
import 'reflect-metadata';
import * as path from 'path';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CurrencyService } from '../currency/services/currency.service';
import { ChartOfAccountEntity } from './entities/chart-of-account.entity';
import { JournalEntryLineEntity } from './entities/journal-entry-line.entity';
import { JournalEntryEntity } from './entities/journal-entry.entity';
import { PeriodLockEntity } from './entities/period-lock.entity';
import { JournalEntryStatus } from './enums/accounting.enum';
import { AccountingRepository } from './repositories/accounting.repository';
import { AccountingService } from './services/accounting.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const USER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

const options = (database: string) => ({
  type: 'postgres' as const,
  host: HOST,
  port: PORT,
  username: USER,
  database,
  entities: [path.join(__dirname, '../**/*.entity.ts')],
  migrations: [path.join(__dirname, '../../migrations/*.ts')],
  migrationsTransactionMode: 'each' as const,
  synchronize: false,
  logging: false,
});

const admin = async (sql: string) => {
  const ds = new DataSource({ ...options('postgres'), entities: [], migrations: [] });
  await ds.initialize();
  try {
    await ds.query(sql);
  } finally {
    await ds.destroy();
  }
};

describePg('Voucher states on PostgreSQL', () => {
  const dbName = `rx_vs_${process.pid}_${Date.now()}`;
  let ds: DataSource;
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
    (await ds.query(`SELECT balance FROM fin_chart_of_accounts WHERE tenant_id = $1 AND code = $2`, [tenant, code]))[0]
      ?.balance;

  beforeAll(async () => {
    await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin(`CREATE DATABASE "${dbName}"`);
    ds = new DataSource(options(dbName));
    await ds.initialize();
    await ds.runMigrations();
    const currency = { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService;
    accounting = new AccountingService(
      new AccountingRepository(new TenantScope(ds)),
      currency,
    );
  }, 120000);

  afterAll(async () => {
    await ds.destroy();
    await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
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
    await expect(ds.query(`UPDATE fin_journal_entries SET description = 'x' WHERE id = $1`, [entry!.id])).rejects.toThrow(
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
    expect(await ds.query(`SELECT count(*)::int AS n FROM fin_journal_entry_lines WHERE journal_entry_id = $1`, [a.id])).toEqual([
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
    await expect(ds.query(`UPDATE fin_journal_entries SET status = 'WEIRD' WHERE entry_number = 'D-2'`)).rejects.toThrow(
      /CHK_fin_journal_entries_status/,
    );
  });
});
