import { TenantScope } from '../access/services/tenant-scope';
/**
 * Voucher copy and optimistic edit lock on a REAL PostgreSQL. Opt-in like the other pg specs:
 * skipped unless ROXIRA_TEST_PG_HOST is set; each run creates and drops its own database.
 */
import 'reflect-metadata';
import * as path from 'path';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CurrencyService } from '../currency/services/currency.service';
import { JournalEntryResponseDto } from './dto/journal-entry-response.dto';
import { JournalEntryStatus } from './enums/accounting.enum';
import { AccountingRepository } from './repositories/accounting.repository';
import { AccountingService } from './services/accounting.service';
import { VoucherToolsService } from './services/voucher-tools.service';

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

const lineView = (entry: Pick<JournalEntryResponseDto, 'lines'>) =>
  entry.lines
    .map((line) => ({
      accountCode: line.accountCode,
      debit: line.debit,
      credit: line.credit,
      description: line.description,
    }))
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode));

describePg('Voucher copy and edit lock on PostgreSQL', () => {
  const dbName = `rx_vc_${process.pid}_${Date.now()}`;
  let ds: DataSource;
  let accounting: AccountingService;
  let tools: VoucherToolsService;

  const balanced = (amount: string) => [
    { accountCode: '1010', debit: amount, description: 'cash' },
    { accountCode: '4010', credit: amount, description: 'revenue' },
  ];
  const make = (
    tenant: string,
    entryNumber: string,
    status: JournalEntryStatus,
    date = '2026-05-01',
  ) =>
    accounting.createJournalEntry(tenant, {
      entryNumber,
      date,
      description: `voucher ${entryNumber}`,
      status,
      lines: balanced('100.00'),
    } as never);
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
    tools = new VoucherToolsService(
      new AccountingRepository(new TenantScope(ds)),
      accounting,
    );
  }, 120000);

  afterAll(async () => {
    await ds.destroy();
    await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  });

  it('copies a posted voucher line by line as a DRAFT and leaves the source untouched', async () => {
    const source = await make(T1, 'SRC-1', JournalEntryStatus.POSTED);
    expect(await balance(T1, '1010')).toBe('100.00');

    const copy = await tools.copyVoucher(T1, source.id, {} as never);
    expect(copy.status).toBe(JournalEntryStatus.DRAFT);
    expect(copy.entryNumber).toBe('SRC-1-COPY');
    expect(copy.description).toBe(source.description);
    expect(lineView(copy)).toEqual(lineView(source));

    // The copy is a draft: it did not move any balance.
    expect(await balance(T1, '1010')).toBe('100.00');

    // The source row and its lines are exactly as before, version still 1.
    const reloaded = await accounting.findOneJournalEntry(T1, source.id);
    expect(reloaded.status).toBe(JournalEntryStatus.POSTED);
    expect(reloaded.version).toBe(1);
    expect(reloaded.entryNumber).toBe('SRC-1');
    expect(lineView(reloaded)).toEqual(lineView(source));
  });

  it('refuses to copy a voucher of another tenant with 404', async () => {
    const source = await make(T1, 'SRC-2', JournalEntryStatus.POSTED);
    await expect(tools.copyVoucher(T2, source.id, {} as never)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a copy dated inside a locked period and creates nothing', async () => {
    const source = await make(T1, 'SRC-3', JournalEntryStatus.POSTED, '2026-08-05');
    await accounting.lockPeriod(T1, 'u', { periodStart: '2026-08-01', periodEnd: '2026-08-31' } as never);
    await expect(tools.copyVoucher(T1, source.id, { date: '2026-08-10' })).rejects.toMatchObject({ status: 423 });
    const rows = await ds.query(
      `SELECT count(*)::int AS n FROM fin_journal_entries WHERE tenant_id = $1 AND entry_number LIKE 'SRC-3-COPY%'`,
      [T1],
    );
    expect(rows).toEqual([{ n: 0 }]);
  });

  it('increments the version on update: the first save wins, the stale second gets 409', async () => {
    const draft = await make(T1, 'V-1', JournalEntryStatus.DRAFT);
    expect(draft.version).toBe(1);

    const first = await accounting.updateVoucher(T1, draft.id, {
      entryNumber: 'V-1',
      description: 'first edit',
      lines: balanced('100.00'),
      expectedVersion: 1,
    } as never);
    expect(first.version).toBe(2);

    await expect(
      accounting.updateVoucher(T1, draft.id, {
        entryNumber: 'V-1',
        description: 'stale edit',
        lines: balanced('100.00'),
        expectedVersion: 1,
      } as never),
    ).rejects.toMatchObject({
      status: 409,
      message: 'این سند را کاربر دیگری تغییر داده است؛ صفحه را تازه کنید.',
    });

    const reloaded = await accounting.findOneJournalEntry(T1, draft.id);
    expect(reloaded.version).toBe(2);
    expect(reloaded.description).toBe('first edit');
  });
});
