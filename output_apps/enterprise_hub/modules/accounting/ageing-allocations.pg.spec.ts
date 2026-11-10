/**
 * Ageing by real treasury allocations (#237) on a REAL PostgreSQL: invoices posted to the ledger,
 * a receipt allocated through TreasuryService, then FinancialReportsService.ageing.
 * Opt-in: skipped unless ROXIRA_TEST_PG_HOST is set.
 */
import 'reflect-metadata';
import { ModuleRef } from '@nestjs/core';
import { ChequesRepository } from '../cheques/repositories/cheques.repository';
import { ChequesService } from '../cheques/services/cheques.service';
import { CurrencyService } from '../currency/services/currency.service';
import { PostingRulesRepository } from '../posting_rules/repositories/posting-rules.repository';
import { PostingRulesService } from '../posting_rules/services/posting-rules.service';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { InvoiceDirection } from '../invoicing/enums/invoice-kind.enum';
import { InvoiceStatus } from '../invoicing/enums/invoice-status.enum';
import { TreasuryDocKind, TreasuryMethod, TreasuryPartyType } from '../treasury/enums/treasury.enum';
import { TreasuryLedgerPostingAdapter } from '../treasury/posting/treasury-ledger-posting.adapter';
import { TreasuryRepository } from '../treasury/repositories/treasury.repository';
import { TreasuryService } from '../treasury/services/treasury.service';
import { AccountType } from './enums/accounting.enum';
import { AGEING_ALLOCATIONS } from './reports/ageing-allocations';
import { AccountingRepository } from './repositories/accounting.repository';
import { FiscalYearRepository } from './repositories/fiscal-year.repository';
import { LedgerReportRepository } from './repositories/ledger-report.repository';
import { AccountingService } from './services/accounting.service';
import { FinancialReportsService } from './services/financial-reports.service';
import {
  createTestDatabase,
  describePg,
  TestDatabaseContext,
  TEST_T1 as T1,
  TEST_T2 as T2,
} from '../../test/support/test-pg';

