/**
 * Landed cost on a REAL PostgreSQL as a non-superuser role: migration with FORCE RLS, the
 * repository and tenant isolation end to end, plus the late-freight gate with the real services
 * and posting engine: a receipt of 10 units, 4 sold, a 1,000,000 minor-unit freight splits into
 * 600,000 into the FIFO layer and 400,000 into COGS, and the voucher balances.
 *
 * Opt-in like the other pg specs: skipped unless ROXIRA_TEST_PG_HOST is set. Each run creates and
 * drops its own database and role. Optional: ROXIRA_TEST_PG_USER, ROXIRA_TEST_PG_PORT, ROXIRA_TEST_PG_PASSWORD.
 *
 *   ROXIRA_TEST_PG_HOST=127.0.0.1 ROXIRA_TEST_PG_PORT=55460 npx jest modules/inventory/purchasing/landed-cost.pg.spec.ts
 */
import 'reflect-metadata';
import * as path from 'path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PeriodLockedException } from '../../accounting/exceptions/ledger.exceptions';
import { parseMinor } from '../../accounting/money';
import { AccountingService } from '../../accounting/services/accounting.service';
import { TenantScope } from '../../access/services/tenant-scope';
import { PostingRulesRepository } from '../../posting_rules/repositories/posting-rules.repository';
import { PostingRulesService } from '../../posting_rules/services/posting-rules.service';
import { FifoBatchEntity } from '../entities/fifo-batch.entity';
import { StockItemEntity } from '../entities/stock-item.entity';
import { WarehouseEntity } from '../entities/warehouse.entity';
import { InventoryRepository } from '../repositories/inventory.repository';
import { InventoryService } from '../services/inventory.service';
import { StockDocumentsService } from '../services/stock-documents.service';
import { PurchaseCycleService } from './purchase-cycle.service';
import { PurchaseRepository } from './purchase.repository';
import { PurchaseOrderStatus } from './purchase.types';
import { LandedCostBasis, LandedCostCategory } from './landed-cost.domain';
import { LandedCostRepository } from './landed-cost.repository';
import { LandedCostService } from './landed-cost.service';
import { CreateLandedCostDto } from './landed-cost.dto';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const APP_PW = 'landed-cost-app-test-only';
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

const TABLES = ['erp_landed_costs', 'erp_landed_cost_allocations'];

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

interface RecordedLine {
  tenant: string;
  docType: string;
  account: string;
  debit: bigint;
  credit: bigint;
}

