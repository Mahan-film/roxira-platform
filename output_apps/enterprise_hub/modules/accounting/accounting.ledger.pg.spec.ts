import { TenantScope } from '../access/services/tenant-scope';
/**
 * Ledger integration tests against a REAL PostgreSQL (concurrency, row locks, period locks,
 * reversal, import rollback, DB triggers, migrations up/down with data).
 *
 * Opt-in: skipped unless ROXIRA_TEST_PG_HOST is set (a unix-socket directory such as /tmp/rxpg or
 * a host name). Each run creates and drops its own throwaway database, nothing else is touched:
 *
 *   initdb -D $DIR -U postgres --auth=trust
 *   pg_ctl -D $DIR -o "-c listen_addresses='' -c unix_socket_directories=/tmp/rxpg" start
 *   ROXIRA_TEST_PG_HOST=/tmp/rxpg npx jest modules/accounting/accounting.ledger.pg.spec.ts
 *
 * Optional: ROXIRA_TEST_PG_USER (default postgres), ROXIRA_TEST_PG_PORT.
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { CurrencyService } from '../currency/services/currency.service';
import { InventoryRepository } from '../inventory/repositories/inventory.repository';
import { InventoryService } from '../inventory/services/inventory.service';
import { StockItemEntity } from '../inventory/entities/stock-item.entity';
import { FifoBatchEntity } from '../inventory/entities/fifo-batch.entity';
import { WarehouseEntity } from '../inventory/entities/warehouse.entity';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { InvoiceStatus } from '../invoicing/enums/invoice-status.enum';
import { InvoicingRepository } from '../invoicing/repositories/invoicing.repository';
import { InvoicePostingService } from '../invoicing/services/invoice-posting.service';
import { ChartOfAccountEntity } from './entities/chart-of-account.entity';
import { JournalEntryLineEntity } from './entities/journal-entry-line.entity';
import { JournalEntryEntity } from './entities/journal-entry.entity';
import { PeriodLockEntity } from './entities/period-lock.entity';
import { PeriodLockedException } from './exceptions/ledger.exceptions';
import { AccountingRepository } from './repositories/accounting.repository';
import { AccountingService } from './services/accounting.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;

const USER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
const MIGRATIONS = path.join(__dirname, '../../migrations/*.ts');
const ENTITIES = path.join(__dirname, '../**/*.entity.ts');

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

const currencyStub = {
  convert: (value: number) => value,
  round: (value: number) => value,
} as unknown as CurrencyService;

const options = (database: string) => {
  return {
    type: 'postgres' as const,
    host: HOST,
    port: PORT,
    username: USER,
    database,
    entities: [ENTITIES],
    migrations: [MIGRATIONS],
    migrationsTransactionMode: 'each' as const,
    synchronize: false,
    logging: false,
    extra: { max: 20 },
  };
};

/** Runs one statement on the maintenance database (CREATE/DROP DATABASE cannot run in a transaction). */
const adminQuery = async (sql: string) => {
  const admin = new DataSource({ ...options('postgres'), entities: [], migrations: [] });
  await admin.initialize();
  try {
    await admin.query(sql);
  } finally {
    await admin.destroy();
  }
};

