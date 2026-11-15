import 'reflect-metadata';
import { CurrencyService } from '../currency/services/currency.service';
import { JournalEntryStatus } from './enums/accounting.enum';
import { InvoiceDirection } from '../invoicing/enums/invoice-kind.enum';
import { InvoiceStatus } from '../invoicing/enums/invoice-status.enum';
import { InvoiceEntity } from '../invoicing/entities/invoice.entity';
import { AccountingRepository } from './repositories/accounting.repository';
import { FiscalYearRepository } from './repositories/fiscal-year.repository';
import { LedgerReportRepository } from './repositories/ledger-report.repository';
import { InvoicingRepository } from '../invoicing/repositories/invoicing.repository';
import { HrRepository } from '../hr/repositories/hr.repository';
import { AccountingService } from './services/accounting.service';
import { FinancialReportsService } from './services/financial-reports.service';
import { ChartTemplateService } from './services/chart-template.service';
import { InvoicingService } from '../invoicing/services/invoicing.service';
import { SalesReportService } from '../invoicing/services/sales-report.service';
import { HrService } from '../hr/services/hr.service';
import {
  createTestDatabase,
  describePg,
  TestDatabaseContext,
  TEST_T1 as T1,
  TEST_T2 as T2,
} from '../../test/support/test-pg';