describePg('Ageing by treasury allocations on PostgreSQL (#237)', () => {
  let testDb: TestDatabaseContext;
  let accounting: AccountingService;
  let treasury: TreasuryService;
  /** Ageing as the app wires it: treasury bound to AGEING_ALLOCATIONS. */
  let reports: FinancialReportsService;
  /** Ageing with no treasury module loaded: FIFO. */
  let fifoReports: FinancialReportsService;
  const invoices = new Map<string, { number: string; payable: number }>();

  /** Posts a sale to the ledger and stores the invoice row that points at the entry. */
  const sale = async (tenantId: string, number: string, day: string, amount: number, partyCode: string) => {
    const entry = await accounting.createJournalEntry(tenantId, {
      entryNumber: `INV-${number}`,
      date: `${day}T12:00:00.000Z`,
      description: `فروش ${number}`,
      lines: [
        { accountCode: '1020', debit: String(amount), credit: '0', partyCode },
        { accountCode: '4010', debit: '0', credit: String(amount) },
      ],
    } as never);
    const inserted = await testDb.owner.getRepository(InvoiceEntity).insert({
      tenantId,
      taxInvoiceNumber: number,
      sellerInfo: {} as never,
      buyerInfo: {} as never,
      items: [],
      totalAmount: amount,
      totalDiscount: 0,
      totalTax: 0,
      finalPayable: amount,
      status: InvoiceStatus.ISSUED,
      journalEntryId: entry.id,
    } as never);
    const id = String(inserted.identifiers[0].id);
    invoices.set(id, { number, payable: amount });
    return id;
  };

  const receipt = (tenantId: string, partyCode: string, day: string, amount: number, invoiceId: string) =>
    treasury.createDocument(tenantId, {
      kind: TreasuryDocKind.RECEIPT,
      partyType: TreasuryPartyType.CUSTOMER,
      partyCode,
      partyName: 'شرکت نمونه پارس',
      docDate: day,
      methods: [{ method: TreasuryMethod.CASH, amount: String(amount) }],
      allocations: [{ invoiceId, amount: String(amount) }],
    } as never);

  beforeAll(async () => {
    testDb = await createTestDatabase('age');
    const scope = testDb.scope;
    const currency = { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService;
    const repo = new AccountingRepository(scope);
    accounting = new AccountingService(repo, currency);
    for (const tenantId of [T1, T2]) {
      await testDb.rawQuery(
        `INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $2) ON CONFLICT DO NOTHING`,
        [tenantId, tenantId.slice(0, 8)],
      ).catch(() => undefined);
      for (const [code, name, accountType] of [
        ['1010', 'بانک', AccountType.ASSET],
        ['1020', 'حساب‌های دریافتنی', AccountType.ASSET],
        ['2010', 'حساب‌های پرداختنی', AccountType.LIABILITY],
        ['4010', 'فروش', AccountType.REVENUE],
      ] as const) {
        await accounting.createAccount(tenantId, { code, name, accountType } as never).catch((e: Error) => {
          if (e.constructor.name !== 'ConflictException') throw e;
        });
      }
    }
    const invoicing = {
      findOne: async (_t: string, id: string) => ({
        id,
        taxInvoiceNumber: invoices.get(id)?.number,
        finalPayable: invoices.get(id)?.payable,
        direction: InvoiceDirection.SALE,
        status: InvoiceStatus.ISSUED,
      }),
    };
    treasury = new TreasuryService(
      new TreasuryRepository(scope),
      new TreasuryLedgerPostingAdapter(accounting),
      { listAccounts: async () => [] } as never,
      new ChequesService(
        new ChequesRepository(scope),
        accounting,
        new PostingRulesService(new PostingRulesRepository(scope), accounting),
      ),
      invoicing as never,
    );
    const moduleRef = {
      get: (token: unknown) => {
        if (token !== AGEING_ALLOCATIONS) throw new Error('unknown token');
        return treasury;
      },
    } as unknown as ModuleRef;
    const ledger = new LedgerReportRepository(scope);
    const fiscal = new FiscalYearRepository(testDb.app);
    reports = new FinancialReportsService(repo, fiscal, ledger, moduleRef);
    fifoReports = new FinancialReportsService(repo, fiscal, ledger);
  }, 240_000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('a payment allocated to the newest invoice leaves the oldest invoice in its old bucket', async () => {
    await sale(T1, 'F-100', '2026-06-01', 1_000_000, 'C1'); // 153 days old on 2026-11-01
    const newest = await sale(T1, 'F-101', '2026-10-20', 500_000, 'C1'); // 12 days old
    await receipt(T1, 'C1', '2026-10-25', 500_000, newest);

    const query = { side: 'receivable' as const, to: '2026-11-01', partyCode: 'C1' };
    const real = (await reports.ageing(T1, query)).rows;
    expect(real).toHaveLength(1);
    // [0-30, 31-60, 61-90, 91+]: the old invoice is untouched, the newest is settled.
    expect(real[0].amounts).toEqual([0n, 0n, 0n, 100_000_000n]);
    expect(real[0].oldestOpenDay).toBe('2026-06-01');
    expect(real[0].balance).toBe(100_000_000n);

    // FIFO (no treasury bound) would have paid half of the oldest instead. Totals agree.
    const fifo = (await fifoReports.ageing(T1, query)).rows;
    expect(fifo[0].amounts).toEqual([50_000_000n, 0n, 0n, 50_000_000n]);
    expect(fifo[0].balance).toBe(real[0].balance);
  });

  it('keeps FIFO for a manual voucher with no allocation, and keeps companies apart', async () => {
    await sale(T1, 'F-200', '2026-07-01', 300_000, 'C2');
    await sale(T1, 'F-201', '2026-10-15', 200_000, 'C2');
    // A manual receipt voucher: no treasury document, so it settles the oldest item first.
    await accounting.createJournalEntry(T1, {
      entryNumber: 'MAN-1',
      date: '2026-10-28T12:00:00.000Z',
      description: 'وصول دستی',
      lines: [
        { accountCode: '1010', debit: '100000', credit: '0' },
        { accountCode: '1020', debit: '0', credit: '100000', partyCode: 'C2' },
      ],
    } as never);
    const rows = (await reports.ageing(T1, { side: 'receivable', to: '2026-11-01', partyCode: 'C2' })).rows;
    expect(rows[0].amounts).toEqual([20_000_000n, 0n, 0n, 20_000_000n]);

    // The other company has the same party code but none of these lines or allocations.
    await sale(T2, 'F-100', '2026-06-01', 7, 'C1');
    const other = (await reports.ageing(T2, { side: 'receivable', to: '2026-11-01', partyCode: 'C1' })).rows;
    expect(other.map((r) => r.amounts)).toEqual([[0n, 0n, 0n, 700n]]);
  });
});
