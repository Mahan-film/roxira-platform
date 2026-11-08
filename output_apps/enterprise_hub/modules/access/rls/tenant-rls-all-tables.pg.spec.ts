/**
 * Complete tenant RLS audit and cross-tenant isolation proof (#475):
 *   1. Lists EVERY table in `public` that has a `tenant_id` column and fails if ANY lacks
 *      `ENABLE + FORCE ROW LEVEL SECURITY` or a policy.
 *   2. Connects as a non-superuser role (`NOBYPASSRLS`) and proves on a sample of newly protected
 *      tables (`erp_warehouses`, `erp_stock_items`, `invoices`, `crm_leads`, `capture_vendors`)
 *      that Tenant A cannot read, update, delete, or forge `tenant_id` on Tenant B rows, and that
 *      an unscoped connection sees nothing and cannot write.
 *   3. Verifies that `EnableRlsRemainingTenantTables1789900000600` `down()` and `up()` are reversible.
 *
 * Opt-in like the other pg specs: skipped unless ROXIRA_TEST_PG_HOST is set.
 *
 *   ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55471 npx jest modules/access/rls/tenant-rls-all-tables.pg.spec.ts
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import {
  EnableRlsRemainingTenantTables1789900000600,
  REMAINING_RLS_TABLES,
} from '../../../migrations/1789900000600-EnableRlsRemainingTenantTables';
import { TenantScope } from '../services/tenant-scope';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const APP_PW = 'rls-all-app-test-only';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

const options = (database: string, username = OWNER, password = OWNER_PW) => ({
  type: 'postgres' as const,
  host: HOST,
  port: PORT,
  username,
  password,
  database,
  entities: [path.join(__dirname, '../../**/*.entity.ts')],
  migrations: [path.join(__dirname, '../../../migrations/*.ts')],
  migrationsTransactionMode: 'each' as const,
  synchronize: false,
  logging: false,
});