describePg('Branch dimension on PostgreSQL (T122)', () => {
  let testDb: TestDatabaseContext;
  let accounting: AccountingService;
  let reports: FinancialReportsService;
  let invoicing: InvoicingService;
  let invRepo: InvoicingRepository;
  let salesReport: SalesReportService;
  let hr: HrService;
  let branchAId: string;
  let branchBId: string;

  beforeAll(async () => {
    testDb = await createTestDatabase('branch_dim');

    const currency = {
      convert: (v: number) => v,
      round: (v: number) => v,
      getRate: () => 1,
    } as unknown as CurrencyService;

    const accRepo = new AccountingRepository(testDb.scope);
    accounting = new AccountingService(accRepo, currency);
    const fiscalRepo = new FiscalYearRepository(testDb.app);
    const ledgerRepo = new LedgerReportRepository(testDb.scope);
    reports = new FinancialReportsService(accRepo, fiscalRepo, ledgerRepo);

    invRepo = new InvoicingRepository(testDb.app.getRepository(InvoiceEntity), testDb.app, testDb.scope);
    invoicing = new InvoicingService(invRepo, currency);
    salesReport = new SalesReportService(invRepo);

    const hrRepo = new HrRepository(testDb.scope, testDb.app);
    hr = new HrService(hrRepo, accounting as never, {} as never, {} as never);

    // Seed tenants T1 and T2
    await testDb.rawQuery(
      `INSERT INTO "tenants" ("id", "name", "slug") VALUES ($1, 'شرکت الف', 'tenant-a'), ($2, 'شرکت ب', 'tenant-b') ON CONFLICT DO NOTHING`,
      [T1, T2],
    );

    // Apply standard chart of accounts for T1
    await new ChartTemplateService(accRepo).apply(T1, 'iran-trading');

    // Create 2 branches for tenant T1
    const resA = await testDb.rawQuery(
      `INSERT INTO "tenant_branches" ("id", "tenant_id", "name", "code", "created_at")
       VALUES (gen_random_uuid(), $1, 'شعبه شمال', 'NORTH', NOW())
       RETURNING "id"`,
      [T1],
    );
    branchAId = resA[0].id;

    const resB = await testDb.rawQuery(
      `INSERT INTO "tenant_branches" ("id", "tenant_id", "name", "code", "created_at")
       VALUES (gen_random_uuid(), $1, 'شعبه جنوب', 'SOUTH', NOW())
       RETURNING "id"`,
      [T1],
    );
    branchBId = resB[0].id;
  }, 120000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('verifies roxira_app connection role is strictly NOSUPERUSER NOBYPASSRLS', async () => {
    const [role] = await testDb.app.query(
      `SELECT current_user AS u, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user`,
    );
    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);
  });

  it('verifies branch_id columns and tenant-branch indexes exist on all 4 tables', async () => {
    const tables = ['invoices', 'fin_pos_settlements', 'fin_journal_entry_lines', 'hr_employees'];

    for (const table of tables) {
      const cols = await testDb.rawQuery(
        `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_name = $1 AND column_name = 'branch_id'`,
        [table],
      );
      expect(cols.length).toBe(1);
      expect(cols[0].data_type).toBe('uuid');
      expect(cols[0].is_nullable).toBe('YES');

      const indexes = await testDb.rawQuery(
        `SELECT indexname FROM pg_indexes WHERE tablename = $1 AND indexname = $2`,
        [table, `IDX_${table}_tenant_branch`],
      );
      expect(indexes.length).toBe(1);
    }
  });

  it('filters financial reports (income statement and trial balance) by branchId', async () => {
    // Post expense on Branch A
    await accounting.createJournalEntry(T1, {
      entryNumber: 'JV-BR-A',
      date: '2026-05-01',
      description: 'هزینه اجاره شعبه شمال',
      branchId: branchAId,
      status: JournalEntryStatus.POSTED,
      lines: [
        { accountCode: '5020', debit: '100000.00', branchId: branchAId },
        { accountCode: '1010', credit: '100000.00', branchId: branchAId },
      ],
    } as never);

    // Post expense on Branch B
    await accounting.createJournalEntry(T1, {
      entryNumber: 'JV-BR-B',
      date: '2026-05-02',
      description: 'هزینه اجاره شعبه جنوب',
      branchId: branchBId,
      status: JournalEntryStatus.POSTED,
      lines: [
        { accountCode: '5020', debit: '250000.00', branchId: branchBId },
        { accountCode: '1010', credit: '250000.00', branchId: branchBId },
      ],
    } as never);

    const periodAll = { from: '2026-04-01', to: '2026-06-30' };
    const periodA = { ...periodAll, branchId: branchAId };
    const periodB = { ...periodAll, branchId: branchBId };

    // 1. Income Statement
    const incAll = await reports.incomeStatement(T1, periodAll);
    const incA = await reports.incomeStatement(T1, periodA);
    const incB = await reports.incomeStatement(T1, periodB);

    expect(incAll.operatingExpenses.total).toBe(35000000n);
    expect(incA.operatingExpenses.total).toBe(10000000n);
    expect(incB.operatingExpenses.total).toBe(25000000n);

    // 2. Trial Balance
    const tbA = await reports.trialBalance(T1, periodA);
    const tbB = await reports.trialBalance(T1, periodB);

    const tbRentA = tbA.rows.find((r) => r.code === '5020');
    const tbRentB = tbB.rows.find((r) => r.code === '5020');

    expect(tbRentA?.turnoverDebit).toBe(10000000n);
    expect(tbRentB?.turnoverDebit).toBe(25000000n);
  });

  it('persists branchId on invoices and isolates queries by branchId', async () => {
    // Invoice 1 on Branch A
    const invA = await invoicing.create(T1, {
      taxInvoiceNumber: 'INV-BR-A1',
      branchId: branchAId,
      direction: InvoiceDirection.SALE,
      status: InvoiceStatus.ISSUED,
      sellerInfo: { name: 'فروشنده الف' },
      buyerInfo: { name: 'خریدار ۱' },
      items: [
        {
          description: 'کالای شعبه شمال',
          quantity: 2,
          unitPrice: 100000,
          vatRate: 10,
        },
      ],
    });
    expect(invA.branchId).toBe(branchAId);

    // Invoice 2 on Branch B
    const invB = await invoicing.create(T1, {
      taxInvoiceNumber: 'INV-BR-B1',
      branchId: branchBId,
      direction: InvoiceDirection.SALE,
      status: InvoiceStatus.ISSUED,
      sellerInfo: { name: 'فروشنده الف' },
      buyerInfo: { name: 'خریدار ۲' },
      items: [
        {
          description: 'کالای شعبه جنوب',
          quantity: 3,
          unitPrice: 200000,
          vatRate: 10,
        },
      ],
    });
    expect(invB.branchId).toBe(branchBId);

    // Query invoices filtered by branch
    const listA = await invoicing.findAll(T1, { page: 1, limit: 10, branchId: branchAId });
    const listB = await invoicing.findAll(T1, { page: 1, limit: 10, branchId: branchBId });

    expect(listA.data.some((inv) => inv.taxInvoiceNumber === 'INV-BR-A1')).toBe(true);
    expect(listA.data.some((inv) => inv.taxInvoiceNumber === 'INV-BR-B1')).toBe(false);

    expect(listB.data.some((inv) => inv.taxInvoiceNumber === 'INV-BR-B1')).toBe(true);
    expect(listB.data.some((inv) => inv.taxInvoiceNumber === 'INV-BR-A1')).toBe(false);

    // Sales report filtered by branch
    const repA = await salesReport.build(T1, { groupBy: 'item', branchId: branchAId });
    const repB = await salesReport.build(T1, { groupBy: 'item', branchId: branchBId });

    expect(JSON.stringify(repA.json)).toContain('کالای شعبه شمال');
    expect(JSON.stringify(repA.json)).not.toContain('کالای شعبه جنوب');

    expect(JSON.stringify(repB.json)).toContain('کالای شعبه جنوب');
    expect(JSON.stringify(repB.json)).not.toContain('کالای شعبه شمال');

    // findSalesBetween and findPurchasesBetween
    const salesA = await invRepo.findSalesBetween(T1, undefined, undefined, branchAId);
    const salesB = await invRepo.findSalesBetween(T1, undefined, undefined, branchBId);
    expect(salesA.some((inv) => inv.taxInvoiceNumber === 'INV-BR-A1')).toBe(true);
    expect(salesA.some((inv) => inv.taxInvoiceNumber === 'INV-BR-B1')).toBe(false);
    expect(salesB.some((inv) => inv.taxInvoiceNumber === 'INV-BR-B1')).toBe(true);
    expect(salesB.some((inv) => inv.taxInvoiceNumber === 'INV-BR-A1')).toBe(false);

    const purchasesA = await invRepo.findPurchasesBetween(T1, undefined, undefined, branchAId);
    expect(purchasesA.length).toBe(0);
  });

  it('persists branchId on fin_pos_settlements', async () => {
    const bankRes = await testDb.rawQuery(
      `INSERT INTO "fin_bank_accounts" ("tenant_id", "name", "account_number", "ledger_account_id")
       VALUES ($1, 'بانک ملت', '12345678', (SELECT id FROM fin_chart_of_accounts WHERE tenant_id = $1 LIMIT 1))
       RETURNING "id"`,
      [T1],
    );
    const bankId = bankRes[0].id;

    const posRes = await testDb.rawQuery(
      `INSERT INTO "fin_pos_settlements"
       ("id", "tenant_id", "bank_account_id", "terminal_number", "date", "gross_amount", "fee_amount", "net_amount", "branch_id")
       VALUES (gen_random_uuid(), $1, $2, 'POS-999', '2026-05-10', 1000000, 1000, 999000, $3)
       RETURNING "id", "branch_id"`,
      [T1, bankId, branchAId],
    );
    expect(posRes[0].branch_id).toBe(branchAId);
  });

  it('persists branchId on hr_employees and filters employee listings by branchId', async () => {
    const empA = await hr.createEmployee(T1, {
      employeeNumber: 'EMP-BR-A',
      firstName: 'علی',
      lastName: 'احمدی',
      nationalId: '0011223344',
      mobile: '09120000001',
      jobTitle: 'کارشناس فروش شمال',
      department: 'فروش',
      branchId: branchAId,
    });
    expect(empA.branchId).toBe(branchAId);

    const empB = await hr.createEmployee(T1, {
      employeeNumber: 'EMP-BR-B',
      firstName: 'رضا',
      lastName: 'حسینی',
      nationalId: '0055667788',
      mobile: '09120000002',
      jobTitle: 'کارشناس فروش جنوب',
      department: 'فروش',
      branchId: branchBId,
    });
    expect(empB.branchId).toBe(branchBId);

    // List employees filtered by branchId
    const listA = await hr.listEmployees(T1, { page: 1, limit: 10, branchId: branchAId });
    const listB = await hr.listEmployees(T1, { page: 1, limit: 10, branchId: branchBId });
    const listAll = await hr.listEmployees(T1, { page: 1, limit: 10 });

    expect(listA.data.some((e) => e.employeeNumber === 'EMP-BR-A')).toBe(true);
    expect(listA.data.some((e) => e.employeeNumber === 'EMP-BR-B')).toBe(false);

    expect(listB.data.some((e) => e.employeeNumber === 'EMP-BR-B')).toBe(true);
    expect(listB.data.some((e) => e.employeeNumber === 'EMP-BR-A')).toBe(false);

    expect(listAll.data.some((e) => e.employeeNumber === 'EMP-BR-A')).toBe(true);
    expect(listAll.data.some((e) => e.employeeNumber === 'EMP-BR-B')).toBe(true);
  });

  it('enforces ON DELETE SET NULL when a branch is removed', async () => {
    // Create a temporary branch
    const tempRes = await testDb.rawQuery(
      `INSERT INTO "tenant_branches" ("id", "tenant_id", "name", "code", "created_at")
       VALUES (gen_random_uuid(), $1, 'شعبه موقت', 'TEMP', NOW())
       RETURNING "id"`,
      [T1],
    );
    const tempBranchId = tempRes[0].id;

    // Create an employee with this branch
    const tempEmp = await hr.createEmployee(T1, {
      employeeNumber: 'EMP-TEMP',
      firstName: 'مهدی',
      lastName: 'کاظمی',
      nationalId: '0099887766',
      mobile: '09120000003',
      jobTitle: 'تست موقت',
      department: 'فنی',
      branchId: tempBranchId,
    });
    expect(tempEmp.branchId).toBe(tempBranchId);

    // Delete the branch
    await testDb.rawQuery(`DELETE FROM "tenant_branches" WHERE "id" = $1`, [tempBranchId]);

    // Employee must still exist, with branchId set to null
    const reloaded = await hr.findOneEmployee(T1, tempEmp.id);
    expect(reloaded).toBeDefined();
    expect(reloaded.branchId).toBeNull();
  });

  it('enforces tenant isolation under roxira_app so T2 cannot access T1 data', async () => {
    // T2 queries should return empty or fail
    const t2Invoices = await invoicing.findAll(T2, { page: 1, limit: 10 });
    expect(t2Invoices.data.length).toBe(0);

    const t2Employees = await hr.listEmployees(T2, { page: 1, limit: 10 });
    expect(t2Employees.data.length).toBe(0);
  });
});
