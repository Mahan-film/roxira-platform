/**
 * Print templates and form builder against a REAL PostgreSQL:
 * - Table `inv_print_templates` has rowsecurity=true and forcerowsecurity=true.
 * - Real service and repository run as roxira_app (NOSUPERUSER NOBYPASSRLS).
 * - Cross-tenant isolation between T1 and T2 is strictly enforced by RLS.
 * - WITH CHECK violation prevents cross-tenant writes even if app code were bypassed.
 *
 * Run with:
 *   ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55441 npx jest modules/invoicing/print-template.pg.spec.ts
 */
import 'reflect-metadata';
import {
  createTestDatabase,
  describePg,
  TestDatabaseContext,
  TEST_T1 as T1,
  TEST_T2 as T2,
} from '../../test/support/test-pg';
import { PrintDocType, PrintPaperSize } from './enums/print-template.enum';
import { PrintTemplateRepository } from './repositories/print-template.repository';
import { PrintTemplateService } from './services/print-template.service';

describePg('PrintTemplateRepository & Service on real PostgreSQL with RLS', () => {
  let testDb: TestDatabaseContext;
  let service: PrintTemplateService;
  let repo: PrintTemplateRepository;

  beforeAll(async () => {
    testDb = await createTestDatabase('print_templates');
    repo = new PrintTemplateRepository(testDb.scope);
    service = new PrintTemplateService(repo);
  });

  afterAll(async () => {
    if (testDb) {
      await testDb.cleanup();
    }
  });

  it('enforces FORCE ROW LEVEL SECURITY on inv_print_templates table', async () => {
    const rows = await testDb.owner.query(`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname = 'inv_print_templates'
    `);

    expect(rows).toHaveLength(1);
    expect(rows[0].relrowsecurity).toBe(true);
    expect(rows[0].relforcerowsecurity).toBe(true);
  });

  it('runs connected as roxira_app role (NOSUPERUSER NOBYPASSRLS)', async () => {
    const [roleRow] = await testDb.app.query(`
      SELECT current_user, rolsuper, rolbypassrls
      FROM pg_roles
      WHERE rolname = current_user
    `);

    expect(roleRow.current_user).toBe('roxira_app');
    expect(roleRow.rolsuper).toBe(false);
    expect(roleRow.rolbypassrls).toBe(false);
  });

  it('persists and isolates templates per tenant via TenantScope and RLS', async () => {
    // 1. T1 creates a sales invoice template
    const t1Template = await service.create(T1, {
      title: 'فاکتور فروش رسمی شرکت الف',
      docType: PrintDocType.SALES_INVOICE,
      paperSize: PrintPaperSize.A4,
      isDefault: true,
      showLogo: true,
      columnsConfig: [
        { key: 'rowNumber', label: 'ردیف', visible: true, order: 1, widthPercent: 8 },
        { key: 'description', label: 'نام کالا / خدمات', visible: true, order: 2, widthPercent: 52 },
        { key: 'totalPrice', label: 'مبلغ کل', visible: true, order: 3, widthPercent: 40 },
      ],
    });

    expect(t1Template.id).toBeGreaterThan(0);
    expect(t1Template.title).toBe('فاکتور فروش رسمی شرکت الف');

    // 2. T1 can find its template
    const t1Found = await service.findOne(T1, t1Template.id);
    expect(t1Found.id).toBe(t1Template.id);

    // 3. T2 cannot see T1 template (NotFoundException because RLS / TenantScope hides it)
    await expect(service.findOne(T2, t1Template.id)).rejects.toThrow();

    // 4. Listing for T2 returns empty list, while T1 has 1 item
    const t2List = await service.list(T2, {});
    expect(t2List).toHaveLength(0);

    const t1List = await service.list(T1, {});
    expect(t1List).toHaveLength(1);
    expect(t1List[0].id).toBe(t1Template.id);
  });

  it('strictly rejects cross-tenant insertion at PostgreSQL level (WITH CHECK violation)', async () => {
    // Setting tenant session to T1, but attempting to insert a row with tenant_id = T2
    await expect(
      testDb.scope.run(T1, async (em) => {
        return em.query(`
          INSERT INTO inv_print_templates (
            tenant_id, doc_type, paper_size, title, is_default, show_logo, columns_config, options
          ) VALUES (
            $1, 'sales_invoice', 'A4', 'جعلی', false, true, '[]'::jsonb, '{}'::jsonb
          )
        `, [T2]);
      }),
    ).rejects.toThrow(/new row violates row-level security policy/i);
  });

  it('allows T2 to have its own default template independently of T1', async () => {
    const t2Template = await service.create(T2, {
      title: 'فاکتور فروش شرکت ب',
      docType: PrintDocType.SALES_INVOICE,
      paperSize: PrintPaperSize.A5,
      isDefault: true,
      showLogo: false,
    });

    const t1Default = await service.findDefault(T1, PrintDocType.SALES_INVOICE);
    const t2Default = await service.findDefault(T2, PrintDocType.SALES_INVOICE);

    expect(t1Default.title).toBe('فاکتور فروش رسمی شرکت الف');
    expect(t1Default.paperSize).toBe(PrintPaperSize.A4);

    expect(t2Default.title).toBe('فاکتور فروش شرکت ب');
    expect(t2Default.paperSize).toBe(PrintPaperSize.A5);
  });

  it('strictly isolates updates and deletions across tenants (cross-tenant mutations refused)', async () => {
    const t1Template = await service.create(T1, {
      title: 'فاکتور فروش قابل محافظت T1',
      docType: PrintDocType.SALES_INVOICE,
      paperSize: PrintPaperSize.A4,
    });

    // T2 cannot update T1's template
    await expect(
      service.update(T2, t1Template.id, { title: 'تغییر غیرمجاز توسط T2' }),
    ).rejects.toThrow();

    // T1's template remains unchanged
    const original = await service.findOne(T1, t1Template.id);
    expect(original.title).toBe('فاکتور فروش قابل محافظت T1');

    // T2 cannot delete T1's template
    await expect(service.remove(T2, t1Template.id)).rejects.toThrow();
    expect(await service.findOne(T1, t1Template.id)).toBeDefined();
  });
});