describePg('All tenant tables FORCE RLS audit and isolation on PostgreSQL (#475)', () => {
  const db = `rx_rls_all_${process.pid}_${Date.now()}`;
  const role = `rx_rls_all_app_${process.pid}`;
  let admin: DataSource;
  let owner: DataSource;
  let app: DataSource;
  let scope: TenantScope;

  beforeAll(async () => {
    admin = await new DataSource({ ...options('postgres'), entities: [], migrations: [] }).initialize();
    await admin.query(`CREATE DATABASE "${db}"`);
    await admin.query(`DROP ROLE IF EXISTS ${role}`);
    await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${APP_PW}'`);
    owner = await new DataSource(options(db)).initialize();
    await owner.runMigrations();
    await owner.query(`GRANT CONNECT ON DATABASE "${db}" TO ${role}`);
    await owner.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await owner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
    await owner.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
    app = await new DataSource({ ...options(db, role, APP_PW), extra: { max: 8 } }).initialize();
    scope = new TenantScope(app);

    for (const tenantId of [T1, T2]) {
      await owner
        .query(`INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $2) ON CONFLICT DO NOTHING`, [
          tenantId,
          tenantId.slice(0, 8),
        ])
        .catch(() => undefined);
    }
  }, 240_000);

  afterAll(async () => {
    await app?.destroy();
    await owner?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin?.query(`DROP ROLE IF EXISTS ${role}`);
    await admin?.destroy();
  });

  it('connects as a non-superuser without BYPASSRLS', async () => {
    const [r] = await app.query(
      `SELECT current_user AS u, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user`,
    );
    expect(r).toMatchObject({ u: role, rolsuper: false, rolbypassrls: false });
  });

  it('lists every table in public with a tenant_id column and fails if any lacks ENABLE + FORCE RLS or a policy', async () => {
    const rows = (await owner.query(`
      SELECT c.relname AS table_name,
             c.relrowsecurity AS rls_enabled,
             c.relforcerowsecurity AS rls_forced,
             (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND a.attnum > 0 AND NOT a.attisdropped
       WHERE c.relkind = 'r'
       ORDER BY c.relname
    `)) as Array<{ table_name: string; rls_enabled: boolean; rls_forced: boolean; policies: number }>;

    expect(rows.length).toBeGreaterThanOrEqual(101);
    const missing = rows.filter((r) => !r.rls_enabled || !r.rls_forced || r.policies < 1);
    expect(missing).toEqual([]);
  });

  it(' verifies each of the 42 tables in REMAINING_RLS_TABLES has policy <table_name>_tenant with USING and WITH CHECK', async () => {
    const rows = (await owner.query(
      `SELECT c.relname AS table_name,
              p.polname AS policy_name,
              pg_get_expr(p.polqual, p.polrelid) AS using_expr,
              pg_get_expr(p.polwithcheck, p.polrelid) AS check_expr
         FROM pg_class c
         JOIN pg_policy p ON p.polrelid = c.oid
        WHERE c.relname = ANY($1::text[]) AND p.polname = c.relname || '_tenant'`,
      [REMAINING_RLS_TABLES],
    )) as Array<{ table_name: string; policy_name: string; using_expr: string; check_expr: string }>;

    expect(rows).toHaveLength(REMAINING_RLS_TABLES.length);
    for (const row of rows) {
      expect(row.using_expr).toContain('app.tenant_id');
      expect(row.check_expr).toContain('app.tenant_id');
    }
  });

  describe('cross-tenant isolation on a sample of newly protected tables', () => {
    it('isolates erp_warehouses and erp_stock_items between tenants', async () => {
      const [w1] = await scope.run(T1, (m) =>
        m.query(
          `INSERT INTO erp_warehouses (tenant_id, name, location_code) VALUES ($1, 'WH-A', 'LOC-A') RETURNING id`,
          [T1],
        ),
      );
      const [w2] = await scope.run(T2, (m) =>
        m.query(
          `INSERT INTO erp_warehouses (tenant_id, name, location_code) VALUES ($1, 'WH-B', 'LOC-B') RETURNING id`,
          [T2],
        ),
      );

      await scope.run(T1, (m) =>
        m.query(
          `INSERT INTO erp_stock_items (tenant_id, sku, barcode, name) VALUES ($1, 'SKU-1', 'BC-1', 'Item A')`,
          [T1],
        ),
      );
      await scope.run(T2, (m) =>
        m.query(
          `INSERT INTO erp_stock_items (tenant_id, sku, barcode, name) VALUES ($1, 'SKU-2', 'BC-2', 'Item B')`,
          [T2],
        ),
      );

      // Tenant B cannot see, update, or delete Tenant A rows even without a WHERE tenant_id filter
      const seenWarehouses = await scope.run(T2, (m) => m.query(`SELECT id, tenant_id, name FROM erp_warehouses`));
      expect(seenWarehouses).toEqual([{ id: w2.id, tenant_id: T2, name: 'WH-B' }]);

      const seenItems = await scope.run(T2, (m) => m.query(`SELECT sku, tenant_id FROM erp_stock_items`));
      expect(seenItems).toEqual([{ sku: 'SKU-2', tenant_id: T2 }]);

      const [, updatedCount] = await scope.run(T2, (m) =>
        m.query(`UPDATE erp_stock_items SET name = 'HACKED' WHERE sku = 'SKU-1' RETURNING id`),
      );
      expect(updatedCount).toBe(0);

      const [, deletedCount] = await scope.run(T2, (m) =>
        m.query(`DELETE FROM erp_warehouses WHERE id = $1 RETURNING id`, [w1.id]),
      );
      expect(deletedCount).toBe(0);

      // Tenant B cannot insert a row with Tenant A's tenant_id
      await expect(
        scope.run(T2, (m) =>
          m.query(`INSERT INTO erp_warehouses (tenant_id, name, location_code) VALUES ($1, 'FORGED', 'LOC-F')`, [T1]),
        ),
      ).rejects.toThrow(/row-level security/);

      // Unscoped connection sees nothing
      expect(await app.query(`SELECT id FROM erp_warehouses`)).toEqual([]);
      expect(await app.query(`SELECT id FROM erp_stock_items`)).toEqual([]);
    });

    it('isolates invoices, crm_leads, and capture_vendors between tenants', async () => {
      const [invA] = await scope.run(T1, (m) =>
        m.query(
          `INSERT INTO invoices (tenant_id, "taxInvoiceNumber", "sellerInfo", "buyerInfo", items, "totalAmount", "finalPayable")
           VALUES ($1, 'INV-A1', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 1000, 1000) RETURNING id`,
          [T1],
        ),
      );
      await scope.run(T2, (m) =>
        m.query(
          `INSERT INTO invoices (tenant_id, "taxInvoiceNumber", "sellerInfo", "buyerInfo", items, "totalAmount", "finalPayable")
           VALUES ($1, 'INV-B1', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 2000, 2000) RETURNING id`,
          [T2],
        ),
      );

      const [leadA] = await scope.run(T1, (m) =>
        m.query(`INSERT INTO crm_leads (tenant_id, full_name) VALUES ($1, 'Lead A') RETURNING id`, [T1]),
      );
      await scope.run(T2, (m) =>
        m.query(`INSERT INTO crm_leads (tenant_id, full_name) VALUES ($1, 'Lead B') RETURNING id`, [T2]),
      );

      const [vendorA] = await scope.run(T1, (m) =>
        m.query(
          `INSERT INTO capture_vendors (tenant_id, name, normalized_name) VALUES ($1, 'Vendor A', 'vendor a') RETURNING id`,
          [T1],
        ),
      );

      // Tenant 2 sees only its own rows
      expect(await scope.run(T2, (m) => m.query(`SELECT "taxInvoiceNumber" FROM invoices`))).toEqual([
        { taxInvoiceNumber: 'INV-B1' },
      ]);
      expect(await scope.run(T2, (m) => m.query(`SELECT full_name FROM crm_leads`))).toEqual([
        { full_name: 'Lead B' },
      ]);
      expect(await scope.run(T2, (m) => m.query(`SELECT id FROM capture_vendors`))).toEqual([]);

      // Tenant 2 cannot update or delete Tenant 1 rows
      expect(
        await scope.run(T2, (m) =>
          m.query(`DELETE FROM invoices WHERE id = $1 RETURNING id`, [invA.id]),
        ),
      ).toEqual([[], 0]);
      expect(
        await scope.run(T2, (m) =>
          m.query(`UPDATE crm_leads SET full_name = 'STOLEN' WHERE id = $1 RETURNING id`, [leadA.id]),
        ),
      ).toEqual([[], 0]);
      expect(
        await scope.run(T2, (m) =>
          m.query(`DELETE FROM capture_vendors WHERE id = $1 RETURNING id`, [vendorA.id]),
        ),
      ).toEqual([[], 0]);

      // Tenant 2 cannot forge tenant_id on insert or update
      await expect(
        scope.run(T2, (m) =>
          m.query(`INSERT INTO crm_leads (tenant_id, full_name) VALUES ($1, 'Forged Lead')`, [T1]),
        ),
      ).rejects.toThrow(/row-level security/);
      await expect(
        scope.run(T2, (m) =>
          m.query(`UPDATE crm_leads SET tenant_id = $1 WHERE tenant_id = $2`, [T1, T2]),
        ),
      ).rejects.toThrow(/row-level security/);

      // Unscoped connection sees nothing and cannot insert
      expect(await app.query(`SELECT count(*)::int AS n FROM invoices`)).toEqual([{ n: 0 }]);
      expect(await app.query(`SELECT count(*)::int AS n FROM crm_leads`)).toEqual([{ n: 0 }]);
      await expect(
        app.query(`INSERT INTO crm_leads (tenant_id, full_name) VALUES ($1, 'Unscoped')`, [T1]),
      ).rejects.toThrow(/row-level security/);
    });
  });

  describe('migration reversibility', () => {
    it('down() disables RLS on the 42 tables and up() restores FORCE RLS', async () => {
      const runner = owner.createQueryRunner();
      const migration = new EnableRlsRemainingTenantTables1789900000600();
      try {
        await migration.down(runner);
        const off = await owner.query(
          `SELECT count(*)::int AS enabled FROM pg_class WHERE relname = ANY($1::text[]) AND (relrowsecurity OR relforcerowsecurity)`,
          [REMAINING_RLS_TABLES],
        );
        expect(off).toEqual([{ enabled: 0 }]);

        await migration.up(runner);
        const on = await owner.query(
          `SELECT count(*)::int AS forced FROM pg_class WHERE relname = ANY($1::text[]) AND relrowsecurity AND relforcerowsecurity`,
          [REMAINING_RLS_TABLES],
        );
        expect(on).toEqual([{ forced: REMAINING_RLS_TABLES.length }]);
      } finally {
        await runner.release();
      }
    });
  });
});
