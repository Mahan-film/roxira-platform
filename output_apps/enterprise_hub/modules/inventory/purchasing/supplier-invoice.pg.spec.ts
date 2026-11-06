/**
 * Supplier invoice on a REAL PostgreSQL as a non-superuser role: migration with FORCE RLS, the
 * repository and tenant isolation end to end.
 *
 * Opt-in like the other pg specs: skipped unless ROXIRA_TEST_PG_HOST is set. Each run creates and
 * drops its own database and role. Optional: ROXIRA_TEST_PG_USER, ROXIRA_TEST_PG_PORT, ROXIRA_TEST_PG_PASSWORD.
 *
 *   ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55460 npx jest modules/inventory/purchasing/supplier-invoice.pg.spec.ts
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { PurchaseOrderStatus } from './purchase.types';
import { PurchaseRepository } from './purchase.repository';
import { NewSupplierInvoice, SupplierInvoiceRepository } from './supplier-invoice.repository';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const APP_PW = 'supplier-invoice-app-test-only';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

const TABLES = [
  'erp_purchase_settings',
  'erp_purchase_requests',
  'erp_purchase_orders',
  'erp_purchase_order_lines',
  'erp_goods_receipts',
  'erp_goods_receipt_lines',
  'erp_supplier_invoices',
  'erp_supplier_invoice_lines',
];

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

describePg('Supplier invoice on PostgreSQL (non-superuser, FORCE RLS)', () => {
  const db = `rx_supplier_invoice_${process.pid}_${Date.now()}`;
  const role = `rx_si_app_${process.pid}`;
  let admin: DataSource;
  let owner: DataSource;
  let app: DataSource;
  let purchases: PurchaseRepository;
  let invoices: SupplierInvoiceRepository;

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

    const scope = new TenantScope(app);
    purchases = new PurchaseRepository(scope);
    invoices = new SupplierInvoiceRepository(scope);
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

  let orderSeq = 0;
  function order(tenantId: string): Promise<{ id: string }> {
    return purchases.run(tenantId, (m) =>
      purchases.insertOrder(
        tenantId,
        {
          number: `PO-${tenantId.slice(0, 4)}-${(orderSeq += 1)}`,
          supplierCode: 'SUP',
          status: PurchaseOrderStatus.RECEIVED,
          warehouseId: null,
          requestId: null,
          orderDate: '2026-11-05',
          lines: [{ sku: 'A', quantity: 1000n, unitPrice: 5_000_000n }],
        },
        m,
      ),
    );
  }

  function invoiceInput(
    orderId: string,
    number: string,
    supplierRef: string,
  ): NewSupplierInvoice {
    return {
      number,
      orderId,
      supplierCode: 'SUP',
      supplierRef,
      invoiceDate: '2026-11-05',
      status: 'MATCHED',
      createdBy: 'u1',
      vat: 0n,
      subtotal: 0n,
      total: 0n,
    };
  }

  function insert(tenantId: string, input: NewSupplierInvoice) {
    return invoices.run(tenantId, (m) => invoices.insertInvoice(tenantId, input, [], m));
  }

  it('creates both invoice tables with ENABLE and FORCE row-level security and one policy each', async () => {
    const rows = await owner.query(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
              (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::int AS policies
         FROM pg_class c WHERE c.relname = ANY($1::text[])`,
      [TABLES],
    );
    expect(rows).toHaveLength(TABLES.length);
    for (const row of rows) {
      expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true, policies: 1 });
    }
  });

  it('hides tenant A invoices from tenant B through the repository and through plain SQL', async () => {
    const orderA = await order(T1);
    const invoice = await insert(T1, invoiceInput(orderA.id, 'SI-000001', 'REF-1'));

    expect(
      await invoices.run(T2, (m) => invoices.findInvoice(T2, invoice.id, m)),
    ).toBeNull();

    await app.transaction(async (m) => {
      await TenantScope.bind(m, T2);
      expect(await m.query(`SELECT id FROM erp_supplier_invoices WHERE tenant_id = $1`, [T1])).toEqual([]);
      expect(
        await m.query(
          `UPDATE erp_supplier_invoices SET status = 'POSTED' WHERE id = $1 RETURNING id`,
          [invoice.id],
        ),
      ).toEqual([[], 0]);
      expect(
        await m.query(`DELETE FROM erp_supplier_invoices WHERE id = $1 RETURNING id`, [invoice.id]),
      ).toEqual([[], 0]);
    });

    const [stillThere] = await owner.query(
      `SELECT status FROM erp_supplier_invoices WHERE id = $1`,
      [invoice.id],
    );
    expect(stillThere.status).toBe('MATCHED');

    await expect(
      app.transaction(async (m) => {
        await TenantScope.bind(m, T2);
        await m.query(
          `INSERT INTO erp_supplier_invoices
             (tenant_id, number, supplier_code, supplier_ref, invoice_date, status, created_by)
           VALUES ($1, 'SI-WRONG', 'SUP', 'REF-WRONG', '2026-11-05', 'HELD', 'u1')`,
          [T1],
        );
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it('keeps (tenant, supplier_code, supplier_ref) unique per tenant, not across tenants', async () => {
    const orderA = await order(T1);
    const orderB = await order(T2);

    const first = await insert(T1, invoiceInput(orderA.id, 'SI-000010', 'SAME-REF'));
    await expect(
      insert(T1, invoiceInput(orderA.id, 'SI-000011', 'SAME-REF')),
    ).rejects.toThrow(/duplicate key|unique/i);

    const otherTenant = await insert(T2, invoiceInput(orderB.id, 'SI-000010', 'SAME-REF'));
    expect(otherTenant.id).not.toBe(first.id);
    expect(otherTenant.supplierRef).toBe('SAME-REF');
  });
});