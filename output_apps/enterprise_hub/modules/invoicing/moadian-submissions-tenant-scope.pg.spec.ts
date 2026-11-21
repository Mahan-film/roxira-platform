/**
 * T209: runs as the shared NOSUPERUSER NOBYPASSRLS app role with two tenants and proves that
 * `InvoicingRepository.findMoadianSubmissionsForInvoices` goes through TenantScope:
 * tenant B cannot read tenant A's moadian submissions.
 */
import { InvoiceEntity } from './entities/invoice.entity';
import { InvoicingRepository } from './repositories/invoicing.repository';
import {
  createTestDatabase,
  describePg,
  TestDatabaseContext,
  TEST_T1 as TENANT_A,
  TEST_T2 as TENANT_B,
} from '../../test/support/test-pg';

describePg('InvoicingRepository.findMoadianSubmissionsForInvoices (NOSUPERUSER NOBYPASSRLS)', () => {
  let testDb: TestDatabaseContext;
  let repo: InvoicingRepository;

  beforeAll(async () => {
    testDb = await createTestDatabase('t209moadian');
    repo = new InvoicingRepository(
      testDb.app.getRepository(InvoiceEntity),
      testDb.app,
      testDb.scope,
    );
  }, 180_000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('returns only the calling tenant submissions', async () => {
    const invoiceA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await testDb.rawQuery(
      `INSERT INTO moadian_submissions (tenant_id, invoice_id, uid, tax_id, serial, status, errors, packet)
       VALUES ($1, $2, gen_random_uuid(), 'TAXIDA000000000000001', 1, 'FAILED', '[{"message":"bad"}]', '{}')`,
      [TENANT_A, invoiceA],
    );

    const own = await repo.findMoadianSubmissionsForInvoices(TENANT_A, [invoiceA]);
    expect(own.get(invoiceA)).toEqual({
      status: 'FAILED',
      errorText: 'bad',
      taxId: 'TAXIDA000000000000001',
    });
    expect((await repo.findMoadianSubmissionsForInvoices(TENANT_B, [invoiceA])).size).toBe(0);
    // A bare connection without app.tenant_id sees nothing (RLS).
    expect(await testDb.app.query(`SELECT 1 FROM moadian_submissions`)).toEqual([]);
  });
});
