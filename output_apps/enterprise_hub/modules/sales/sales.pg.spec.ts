/**
 * Sales quotations and orders on a REAL PostgreSQL as a non-superuser role: migration with FORCE
 * RLS, the scoped repository/service, exact totals, the state machine, conversion and checkout
 * checks (delivered/invoiced <= quantity) end to end.
 *
 * Opt-in like the other pg specs: skipped unless ROXIRA_TEST_PG_HOST is set. Each run creates and
 * drops its own database and role. Optional: ROXIRA_TEST_PG_USER, ROXIRA_TEST_PG_PORT, ROXIRA_TEST_PG_PASSWORD.
 *
 *   ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55433 ROXIRA_TEST_PG_USER=postgres npx jest --runInBand modules/sales/sales.pg.spec.ts
 */
import 'reflect-metadata';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { PartyRole } from '../parties/enums/party-role.enum';
import { PartiesRepository } from '../parties/repositories/parties.repository';
import { PartiesService } from '../parties/services/parties.service';
import { SalesRepository } from './repositories/sales.repository';
import { SalesService } from './services/sales.service';
import { SalesOrderStatus, SalesQuotationStatus } from './enums/sales-status.enum';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const APP_PW = 'sales-app-test-only';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

const options = (database: string, username = OWNER, password = OWNER_PW) => ({
  type: 'postgres' as const,
  host: HOST,
  port: PORT,
  username,
  password,
  database,
  entities: [path.join(__dirname, '../**/*.entity.ts')],
  migrations: [path.join(__dirname, '../../migrations/*.ts')],
  migrationsTransactionMode: 'each' as const,
  synchronize: false,
  logging: false,
});

