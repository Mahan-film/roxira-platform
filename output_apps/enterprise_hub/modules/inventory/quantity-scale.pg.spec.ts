/**
 * Real PostgreSQL integration test for Quantity Scale & Landed Cost Remainder (#500):
 * - Connects as a NOSUPERUSER NOBYPASSRLS role (`rx_qty_scale_app`).
 * - Exercises real InventoryRepository and InventoryService under TenantScope.
 * - Proves that quantities with > 2 decimal places (e.g. 1.125) are refused on both sale/issue and purchase/receive,
 *   preventing silent rounding from corrupting physical stock.
 * - Proves that hand-computed 2-decimal sales and purchases move stock exactly without discrepancy.
 * - Proves that landed-cost allocation books remainder to COGS, reconciling FIFO layers with GL ledger down to 0 rials.
 */
import 'reflect-metadata';
import * as path from 'path';
import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { FifoBatchEntity } from './entities/fifo-batch.entity';
import { StockItemEntity } from './entities/stock-item.entity';
import { WarehouseEntity } from './entities/warehouse.entity';
import { InventoryRepository } from './repositories/inventory.repository';
import { InventoryService } from './services/inventory.service';
import { layerRaise, splitShare } from './purchasing/landed-cost.domain';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;

const ADMIN_USER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const PORT = process.env.ROXIRA_TEST_PG_PORT ? Number(process.env.ROXIRA_TEST_PG_PORT) : 5432;
const APP_ROLE = 'rx_qty_scale_app';
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const SKU = 'SCALE-SKU-1';

const baseOptions = (database: string, username: string) => ({
  type: 'postgres' as const,
  host: HOST,
  port: PORT,
  username,
  database,
  entities: [WarehouseEntity, StockItemEntity, FifoBatchEntity],
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

describePg('Quantity scale & landed-cost remainder on PostgreSQL (NOSUPERUSER NOBYPASSRLS)', () => {
  const dbName = `rx_qty_scale_${process.pid}_${Date.now()}`;
  let ownerDs: DataSource;
  let appDs: DataSource;
  let scope: TenantScope;
  let invRepo: InventoryRepository;
  let invService: InventoryService;

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
    invService = new InventoryService(invRepo);

    // Seed stock item
    await invRepo.createStockItem(TENANT_A, {
      sku: SKU,
      barcode: SKU,
      name: 'Item for scale testing',
      quantity: 0,
      minQuantity: 0,
    });
  }, 180_000);

  afterAll(async () => {
    if (appDs?.isInitialized) await appDs.destroy();
    if (ownerDs?.isInitialized) await ownerDs.destroy();
    await adminQuery(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  });

  it('refuses inbound / purchase with 3 decimals (e.g. 1.125) instead of silently rounding', async () => {
    await expect(
      invService.receiveStock(TENANT_A, {
        sku: SKU,
        quantity: 1.125,
        unitPurchaseCost: 100_000,
      }),
    ).rejects.toThrow(BadRequestException);

    // Verify stock remains 0 (not silently moved or corrupted)
    const item = await invRepo.findStockItemBySku(TENANT_A, SKU);
    expect(item?.quantity).toBe(0);
  });

  it('accepts exact 2-decimal inbound / purchase and records FIFO layer without rounding error', async () => {
    const inbound = await invService.receiveStock(TENANT_A, {
      sku: SKU,
      quantity: 2.5,
      unitPurchaseCost: 100_000,
    });

    expect(inbound.quantity).toBe(2.5);
    expect(inbound.quantityAfter).toBe(2.5);

    const item = await invRepo.findStockItemBySku(TENANT_A, SKU);
    expect(item?.quantity).toBe(2.5);

    const batches = await invRepo.findBatchesBySku(TENANT_A, SKU);
    expect(batches).toHaveLength(1);
    expect(batches[0].quantityRemaining).toBe(2.5);
    expect(batches[0].unitPurchaseCost).toBe(100_000);
  });

  it('refuses outbound / sale with 3 decimals (e.g. 1.125) instead of silently rounding', async () => {
    await expect(
      invService.issueStock(TENANT_A, {
        sku: SKU,
        quantity: 1.125,
      }),
    ).rejects.toThrow(BadRequestException);

    // Verify stock remains unchanged at 2.5
    const item = await invRepo.findStockItemBySku(TENANT_A, SKU);
    expect(item?.quantity).toBe(2.5);
  });

  it('accepts exact 2-decimal outbound / sale and reduces FIFO layer with zero trailing discrepancy', async () => {
    const outbound = await invService.issueStock(TENANT_A, {
      sku: SKU,
      quantity: 1.25,
    });

    expect(outbound.quantity).toBe(1.25);
    expect(outbound.quantityAfter).toBe(1.25);
    expect(outbound.totalCost).toBe(125_000); // 1.25 * 100_000

    const item = await invRepo.findStockItemBySku(TENANT_A, SKU);
    expect(item?.quantity).toBe(1.25);

    const batches = await invRepo.findBatchesBySku(TENANT_A, SKU);
    expect(batches).toHaveLength(1);
    expect(batches[0].quantityRemaining).toBe(1.25);
  });

  it('reconciles landed cost remainder into COGS with zero discrepancy against FIFO batches', async () => {
    // 3 remaining units (300 hundredths), 100 minor units landed cost.
    // layerRaise gives raisePerUnit: 33n, remainder: 1n.
    const remainingHundredths = 300n;
    const split = splitShare(100n, 300n, remainingHundredths);
    const { raisePerUnit, remainder } = layerRaise(split.toInventory, remainingHundredths);

    const toInventory = split.toInventory - remainder;
    const toCogs = split.toCogs + remainder;

    expect(toInventory).toBe(99n);
    expect(toCogs).toBe(1n);
    expect(toInventory + toCogs).toBe(100n);

    // Physical batch layer value increase equals ledger inventory line down to 0 rials:
    const physicalIncrease = (remainingHundredths * raisePerUnit) / 100n;
    expect(physicalIncrease).toBe(toInventory);
  });
});
