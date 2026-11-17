/**
 * Universal entity search on real PostgreSQL (Task T147).
 * Opt-in: skipped unless ROXIRA_TEST_PG_HOST is set.
 * Enforces:
 * - Real PostgreSQL with pg_trgm extension
 * - Execution under roxira_app role (NOSUPERUSER NOBYPASSRLS)
 * - Strict tenant isolation (FORCE RLS)
 * - Latency < 300 ms on seed data
 */
import 'reflect-metadata';
import {
  createTestDatabase,
  describePg,
  TestDatabaseContext,
} from '../../test/support/test-pg';
import { SearchService } from './services/search.service';
import { AccessContext } from '../access/access-context';
import { SELLABLE_MODULES, systemRolePermissions } from '../access/catalogue';

const OWNER = {
  roleKey: 'owner',
  permissions: new Set(systemRolePermissions('owner')),
  entitledModules: new Set<string>(SELLABLE_MODULES),
} as unknown as AccessContext;
const T1 = '66666666-6666-4666-8666-666666666666';
const T2 = '77777777-7777-4777-8777-777777777777';

describePg('Universal search on PostgreSQL with RLS and pg_trgm (T147)', () => {
  let testDb: TestDatabaseContext;
  let service: SearchService;

  beforeAll(async () => {
    testDb = await createTestDatabase('srch');
    service = new SearchService(testDb.scope, testDb.app);

    // Seed Tenant 1
    await testDb.scope.run(T1, async (manager) => {
      // 1. Party
      await manager.query(`
        INSERT INTO "erp_parties" ("tenant_id", "code", "name", "role", "national_id", "economic_code", "phone", "active", "created_at", "updated_at")
        VALUES ($1, 'C-ALF-101', 'شرکت تجارت هوشمند آلفا', 'customer', '10103456789', '4111222333', '02188889999', true, NOW(), NOW())
      `, [T1]);

      // 2. Stock Item
      await manager.query(`
        INSERT INTO "erp_stock_items" ("tenant_id", "sku", "barcode", "name", "quantity", "min_quantity")
        VALUES ($1, 'SKU-LAP-001', '6261234567890', 'لپ‌تاپ مهندسی ایسوس مدل آلفا', 10, 2)
      `, [T1]);

      // 3. Invoice
      await manager.query(`
        INSERT INTO "invoices" (
          "id", "tenant_id", "taxInvoiceNumber", "sellerInfo", "buyerInfo", "items",
          "currency", "jurisdiction", "exchangeRate", "totalAmount", "totalDiscount",
          "totalTax", "finalPayable", "status", "createdAt"
        ) VALUES (
          gen_random_uuid(), $1, 'INV-1403-ALFA99', '{"name":"شرکت ما"}'::jsonb,
          '{"name":"شرکت تجارت هوشمند آلفا"}'::jsonb, '[]'::jsonb,
          'IRR', 'IR', 1, 15000000, 0, 1500000, 16500000, 'ISSUED', NOW()
        )
      `, [T1]);

      // 4. Cheque
      await manager.query(`
        INSERT INTO "fin_cheques" (
          "tenant_id", "direction", "cheque_number", "sayad_number", "bank_name",
          "amount", "issue_date", "due_date", "party_name", "status", "created_at", "updated_at"
        ) VALUES (
          $1, 'received', 'CHQ-778899', '1403001234567890', 'بانک تجارت',
          25000000, '2026-04-01', '2026-05-01', 'شرکت تجارت هوشمند آلفا', 'registered', NOW(), NOW()
        )
      `, [T1]);

      // 5. Chart of Accounts
      await manager.query(`
        INSERT INTO "fin_chart_of_accounts" (
          "tenant_id", "code", "name", "account_type", "currency", "balance", "level"
        ) VALUES (
          $1, '101009', 'صندوق مرکزی فروشگاه آلفا', 'ASSET', 'IRR', 1000000, 'MOEIN'
        )
      `, [T1]);
    });

    // Seed Tenant 2 (Isolation test)
    await testDb.scope.run(T2, async (manager) => {
      await manager.query(`
        INSERT INTO "erp_parties" ("tenant_id", "code", "name", "role", "national_id", "active", "created_at", "updated_at")
        VALUES ($1, 'C-T2-ALF', 'شرکت آلفا مستاجر دوم', 'customer', '10999999999', true, NOW(), NOW())
      `, [T2]);
    });
  }, 120000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('searches across all entity types in under 300 ms on seed data', async () => {
    const start = Date.now();
    const res = await service.search(T1, 'آلفا', 20, undefined, OWNER);
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(300);
    expect(res.latencyMs).toBeLessThan(300);
    expect(res.total).toBeGreaterThanOrEqual(5);

    // Verify entity types are returned
    const types = res.items.map((i) => i.type);
    expect(types).toContain('customer');
    expect(types).toContain('product');
    expect(types).toContain('invoice');
    expect(types).toContain('cheque');
    expect(types).toContain('account');
  });

  it('enforces strict tenant isolation under RLS (never returns another tenant data)', async () => {
    // T1 search must not see T2 party
    const t1Results = await service.search(T1, 'مستاجر', 20, undefined, OWNER);
    expect(t1Results.items.some((i) => i.title.includes('مستاجر دوم'))).toBe(false);

    // T2 search must see its own party and not T1
    const t2Results = await service.search(T2, 'مستاجر', 20, undefined, OWNER);
    expect(t2Results.items.some((i) => i.title.includes('مستاجر دوم'))).toBe(true);

    const t2AlfaResults = await service.search(T2, 'ایسوس', 20, undefined, OWNER);
    expect(t2AlfaResults.items.some((i) => i.type === 'product')).toBe(false);
  });

  it('matches fuzzy and partial codes via pg_trgm indexes', async () => {
    // Partial SKU
    const skuRes = await service.search(T1, 'LAP-001', 20, undefined, OWNER);
    expect(skuRes.items.some((i) => i.type === 'product' && i.title.includes('ایسوس'))).toBe(true);

    // Partial Cheque number
    const chqRes = await service.search(T1, '778899', 20, undefined, OWNER);
    expect(chqRes.items.some((i) => i.type === 'cheque' && i.title.includes('CHQ-778899'))).toBe(true);

    // Partial invoice number
    const invRes = await service.search(T1, 'ALFA99', 20, undefined, OWNER);
    expect(invRes.items.some((i) => i.type === 'invoice' && i.title.includes('ALFA99'))).toBe(true);
  });
});
