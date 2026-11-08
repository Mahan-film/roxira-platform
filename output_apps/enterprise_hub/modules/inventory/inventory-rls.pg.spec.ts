/**
 * Real PostgreSQL FORCE RLS integration test for Inventory & ERP Stock:
 * - Connects as a NOSUPERUSER NOBYPASSRLS role (`rx_inventory_rls_app`).
 * - Verifies all 6 inventory tables (`erp_stock_document_lines`, `erp_stock_documents`, `erp_stock_items`,
 *   `erp_stores`, `erp_warehouses`, `inventory_fifo_batches`) have `relrowsecurity = true` and `relforcerowsecurity = true`.
 * - Exercises the real `InventoryRepository` and `StockDocumentsRepository` methods across two tenants
 *   and proves strict isolation.
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { INVENTORY_RLS_TABLES } from '../../migrations/1789900001100-EnableRlsInventory';
import { TenantScope } from '../access/services/tenant-scope';
import { FifoBatchEntity } from './entities/fifo-batch.entity';
import { StockDocumentEntity, StockDocumentLineEntity } from './entities/stock-document.entity';
import { StockItemEntity } from './entities/stock-item.entity';
import { StoreEntity } from './entities/store.entity';
import { WarehouseEntity } from './entities/warehouse.entity';
import { StockDocumentStatus, StockDocumentType } from './enums/stock-document.enum';
import { InventoryRepository } from './repositories/inventory.repository';
import { StockDocumentsRepository } from './repositories/stock-documents.repository';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;

const ADMIN_USER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
const APP_ROLE = 'rx_inventory_rls_app';
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

const baseOptions = (database: string, username: string) => ({
  type: 'postgres' as const,
  host: HOST,
  port: PORT,
  username,
  database,
  entities: [
    WarehouseEntity,
    StockItemEntity,
    FifoBatchEntity,
    StoreEntity,
    StockDocumentEntity,
    StockDocumentLineEntity,
  ],
  migrations: [path.join(__dirname, '../../migrations/*.ts')],
  migrationsTransactionMode: 'each' as const,
  synchronize: false,
  logging: false,
});

const adminQuery = async (sql: string) => {
  const admin = new DataSource({
    ...baseOptions('postgres', ADMIN_USER),
    entities: [],
    migrations: [],
  });
  await admin.initialize();
  try {
    await admin.query(sql);
  } finally {
    await admin.destroy();
  }
};

describePg('Inventory & ERP Stock FORCE RLS on PostgreSQL (NOSUPERUSER NOBYPASSRLS)', () => {
  const dbName = `rx_inventory_rls_${process.pid}_${Date.now()}`;
  let ownerDs: DataSource;
  let appDs: DataSource;
  let scope: TenantScope;
  let invRepo: InventoryRepository;
  let docRepo: StockDocumentsRepository;

  beforeAll(async () => {
    await adminQuery(`CREATE DATABASE "${dbName}"`);
    await adminQuery(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
          CREATE ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
        END IF;
      END $$;
    `);

    ownerDs = new DataSource({
      ...baseOptions(dbName, ADMIN_USER),
      entities: [path.join(__dirname, '../**/*.entity.ts')],
    });
    await ownerDs.initialize();
    await ownerDs.runMigrations();

    await ownerDs.query(`GRANT CONNECT ON DATABASE "${dbName}" TO ${APP_ROLE}`);
    await ownerDs.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
    await ownerDs.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`,
    );
    await ownerDs.query(
      `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`,
    );

    appDs = new DataSource(baseOptions(dbName, APP_ROLE));
    await appDs.initialize();
    scope = new TenantScope(appDs);

    invRepo = new InventoryRepository(
      appDs.getRepository(WarehouseEntity),
      appDs.getRepository(StockItemEntity),
      appDs.getRepository(FifoBatchEntity),
      appDs,
      scope,
    );
    docRepo = new StockDocumentsRepository(appDs, scope);
  }, 180_000);

  afterAll(async () => {
    if (appDs?.isInitialized) await appDs.destroy();
    if (ownerDs?.isInitialized) await ownerDs.destroy();
    await adminQuery(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  });

  it('enables and forces RLS on all 6 inventory and ERP stock tables', async () => {
    const rows = (await appDs.query(
      `SELECT c.relname AS table_name, c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
       ORDER BY c.relname`,
      [INVENTORY_RLS_TABLES],
    )) as Array<{ table_name: string; rls: boolean; force_rls: boolean }>;

    expect(rows).toEqual(
      INVENTORY_RLS_TABLES.map((table_name) => ({
        table_name,
        rls: true,
        force_rls: true,
      })),
    );
  });

  it('isolates InventoryRepository methods (warehouses, stock items, FIFO batches) across tenants under NOSUPERUSER NOBYPASSRLS', async () => {
    const whA = await invRepo.createWarehouse(TENANT_A, {
      name: 'انبار مرکزی',
      locationCode: 'WH-1',
    });
    const whB = await invRepo.createWarehouse(TENANT_B, {
      name: 'انبار مرکزی',
      locationCode: 'WH-1',
    });

    expect((await invRepo.findAllWarehouses(TENANT_A)).map((w) => w.id)).toEqual([whA.id]);
    expect((await invRepo.findAllWarehouses(TENANT_B)).map((w) => w.id)).toEqual([whB.id]);
    expect(await invRepo.findWarehouseById(TENANT_B, whA.id)).toBeNull();

    const itemA = await invRepo.createStockItem(TENANT_A, {
      sku: 'SKU-100',
      barcode: 'BAR-100',
      name: 'کالای الف',
      quantity: 0,
      minQuantity: 2,
    });
    const itemB = await invRepo.createStockItem(TENANT_B, {
      sku: 'SKU-100',
      barcode: 'BAR-100',
      name: 'کالای ب',
      quantity: 0,
      minQuantity: 2,
    });

    expect(await invRepo.findStockItemById(TENANT_B, itemA.id)).toBeNull();
    expect((await invRepo.findStockItemBySku(TENANT_A, 'SKU-100'))?.id).toBe(itemA.id);
    expect((await invRepo.findStockItemBySku(TENANT_B, 'SKU-100'))?.id).toBe(itemB.id);

    const inboundA = await invRepo.persistInbound(TENANT_A, {
      sku: 'SKU-100',
      quantity: 10,
      unitPurchaseCost: 50_000,
      warehouseId: whA.id,
      batchNumber: 'BATCH-A-1',
    });
    expect(Number(inboundA.item.quantity)).toBe(10);
    expect(await invRepo.availableQuantity(TENANT_A, 'SKU-100', whA.id)).toBe(10);
    expect(await invRepo.availableQuantity(TENANT_B, 'SKU-100', whA.id)).toBe(0);
    expect(await invRepo.findBatchesBySku(TENANT_A, 'SKU-100')).toHaveLength(1);
    expect(await invRepo.findBatchesBySku(TENANT_B, 'SKU-100')).toEqual([]);

    const outboundA = await invRepo.persistOutbound(TENANT_A, {
      sku: 'SKU-100',
      quantity: 4,
      warehouseId: whA.id,
    });
    expect(Number(outboundA.item.quantity)).toBe(6);

    // Tenant B cannot delete or modify Tenant A's stock item or FIFO layer
    expect(await invRepo.deleteStockItemsByIds(TENANT_B, [itemA.id])).toBe(0);
    await invRepo.raiseLayerUnitCostByMinor(TENANT_B, inboundA.batch.id, 100_000n);
    const [batchAfter] = await invRepo.findBatchesBySku(TENANT_A, 'SKU-100');
    expect(Number(batchAfter.unitPurchaseCost)).toBe(50_000);
  });

  it('isolates StockDocumentsRepository methods (stores, stock documents, lines) across tenants under NOSUPERUSER NOBYPASSRLS', async () => {
    const [whA] = await invRepo.findAllWarehouses(TENANT_A);

    const storeA = await docRepo.createStore(TENANT_A, {
      code: 'ST-1',
      name: 'شعبه مرکزی الف',
      address: 'تهران',
    });
    const storeB = await docRepo.createStore(TENANT_B, {
      code: 'ST-1',
      name: 'شعبه مرکزی ب',
      address: 'شیراز',
    });

    expect(await docRepo.findStoreById(TENANT_B, storeA.id)).toBeNull();
    expect((await docRepo.listStores(TENANT_A)).map((s) => s.id)).toEqual([storeA.id]);
    expect((await docRepo.listStores(TENANT_B)).map((s) => s.id)).toEqual([storeB.id]);

    const docA = await docRepo.transaction(
      (manager) =>
        docRepo.insertDocument(
          TENANT_A,
          {
            docNumber: 'PR-20260401-00001',
            docType: StockDocumentType.PURCHASE_RECEIPT,
            status: StockDocumentStatus.POSTED,
            docDate: '2026-04-01',
            toWarehouseId: whA.id,
            createdBy: 'actor-a',
            postedAt: new Date(),
          },
          [
            {
              itemId: null,
              sku: 'SKU-100',
              quantity: 10,
              unitCost: 50_000,
              value: 500_000,
              batchNumber: 'BATCH-A-1',
            },
          ],
          manager,
        ),
      TENANT_A,
    );

    expect((await docRepo.findDocument(TENANT_A, docA.id))?.docNumber).toBe('PR-20260401-00001');
    expect(await docRepo.findDocument(TENANT_B, docA.id)).toBeNull();
    expect(await docRepo.findDocumentLines(TENANT_A, docA.id)).toHaveLength(1);
    expect(await docRepo.findDocumentLines(TENANT_B, docA.id)).toEqual([]);

    const [docsB, totalB] = await docRepo.listDocuments(TENANT_B, { skip: 0, take: 20 });
    expect(totalB).toBe(0);
    expect(docsB).toEqual([]);

    // Tenant B cannot delete or update Tenant A's document
    await docRepo.transaction((m) => docRepo.deleteDraft(TENANT_B, docA.id, m), TENANT_B);
    expect(await docRepo.findDocument(TENANT_A, docA.id)).not.toBeNull();

    for (const table of INVENTORY_RLS_TABLES) {
      const unscoped = await appDs.query(`SELECT count(*)::int AS n FROM "${table}"`);
      expect(unscoped[0].n).toBe(0);
    }
  });
});
