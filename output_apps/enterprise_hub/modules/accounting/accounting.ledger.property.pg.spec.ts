/**
 * Ledger invariants as fast-check properties on a REAL PostgreSQL (the SQL aggregates, the stored
 * account balances, the voucher guards and the reversal rules are what is under test).
 * Opt-in like the other pg specs: skipped unless ROXIRA_TEST_PG_HOST is set; each run creates and
 * drops its own database. Every property run uses a fresh tenant, so runs never see each other.
 *
 * The expected values come from an independent bigint model of the generated vouchers, never from
 * the database aggregates being checked.
 */
import 'reflect-metadata';
import * as path from 'path';
import * as fc from 'fast-check';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CurrencyService } from '../currency/services/currency.service';
import { TenantScope } from '../access/services/tenant-scope';
import { JournalEntryStatus } from './enums/accounting.enum';
import { minorToDecimal, parseMinor, toMinor } from './money';
import { AccountingRepository } from './repositories/accounting.repository';
import { AccountingService } from './services/accounting.service';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const USER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
const NUM_RUNS = Number(process.env.ROXIRA_PROPERTY_RUNS ?? 25);

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

/** Codes of the default chart (constants/accounting.constants.ts). */
const CODES = ['1010', '1020', '1030', '2010', '2020', '3010', '4010', '4020', '5010', '5020', '5030'];
const DAY_MS = 86_400_000;
const isoDay = (offset: number) => new Date(Date.UTC(2025, 2, 21) + offset * DAY_MS).toISOString().slice(0, 10);

interface Side {
  code: string;
  debit: bigint;
  credit: bigint;
}
interface Voucher {
  status: 'POSTED' | 'TEMPORARY' | 'DRAFT';
  day: number;
  lines: Side[];
  /** null = never reversed, else the day offset of the reversal (>= voucher day). */
  reverseOn: number | null;
}

/** Lines that balance by construction: random single-sided lines, then one closing line. */
const linesArb: fc.Arbitrary<Side[]> = fc
  .array(
    fc.record({
      code: fc.constantFrom(...CODES),
      debitSide: fc.boolean(),
      amount: fc.bigInt({ min: 1n, max: 5_000_000_000_000n }),
    }),
    { minLength: 1, maxLength: 5 },
  )
  .chain((raw) =>
    fc.constantFrom(...CODES).map((closer) => {
      const lines: Side[] = raw.map((l) => ({
        code: l.code,
        debit: l.debitSide ? l.amount : 0n,
        credit: l.debitSide ? 0n : l.amount,
      }));
      const diff = lines.reduce((s, l) => s + l.debit - l.credit, 0n);
      if (diff > 0n) lines.push({ code: closer, debit: 0n, credit: diff });
      else if (diff < 0n) lines.push({ code: closer, debit: -diff, credit: 0n });
      else {
        lines.push({ code: closer, debit: 1n, credit: 0n }, { code: closer, debit: 0n, credit: 1n });
      }
      return lines;
    }),
  );

const voucherArb: fc.Arbitrary<Voucher> = fc
  .record({
    status: fc.constantFrom<Voucher['status']>('POSTED', 'POSTED', 'POSTED', 'TEMPORARY', 'DRAFT'),
    day: fc.integer({ min: 0, max: 700 }),
    lines: linesArb,
    reverse: fc.option(fc.integer({ min: 0, max: 30 }), { nil: null }),
  })
  .map((v) => ({ status: v.status, day: v.day, lines: v.lines, reverseOn: v.reverse === null ? null : v.day + v.reverse }));

