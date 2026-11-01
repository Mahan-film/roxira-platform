/**
 * Floating details, cost centres and project centres on a REAL PostgreSQL. Opt-in like the other
 * pg specs: skipped unless ROXIRA_TEST_PG_HOST is set; each run creates and drops its own database.
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
import { DimensionKind, JournalEntryStatus } from './enums/accounting.enum';
import { AccountingRepository } from './repositories/accounting.repository';
import { DimensionRepository } from './repositories/dimension.repository';
import { AccountingService } from './services/accounting.service';
import { DimensionService } from './services/dimension.service';

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

describePg('Dimensions on PostgreSQL', () => {
  const dbName = `rx_dim_${process.pid}_${Date.now()}`;
  let ds: DataSource;
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
    await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin(`CREATE DATABASE "${dbName}"`);
    ds = new DataSource(options(dbName));
    await ds.initialize();
    await ds.runMigrations();
    const currency = { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService;
    accounting = new AccountingService(
      new AccountingRepository(
        ds.getRepository(ChartOfAccountEntity),
        ds.getRepository(JournalEntryEntity),
        ds.getRepository(JournalEntryLineEntity),
        ds.getRepository(PeriodLockEntity),
        ds,
      ),
      currency,
    );
    dims = new DimensionService(new DimensionRepository(ds));
  }, 120000);

  afterAll(async () => {
    await ds.destroy();
    await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
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
    const rows = await ds.query(`SELECT project_id FROM fin_journal_entry_lines WHERE journal_entry_id = $1 AND debit > 0`, [draft!.id]);
    expect(rows[0].project_id).not.toBeNull();
    await expect(
      ds.query(`UPDATE fin_journal_entry_lines SET project_id = (SELECT id FROM fin_dimensions LIMIT 1), tenant_id = $1 WHERE journal_entry_id = $2`, [T2, draft!.id]),
    ).rejects.toThrow();
  });
});
