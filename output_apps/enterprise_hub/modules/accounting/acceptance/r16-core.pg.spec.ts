/**
 * R16 core acceptance suite (T177), part 2: tests that need PostgreSQL. Skipped without
 * ROXIRA_TEST_PG_HOST. The services run against a throwaway database as the `roxira_app` role
 * (NOSUPERUSER NOBYPASSRLS); only direct "privileged role" attacks use the owner connection.
 * Spec text: docs/strategy/research/R16_ACCEPTANCE_TESTS.md. Each `it.skip` names the row that
 * adds the missing capability.
 */
import 'reflect-metadata';
import { CurrencyService } from '../../currency/services/currency.service';
import { InventoryRepository } from '../../inventory/repositories/inventory.repository';
import { StockDocumentsRepository } from '../../inventory/repositories/stock-documents.repository';
import { InventoryService } from '../../inventory/services/inventory.service';
import { StockDocumentsService } from '../../inventory/services/stock-documents.service';
import { FifoBatchEntity } from '../../inventory/entities/fifo-batch.entity';
import { StockItemEntity } from '../../inventory/entities/stock-item.entity';
import { WarehouseEntity } from '../../inventory/entities/warehouse.entity';
import { PostingRulesRepository } from '../../posting_rules/repositories/posting-rules.repository';
import { PostingRulesService } from '../../posting_rules/services/posting-rules.service';
import { DimensionKind, JournalEntryStatus } from '../enums/accounting.enum';
import { fromDb, minorToDecimal, toMinor } from '../money';
import { AccountingRepository } from '../repositories/accounting.repository';
import { DimensionRepository } from '../repositories/dimension.repository';
import { FiscalYearRepository } from '../repositories/fiscal-year.repository';
import { LedgerReportRepository } from '../repositories/ledger-report.repository';
import { AccountingService } from '../services/accounting.service';
import { ChartTemplateService } from '../services/chart-template.service';
import { CostCentreReportService } from '../services/cost-centre-report.service';
import { DimensionService } from '../services/dimension.service';
import { FinancialReportsService } from '../services/financial-reports.service';
import { createTestDatabase, describePg, TestDatabaseContext, TEST_T1 as T1, TEST_T2 as T2 } from '../../../test/support/test-pg';
import {
  R16_T3_PERIODS as T3,
  R16_T4_AUDIT as T4,
  R16_T5_DIMENSIONS as T5,
  R16_T8_INVENTORY as T8,
} from './r16-fixtures';

const noon = (day: string) => `${day}T12:00:00.000Z`;
const decimal = minorToDecimal;

