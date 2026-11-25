/**
 * Real PostgreSQL integration test for optional salesperson_id on invoices (#440):
 * - Runs as NOSUPERUSER NOBYPASSRLS (`roxira_app`).
 * - Verifies `InvoicingRepository.isSalespersonInTenant` enforces active tenant membership
 *   and rejects users from another tenant or suspended memberships.
 * - Verifies `InvoicingService.create` / `findById` / `update` round-trip `salespersonId`
 *   (both UUID and null) and reject cross-tenant salesperson links with 404.
 * - Verifies `SalesReportService.build(..., { groupBy: 'salesperson' })` groups issued/paid
 *   invoices by `salespersonId`.
 */
import { NotFoundException } from '@nestjs/common';
import { Currency } from '../currency/enums/currency.enum';
import {
  createTestDatabase,
  describePg,
  TestDatabaseContext,
  TEST_T1 as TENANT_A,
  TEST_T2 as TENANT_B,
} from '../../test/support/test-pg';
import { InvoiceEntity } from './entities/invoice.entity';
import { InvoiceStatus } from './enums/invoice-status.enum';
import { InvoicingRepository } from './repositories/invoicing.repository';
import { InvoicingService } from './services/invoicing.service';
import { SalesReportService } from './services/sales-report.service';

const SELLER_A_ACTIVE = '33333333-3333-4333-8333-333333333333';
const SELLER_A_SUSPENDED = '44444444-4444-4444-8444-444444444444';
const SELLER_B_ACTIVE = '55555555-5555-4555-8555-555555555555';

describePg('Invoice salesperson_id on PostgreSQL (NOSUPERUSER NOBYPASSRLS)', () => {
  let testDb: TestDatabaseContext;
  let repo: InvoicingRepository;
  let service: InvoicingService;
  let salesReportService: SalesReportService;

  beforeAll(async () => {
    testDb = await createTestDatabase('t440seller');

    await testDb.rawQuery(
      `INSERT INTO "tenants" ("id", "name", "slug") VALUES
       ($1, 'Tenant A', 'tenant-a-seller'),
       ($2, 'Tenant B', 'tenant-b-seller')
       ON CONFLICT DO NOTHING`,
      [TENANT_A, TENANT_B],
    );

    await testDb.rawQuery(
      `INSERT INTO "users" ("id", "phone") VALUES
       ($1, '09120000101'),
       ($2, '09120000102'),
       ($3, '09120000103')
       ON CONFLICT DO NOTHING`,
      [SELLER_A_ACTIVE, SELLER_A_SUSPENDED, SELLER_B_ACTIVE],
    );

    await testDb.rawQuery(
      `INSERT INTO "tenant_memberships" ("id", "tenant_id", "user_id", "role_key", "status") VALUES
       (gen_random_uuid(), $1, $3, 'sales', 'ACTIVE'),
       (gen_random_uuid(), $1, $4, 'sales', 'SUSPENDED'),
       (gen_random_uuid(), $2, $5, 'sales', 'ACTIVE')
       ON CONFLICT DO NOTHING`,
      [TENANT_A, TENANT_B, SELLER_A_ACTIVE, SELLER_A_SUSPENDED, SELLER_B_ACTIVE],
    );

    repo = new InvoicingRepository(
      testDb.app.getRepository(InvoiceEntity),
      testDb.app,
      testDb.scope,
    );

    const currencyService = {
      getRate: () => 1,
      round: (val: number) => val,
    };

    service = new InvoicingService(
      repo,
      currencyService as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        generalRate: () => 0.1,
        resolve: () => 0.1,
      } as any,
    );

    salesReportService = new SalesReportService(repo);
  }, 180_000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('enforces tenant isolation and active status in isSalespersonInTenant under FORCE RLS', async () => {
    await expect(repo.isSalespersonInTenant(TENANT_A, SELLER_A_ACTIVE)).resolves.toBe(true);
    await expect(repo.isSalespersonInTenant(TENANT_A, SELLER_A_SUSPENDED)).resolves.toBe(false);
    await expect(repo.isSalespersonInTenant(TENANT_A, SELLER_B_ACTIVE)).resolves.toBe(false);
    await expect(repo.isSalespersonInTenant(TENANT_B, SELLER_B_ACTIVE)).resolves.toBe(true);
    await expect(repo.isSalespersonInTenant(TENANT_B, SELLER_A_ACTIVE)).resolves.toBe(false);
  });

  it('round-trips invoices with and without salespersonId, rejects cross-tenant links, and groups sales report', async () => {
    const withSeller = await service.create(TENANT_A, {
      sellerInfo: { name: 'فروشنده الف' },
      buyerInfo: { name: 'خریدار ۱' },
      salespersonId: SELLER_A_ACTIVE,
      status: InvoiceStatus.ISSUED,
      currency: Currency.IRR,
      items: [{ description: 'محصول ۱', quantity: 2, unitPrice: 1000, vatRate: 0.1 }],
    });
    expect(withSeller.salespersonId).toBe(SELLER_A_ACTIVE);

    const fetchedWithSeller = await service.findOne(TENANT_A, withSeller.id);
    expect(fetchedWithSeller.salespersonId).toBe(SELLER_A_ACTIVE);

    const withoutSeller = await service.create(TENANT_A, {
      sellerInfo: { name: 'فروشنده الف' },
      buyerInfo: { name: 'خریدار ۲' },
      status: InvoiceStatus.ISSUED,
      currency: Currency.IRR,
      items: [{ description: 'محصول ۲', quantity: 1, unitPrice: 500, vatRate: 0.1 }],
    });
    expect(withoutSeller.salespersonId).toBeNull();

    // Cross-tenant salesperson must be rejected cleanly
    await expect(
      service.create(TENANT_A, {
        sellerInfo: { name: 'فروشنده الف' },
        buyerInfo: { name: 'خریدار ۳' },
        salespersonId: SELLER_B_ACTIVE,
        items: [{ description: 'محصول ۳', quantity: 1, unitPrice: 500, vatRate: 0.1 }],
      }),
    ).rejects.toThrow(NotFoundException);

    // Update to assign and then clear salespersonId
    const assigned = await service.update(TENANT_A, withoutSeller.id, {
      salespersonId: SELLER_A_ACTIVE,
    });
    expect(assigned.salespersonId).toBe(SELLER_A_ACTIVE);

    const cleared = await service.update(TENANT_A, withoutSeller.id, {
      salespersonId: null,
    });
    expect(cleared.salespersonId).toBeNull();

    // Sales report grouped by salesperson
    const { json } = await salesReportService.build(TENANT_A, { groupBy: 'salesperson' });
    const report = json as { groupBy: string; groups: Array<{ key: string; net: number }> };
    expect(report.groupBy).toBe('salesperson');
    expect(report.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: SELLER_A_ACTIVE, net: 2000 }),
        expect.objectContaining({ key: 'بدون فروشنده', net: 500 }),
      ]),
    );
  });
});
