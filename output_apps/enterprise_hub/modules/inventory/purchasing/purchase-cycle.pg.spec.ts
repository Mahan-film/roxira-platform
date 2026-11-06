/**
 * Purchase cycle on a REAL PostgreSQL as a non-superuser role: migration with FORCE RLS, the
 * repository and tenant isolation end to end.
 *
 * Opt-in like the other pg specs: skipped unless ROXIRA_TEST_PG_HOST is set. Each run creates and
 * drops its own database and role. Optional: ROXIRA_TEST_PG_USER, ROXIRA_TEST_PG_PORT, ROXIRA_TEST_PG_PASSWORD.
 *
 *   ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55460 npx jest modules/inventory/purchasing/purchase-cycle.pg.spec.ts
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { PurchaseRepository } from './purchase.repository';
import { PurchaseOrderStatus, PurchaseRequestStatus } from './purchase.types';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const APP_PW = 'purchase-app-test-only';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

const TABLES = [
  'erp_purchase_settings',
  'erp_purchase_requests',
  'erp_purchase_orders',
  'erp_purchase_order_lines',
  'erp_goods_receipts',
  'erp_goods_receipt_lines',
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

describePg('Purchase cycle on PostgreSQL (non-superuser, FORCE RLS)', () => {
  const db = `rx_purchase_${process.pid}_${Date.now()}`;
  const role = `rx_pur_app_${process.pid}`;
  let admin: DataSource;
  let owner: DataSource;
  let app: DataSource;
  let repository: PurchaseRepository;

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
    repository = new PurchaseRepository(scope);
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

  it('creates the six tables with ENABLE and FORCE row-level security and one policy each', async () => {
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

  it('hides tenant A rows from tenant B through the repository and through plain SQL', async () => {
    const request = await repository.run(T1, (m) =>
      repository.insertRequest(
        T1,
        {
          number: 'PR-000001',
          status: PurchaseRequestStatus.OPEN,
          requestedBy: 'u1',
          lines: [{ sku: 'A', quantity: 1000n }],
        },
        m,
      ),
    );

    expect(await repository.run(T2, (m) => repository.findRequest(T2, request.id, m))).toBeNull();

    await app.transaction(async (m) => {
      await TenantScope.bind(m, T2);
      expect(await m.query(`SELECT id FROM erp_purchase_requests WHERE tenant_id = $1`, [T1])).toEqual([]);
      expect(
        await m.query(`UPDATE erp_purchase_requests SET status = 'CANCELLED' WHERE id = $1 RETURNING id`, [
          request.id,
        ]),
      ).toEqual([[], 0]);
      expect(
        await m.query(`DELETE FROM erp_purchase_requests WHERE id = $1 RETURNING id`, [request.id]),
      ).toEqual([[], 0]);
    });

    const [stillThere] = await owner.query(`SELECT status FROM erp_purchase_requests WHERE id = $1`, [request.id]);
    expect(stillThere.status).toBe(PurchaseRequestStatus.OPEN);

    await expect(
      app.transaction(async (m) => {
        await TenantScope.bind(m, T2);
        await m.query(
          `INSERT INTO erp_purchase_requests (tenant_id, number, status, requested_by, lines)
           VALUES ($1, 'PR-WRONG', 'OPEN', 'u1', '[]'::jsonb)`,
          [T1],
        );
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it('keeps the idempotency key unique per tenant, not across tenants', async () => {
    const order = (tenantId: string) =>
      repository.run(tenantId, (m) =>
        repository.insertOrder(
          tenantId,
          {
            number: 'PO-000001',
            supplierCode: 'SUP',
            status: PurchaseOrderStatus.DRAFT,
            warehouseId: null,
            requestId: null,
            orderDate: '2026-11-05',
            lines: [{ sku: 'A', quantity: 100n, unitPrice: 100n }],
          },
          m,
        ),
      );
    const orderA = await order(T1);
    const orderB = await order(T2);

    const receipt = (tenantId: string, number: string, orderId: string) =>
      repository.run(tenantId, (m) =>
        repository.insertReceipt(
          tenantId,
          {
            number,
            orderId,
            supplierCode: 'SUP',
            receivedAt: new Date('2026-11-05T09:00:00Z'),
            receivedBy: 'u1',
            idempotencyKey: 'same-key',
            totalValue: 0n,
            journalEntryId: null,
          },
          [],
          m,
        ),
      );

    const first = await receipt(T1, 'GR-000001', orderA.id);
    await expect(receipt(T1, 'GR-000002', orderA.id)).rejects.toThrow(/duplicate key|unique/i);
    const otherTenant = await receipt(T2, 'GR-000001', orderB.id);
    expect(otherTenant.id).not.toBe(first.id);
    expect(otherTenant.idempotencyKey).toBe('same-key');
  });

  it('allows two tenants to use the same document number', async () => {
    const created = await repository.run(T2, (m) =>
      repository.insertRequest(
        T2,
        {
          number: 'PR-000001',
          status: PurchaseRequestStatus.OPEN,
          requestedBy: 'u2',
          lines: [{ sku: 'A', quantity: 500n }],
        },
        m,
      ),
    );
    expect(created.tenantId).toBe(T2);
    expect(created.number).toBe('PR-000001');
  });
});