describePg('R16 core acceptance on PostgreSQL', () => {
  let testDb: TestDatabaseContext;
  let accounting: AccountingService;
  let dims: DimensionService;
  let costCentres: CostCentreReportService;
  let inventory: InventoryService;
  let documents: StockDocumentsService;

  beforeAll(async () => {
    testDb = await createTestDatabase('r16');
    const currency = { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService;
    const repo = new AccountingRepository(testDb.scope);
    accounting = new AccountingService(repo, currency);
    await new ChartTemplateService(repo).apply(T1, 'iran-trading');
    const dimensionRepo = new DimensionRepository(testDb.app);
    dims = new DimensionService(dimensionRepo);
    const ledger = new LedgerReportRepository(testDb.scope);
    costCentres = new CostCentreReportService(
      new FinancialReportsService(repo, new FiscalYearRepository(testDb.app), ledger),
      ledger,
      dimensionRepo,
    );
    inventory = new InventoryService(
      new InventoryRepository(
        testDb.app.getRepository(WarehouseEntity),
        testDb.app.getRepository(StockItemEntity),
        testDb.app.getRepository(FifoBatchEntity),
        testDb.app,
        testDb.scope,
      ),
    );
    documents = new StockDocumentsService(
      new StockDocumentsRepository(testDb.app, testDb.scope),
      inventory,
      accounting,
      new PostingRulesService(new PostingRulesRepository(testDb.scope), accounting),
    );
  }, 180_000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  describe('T3 period close and locks (T178)', () => {
    let lockId = 0;
    let draftId = 0;
    const pair = (entryNumber: string, date: string, status: JournalEntryStatus) => ({
      entryNumber,
      date: noon(date),
      description: 'R16 T3',
      status,
      lines: [
        { accountCode: '5020', debit: '800.00' },
        { accountCode: '1010', credit: '800.00' },
      ],
    });

    it('keeps DRAFT-9 out of the ledger and locks 2026-10 with a reason', async () => {
      draftId = (await accounting.createJournalEntry(T1, pair(T3.draftBill.id, T3.draftBill.date, JournalEntryStatus.DRAFT) as never)).id;
      const lock = await accounting.lockPeriod(T1, 'chief-accountant', {
        periodStart: T3.lockedMonth.start,
        periodEnd: T3.lockedMonth.end,
        reason: 'October soft lock',
      });
      lockId = lock.id;
      expect(lock.active).toBe(true);
      expect(await accounting.isPeriodLocked(T1, new Date(noon(T3.postingDateInLockedMonth)))).toBe(true);
      expect(await accounting.isPeriodLocked(T1, new Date(noon('2026-11-05')))).toBe(false);
    });

    it('refuses posting DRAFT-9 and a new voucher inside the locked month (423 today, spec says 422 PERIOD_LOCKED)', async () => {
      await expect(accounting.changeVoucherStatus(T1, draftId, JournalEntryStatus.POSTED)).rejects.toMatchObject({ status: 423 });
      await expect(
        accounting.createJournalEntry(T1, pair('LATE-OCT', T3.postingDateInLockedMonth, JournalEntryStatus.POSTED) as never),
      ).rejects.toMatchObject({ status: 423 });
    });

    it('still posts into the open November', async () => {
      const entry = await accounting.createJournalEntry(T1, pair('NOV-1', '2026-11-05', JournalEntryStatus.POSTED) as never);
      expect(entry.status).toBe('POSTED');
    });

    it('a plain soft lock can be lifted with a reason (the spec wants this only for a role exception)', async () => {
      const unlocked = await accounting.unlockPeriod(T1, 'admin', lockId, { reason: 'R16 test cleanup' });
      expect(unlocked.active).toBe(false);
    });

    it.skip('soft lock with an exception for the chief accountant role: the AP clerk gets 422 PERIOD_LOCKED, the chief accountant can post — needs T178 (locks are all-or-nothing and answer 423)', () => undefined);
    it.skip('hard close is blocked while DRAFT-9 is unposted, naming it — needs T178', () => undefined);
    it.skip('after hard close admin can neither unlock nor post into 2026-10; corrections go to 2026-11 or an adjustment period — needs T178 (no hard-close state, no adjustment period)', () => undefined);
  });

  describe('T4 audit trail and immutability (T178)', () => {
    let journalId = 0;
    const amount = decimal(T4.journal.rent);

    it('posts J-42 (Dr rent 2,500.00 / Cr AP 2,500.00)', async () => {
      const entry = await accounting.createJournalEntry(T1, {
        entryNumber: 'J-42',
        date: noon('2026-11-10'),
        description: 'rent',
        lines: [
          { accountCode: '5020', debit: amount },
          { accountCode: '2010', credit: amount },
        ],
      } as never);
      journalId = entry.id;
      expect(entry.status).toBe('POSTED');
    });

    it('refuses to change a posted voucher through the service', async () => {
      await expect(
        accounting.updateVoucher(T1, journalId, {
          entryNumber: 'J-42',
          description: 'x',
          lines: [
            { accountCode: '5020', debit: '1.00' },
            { accountCode: '2010', credit: '1.00' },
          ],
        } as never),
      ).rejects.toMatchObject({ status: expect.any(Number) });
      await expect(accounting.deleteVoucher(T1, journalId)).rejects.toMatchObject({ status: expect.any(Number) });
    });

    it('refuses a privileged database role: the trigger blocks amount and header changes', async () => {
      await expect(testDb.rawQuery(`UPDATE fin_journal_entry_lines SET debit = 1 WHERE journal_entry_id = $1`, [journalId])).rejects.toThrow(/immutable/);
      await expect(testDb.rawQuery(`UPDATE fin_journal_entries SET entry_number = 'J-99' WHERE id = $1`, [journalId])).rejects.toThrow();
      await expect(testDb.rawQuery(`DELETE FROM fin_journal_entries WHERE id = $1`, [journalId])).rejects.toThrow();
    });

    it('reverses J-42 with a linked entry that nets every account to zero; a second reversal is refused', async () => {
      const reversal = await accounting.reverseJournalEntry(T1, journalId, { date: noon('2026-11-11'), reason: 'R16 T4' });
      expect(reversal.entryNumber).toBe('J-42-REV');
      const nets: Array<{ code: string; net: string }> = await testDb.rawQuery(
        `SELECT a.code, SUM(l.debit - l.credit) AS net
           FROM fin_journal_entry_lines l
           JOIN fin_journal_entries e ON e.id = l.journal_entry_id
           JOIN fin_chart_of_accounts a ON a.id = l.account_id
          WHERE e.tenant_id = $1 AND e.entry_number IN ('J-42', 'J-42-REV')
          GROUP BY a.code`,
        [T1],
      );
      expect(nets.map((r) => r.code).sort()).toEqual(['2010', '5020']);
      for (const row of nets) expect(fromDb(row.net)).toBe(0n);
      await expect(accounting.reverseJournalEntry(T1, journalId)).rejects.toMatchObject({ status: 409 });
    });

    it.skip(`GL audit numbers ${T4.journal.number} and ${T4.reversalNumber} with SHA-256 chain H43 = SHA256(H42 || canonical(J-43)) — needs T178 (hash chain, gapless audit number)`, () => undefined);
    it.skip('verify-chain returns VALID, 0 gaps, 43/43 — needs T178', () => undefined);
    it.skip('a VAT code description change shows user, time, old and new value in the change log immediately — needs T178 (master-data change log)', () => undefined);
  });

  describe('T5 dimensions (T181)', () => {
    it('posts BILL-55 split 600.00 CC-RND / 400.00 CC-SALES and the cost-centre trial balance balances', async () => {
      await dims.create(T1, { kind: DimensionKind.COST_CENTER, code: 'CC-RND', name: 'R&D' });
      await dims.create(T1, { kind: DimensionKind.COST_CENTER, code: 'CC-SALES', name: 'Sales' });
      await accounting.createJournalEntry(T1, {
        entryNumber: T5.bill.id,
        date: noon('2026-10-12'),
        description: 'BILL-55',
        lines: [
          { accountCode: '5020', debit: decimal(T5.bill.splits['CC-RND']), costCenterCode: 'CC-RND' },
          { accountCode: '5020', debit: decimal(T5.bill.splits['CC-SALES']), costCenterCode: 'CC-SALES' },
          { accountCode: '2010', credit: decimal(T5.bill.total) },
        ],
      } as never);
      const report = await costCentres.trialBalance(T1, { from: '2026-10-01', to: '2026-10-31' });
      const debit = (code: string) => report.centres.find((c) => c.code === code)!.totals.periodDebit;
      expect(debit('CC-RND')).toBe(fromDb(decimal(T5.bill.splits['CC-RND'])));
      expect(debit('CC-SALES')).toBe(fromDb(decimal(T5.expected.salesAt20261031)));
      expect(report.balanced).toBe(true);
    });

    it.skip('required-dimension rules: a CC-RND line without Project returns 422 DIMENSION_RULE_VIOLATION — needs T181 (dimension rules)', () => undefined);
    it.skip('e-invoicing enabled uses no dimension slot; five dimensions at once — needs T181 (dimensions v2 beyond cost centre and project)', () => undefined);
    it.skip('rename CC-SALES to CC-EMEA-SALES effective 2026-11-01: the 2026-10-31 report keeps CC-SALES 400.00, 2026-11-30 shows CC-EMEA-SALES — needs T181 (effective-dated dimension names)', () => undefined);
  });

  describe('T8 inventory valuation', () => {
    let wh = 0;

    it('FIFO: receive 10 @ 10.00 then 10 @ 12.00, deliver 12 -> COGS 124.00, ending 96.00', async () => {
      wh = (await inventory.createWarehouse(T1, { name: 'R16', locationCode: 'R16-1' })).id;
      await inventory.createStockItem(T1, { sku: 'SKU-FIFO', barcode: 'SKU-FIFO', name: 'SKU-FIFO' } as never);
      for (const r of T8.receipts) {
        await documents.createReceipt(T1, 'u', {
          toWarehouseId: wh,
          docDate: `2026-11-0${r.day}`,
          lines: [{ sku: 'SKU-FIFO', quantity: r.qty, unitCost: r.unitCost }],
        });
      }
      const delivery = await documents.createDelivery(T1, 'u', {
        fromWarehouseId: wh,
        lines: [{ sku: 'SKU-FIFO', quantity: T8.deliveredQty }],
      });
      expect(toMinor(delivery.totalValue)).toBe(T8.expected.fifo.cogs);
      const [ending] = await testDb.rawQuery<{ value: string }>(
        `SELECT COALESCE(SUM(quantity_remaining * unit_purchase_cost), 0) AS value FROM inventory_fifo_batches WHERE tenant_id = $1 AND sku = 'SKU-FIFO'`,
        [T1],
      );
      expect(fromDb(ending.value)).toBe(T8.expected.fifo.ending);
    });

    it('tenant B sees none of tenant A inventory under RLS as roxira_app', async () => {
      const count = (tenant: string) =>
        testDb.scope.within(tenant, undefined, async (manager) => {
          const [row] = (await manager.query(`SELECT count(*)::int AS n FROM inventory_fifo_batches`)) as Array<{ n: number }>;
          return row.n;
        });
      expect(await count(T1)).toBeGreaterThan(0);
      expect(await count(T2)).toBe(0);
    });

    it('issuing more units than are on hand is refused and leaves no document (negative stock disabled)', async () => {
      const before = (await documents.list(T1, { page: 1, limit: 100 })).total;
      await expect(
        documents.createDelivery(T1, 'u', { fromWarehouseId: wh, lines: [{ sku: 'SKU-FIFO', quantity: 20 }] }),
      ).rejects.toMatchObject({ status: 400 });
      expect((await documents.list(T1, { page: 1, limit: 100 })).total).toBe(before);
    });

    it.skip('AVCO: COGS 132.00, ending 88.00 — needs T195 (AVCO and standard costing; only FIFO layers exist)', () => undefined);
    it.skip('STD cost 11.00: PPV +10.00 day 1, -10.00 day 2, COGS 132.00, ending 88.00 — needs T195', () => undefined);
    it.skip('GL inventory 272.00 equals the subledger across the three SKUs — needs T195', () => undefined);
    it.skip('a manual journal into the inventory control account is rejected — needs T178 (control-account guard)', () => undefined);
  });
});