const createDb = async (name: string) => {
  await adminQuery(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await adminQuery(`CREATE DATABASE "${name}"`);
};

const dropDb = async (name: string) => adminQuery(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);

const entry = (entryNumber: string, date: string, lines: object[]) =>
  ({ entryNumber, date, description: 'test', lines }) as never;

const pair = (n: string, date: string, amount: number | string, a = '1010', b = '4010') =>
  entry(n, date, [
    { accountCode: a, debit: amount },
    { accountCode: b, credit: amount },
  ]);

describePg('Ledger on PostgreSQL', () => {
  const dbName = `rx_it_${process.pid}_${Date.now()}`;
  let ds: DataSource;
  let accounting: AccountingService;
  let inventory: InventoryService;
  let invoicing: InvoicingRepository;
  let posting: InvoicePostingService;

  const q = <R = Record<string, string>>(sql: string, params: unknown[] = []) =>
    ds.query(sql, params) as Promise<R[]>;

  const balanceOf = async (tenant: string, code: string): Promise<string> =>
    (await q<{ balance: string }>(
      'SELECT balance FROM fin_chart_of_accounts WHERE tenant_id=$1 AND code=$2',
      [tenant, code],
    ))[0].balance;

  /** balance column == SUM(debit - credit) of the account's lines, for every account. */
  const expectBalancesMatchLines = async () => {
    const drift = await q(`
      SELECT a.id FROM fin_chart_of_accounts a
      LEFT JOIN (SELECT account_id, SUM(debit - credit) AS t FROM fin_journal_entry_lines GROUP BY 1) s
        ON s.account_id = a.id
      WHERE a.balance <> COALESCE(s.t, 0)`);
    expect(drift).toEqual([]);
  };

  beforeAll(async () => {
    await createDb(dbName);
    ds = new DataSource(options(dbName));
    await ds.initialize();
    await ds.runMigrations();

    const repo = new AccountingRepository(new TenantScope(ds));
    accounting = new AccountingService(repo, currencyStub);
    inventory = new InventoryService(
      new InventoryRepository(
        ds.getRepository(WarehouseEntity),
        ds.getRepository(StockItemEntity),
        ds.getRepository(FifoBatchEntity),
        ds,
      ),
    );
    invoicing = new InvoicingRepository(ds.getRepository(InvoiceEntity), ds);
    posting = new InvoicePostingService(invoicing, inventory, accounting);
  }, 120_000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.destroy();
    }
    await dropDb(dbName);
  });

  describe('concurrency', () => {
    it('20 parallel entries over the same accounts in opposite line orders: no deadlock, exact balances', async () => {
      const posts = Array.from({ length: 20 }, (_, i) =>
        accounting.createJournalEntry(
          T1,
          entry(`CONC-${i}`, '2026-01-10T12:00:00Z', i % 2
            ? [
                { accountCode: '1010', debit: 10 },
                { accountCode: '1020', debit: 5 },
                { accountCode: '4010', credit: 15 },
              ]
            : [
                { accountCode: '4010', credit: 15 },
                { accountCode: '1020', debit: 5 },
                { accountCode: '1010', debit: 10 },
              ]),
        ),
      );
      await expect(Promise.all(posts)).resolves.toHaveLength(20);
      expect(await balanceOf(T1, '1010')).toBe('200.00');
      expect(await balanceOf(T1, '4010')).toBe('-300.00');
      await expectBalancesMatchLines();
    });

    it('two simultaneous posts with the same number: exactly one wins, the other is a 409', async () => {
      const post = () => accounting.createJournalEntry(T1, pair('SAME-1', '2026-01-11T12:00:00Z', 7));
      const results = await Promise.allSettled([post(), post(), post()]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const r of results.filter((x) => x.status === 'rejected')) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
      }
      expect(await q('SELECT 1 FROM fin_journal_entries WHERE tenant_id=$1 AND entry_number=$2', [T1, 'SAME-1'])).toHaveLength(1);
    });

    it('a duplicate inside an outer transaction is a 409 and leaves the transaction usable', async () => {
      await accounting.createJournalEntry(T1, pair('OUTER-DUP', '2026-01-12T12:00:00Z', 3));
      await ds.transaction(async (manager) => {
        await expect(
          accounting.createJournalEntry(T1, pair('OUTER-DUP', '2026-01-12T12:00:00Z', 3), manager),
        ).rejects.toBeInstanceOf(ConflictException);
        // would throw "current transaction is aborted" had the unique violation reached PG
        await accounting.createJournalEntry(T1, pair('OUTER-OK', '2026-01-12T12:00:00Z', 4), manager);
      });
      expect(await q('SELECT 1 FROM fin_journal_entries WHERE entry_number=$1', ['OUTER-OK'])).toHaveLength(1);
    });

    it('a failure in an outer transaction rolls the whole entry back (no lines, no balance change)', async () => {
      const before = await balanceOf(T1, '1010');
      await expect(
        ds.transaction(async (manager) => {
          await accounting.createJournalEntry(T1, pair('ROLLED-BACK', '2026-01-12T12:00:00Z', 99), manager);
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(await q('SELECT 1 FROM fin_journal_entries WHERE entry_number=$1', ['ROLLED-BACK'])).toHaveLength(0);
      expect(await balanceOf(T1, '1010')).toBe(before);
    });
  });

  describe('period locks', () => {
    it('refuses to post, reverse into and import into a locked period; unlock reopens; history is kept', async () => {
      const posted = await accounting.createJournalEntry(T2, pair('PL-1', '2026-03-15T12:00:00Z', 50));
      const lock = await accounting.lockPeriod(T2, 'user-1', {
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
        reason: 'Q1 close',
      });
      expect(lock.active).toBe(true);

      await expect(
        accounting.createJournalEntry(T2, pair('PL-2', '2026-03-31T00:00:00Z', 1)),
      ).rejects.toBeInstanceOf(PeriodLockedException);
      await expect(
        accounting.reverseJournalEntry(T2, posted.id, { date: '2026-03-20T12:00:00Z' }),
      ).rejects.toBeInstanceOf(PeriodLockedException);
      await expect(
        accounting.importOpeningBalances(T2, [
          { accountCode: '1010', debit: 5, date: '2026-03-02T12:00:00Z' },
          { accountCode: '4010', credit: 5, date: '2026-03-02T12:00:00Z' },
        ]),
      ).rejects.toBeInstanceOf(PeriodLockedException);
      // the days next to the range stay open, and another tenant is unaffected
      await accounting.createJournalEntry(T2, pair('PL-3', '2026-04-01T12:00:00Z', 1));
      await accounting.createJournalEntry(T1, pair('PL-OTHER-TENANT', '2026-03-15T12:00:00Z', 1));

      const unlocked = await accounting.unlockPeriod(T2, 'user-2', lock.id, { reason: 'late invoice' });
      expect(unlocked.active).toBe(false);
      expect(unlocked.unlockedBy).toBe('user-2');
      await accounting.createJournalEntry(T2, pair('PL-4', '2026-03-31T00:00:00Z', 1));

      await expect(accounting.unlockPeriod(T2, 'user-2', lock.id, { reason: 'again again' })).rejects.toBeInstanceOf(ConflictException);
      // tenant isolation of the lock API
      await expect(accounting.unlockPeriod(T1, 'user-3', lock.id, { reason: 'not mine' })).rejects.toThrow();
      const history = await accounting.listPeriodLocks(T2);
      expect(history.map((l) => [l.id, l.active, l.lockedBy, l.reason])).toEqual([[lock.id, false, 'user-1', 'Q1 close']]);
      expect(await accounting.listPeriodLocks(T1)).toEqual([]);
    });

    it('the DB itself refuses an entry dated in a locked period and any delete/rewrite of lock history', async () => {
      const lock = await accounting.lockPeriod(T2, 'user-1', { periodStart: '2026-05-01', periodEnd: '2026-05-31' });
      await expect(
        q(`INSERT INTO fin_journal_entries (entry_number, date, description, tenant_id) VALUES ('RAW-LOCKED', '2026-05-10', 'x', $1)`, [T2]),
      ).rejects.toThrow(/locked period/);
      await expect(q('DELETE FROM fin_period_locks WHERE id=$1', [lock.id])).rejects.toThrow(/history/);
      await expect(q(`UPDATE fin_period_locks SET period_end='2027-01-01' WHERE id=$1`, [lock.id])).rejects.toThrow(/append-only/);
      await accounting.unlockPeriod(T2, 'user-1', lock.id, { reason: 'test cleanup' });
    });

    it('a lock waits for an in-flight posting, and a posting started after it is refused', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let postedInside!: () => void;
      const inside = new Promise<void>((resolve) => (postedInside = resolve));

      const longPost = ds.transaction(async (manager) => {
        await accounting.createJournalEntry(T2, pair('RACE-1', '2026-06-10T12:00:00Z', 5), manager);
        postedInside();
        await gate; // keep the transaction (and its shared ledger lock) open
      });
      await inside;

      let locked = false;
      const lockPromise = accounting
        .lockPeriod(T2, 'user-1', { periodStart: '2026-06-01', periodEnd: '2026-06-30' })
        .then((l) => {
          locked = true;
          return l;
        });
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(locked).toBe(false); // waiting for the posting to finish
      release();
      await longPost;
      const lock = await lockPromise;
      expect(locked).toBe(true);
      await expect(
        accounting.createJournalEntry(T2, pair('RACE-2', '2026-06-10T12:00:00Z', 5)),
      ).rejects.toBeInstanceOf(PeriodLockedException);
      await accounting.unlockPeriod(T2, 'user-1', lock.id, { reason: 'test cleanup' });
    });
  });

  describe('posted rows are immutable in the database', () => {
    it('blocks UPDATE/DELETE of POSTED headers and lines; a raw unbalanced or cross-tenant insert fails at COMMIT', async () => {
      const posted = await accounting.createJournalEntry(T1, pair('IMMUT-1', '2026-02-01T12:00:00Z', 10));
      await expect(q(`UPDATE fin_journal_entries SET description='x' WHERE id=$1`, [posted.id])).rejects.toThrow(/immutable/);
      await expect(q('DELETE FROM fin_journal_entries WHERE id=$1', [posted.id])).rejects.toThrow(/immutable/);
      await expect(q('UPDATE fin_journal_entry_lines SET debit=1 WHERE journal_entry_id=$1', [posted.id])).rejects.toThrow(/immutable/);
      await expect(q('DELETE FROM fin_journal_entry_lines WHERE journal_entry_id=$1', [posted.id])).rejects.toThrow(/immutable/);

      const [{ id: cash }] = await q<{ id: number }>(`SELECT id FROM fin_chart_of_accounts WHERE tenant_id=$1 AND code='1010'`, [T1]);
      const [{ id: other }] = await q<{ id: number }>(`SELECT id FROM fin_chart_of_accounts WHERE tenant_id=$1 AND code='1010'`, [T2]);
      await expect(
        ds.transaction(async (m) => {
          const [{ id }] = await m.query(`INSERT INTO fin_journal_entries (entry_number, date, description, tenant_id) VALUES ('RAW-UNBAL', '2026-02-02', 'x', $1) RETURNING id`, [T1]);
          await m.query(`INSERT INTO fin_journal_entry_lines (journal_entry_id, account_id, debit, credit, tenant_id) VALUES ($1,$2,5,0,$3)`, [id, cash, T1]);
        }),
      ).rejects.toThrow(/not balanced/);
      await expect(
        ds.transaction(async (m) => {
          const [{ id }] = await m.query(`INSERT INTO fin_journal_entries (entry_number, date, description, tenant_id) VALUES ('RAW-XTENANT', '2026-02-02', 'x', $1) RETURNING id`, [T1]);
          await m.query(`INSERT INTO fin_journal_entry_lines (journal_entry_id, account_id, debit, credit, tenant_id) VALUES ($1,$2,5,0,$3),($1,$2,0,5,$3)`, [id, other, T1]);
        }),
      ).rejects.toThrow(/mixes tenants/);
    });
  });

  describe('reversal', () => {
    it('a reversal cannot be reversed; an entry is reversed once (also when raced); numbers of 61-64 chars work', async () => {
      const original = await accounting.createJournalEntry(T1, pair('REV-A', '2026-02-05T12:00:00Z', 25));
      const [first, second] = await Promise.allSettled([
        accounting.reverseJournalEntry(T1, original.id),
        accounting.reverseJournalEntry(T1, original.id),
      ]);
      expect([first.status, second.status].sort()).toEqual(['fulfilled', 'rejected']);
      const rejected = [first, second].find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(ConflictException);
      const reversal = [first, second].find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ id: number; entryNumber: string }>;
      expect(reversal.value.entryNumber).toBe('REV-A-REV');
      await expect(accounting.reverseJournalEntry(T1, reversal.value.id)).rejects.toBeInstanceOf(BadRequestException);

      for (const length of [60, 61, 62, 63, 64]) {
        const number = `${'L'.repeat(length - 1)}${length % 10}`;
        const long = await accounting.createJournalEntry(T1, pair(number, '2026-02-06T12:00:00Z', 1));
        const rev = await accounting.reverseJournalEntry(T1, long.id);
        expect(rev.entryNumber.length).toBeLessThanOrEqual(64);
      }
      await expectBalancesMatchLines();
    });
  });

  describe('import rollback posts reversals, never deletes', () => {
    it('reverses a batch, keeps originals, is idempotent, and refuses (423, nothing changed) in a locked period', async () => {
      const ids: number[] = [];
      for (const n of ['IMP-1', 'IMP-2', 'IMP-3']) {
        ids.push((await accounting.createJournalEntry(T1, pair(n, '2026-07-10T12:00:00Z', 100))).id);
      }
      const cashBefore = await balanceOf(T1, '1010');

      const lock = await accounting.lockPeriod(T1, 'user-1', { periodStart: '2026-07-01', periodEnd: '2026-07-31' });
      const reversalsBefore = (await q('SELECT 1 FROM fin_journal_entries WHERE reverses_entry_id IS NOT NULL')).length;
      await expect(accounting.removeImportedJournalEntries(T1, ids)).rejects.toBeInstanceOf(PeriodLockedException);
      expect((await q('SELECT 1 FROM fin_journal_entries WHERE reverses_entry_id IS NOT NULL')).length).toBe(reversalsBefore);
      expect(await balanceOf(T1, '1010')).toBe(cashBefore);

      await accounting.unlockPeriod(T1, 'user-1', lock.id, { reason: 'import undo' });
      await expect(accounting.removeImportedJournalEntries(T1, ids)).resolves.toEqual({ removed: 3, refused: [] });
      expect(await q('SELECT 1 FROM fin_journal_entries WHERE id = ANY($1) AND status=$2', [ids, 'POSTED'])).toHaveLength(3);
      expect(await q('SELECT 1 FROM fin_journal_entries WHERE reverses_entry_id = ANY($1)', [ids])).toHaveLength(3);
      expect(Number(await balanceOf(T1, '1010'))).toBe(Number(cashBefore) - 300);
      // retrying the undo is a no-op that still reports them as removed
      await expect(accounting.removeImportedJournalEntries(T1, ids)).resolves.toEqual({ removed: 3, refused: [] });
      expect(await q('SELECT 1 FROM fin_journal_entries WHERE reverses_entry_id = ANY($1)', [ids])).toHaveLength(3);
      // other tenants' ids are not touched or counted
      await expect(accounting.removeImportedJournalEntries(T2, ids)).resolves.toEqual({ removed: 0, refused: [] });
      await expectBalancesMatchLines();
    });
  });

  describe('exact money', () => {
    it('stores and returns a 9e15 amount exactly and keeps balance == sum of lines', async () => {
      const created = await accounting.createJournalEntry(T2, pair('BIG-1', '2026-08-01T12:00:00Z', '9007199254740993.01'));
      expect(created.totalDebit).toBe('9007199254740993.01');
      const tb = await accounting.getTrialBalance(T2);
      expect(tb.balanced).toBe(true);
      const ledger = await accounting.getAccountLedger(T2, '1010', { limit: 1000 } as never);
      expect(ledger.entries.some((e) => e.debit === '9007199254740993.01')).toBe(true);
      await expect(
        accounting.createJournalEntry(T2, entry('BIG-2', '2026-08-01T12:00:00Z', [
          { accountCode: '1010', debit: '0.10' },
          { accountCode: '1020', debit: '0.20' },
          { accountCode: '4010', credit: '0.30' },
        ])),
      ).resolves.toBeDefined();
      await expectBalancesMatchLines();
    });
  });

  describe('invoice posting: atomic stock + ledger, idempotent, exact FX mirror', () => {
    const SKU = 'SKU-PG-1';
    const makeInvoice = async (overrides: Partial<InvoiceEntity>) =>
      invoicing.create(T1, {
        taxInvoiceNumber: `TI-${Math.random().toString(36).slice(2, 8)}`,
        sellerInfo: { name: 's' },
        buyerInfo: { name: 'b' },
        items: [{ itemId: 1, sku: SKU, description: 'x', quantity: 2, unitPrice: 500, discount: 0, vatRate: 0.1, tax: 100, total: 1100 }],
        currency: 'IRR' as never,
        totalAmount: 1000, totalDiscount: 0, totalTax: 100, finalPayable: 1100,
        status: InvoiceStatus.ISSUED,
        issuedAt: new Date('2026-09-10T12:00:00Z'),
        ...overrides,
      } as Partial<InvoiceEntity>);
    const stockLevel = async (): Promise<number> =>
      Number((await q<{ quantity: number }>('SELECT quantity FROM erp_stock_items WHERE tenant_id=$1 AND sku=$2', [T1, SKU]))[0].quantity);

    beforeAll(async () => {
      await inventory.createStockItem(T1, { sku: SKU, barcode: SKU, name: 'pg item' } as never);
      await inventory.receiveStock(T1, { sku: SKU, quantity: 100, unitPurchaseCost: 10 } as never);
    });

    it('concurrent postIssued of one invoice deducts stock once and posts one entry', async () => {
      const invoice = await makeInvoice({});
      const before = await stockLevel();
      await Promise.all(Array.from({ length: 5 }, () =>
        posting.postIssued({ tenantId: T1, invoiceId: invoice.id, status: InvoiceStatus.ISSUED }),
      ));
      expect(await stockLevel()).toBe(before - 2);
      const after = await invoicing.findById(T1, invoice.id);
      expect(after?.journalEntryId).not.toBeNull();
      expect(await q('SELECT 1 FROM fin_journal_entries WHERE tenant_id=$1 AND entry_number=$2', [T1, `INV-${invoice.id}-ISSUED`])).toHaveLength(1);
    });

    it('a posting failure after the stock deduction rolls the stock back (nothing half-posted)', async () => {
      const lock = await accounting.lockPeriod(T1, 'user-1', { periodStart: '2026-10-01', periodEnd: '2026-10-31' });
      const invoice = await makeInvoice({ issuedAt: new Date('2026-10-10T12:00:00Z') });
      const before = await stockLevel();
      await posting.postIssued({ tenantId: T1, invoiceId: invoice.id, status: InvoiceStatus.ISSUED });
      expect(await stockLevel()).toBe(before); // the ledger refused; the deduction was rolled back
      const after = await invoicing.findById(T1, invoice.id);
      expect(after?.journalEntryId).toBeNull();
      expect(after?.postingError).toMatch(/locked/i);
      await accounting.unlockPeriod(T1, 'user-1', lock.id, { reason: 'test cleanup' });
      // once the period is open the same event succeeds: stock deducted exactly once
      await posting.postIssued({ tenantId: T1, invoiceId: invoice.id, status: InvoiceStatus.ISSUED });
      expect(await stockLevel()).toBe(before - 2);
    });

    it('insufficient stock leaves no ledger entry behind', async () => {
      const invoice = await makeInvoice({
        items: [{ itemId: 1, sku: SKU, description: 'x', quantity: 1e6, unitPrice: 1, discount: 0, vatRate: 0, tax: 0, total: 1e6 }] as never,
      });
      await posting.postIssued({ tenantId: T1, invoiceId: invoice.id, status: InvoiceStatus.ISSUED });
      expect(await q('SELECT 1 FROM fin_journal_entries WHERE entry_number=$1', [`INV-${invoice.id}-ISSUED`])).toHaveLength(0);
      expect((await invoicing.findById(T1, invoice.id))?.postingError).toBeTruthy();
    });

    it.each([
      ['41234.5678', '1234.56', '123.45'],
      ['920000.123457', '1000.01', '100.01'],
      ['0.000003', '999999.99', '99999.99'],
      ['41234.5678', '3.33', '0.33'],
    ])('FX invoice (rate %s, payable %s, tax %s): issue posts, cancel mirrors it exactly, all balances return to zero', async (fxRate, payable, tax) => {
      const invoice = await makeInvoice({
        currency: 'USD' as never,
        fxRate: fxRate as never,
        totalAmount: (Number(payable) - Number(tax)) as never,
        totalTax: tax as never,
        finalPayable: payable as never,
        items: [] as never,
      });
      const accountsBefore = await q<{ id: number; balance: string }>(
        `SELECT id, balance FROM fin_chart_of_accounts WHERE tenant_id=$1 ORDER BY id`, [T1]);

      await posting.postIssued({ tenantId: T1, invoiceId: invoice.id, status: InvoiceStatus.ISSUED });
      const issued = await invoicing.findById(T1, invoice.id);
      expect(issued?.postingError).toBeNull();
      expect(issued?.journalEntryId).not.toBeNull();

      await posting.postCancelled({ tenantId: T1, invoiceId: invoice.id, status: InvoiceStatus.CANCELLED });
      const cancelled = await invoicing.findById(T1, invoice.id);
      expect(cancelled?.postingError).toBeNull();
      expect(cancelled?.reversalJournalEntryId).not.toBeNull();

      const issuedLines = await q(
        `SELECT account_id, debit, credit FROM fin_journal_entry_lines WHERE journal_entry_id=$1 ORDER BY account_id`, [issued?.journalEntryId]);
      const cancelLines = await q(
        `SELECT account_id, credit AS debit, debit AS credit FROM fin_journal_entry_lines WHERE journal_entry_id=$1 ORDER BY account_id`, [cancelled?.reversalJournalEntryId]);
      expect(cancelLines).toEqual(issuedLines);
      expect(await q<{ id: number; balance: string }>(
        `SELECT id, balance FROM fin_chart_of_accounts WHERE tenant_id=$1 ORDER BY id`, [T1])).toEqual(accountsBefore);
      await expectBalancesMatchLines();
    });
  });

  describe('migrations on a database with legacy data', () => {
    const legacy = `${dbName}_mig`;

    afterAll(async () => dropDb(legacy));

    it('up reconciles drifted float balances (logged, old value kept), down restores double precision, up again is clean', async () => {
      await createDb(legacy);
      const base = new DataSource(options(legacy));
      await base.initialize();
      await base.runMigrations();
      // go back to the pre-ledger schema (the ledger migrations and all later ones), then seed legacy data
      while ((await base.query(`SELECT 1 FROM migrations WHERE name = 'LedgerPeriodLocksAndGuards1789320000000'`)).length > 0) {
        await base.undoLastMigration();
      }
      const accounts = await base.query(
        `INSERT INTO fin_chart_of_accounts (code, name, account_type, tenant_id, balance) VALUES
           ('1010','cash','ASSET',$1,0.30000000000000004), ('4010','sales','REVENUE',$1,-0.3), ('9999','drift','ASSET',$1,5)
         RETURNING id, code`, [T1]);
      const id = (code: string) => accounts.find((a: { code: string }) => a.code === code).id;
      const [{ id: entryId }] = await base.query(
        `INSERT INTO fin_journal_entries (entry_number, date, description, tenant_id) VALUES ('J1', now(), 'x', $1) RETURNING id`, [T1]);
      await base.query(
        `INSERT INTO fin_journal_entries (entry_number, date, description, tenant_id) VALUES ('J1-REV', now(), 'rev', $1)`, [T1]);
      await base.query(
        `INSERT INTO fin_journal_entry_lines (journal_entry_id, account_id, debit, credit, tenant_id) VALUES ($1,$2,0.3,0,$4),($1,$3,0,0.3,$4)`,
        [entryId, id('1010'), id('4010'), T1]);

      await base.runMigrations();
      const after = await base.query(`SELECT code, balance, balance_legacy_double FROM fin_chart_of_accounts WHERE tenant_id=$1 ORDER BY code`, [T1]);
      expect(after.find((r: { code: string }) => r.code === '1010')).toMatchObject({ balance: '0.30', balance_legacy_double: 0.30000000000000004 });
      expect(after.find((r: { code: string }) => r.code === '9999')).toMatchObject({ balance: '0.00', balance_legacy_double: 5 });
      const log = await base.query(`SELECT account_id, balance_before, balance_from_lines FROM fin_balance_reconciliation_log`);
      expect(log).toEqual([{ account_id: id('9999'), balance_before: '5.00', balance_from_lines: '0.00' }]);
      // the old "<number>-REV" convention is backfilled into reverses_entry_id
      expect(await base.query(`SELECT reverses_entry_id FROM fin_journal_entries WHERE entry_number='J1-REV'`)).toEqual([{ reverses_entry_id: entryId }]);

      // later migrations, numeric -> double precision, then guards, locks table, reverses column
      while ((await base.query(`SELECT 1 FROM migrations WHERE name = 'LedgerPeriodLocksAndGuards1789320000000'`)).length > 0) {
        await base.undoLastMigration();
      }
      expect((await base.query(`SELECT data_type FROM information_schema.columns WHERE table_name='fin_chart_of_accounts' AND column_name='balance'`))[0].data_type).toBe('double precision');
      expect(await base.query(`SELECT 1 FROM information_schema.tables WHERE table_name IN ('fin_period_locks','fin_balance_reconciliation_log')`)).toEqual([]);
      expect(await base.query(`SELECT 1 FROM pg_trigger WHERE tgname LIKE 'TRG_fin_%'`)).toEqual([]);
      // data survived the round trip and the table is writable again
      expect(Number((await base.query(`SELECT balance FROM fin_chart_of_accounts WHERE code='1010' AND tenant_id=$1`, [T1]))[0].balance)).toBe(0.3);

      await base.runMigrations();
      expect((await base.query(`SELECT data_type, numeric_precision, numeric_scale FROM information_schema.columns WHERE table_name='fin_chart_of_accounts' AND column_name='balance'`))[0]).toEqual({ data_type: 'numeric', numeric_precision: 18, numeric_scale: 2 });
      await base.destroy();
    }, 120_000);
  });
});
