/**
 * Sales quotations and orders on a REAL PostgreSQL as a non-superuser role: migration with FORCE
 * RLS, the scoped repository/service, exact totals, the state machine, conversion and checkout
 * checks (delivered/invoiced <= quantity) end to end.
 *
 * Opt-in like the other pg specs: skipped unless ROXIRA_TEST_PG_HOST is set. Each run creates and
 * drops its own database and role. Optional: ROXIRA_TEST_PG_USER, ROXIRA_TEST_PG_PORT, ROXIRA_TEST_PG_PASSWORD.
 *
 *   ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55433 ROXIRA_TEST_PG_USER=postgres npx jest --runInBand modules/sales/availability.pg.spec.ts
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
import { SalesAvailabilityService } from './services/sales-availability.service';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import { InventoryModule } from '../inventory/inventory.module';
import { SalesModule } from './sales.module';
import { InventoryService } from '../inventory/services/inventory.service';
import { InventoryRepository } from '../inventory/repositories/inventory.repository';
import { WarehouseEntity } from '../inventory/entities/warehouse.entity';
import { StockItemEntity } from '../inventory/entities/stock-item.entity';
import { FifoBatchEntity } from '../inventory/entities/fifo-batch.entity';
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

describePg('Reservation and available stock on PostgreSQL (derived, non-superuser)', () => {
  const db = `rx_avail_${process.pid}_${Date.now()}`;
  const role = `rx_av_app_${process.pid}`;
  let admin: DataSource;
  let owner: DataSource;
  let app: DataSource;
  let sales: SalesService;
  let availability: SalesAvailabilityService;
  let withSales: InventoryService;
  let withoutSales: InventoryService;
  let A: number;
  let B: number;
  let C: number;
  let warehouseId: number;
  let o1Id: number;
  let o2Id: number;

  const order = async (tenant: string, party: string, lines: Array<[number, number]>, confirm: boolean) => {
    const created = await sales.createOrder(tenant, {
      partyCode: party,
      warehouseId,
      orderDate: '2026-05-03',
      lines: lines.map(([itemId, quantity]) => ({ itemId, quantity, unitPrice: 1000 })),
    } as never);
    if (confirm) await sales.confirmOrder(tenant, created.id);
    return created.id;
  };

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
    const parties = new PartiesService(new PartiesRepository(scope));
    const salesRepo = new SalesRepository(scope);
    sales = new SalesService(salesRepo, parties);
    availability = new SalesAvailabilityService(salesRepo);
    const invRepo = new InventoryRepository(
      app.getRepository(WarehouseEntity),
      app.getRepository(StockItemEntity),
      app.getRepository(FifoBatchEntity),
      app,
    );
    withSales = new InventoryService(invRepo, availability);
    withoutSales = new InventoryService(invRepo);

    for (const tenantId of [T1, T2]) {
      await owner
        .query(`INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $2) ON CONFLICT DO NOTHING`, [tenantId, tenantId.slice(0, 8)])
        .catch(() => undefined);
      await parties.create(tenantId, { code: 'CUST', name: 'مشتری نمونه', role: PartyRole.CUSTOMER } as never);
    }
    await owner.query(
      `INSERT INTO erp_stock_items (tenant_id, sku, barcode, name, quantity, min_quantity) VALUES
        ($1, 'A', 'A', 'کالا A', 10, 6), ($1, 'B', 'B', 'کالا B', 20, 5), ($1, 'C', 'C', 'کالا C', 3, 0),
        ($2, 'X', 'X', 'کالا X', 100, 0)`,
      [T1, T2],
    );
    const rows = await owner.query<Array<{ id: number; sku: string }>>(`SELECT id, sku FROM erp_stock_items`);
    const idOf = (sku: string) => Number(rows.find((r) => r.sku === sku)!.id);
    A = idOf('A');
    B = idOf('B');
    C = idOf('C');
    const X = idOf('X');
    const wh = await owner.query<Array<{ id: number; tenant_id: string }>>(
      `INSERT INTO erp_warehouses (tenant_id, name, location_code, is_active) VALUES ($1, 'انبار', 'W-1', true), ($2, 'انبار', 'W-1', true) RETURNING id, tenant_id`,
      [T1, T2],
    );
    warehouseId = Number(wh.find((w) => w.tenant_id === T1)!.id);
    const warehouseB = Number(wh.find((w) => w.tenant_id === T2)!.id);

    o1Id = await order(T1, 'CUST', [[A, 3], [B, 4]], true); // O1 confirmed
    o2Id = await order(T1, 'CUST', [[A, 2.5]], true); // O2 confirmed
    await order(T1, 'CUST', [[A, 100]], false); // O3 draft
    const o4 = await order(T1, 'CUST', [[A, 50]], true); // O4 cancelled
    await sales.cancelOrder(T1, o4);
    await owner.query(
      `UPDATE erp_sales_order_lines SET delivered_quantity = 1 WHERE tenant_id = $1 AND order_id = $2 AND item_id = $3`,
      [T1, o1Id, A],
    );
    // tenant B reserves its own item; it must not change tenant A numbers
    const tb = await sales.createOrder(T2, {
      partyCode: 'CUST',
      warehouseId: warehouseB,
      orderDate: '2026-05-03',
      lines: [{ itemId: X, quantity: 7, unitPrice: 1000 }],
    } as never);
    await sales.confirmOrder(T2, tb.id);
  }, 240_000);

  afterAll(async () => {
    await app?.destroy();
    await owner?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin?.query(`DROP ROLE IF EXISTS ${role}`);
    await admin?.destroy();
  });

  it('derives reserved and available from CONFIRMED open quantity only, on-hand unchanged', async () => {
    const rows = await availability.availability(T1, [A, B, C]);
    expect(rows.map((r) => [r.sku, r.onHand, r.reserved, r.available])).toEqual([
      ['A', 10, 4.5, 5.5], // O1 open 3-1=2, O2 2.5; DRAFT 100 and CANCELLED 50 ignored
      ['B', 20, 4, 16],
      ['C', 3, 0, 3],
    ]);
    const [onHand] = await owner.query(`SELECT quantity FROM erp_stock_items WHERE id = $1`, [A]);
    expect(Number(onHand.quantity)).toBe(10);
  });

  it('reorder list uses available stock: A (available 5.5 <= 6) is low although on-hand 10 is not', async () => {
    const low = await withSales.listStockItems(T1, { page: 1, limit: 50, lowStockOnly: true } as never);
    expect(low.data.map((i) => i.sku)).toEqual(['A']);
    expect(low.lowStockCount).toBe(1);
    const all = await withSales.listStockItems(T1, { page: 1, limit: 50 } as never);
    const a = all.data.find((i) => i.sku === 'A')!;
    expect([a.quantity, a.reservedQuantity, a.availableQuantity, a.isLowStock]).toEqual([10, 4.5, 5.5, true]);
    expect(all.data.find((i) => i.sku === 'B')!.isLowStock).toBe(false);
    const valuation = await withSales.getFifoValuation(T1);
    expect(valuation.rows.find((r) => r.sku === 'A')!.availableQuantity).toBe(5.5);
  });

  it('without the sales service the rule falls back to on-hand', async () => {
    const low = await withoutSales.listStockItems(T1, { page: 1, limit: 50, lowStockOnly: true } as never);
    expect(low.data).toHaveLength(0);
  });

  it('cancelling O2 frees its reservation; a fully delivered line reserves nothing', async () => {
    await sales.cancelOrder(T1, o2Id);
    expect((await availability.availability(T1, [A]))[0]).toMatchObject({ reserved: 2, available: 8 });
    expect((await withSales.listStockItems(T1, { page: 1, limit: 50, lowStockOnly: true } as never)).data).toHaveLength(0);
    await owner.query(
      `UPDATE erp_sales_order_lines SET delivered_quantity = quantity WHERE tenant_id = $1 AND order_id = $2 AND item_id = $3`,
      [T1, o1Id, B],
    );
    expect((await availability.availability(T1, [B]))[0]).toMatchObject({ reserved: 0, available: 20 });
  });

  it('dirty double-precision on-hand rows render rounded like roundQuantity and never throw', async () => {
    const dirty: Array<[string, string, number]> = [
      ['D-FLOAT', '0.30000000000000004', 0.3],
      ['D-NEG', '-1.5', -1.5],
      ['D-3DEC', '1.125', 1.13],
      ['D-ZERO', '0', 0],
      ['D-NAN', "'NaN'", 0],
    ];
    for (const [sku, literal] of dirty) {
      const value = literal.startsWith("'") ? `${literal}::float8` : `${literal}::float8`;
      await owner.query(
        `INSERT INTO erp_stock_items (tenant_id, sku, barcode, name, quantity, min_quantity) VALUES ($1, $2, $2, $2, ${value}, 0)`,
        [T1, sku],
      );
    }
    const list = await withSales.listStockItems(T1, { page: 1, limit: 100 } as never);
    for (const [sku, literal, expected] of dirty) {
      const row = list.data.find((i) => i.sku === sku)!;
      expect(row.quantity).toBe(expected);
      expect(row.availableQuantity).toBe(expected);
      const old = Number(literal.replace(/'/g, ''));
      if (Number.isFinite(old)) {
        expect(row.quantity).toBe(Math.round((old + Number.EPSILON) * 100) / 100); // same as the old roundQuantity
      }
    }
    const valuation = await withSales.getFifoValuation(T1);
    expect(valuation.rows.find((r) => r.sku === 'D-3DEC')!.quantity).toBe(1.13);
    const ids = list.data.filter((i) => i.sku.startsWith('D-')).map((i) => i.id);
    const avail = await availability.availability(T1, ids);
    expect(avail.map((r) => r.available).sort((a, b) => a - b)).toEqual([-1.5, 0, 0, 0.3, 1.13]);
    await owner.query(`DELETE FROM erp_stock_items WHERE tenant_id = $1 AND sku LIKE 'D-%'`, [T1]);
  });

  it('module wiring: InventoryService gets the reservation service from SalesModule and there is no import cycle', async () => {
    // Metadata the Nest container reads: InventoryModule imports SalesModule, which exports the
    // service; InventoryService declares it as an @Optional() second constructor parameter.
    const imports = (m: unknown): unknown[] => (Reflect.getMetadata('imports', m as object) ?? []).filter(Boolean);
    expect(imports(InventoryModule)).toContain(SalesModule);
    expect(Reflect.getMetadata('exports', SalesModule)).toContain(SalesAvailabilityService);
    expect(Reflect.getMetadata('design:paramtypes', InventoryService)[1]).toBe(SalesAvailabilityService);
    // No cycle: nothing reachable from SalesModule's imports is InventoryModule.
    const seen = new Set<unknown>();
    const walk = (m: unknown): void => {
      if (seen.has(m)) return;
      seen.add(m);
      imports(m).forEach(walk);
    };
    walk(SalesModule);
    expect(seen.has(InventoryModule)).toBe(false);
    // Real container: SalesModule (real) plus InventoryService (real class) must receive the instance.
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({ ...options(db, role, APP_PW), autoLoadEntities: false } as never),
        SalesModule,
      ],
      providers: [
        InventoryService,
        {
          provide: InventoryRepository,
          useFactory: (ds: DataSource) =>
            new InventoryRepository(
              ds.getRepository(WarehouseEntity),
              ds.getRepository(StockItemEntity),
              ds.getRepository(FifoBatchEntity),
              ds,
            ),
          inject: [getDataSourceToken()],
        },
      ],
    }).compile();
    const inventory = moduleRef.get(InventoryService);
    expect((inventory as unknown as { reservations?: unknown }).reservations).toBeInstanceOf(SalesAvailabilityService);
    // After the previous tests O1 still reserves 2 of A (O2 cancelled): the container-built service applies it.
    const all = await inventory.listStockItems(T1, { page: 1, limit: 100 } as never);
    const a = all.data.find((i) => i.sku === 'A')!;
    expect([a.quantity, a.reservedQuantity, a.availableQuantity]).toEqual([10, 2, 8]);
    await moduleRef.close();
  });
});
