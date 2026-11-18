import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { CurrencyService } from '../currency/services/currency.service';
import { FxRateType, JournalEntryStatus } from './enums/accounting.enum';
import { AccountingRepository } from './repositories/accounting.repository';
import { AccountingService } from './services/accounting.service';
import {
  createTestDatabase,
  describePg,
  TestDatabaseContext,
  TEST_T1 as T1,
  TEST_T2 as T2,
} from '../../test/support/test-pg';

describePg('Dual-Amount Ledger & FX Rates on PostgreSQL (T138)', () => {
  let testDb: TestDatabaseContext;
  let accounting: AccountingService;
  let repository: AccountingRepository;

  beforeAll(async () => {
    testDb = await createTestDatabase('dual_amt');
    const currency = {
      convert: (v: number) => v,
      round: (v: number) => v,
    } as unknown as CurrencyService;
    repository = new AccountingRepository(testDb.scope);
    accounting = new AccountingService(repository, currency);
  }, 120000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  describe('FORCE RLS on fx_rates table as roxira_app role', () => {
    it('runs under NOSUPERUSER NOBYPASSRLS roxira_app role and enforces tenant isolation', async () => {
      // 0. Confirm roxira_app role permissions
      const [roleRow] = await testDb.app.query(
        `SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
      );
      expect(roleRow.current_user).toBe('roxira_app');
      expect(roleRow.rolsuper).toBe(false);
      expect(roleRow.rolbypassrls).toBe(false);

      // 1. T1 creates FX rate
      const t1Rate = await accounting.upsertFxRate(T1, {
        baseCurrency: 'USD',
        quoteCurrency: 'IRR',
        rateDate: '2026-11-16',
        rateType: FxRateType.SPOT,
        rate: 920000,
        source: 'CBI',
      });
      expect(t1Rate.id).toBeDefined();

      // 2. Positive read for T1
      const foundT1 = await accounting.findFxRate(T1, 'USD', 'IRR', '2026-11-16', FxRateType.SPOT);
      expect(foundT1).not.toBeNull();
      expect(foundT1?.rate).toBe(920000);

      // 3. Cross-tenant isolation: T2 cannot see T1 rate under RLS
      const foundT2 = await accounting.findFxRate(T2, 'USD', 'IRR', '2026-11-16', FxRateType.SPOT);
      expect(foundT2).toBeNull();

      const listT2 = await accounting.listFxRates(T2, {
        baseCurrency: 'USD',
        quoteCurrency: 'IRR',
      });
      expect(listT2).toHaveLength(0);

      // 4. T2 can create its own rate for the same pair and date without collision
      const t2Rate = await accounting.upsertFxRate(T2, {
        baseCurrency: 'USD',
        quoteCurrency: 'IRR',
        rateDate: '2026-11-16',
        rateType: FxRateType.SPOT,
        rate: 925000,
        source: 'NIMA',
      });
      expect(t2Rate.id).toBeDefined();
      expect(t2Rate.rate).toBe(925000);

      // Verify T1 rate remains unchanged
      const verifyT1 = await accounting.findFxRate(T1, 'USD', 'IRR', '2026-11-16', FxRateType.SPOT);
      expect(verifyT1?.rate).toBe(920000);
    });
  });

  describe('Bi-directional Expand/Backfill Sync Trigger', () => {
    it('synchronizes legacy columns to dual-amount columns and vice-versa', async () => {
      // Create a draft entry to attach raw test lines to
      const draft = await accounting.createJournalEntry(T1, {
        entryNumber: 'EXPAND-SYNC-001',
        description: 'تست تریگر همگام‌سازی',
        status: JournalEntryStatus.DRAFT,
        lines: [
          { accountCode: '1010', debit: 100 },
          { accountCode: '4010', credit: 100 },
        ],
      });

      // 1. Insert line using legacy columns directly
      const [legacyRow] = await testDb.scope.within(T1, undefined, async (manager) => {
        return manager.query(
          `INSERT INTO fin_journal_entry_lines
             (tenant_id, journal_entry_id, account_id, debit, credit, currency, fx_rate)
           VALUES
             ($1, $2, (SELECT id FROM fin_chart_of_accounts WHERE tenant_id=$1 AND code='1010'), 50.00, 0.00, 'EUR', 1.08)
           RETURNING *`,
          [T1, draft.id],
        );
      });

      expect(Number(legacyRow.book_debit)).toBe(50);
      expect(Number(legacyRow.book_credit)).toBe(0);
      expect(Number(legacyRow.tx_debit)).toBe(46.3);
      expect(legacyRow.tx_currency_code).toBe('EUR');
      expect(Number(legacyRow.fx_rate_applied)).toBe(1.08);
      expect(legacyRow.is_rounding).toBe(false);

      // 1b. Insert legacy USD line with amount_fx and verify tx_debit = amount_fx (not IRR book_debit)
      const [legacyUsdRow] = await testDb.scope.within(T1, undefined, async (manager) => {
        return manager.query(
          `INSERT INTO fin_journal_entry_lines
             (tenant_id, journal_entry_id, account_id, debit, credit, currency, fx_rate, amount_fx)
           VALUES
             ($1, $2, (SELECT id FROM fin_chart_of_accounts WHERE tenant_id=$1 AND code='1010'), 92000000.00, 0.00, 'USD', 920000, 100.00)
           RETURNING *`,
          [T1, draft.id],
        );
      });
      expect(Number(legacyUsdRow.book_debit)).toBe(92000000);
      expect(Number(legacyUsdRow.tx_debit)).toBe(100);
      expect(Number(legacyUsdRow.tx_credit)).toBe(0);
      expect(legacyUsdRow.tx_currency_code).toBe('USD');

      // 1c. Verify backfill query sets tx_debit = amount_fx for pre-existing USD legacy lines
      await testDb.owner.query(
        `ALTER TABLE fin_journal_entry_lines DISABLE TRIGGER "TRG_fin_journal_entry_lines_dual_sync"`,
      );
      let backfilledUsdRow: any;
      try {
        await testDb.owner.query(
          `UPDATE fin_journal_entry_lines
              SET book_debit = NULL, book_credit = NULL, tx_debit = NULL, tx_credit = NULL
            WHERE id = $1`,
          [legacyUsdRow.id],
        );
        await testDb.owner.query(
          `UPDATE fin_journal_entry_lines
              SET tx_currency_code = COALESCE(currency, 'IRR'),
                  fx_rate_applied = COALESCE(fx_rate, 1.0),
                  tx_debit = CASE
                    WHEN COALESCE(currency, 'IRR') <> 'IRR' AND COALESCE(debit, 0) > 0 THEN
                      ROUND(COALESCE(amount_fx, debit / COALESCE(NULLIF(fx_rate, 0), 1.0)), 2)
                    WHEN COALESCE(currency, 'IRR') <> 'IRR' THEN 0
                    ELSE debit
                  END,
                  tx_credit = CASE
                    WHEN COALESCE(currency, 'IRR') <> 'IRR' AND COALESCE(credit, 0) > 0 THEN
                      ROUND(COALESCE(amount_fx, credit / COALESCE(NULLIF(fx_rate, 0), 1.0)), 2)
                    WHEN COALESCE(currency, 'IRR') <> 'IRR' THEN 0
                    ELSE credit
                  END,
                  book_debit = debit,
                  book_credit = credit,
                  is_rounding = false
            WHERE id = $1 AND book_debit IS NULL`,
          [legacyUsdRow.id],
        );
        [backfilledUsdRow] = await testDb.owner.query(
          `SELECT * FROM fin_journal_entry_lines WHERE id = $1`,
          [legacyUsdRow.id],
        );
      } finally {
        await testDb.owner.query(
          `ALTER TABLE fin_journal_entry_lines ENABLE TRIGGER "TRG_fin_journal_entry_lines_dual_sync"`,
        );
      }
      expect(Number(backfilledUsdRow.book_debit)).toBe(92000000);
      expect(Number(backfilledUsdRow.tx_debit)).toBe(100);
      expect(Number(backfilledUsdRow.tx_credit)).toBe(0);

      // 2. Insert line using dual-amount columns directly
      const [dualRow] = await testDb.scope.within(T1, undefined, async (manager) => {
        return manager.query(
          `INSERT INTO fin_journal_entry_lines
             (tenant_id, journal_entry_id, account_id, book_debit, book_credit, tx_debit, tx_credit, tx_currency_code, fx_rate_applied, is_rounding)
           VALUES
             ($1, $2, (SELECT id FROM fin_chart_of_accounts WHERE tenant_id=$1 AND code='4010'), 0.00, 50.00, 0.00, 50.00, 'EUR', 1.08, false)
           RETURNING *`,
          [T1, draft.id],
        );
      });

      expect(Number(dualRow.debit)).toBe(0);
      expect(Number(dualRow.credit)).toBe(50);
      expect(dualRow.currency).toBe('EUR');
      expect(Number(dualRow.fx_rate)).toBe(1.08);
    });
  });

  describe('Database Trigger Balance Enforcement (fin_assert_entry_consistent)', () => {
    it('allows posted dual-amount vouchers that balance in book and transaction currency', async () => {
      const entry = await accounting.createJournalEntry(T1, {
        entryNumber: 'DUAL-POSTED-001',
        description: 'ثبت سند ارزی قطعی',
        lines: [
          {
            accountCode: '1010',
            txCurrencyCode: 'USD',
            txDebit: 200,
            txCredit: 0,
            bookDebit: 184000000,
            bookCredit: 0,
            fxRateApplied: 920000,
          },
          {
            accountCode: '4010',
            txCurrencyCode: 'USD',
            txDebit: 0,
            txCredit: 200,
            bookDebit: 0,
            bookCredit: 184000000,
            fxRateApplied: 920000,
          },
        ],
      });

      expect(entry.id).toBeDefined();
      expect(entry.status).toBe(JournalEntryStatus.POSTED);
    });

    it('rejects database write if book currency does not balance on POSTED entry', async () => {
      // Create a draft
      const draft = await accounting.createJournalEntry(T1, {
        entryNumber: 'DB-UNBAL-BOOK',
        description: 'تست خطای تراز دفاتر در پایگاه داده',
        status: JournalEntryStatus.DRAFT,
        lines: [
          { accountCode: '1010', debit: 100 },
          { accountCode: '4010', credit: 100 },
        ],
      });

      // Update lines to be unbalanced in book currency and try to set status to POSTED
      await expect(
        testDb.scope.within(T1, undefined, async (manager) => {
          await manager.query(
            `UPDATE fin_journal_entry_lines
                SET book_debit = 100, debit = 100
              WHERE journal_entry_id = $1 AND debit > 0`,
            [draft.id],
          );
          await manager.query(
            `UPDATE fin_journal_entry_lines
                SET book_credit = 90, credit = 90
              WHERE journal_entry_id = $1 AND credit > 0`,
            [draft.id],
          );
          await manager.query(
            `UPDATE fin_journal_entries SET status = 'POSTED' WHERE id = $1`,
            [draft.id],
          );
        }),
      ).rejects.toThrow(/cannot leave DRAFT.*balances/);
    });

    it('rejects database write if single transaction currency does not balance on POSTED entry', async () => {
      const draft = await accounting.createJournalEntry(T1, {
        entryNumber: 'DB-UNBAL-TX',
        description: 'تست خطای تراز ارز معامله در پایگاه داده',
        status: JournalEntryStatus.DRAFT,
        lines: [
          { accountCode: '1010', debit: 100 },
          { accountCode: '4010', credit: 100 },
        ],
      });

      // Book balances (100 = 100), but USD amounts are unbalanced (100 USD vs 90 USD)
      await expect(
        testDb.scope.within(T1, undefined, async (manager) => {
          await manager.query(
            `UPDATE fin_journal_entry_lines
                SET tx_currency_code = 'USD', tx_debit = 100
              WHERE journal_entry_id = $1 AND debit > 0`,
            [draft.id],
          );
          await manager.query(
            `UPDATE fin_journal_entry_lines
                SET tx_currency_code = 'USD', tx_credit = 90
              WHERE journal_entry_id = $1 AND credit > 0`,
            [draft.id],
          );
          await manager.query(
            `UPDATE fin_journal_entries SET status = 'POSTED' WHERE id = $1`,
            [draft.id],
          );
        }),
      ).rejects.toThrow(/not balanced in transaction currency/);
    });

    it('allows rounding line (is_rounding = true) to balance book residual in database', async () => {
      const entry = await accounting.createJournalEntry(T1, {
        entryNumber: 'DB-ROUNDING-OK',
        description: 'تست سطر گردکردن در دیتابیس',
        lines: [
          {
            accountCode: '1010',
            txCurrencyCode: 'USD',
            txDebit: 100,
            bookDebit: '920000.50',
          },
          {
            accountCode: '4010',
            txCurrencyCode: 'USD',
            txCredit: 100,
            bookCredit: '920000.00',
          },
          {
            accountCode: '2010',
            txCurrencyCode: 'IRR',
            bookCredit: '0.50',
            isRounding: true,
          },
        ],
      });

      expect(entry.id).toBeDefined();
      expect(entry.status).toBe(JournalEntryStatus.POSTED);
    });
  });
});