describePg('Ledger property tests on PostgreSQL', () => {
  const dbName = `rx_lp_${process.pid}_${Date.now()}`;
  let ds: DataSource;
  let accounting: AccountingService;
  let runNo = 0;

  const tenantFor = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const minorOf = (v: unknown) => toMinor(v as number | string);

  beforeAll(async () => {
    await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin(`CREATE DATABASE "${dbName}"`);
    ds = new DataSource(options(dbName));
    await ds.initialize();
    await ds.runMigrations();
    const currency = { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService;
    accounting = new AccountingService(new AccountingRepository(new TenantScope(ds)), currency);
  }, 180000);

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
    await admin(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  });

  /** Posts the generated vouchers and returns the independent model: net (debit - credit) per code. */
  async function apply(tenant: string, vouchers: Voucher[]) {
    const model = new Map<string, { debit: bigint; credit: bigint }>(CODES.map((c) => [c, { debit: 0n, credit: 0n }]));
    const add = (lines: Side[], flip: boolean) => {
      for (const l of lines) {
        const m = model.get(l.code)!;
        m.debit += flip ? l.credit : l.debit;
        m.credit += flip ? l.debit : l.credit;
      }
    };
    for (let i = 0; i < vouchers.length; i++) {
      const v = vouchers[i];
      const created = await accounting.createJournalEntry(tenant, {
        entryNumber: `V-${i}`,
        date: isoDay(v.day),
        description: 'property',
        status: v.status as JournalEntryStatus,
        lines: v.lines.map((l) => ({
          accountCode: l.code,
          ...(l.debit > 0n ? { debit: minorToDecimal(l.debit) } : { credit: minorToDecimal(l.credit) }),
        })),
      } as never);
      if (v.status === 'POSTED') add(v.lines, false);
      if (v.reverseOn !== null) {
        if (v.status === 'POSTED') {
          const rev = await accounting.reverseJournalEntry(tenant, created.id, { date: isoDay(v.reverseOn) });
          add(v.lines, true);
          // Reversal twice: the original cannot be reversed again, and a reversal cannot be reversed.
          await expect(accounting.reverseJournalEntry(tenant, created.id, { date: isoDay(v.reverseOn) })).rejects.toBeInstanceOf(
            ConflictException,
          );
          await expect(accounting.reverseJournalEntry(tenant, rev.id, { date: isoDay(v.reverseOn) })).rejects.toBeInstanceOf(
            BadRequestException,
          );
        } else {
          await expect(accounting.reverseJournalEntry(tenant, created.id, { date: isoDay(v.reverseOn) })).rejects.toBeInstanceOf(
            BadRequestException,
          );
        }
      }
    }
    return model;
  }

  it('stored balances, SQL line sums, trial balance and ledger all agree with an independent model', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(voucherArb, { minLength: 1, maxLength: 6 }), fc.integer({ min: 0, max: 700 }), async (vouchers, midDay) => {
        const tenant = tenantFor(++runNo);
        const model = await apply(tenant, vouchers);

        // 1 + 2: stored balance == model == SUM of POSTED lines (exact minor units)
        const stored = await ds.query(`SELECT id, code, balance FROM fin_chart_of_accounts WHERE tenant_id = $1`, [tenant]);
        const sums = await ds.query(
          `SELECT a.code AS code, COALESCE(SUM(l.debit),0) AS d, COALESCE(SUM(l.credit),0) AS c
             FROM fin_chart_of_accounts a
             LEFT JOIN fin_journal_entry_lines l ON l.account_id = a.id AND l.tenant_id = a.tenant_id
              AND EXISTS (SELECT 1 FROM fin_journal_entries e WHERE e.id = l.journal_entry_id AND e.status = 'POSTED')
            WHERE a.tenant_id = $1 GROUP BY a.code`,
          [tenant],
        );
        const sumBy = new Map<string, { d: bigint; c: bigint }>(sums.map((r: { code: string; d: string; c: string }) => [r.code, { d: parseMinor(String(r.d)), c: parseMinor(String(r.c)) }]));
        for (const code of CODES) {
          const m = model.get(code)!;
          const row = stored.find((r: { code: string }) => r.code === code);
          expect(parseMinor(String(row.balance))).toBe(m.debit - m.credit);
          expect(sumBy.get(code)!.d).toBe(m.debit);
          expect(sumBy.get(code)!.c).toBe(m.credit);
        }

        // 3: trial balance per row and totals
        const tb = await accounting.getTrialBalance(tenant);
        let totalD = 0n;
        let totalC = 0n;
        for (const row of tb.rows) {
          const m = model.get(row.code);
          if (!m) continue;
          expect(minorOf(row.totalDebit)).toBe(m.debit);
          expect(minorOf(row.totalCredit)).toBe(m.credit);
          totalD += m.debit;
          totalC += m.credit;
        }
        expect(minorOf(tb.totalDebit)).toBe(totalD);
        expect(minorOf(tb.totalCredit)).toBe(totalC);
        expect(totalD).toBe(totalC);
        expect(tb.balanced).toBe(true);

        // 4: opening + movements = closing for a mid-range window, and closing(all) == stored balance
        for (const code of CODES) {
          const m = model.get(code)!;
          const all = await accounting.getAccountLedger(tenant, code, { limit: 100000 } as never);
          expect(minorOf(all.closingBalance)).toBe(m.debit - m.credit);
          const win = await accounting.getAccountLedger(tenant, code, { fromDate: isoDay(midDay), limit: 100000 } as never);
          expect(minorOf(win.openingBalance) + minorOf(win.totalDebit) - minorOf(win.totalCredit)).toBe(minorOf(win.closingBalance));
          expect(minorOf(win.closingBalance)).toBe(m.debit - m.credit);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  }, 600000);

  // FINDING (#230 item 3): AccountingService.getAccountLedger computes openingBalance, totals and
  // closingBalance from the lines of the requested PAGE (`limit`, default 100), not the whole range,
  // so any account with more lines than the limit reports a wrong closing balance.
  // Counterexample: three POSTED vouchers each [1010 credit 0.01, 1010 debit 0.01], limit 1:
  // closingBalance = -0.01, expected 0.00. `it.failing` keeps CI green while the bug is open; once the
  // service computes totals over the whole range, turn this into a plain `it`.
  it.failing('closing balance does not depend on the page limit (KNOWN BUG)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(voucherArb.filter((v) => v.status === 'POSTED'), { minLength: 3, maxLength: 6 }), async (vouchers) => {
        const tenant = tenantFor(++runNo);
        const model = await apply(tenant, vouchers);
        for (const code of CODES) {
          const m = model.get(code)!;
          const page = await accounting.getAccountLedger(tenant, code, { limit: 1 } as never);
          expect(minorOf(page.closingBalance)).toBe(m.debit - m.credit);
        }
      }),
      { numRuns: Math.max(5, Math.floor(NUM_RUNS / 2)) },
    );
  }, 600000);
});