describePg('Landed cost on PostgreSQL (non-superuser, FORCE RLS)', () => {
  const db = `rx_landed_cost_${process.pid}_${Date.now()}`;
  const role = `rx_lc_app_${process.pid}`;
  let admin: DataSource;
  let owner: DataSource;
  let app: DataSource;
  let scope: TenantScope;
  let purchases: PurchaseRepository;
  let landedCosts: LandedCostRepository;
  let accounting: AccountingService;
  let landed: LandedCostService;
  let cycle: PurchaseCycleService;
  let inventory: InventoryService;
  const lines: RecordedLine[] = [];
  const ledger: string[] = [];

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
    purchases = new PurchaseRepository(scope);
    landedCosts = new LandedCostRepository(scope);
    for (const tenantId of [T1, T2]) {
      await owner
        .query(`INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $2) ON CONFLICT DO NOTHING`, [
          tenantId,
          tenantId.slice(0, 8),
        ])
        .catch(() => undefined);
    }

    // The ledger is a fake that refuses unbalanced vouchers and records every line; the posting
    // engine, its templates and the role mappings are the real ones.
    accounting = {
      listAccounts: async (_tenantId: string) => ['1030', '2013', '5110', '2010'].map((code) => ({ code })),
      createJournalEntry: async (
        tenant: string,
        dto: { entryNumber: string; lines: Array<{ accountCode: string; debit: string; credit: string }> },
        manager?: { query: (sql: string, params: unknown[]) => Promise<Array<{ id: string }>> },
      ) => {
        const mapped = dto.lines.map((l: { accountCode: string; debit: string; credit: string }) => ({
          tenant,
          docType: dto.entryNumber.startsWith('LC-') ? 'purchase.landed_cost' : 'purchase.receipt',
          account: l.accountCode,
          debit: parseMinor(String(l.debit)),
          credit: parseMinor(String(l.credit)),
        }));
        expect(mapped.reduce((s: bigint, l: { debit: bigint }) => s + l.debit, 0n)).toBe(
          mapped.reduce((s: bigint, l: { credit: bigint }) => s + l.credit, 0n),
        );
        lines.push(...mapped);
        // Runs in the posting transaction of the tenant (RLS needs app.tenant_id on that connection).
        const [row] = await (manager ?? app).query(
          `INSERT INTO fin_journal_entries (tenant_id, entry_number, description) VALUES ($1, $2, 'test') RETURNING id`,
          [tenant, dto.entryNumber],
        );
        ledger.push(`${tenant}:${dto.entryNumber}`);
        return { id: row.id, entryNumber: dto.entryNumber };
      },
      isPeriodLocked: async () => false,
    } as unknown as AccountingService;

    const postingRules = new PostingRulesService(new PostingRulesRepository(scope), accounting);
    const inventoryRepository = new InventoryRepository(
      app.getRepository(WarehouseEntity),
      app.getRepository(StockItemEntity),
      app.getRepository(FifoBatchEntity),
      app,
    );
    inventory = new InventoryService(inventoryRepository);
    const stockAccounts = {
      resolveAccounts: async (_tenantId: string, specs: Array<{ name: string }>) =>
        specs.map((spec) => {
          const codes: Record<string, string> = {
            'موجودی کالا': '1030',
            'کالای دریافتی صورتحساب‌نشده': '2013',
            'بهای تمام‌شده کالای فروش‌رفته': '5110',
            'حساب‌های پرداختنی تجاری': '2010',
          };
          return codes[spec.name] ?? '1030';
        }),
    } as unknown as StockDocumentsService;
    cycle = new PurchaseCycleService(scope, purchases, inventory, stockAccounts, postingRules);
    landed = new LandedCostService(
      scope,
      purchases,
      landedCosts,
      inventoryRepository,
      stockAccounts,
      postingRules,
      accounting,
    );
  }, 240_000);

  afterAll(async () => {
    await app?.destroy();
    await owner?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin?.query(`DROP ROLE IF EXISTS ${role}`);
    await admin?.destroy();
  });

  function landedCostInput(receiptId: string, over: Record<string, unknown> = {}): CreateLandedCostDto {
    return {
      category: LandedCostCategory.FREIGHT,
      amount: '1000000',
      basis: LandedCostBasis.VALUE,
      date: '2026-11-05',
      supplierCode: 'SUP',
      reference: 'waybill-77',
      idempotencyKey: undefined,
      ...over,
    } as CreateLandedCostDto;
  }

  it('creates the two tables with ENABLE and FORCE row-level security and one policy each', async () => {
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

  it('hides tenant A landed costs from tenant B through the repository and plain SQL', async () => {
    const order = await purchases.run(T1, (m) =>
      purchases.insertOrder(
        T1,
        {
          number: 'PO-LC-1',
          supplierCode: 'SUP',
          status: PurchaseOrderStatus.RECEIVED,
          warehouseId: null,
          requestId: null,
          orderDate: '2026-11-01',
          lines: [{ sku: 'A', quantity: 1000n, unitPrice: 1_000_000n }],
        },
        m,
      ),
    );
    const receipt = await purchases.run(T1, (m) =>
      purchases.insertReceipt(
        T1,
        {
          number: 'GR-LC-1',
          orderId: order.id,
          supplierCode: 'SUP',
          receivedAt: new Date('2026-11-02T09:00:00Z'),
          receivedBy: 'u1',
          idempotencyKey: null,
          totalValue: 10_000_000n,
          journalEntryId: null,
        },
        [
          {
            orderLineId: order.lines[0].id,
            sku: 'A',
            quantity: 1000n,
            unitCost: 1_000_000n,
            value: 10_000_000n,
            weight: null,
            fifoBatchId: null,
          },
        ],
        m,
      ),
    );

    const created = await purchases.run(T1, (m) =>
      landedCosts.insertLandedCost(
        T1,
        {
          receiptId: receipt.id,
          category: LandedCostCategory.FREIGHT,
          basis: LandedCostBasis.VALUE,
          amount: 1_000_000n,
          date: '2026-11-05',
          supplierCode: 'SUP',
          reference: 'waybill-77',
          idempotencyKey: 'lc-key-iso',
          createdBy: 'u1',
          inventoryAmount: 1_000_000n,
          cogsAmount: 0n,
        },
        [
          {
            receiptLineId: receipt.lines[0].id,
            sku: 'A',
            quantity: 1000n,
            basisValue: 10_000_000n,
            share: 1_000_000n,
            toInventory: 1_000_000n,
            toCogs: 0n,
            fifoBatchId: null,
          },
        ],
        m,
      ),
    );

    expect(await purchases.run(T2, (m) => landedCosts.findLandedCost(T2, created.id, m))).toBeNull();
    expect(
      await purchases.run(T2, (m) => landedCosts.findByIdempotencyKey(T2, 'lc-key-iso', m)),
    ).toBeNull();

    await app.transaction(async (m) => {
      await TenantScope.bind(m, T2);
      expect(await m.query(`SELECT id FROM erp_landed_costs WHERE tenant_id = $1`, [T1])).toEqual([]);
      expect(
        await m.query(`UPDATE erp_landed_costs SET amount = 1 WHERE id = $1 RETURNING id`, [created.id]),
      ).toEqual([[], 0]);
      expect(
        await m.query(`DELETE FROM erp_landed_cost_allocations WHERE id = $1 RETURNING id`, [
          created.allocations[0].id,
        ]),
      ).toEqual([[], 0]);
    });

    const [stillThere] = await owner.query(`SELECT amount FROM erp_landed_costs WHERE id = $1`, [created.id]);
    expect(stillThere.amount).toBe('1000000');

    await expect(
      app.transaction(async (m) => {
        await TenantScope.bind(m, T2);
        await m.query(
          `INSERT INTO erp_landed_costs (tenant_id, receipt_id, category, basis, amount, cost_date, supplier_code, reference, created_by)
           VALUES ($1, $2, 'FREIGHT', 'VALUE', 1, '2026-11-05', 'SUP', 'x', 'u1')`,
          [T1, receipt.id],
        );
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it('keeps the idempotency key unique per tenant and pins the allocation sums in the database', async () => {
    const order = await purchases.run(T1, (m) =>
      purchases.insertOrder(
        T1,
        {
          number: 'PO-LC-2',
          supplierCode: 'SUP',
          status: PurchaseOrderStatus.RECEIVED,
          warehouseId: null,
          requestId: null,
          orderDate: '2026-11-01',
          lines: [{ sku: 'A', quantity: 1000n, unitPrice: 1_000_000n }],
        },
        m,
      ),
    );
    const receipt = await purchases.run(T1, (m) =>
      purchases.insertReceipt(
        T1,
        {
          number: 'GR-LC-2',
          orderId: order.id,
          supplierCode: 'SUP',
          receivedAt: new Date('2026-11-02T09:00:00Z'),
          receivedBy: 'u1',
          idempotencyKey: null,
          totalValue: 10_000_000n,
          journalEntryId: null,
        },
        [
          {
            orderLineId: order.lines[0].id,
            sku: 'A',
            quantity: 1000n,
            unitCost: 1_000_000n,
            value: 10_000_000n,
            weight: null,
            fifoBatchId: null,
          },
        ],
        m,
      ),
    );
    const input = {
      receiptId: receipt.id,
      category: LandedCostCategory.CUSTOMS,
      basis: LandedCostBasis.QUANTITY,
      amount: 1_000_000n,
      date: '2026-11-05',
      supplierCode: 'SUP',
      reference: 'customs-9',
      idempotencyKey: 'lc-key-uniq',
      createdBy: 'u1',
      inventoryAmount: 600_000n,
      cogsAmount: 400_000n,
    };
    const allocations = [
      {
        receiptLineId: receipt.lines[0].id,
        sku: 'A',
        quantity: 1000n,
        basisValue: 1000n,
        share: 1_000_000n,
        toInventory: 600_000n,
        toCogs: 400_000n,
        fifoBatchId: null,
      },
    ];

    await purchases.run(T1, (m) => landedCosts.insertLandedCost(T1, input, allocations, m));
    await expect(
      purchases.run(T1, (m) => landedCosts.insertLandedCost(T1, input, allocations, m)),
    ).rejects.toThrow(/duplicate key|unique/i);

    await expect(
      purchases.run(T1, (m) =>
        landedCosts.insertLandedCost(
          T1,
          { ...input, idempotencyKey: null, inventoryAmount: 1n, cogsAmount: 2n },
          allocations,
          m,
        ),
      ),
    ).rejects.toThrow(/check/i);

    await app.transaction(async (m) => {
      await TenantScope.bind(m, T2);
      await m.query(
        `INSERT INTO erp_landed_costs (tenant_id, receipt_id, category, basis, amount, cost_date, supplier_code, reference, idempotency_key, created_by, inventory_amount, cogs_amount)
         VALUES ($1, $2, 'CUSTOMS', 'QUANTITY', 1, '2026-11-05', 'SUP', 'customs-9', 'lc-key-uniq', 'u1', 1, 0)`,
        [T2, receipt.id],
      );
    });
  });

  it('runs the late-freight gate: 10 units received, 4 sold, 1,000,000 freight = 600,000 layer + 400,000 COGS', async () => {
    await inventory.createStockItem(T1, { sku: 'A', barcode: 'A', name: 'کالای آزمون', quantity: 0, minQuantity: 0 });
    const order = await cycle.createOrder(T1, 'u1', {
      supplierCode: 'SUP',
      orderDate: '2026-11-01',
      lines: [{ sku: 'A', quantity: '1000', unitPrice: '1000000' }],
    });
    await cycle.approveOrder(T1, 'u1', order.id);
    const receipt = await cycle.createReceipt(T1, 'u1', order.id, {
      lines: [{ orderLineId: order.lines[0].id, quantity: '1000' }],
    });
    const batchId = receipt.lines[0].fifoBatchId as number;

    // 4 of the 10 units are sold before the freight invoice arrives.
    await inventory.issueStock(T1, { sku: 'A', quantity: 4 });

    const created = await landed.createLandedCost(
      T1,
      'u1',
      receipt.id,
      landedCostInput(receipt.id, { idempotencyKey: 'lc-gate' }),
    );
    expect(created.inventoryAmount).toBe('600000');
    expect(created.cogsAmount).toBe('400000');
    expect(created.allocations).toHaveLength(1);
    expect(created.allocations[0]).toMatchObject({
      receiptLineId: receipt.lines[0].id,
      share: '1000000',
      toInventory: '600000',
      toCogs: '400000',
      fifoBatchId: batchId,
    });

    // The FIFO layer carries its share: 100,000 minor units per whole unit on the 6 remaining.
    const [batch] = await owner.query(
      `SELECT quantity_remaining, unit_purchase_cost FROM inventory_fifo_batches WHERE id = $1`,
      [batchId],
    );
    expect(Number(batch.quantity_remaining)).toBe(6);
    expect(Number(batch.unit_purchase_cost)).toBe(11_000);

    // The voucher: INVENTORY 600,000 + COGS 400,000 debit, PAYABLE 1,000,000 credit.
    const landedLines = lines.filter((line) => line.tenant === T1 && line.docType === 'purchase.landed_cost');
    const net: Record<string, bigint> = {};
    for (const line of landedLines) net[line.account] = (net[line.account] ?? 0n) + line.debit - line.credit;
    expect(net).toEqual({ '1030': 600_000n, '5110': 400_000n, '2010': -1_000_000n });

    // A repeated key returns the same record and writes nothing new (2 vouchers: receipt + landed cost).
    const again = await landed.createLandedCost(
      T1,
      'u1',
      receipt.id,
      landedCostInput(receipt.id, { idempotencyKey: 'lc-gate' }),
    );
    expect(again.id).toBe(created.id);
    expect(again.journalEntryId).toBe(created.journalEntryId);
    expect(ledger).toHaveLength(2);
    expect(lines.filter((line) => line.docType === 'purchase.landed_cost')).toHaveLength(3);

    // Another tenant gets a 404, a weightless WEIGHT allocation a 400.
    await expect(
      landed.createLandedCost(T2, 'u1', receipt.id, landedCostInput(receipt.id)),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      landed.createLandedCost(
        T1,
        'u1',
        receipt.id,
        landedCostInput(receipt.id, { basis: LandedCostBasis.WEIGHT, idempotencyKey: 'lc-weight' }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ledger).toHaveLength(2);

    // Two parallel first requests with one new key (the unique-violation race): one document, one voucher.
    const raced = await Promise.all([
      landed.createLandedCost(T1, 'u1', receipt.id, landedCostInput(receipt.id, { idempotencyKey: 'lc-race' })),
      landed.createLandedCost(T1, 'u1', receipt.id, landedCostInput(receipt.id, { idempotencyKey: 'lc-race' })),
    ]);
    expect(raced[1].id).toBe(raced[0].id);
    expect(raced[1].journalEntryId).toBe(raced[0].journalEntryId);
    expect(ledger).toHaveLength(3);

    // A locked period is refused before anything is written.
    (accounting as unknown as { isPeriodLocked: () => Promise<boolean> }).isPeriodLocked = async () => true;
    await expect(
      landed.createLandedCost(T1, 'u1', receipt.id, landedCostInput(receipt.id, { idempotencyKey: 'lc-locked' })),
    ).rejects.toBeInstanceOf(PeriodLockedException);
    (accounting as unknown as { isPeriodLocked: () => Promise<boolean> }).isPeriodLocked = async () => false;
    const rows = await owner.query(
      `SELECT count(*)::int AS count FROM erp_landed_costs WHERE receipt_id = $1`,
      [receipt.id],
    );
    expect(rows[0].count).toBe(2);
    expect(ledger).toHaveLength(3);
  });
});