describePg('Sales quotations and orders on PostgreSQL (non-superuser, FORCE RLS)', () => {
  const db = `rx_sales_${process.pid}_${Date.now()}`;
  const role = `rx_sls_app_${process.pid}`;
  const fourTables = [
    'erp_sales_quotations',
    'erp_sales_quotation_lines',
    'erp_sales_orders',
    'erp_sales_order_lines',
  ];
  let admin: DataSource;
  let owner: DataSource;
  let app: DataSource;
  let sales: SalesService;
  let warehouseId: number;
  let item1: number;
  let item2: number;
  let seedQuotationId: number;
  let seedOrderId: number;

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
    sales = new SalesService(new SalesRepository(scope), new PartiesService(new PartiesRepository(scope)));

    for (const tenantId of [T1, T2]) {
      await owner
        .query(`INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $2) ON CONFLICT DO NOTHING`, [tenantId, tenantId.slice(0, 8)])
        .catch(() => undefined);
    }
    await new PartiesService(new PartiesRepository(scope)).create(T1, {
      code: 'CUST',
      name: 'مشتری نمونه',
      role: PartyRole.CUSTOMER,
    } as never);
    await owner.query(
      `INSERT INTO erp_stock_items (tenant_id, sku, barcode, name, quantity, min_quantity)
       VALUES ($1, 'I-1', 'I-1', 'کالا ۱', 0, 0), ($1, 'I-2', 'I-2', 'کالا ۲', 0, 0)`,
      [T1],
    );
    const items = await owner.query<Array<{ id: number; sku: string }>>(
      `SELECT id, sku FROM erp_stock_items WHERE tenant_id = $1 ORDER BY sku`,
      [T1],
    );
    item1 = Number(items.find((row) => row.sku === 'I-1')!.id);
    item2 = Number(items.find((row) => row.sku === 'I-2')!.id);
    const [warehouse] = await owner.query<Array<{ id: number }>>(
      `INSERT INTO erp_warehouses (tenant_id, name, location_code, is_active) VALUES ($1, 'انبار اصلی', 'W-1', true) RETURNING id`,
      [T1],
    );
    warehouseId = Number(warehouse.id);
  }, 240_000);

  afterAll(async () => {
    await app?.destroy();
    await owner?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin?.query(`DROP ROLE IF EXISTS ${role}`);
    await admin?.destroy();
  });

  it('runs as a non-superuser and all four sales tables have ENABLE + FORCE RLS with a policy', async () => {
    const [r] = await app.query(`SELECT r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user`);
    expect(r).toMatchObject({ rolsuper: false, rolbypassrls: false });
    for (const table of fourTables) {
      const [row] = await owner.query(
        `SELECT c.relrowsecurity, c.relforcerowsecurity,
                (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::int AS policies
           FROM pg_class c WHERE c.relname = $1`,
        [table],
      );
      expect({ table, ...row }).toMatchObject({
        table,
        relrowsecurity: true,
        relforcerowsecurity: true,
        policies: 1,
      });
    }
  });

  it('numbers documents per tenant: QT-1, QT-2 for quotations and SO-1 for an order', async () => {
    const quote1 = await sales.createQuotation(T1, {
      partyCode: 'CUST',
      quoteDate: '2026-05-01',
      lines: [{ itemId: item1, quantity: 1, unitPrice: 1000 }],
    } as never);
    const quote2 = await sales.createQuotation(T1, {
      partyCode: 'CUST',
      quoteDate: '2026-05-02',
      lines: [{ itemId: item1, quantity: 1, unitPrice: 1000 }],
    } as never);
    const order1 = await sales.createOrder(T1, {
      partyCode: 'CUST',
      warehouseId,
      orderDate: '2026-05-03',
      lines: [{ itemId: item1, quantity: 1, unitPrice: 1000 }],
    } as never);
    expect(quote1.number).toBe('QT-1');
    expect(quote2.number).toBe('QT-2');
    expect(order1.number).toBe('SO-1');
    expect(quote1.status).toBe(SalesQuotationStatus.DRAFT);
    expect(order1.status).toBe(SalesOrderStatus.DRAFT);
    seedQuotationId = quote1.id;
    seedOrderId = order1.id;
  });

  it('tenant B cannot list or get tenant A documents, RLS cuts raw reads and refuses a foreign write', async () => {
    await expect(sales.getQuotation(T2, seedQuotationId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(sales.getOrder(T2, seedOrderId)).rejects.toBeInstanceOf(NotFoundException);
    expect((await sales.listQuotations(T2, { limit: 50, offset: 0 } as never)).total).toBe(0);
    expect((await sales.listOrders(T2, { limit: 50, offset: 0 } as never)).total).toBe(0);

    await app.transaction(async (m) => {
      await TenantScope.bind(m, T2);
      for (const table of fourTables) {
        expect(await m.query(`SELECT 1 FROM "${table}"`)).toEqual([]);
      }
    });
    for (const table of fourTables) {
      expect(await app.query(`SELECT 1 FROM "${table}"`)).toEqual([]);
    }

    await expect(
      app.transaction(async (m) => {
        await TenantScope.bind(m, T2);
        await m.query(
          `INSERT INTO erp_sales_quotations (tenant_id, number, party_code, quote_date) VALUES ($1, 'QT-X', 'CUST', '2026-05-01')`,
          [T1],
        );
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it('computes exact totals and converts a SENT quotation once into an order', async () => {
    const quote = await sales.createQuotation(T1, {
      partyCode: 'CUST',
      quoteDate: '2026-05-10',
      lines: [
        { itemId: item1, quantity: 2.5, unitPrice: 40000 },
        { itemId: item2, quantity: 3, unitPrice: 12500, discount: 1500 },
      ],
    } as never);
    expect(quote.totalAmount).toBe(136000);
    expect(quote.lines!.map((line) => line.lineTotal)).toEqual([100000, 36000]);
    expect(quote.lines!.map((line) => line.quantity)).toEqual([2.5, 3]);

    await sales.changeQuotationStatus(T1, quote.id, { status: SalesQuotationStatus.SENT } as never);
    const order = await sales.convertQuotation(T1, quote.id, {
      warehouseId,
      orderDate: '2026-05-11',
    } as never);
    expect(order.status).toBe(SalesOrderStatus.DRAFT);
    expect(order.totalAmount).toBe(136000);
    expect(order.quotationId).toBe(quote.id);
    expect(Number(order.number.replace('SO-', ''))).toBeGreaterThan(0);
    expect((await sales.getQuotation(T1, quote.id)).status).toBe(SalesQuotationStatus.CONVERTED);

    await expect(
      sales.convertQuotation(T1, quote.id, { warehouseId, orderDate: '2026-05-12' } as never),
    ).rejects.toBeInstanceOf(ConflictException);

    const draft = await sales.createQuotation(T1, {
      partyCode: 'CUST',
      quoteDate: '2026-05-13',
      lines: [{ itemId: item1, quantity: 1, unitPrice: 1000 }],
    } as never);
    await expect(
      sales.convertQuotation(T1, draft.id, { warehouseId, orderDate: '2026-05-13' } as never),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('confirms and cancels an order, but refuses to cancel one with a delivery', async () => {
    const order = await sales.createOrder(T1, {
      partyCode: 'CUST',
      warehouseId,
      orderDate: '2026-06-01',
      lines: [{ itemId: item1, quantity: 5, unitPrice: 2000 }],
    } as never);
    expect((await sales.confirmOrder(T1, order.id)).status).toBe(SalesOrderStatus.CONFIRMED);
    expect((await sales.cancelOrder(T1, order.id)).status).toBe(SalesOrderStatus.CANCELLED);

    const delivered = await sales.createOrder(T1, {
      partyCode: 'CUST',
      warehouseId,
      orderDate: '2026-06-02',
      lines: [{ itemId: item1, quantity: 5, unitPrice: 2000 }],
    } as never);
    await sales.confirmOrder(T1, delivered.id);
    await owner.query(`UPDATE erp_sales_order_lines SET delivered_quantity = 1 WHERE tenant_id = $1 AND order_id = $2`, [
      T1,
      delivered.id,
    ]);
    await expect(sales.cancelOrder(T1, delivered.id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a quantity with more than two decimals as a bad request', async () => {
    await expect(
      sales.createQuotation(T1, {
        partyCode: 'CUST',
        quoteDate: '2026-07-01',
        lines: [{ itemId: item1, quantity: '1.125', unitPrice: 1000 }],
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('the database refuses a delivered quantity above the ordered quantity', async () => {
    const order = await sales.createOrder(T1, {
      partyCode: 'CUST',
      warehouseId,
      orderDate: '2026-08-01',
      lines: [{ itemId: item1, quantity: 1, unitPrice: 1000 }],
    } as never);
    await expect(
      owner.query(`UPDATE erp_sales_order_lines SET delivered_quantity = 2 WHERE tenant_id = $1 AND order_id = $2`, [
        T1,
        order.id,
      ]),
    ).rejects.toThrow(/CHK_erp_sales_order_lines_delivered/);
  });
});
