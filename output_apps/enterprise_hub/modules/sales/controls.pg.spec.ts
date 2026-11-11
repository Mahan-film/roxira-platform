/**
 * Controls integration spec on a REAL PostgreSQL as a NOSUPERUSER NOBYPASSRLS role (#584 item 7):
 * 1. Credit exposure (open sale invoices + uncleared cheques vs party credit limit / policy)
 * 2. Discount limit per role (agent vs manager vs owner)
 * 3. Negative stock policy (refuse vs warn)
 * 4. Budget warning (project budget vs posted ledger expenses)
 *
 * Runs under TenantScope with forced tenant RLS.
 */
import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TenantScope } from '../access/services/tenant-scope';
import { PartyRole } from '../parties/enums/party-role.enum';
import { PartiesRepository } from '../parties/repositories/parties.repository';
import { PartiesService } from '../parties/services/parties.service';
import { SalesRepository } from './repositories/sales.repository';
import { SalesService } from './services/sales.service';
import { CreditExposureService } from './policy/credit-exposure.service';
import { DiscountPolicyService } from './policy/discount-policy.service';
import { PolicyService } from '../tenants/policy/policy.service';
import { AuditService } from '../access/services/audit.service';
import { InventoryRepository } from '../inventory/repositories/inventory.repository';
import { InsufficientStockError } from '../inventory/errors/inventory.errors';
import { WarehouseEntity } from '../inventory/entities/warehouse.entity';
import { StockItemEntity } from '../inventory/entities/stock-item.entity';
import { FifoBatchEntity } from '../inventory/entities/fifo-batch.entity';
import { BudgetControlService } from '../accounting/services/budget-control.service';
import { AccountingService } from '../accounting/services/accounting.service';
import { AccountingRepository } from '../accounting/repositories/accounting.repository';
import { CurrencyService } from '../currency/services/currency.service';
import { JournalEntryStatus } from '../accounting/enums/accounting.enum';

const HOST = process.env.ROXIRA_TEST_PG_HOST ?? (process.env.CI ? '127.0.0.1' : undefined);
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const ADMIN_DB = process.env.ROXIRA_TEST_PG_ADMIN_DB ?? (OWNER === 'mac' ? 'template1' : 'postgres');
const APP_PW = 'controls-app-test-pw';
const TENANT_ID = '33333333-3333-4333-8333-333333333333';

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

describePg('Controls & Policies on PostgreSQL (NOSUPERUSER NOBYPASSRLS, FORCE RLS)', () => {
  const db = `rx_ctrl_${process.pid}_${Date.now()}`;
  const role = `rx_ctrl_app_${process.pid}`;

  let admin: DataSource;
  let owner: DataSource;
  let app: DataSource;
  let scope: TenantScope;
  let policyService: PolicyService;
  let creditExposureService: CreditExposureService;
  let discountPolicyService: DiscountPolicyService;
  let salesService: SalesService;
  let partiesService: PartiesService;
  let inventoryRepo: InventoryRepository;
  let budgetControlService: BudgetControlService;
  let accountingService: AccountingService;

  let warehouseId: number;
  let testItemId: number;
  const testSku = 'CTRL-SKU-1';
  const customerCode = 'CUST-CTRL-1';
  const projectCode = 'PRJ-CTRL-1';

  beforeAll(async () => {
    admin = await new DataSource({ ...options(ADMIN_DB), entities: [], migrations: [] }).initialize();
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

    const audit = { record: async (): Promise<void> => undefined } as unknown as AuditService;
    policyService = new PolicyService(scope, audit);
    creditExposureService = new CreditExposureService(scope, policyService);
    discountPolicyService = new DiscountPolicyService(policyService);
    const partiesRepo = new PartiesRepository(scope);
    partiesService = new PartiesService(partiesRepo);
    const salesRepo = new SalesRepository(scope);
    salesService = new SalesService(salesRepo, partiesService, creditExposureService, discountPolicyService);

    inventoryRepo = new InventoryRepository(
      app.getRepository(WarehouseEntity),
      app.getRepository(StockItemEntity),
      app.getRepository(FifoBatchEntity),
      app,
      scope,
    );

    budgetControlService = new BudgetControlService(scope, policyService);
    const accountingRepo = new AccountingRepository(scope);
    const currency = { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService;
    accountingService = new AccountingService(accountingRepo, currency, undefined, budgetControlService);

    // Seed tenant
    await owner.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, 'Controls Tenant', 'ctrl-tenant') ON CONFLICT DO NOTHING`,
      [TENANT_ID],
    );

    // Seed customer with credit limit: 10,000,000 Rial = 1,000,000,000 minor units
    await partiesService.create(TENANT_ID, {
      code: customerCode,
      name: 'مشتری آزمایشی کنترل‌ها',
      role: PartyRole.CUSTOMER,
      creditLimit: '10000000',
    });

    // Seed warehouse and stock item
    const [wh] = await owner.query<Array<{ id: number }>>(
      `INSERT INTO erp_warehouses (tenant_id, name, location_code, is_active) VALUES ($1, 'انبار کنترل', 'WH-CTRL', true) RETURNING id`,
      [TENANT_ID],
    );
    warehouseId = Number(wh.id);

    const [item] = await owner.query<Array<{ id: number }>>(
      `INSERT INTO erp_stock_items (tenant_id, sku, barcode, name, quantity, min_quantity)
       VALUES ($1, $2, $2, 'کالای کنترل', 5, 0) RETURNING id`,
      [TENANT_ID, testSku],
    );
    testItemId = Number(item.id);

    // Seed FIFO batch with 5 units at 100,000 Rial
    await owner.query(
      `INSERT INTO inventory_fifo_batches (tenant_id, sku, batch_number, quantity_remaining, unit_purchase_cost, warehouse_id)
       VALUES ($1, $2, 'BATCH-1', 5, 100000, $3)`,
      [TENANT_ID, testSku, warehouseId],
    );

    // Seed contracting project with budget: 50,000,000 Rial
    await owner.query(
      `INSERT INTO erp_projects (tenant_id, code, name, budget, status)
       VALUES ($1, $2, 'پروژه کنترل بودجه', '50000000.00', 'active')`,
      [TENANT_ID, projectCode],
    );

    // Seed project dimension so journal line can reference it
    await owner.query(
      `INSERT INTO fin_dimensions (tenant_id, kind, code, name, active)
       VALUES ($1, 'PROJECT', $2, 'پروژه کنترل', true)`,
      [TENANT_ID, projectCode],
    );
  }, 240_000);

  afterAll(async () => {
    await app?.destroy();
    await owner?.destroy();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${db}"`);
      await admin.query(`DROP ROLE IF EXISTS ${role}`);
      await admin.destroy();
    }
  });

  describe('1. Credit Exposure Enforcement', () => {
    it('calculates open invoices and uncleared cheques and enforces credit limit', async () => {
      // 1. Insert open sale invoice of 8,000,000 Rial for this customer
      await owner.query(
        `INSERT INTO invoices (
           tenant_id, "taxInvoiceNumber", "sellerInfo", "buyerInfo", items,
           "totalAmount", "finalPayable", direction, status
         ) VALUES (
           $1, 'INV-CTRL-01', '{"name":"seller"}'::jsonb,
           json_build_object('name', 'buyer', 'partyCode', $2::text)::jsonb,
           '[]'::jsonb, 8000000, 8000000, 'SALE', 'ISSUED'
         )`,
        [TENANT_ID, customerCode],
      );

      // 2. Insert uncleared received cheque of 1,500,000 Rial
      await owner.query(
        `INSERT INTO fin_cheques (
           tenant_id, direction, cheque_number, amount, issue_date, due_date, party_name, party_code, status
         ) VALUES (
           $1, 'received', 'CHQ-01', 1500000, CURRENT_DATE, CURRENT_DATE + 30, 'مشتری', $2, 'registered'
         )`,
        [TENANT_ID, customerCode],
      );

      // Total exposure is now: 8M + 1.5M = 9,500,000 Rial (950,000,000 minor)
      const exposure = await creditExposureService.computeExposure(TENANT_ID, customerCode);
      expect(exposure.openInvoices).toBe(800000000n);
      expect(exposure.unclearedCheques).toBe(150000000n);
      expect(exposure.totalExposure).toBe(950000000n);

      // Set policy: refuse
      await policyService.set(
        TENANT_ID,
        { userId: 'admin-1', roleKey: 'owner' },
        'sales.credit_exposure.mode',
        'refuse',
        'Testing refuse mode',
      );

      // Creating an order of 1,000,000 Rial brings exposure to 10.5M > limit 10M -> must refuse
      await expect(
        salesService.createOrder(
          TENANT_ID,
          {
            partyCode: customerCode,
            warehouseId,
            orderDate: '2026-11-08',
            lines: [{ itemId: testItemId, quantity: 1, unitPrice: 1000000 }],
          },
          'user-1',
          'sales_agent',
        ),
      ).rejects.toThrow(BadRequestException);

      // Set policy: warn
      await policyService.set(
        TENANT_ID,
        { userId: 'admin-1', roleKey: 'owner' },
        'sales.credit_exposure.mode',
        'warn',
        'Testing warn mode',
      );

      // Creating order now succeeds with warning
      const warnedOrder = await salesService.createOrder(
        TENANT_ID,
        {
          partyCode: customerCode,
          warehouseId,
          orderDate: '2026-11-08',
          lines: [{ itemId: testItemId, quantity: 1, unitPrice: 1000000 }],
        },
        'user-1',
        'sales_agent',
      );
      expect(warnedOrder).toBeDefined();
      expect(warnedOrder.warning).toBeDefined();
      expect(warnedOrder.warning).toContain('سقف اعتبار');
    });
  });

  describe('2. Discount Limits per Role', () => {
    it('enforces discount limits per agent, manager, and owner', async () => {
      // Set policy: refuse, max agent: 10%, max manager: 25%
      await policyService.set(
        TENANT_ID,
        { userId: 'admin-1', roleKey: 'owner' },
        'sales.discount.enforcement',
        'refuse',
        'Setting refuse mode for discount',
      );
      await policyService.set(
        TENANT_ID,
        { userId: 'admin-1', roleKey: 'owner' },
        'sales.discount.max_percent_agent',
        10,
        'Setting agent limit',
      );
      await policyService.set(
        TENANT_ID,
        { userId: 'admin-1', roleKey: 'owner' },
        'sales.discount.max_percent_manager',
        25,
        'Setting manager limit',
      );

      // 1. Agent attempting 15% discount (> 10%) is refused
      await expect(
        salesService.createQuotation(
          TENANT_ID,
          {
            partyCode: customerCode,
            quoteDate: '2026-11-08',
            lines: [{ itemId: testItemId, quantity: 1, unitPrice: 100000, discount: 15000 }], // 15%
          },
          'agent-1',
          'sales_agent',
        ),
      ).rejects.toThrow(BadRequestException);

      // 2. Agent with 8% discount (<= 10%) succeeds
      const agentQuote = await salesService.createQuotation(
        TENANT_ID,
        {
          partyCode: customerCode,
          quoteDate: '2026-11-08',
          lines: [{ itemId: testItemId, quantity: 1, unitPrice: 100000, discount: 8000 }], // 8%
        },
        'agent-1',
        'sales_agent',
      );
      expect(agentQuote).toBeDefined();

      // 3. Manager with 20% discount (<= 25%) succeeds
      const managerQuote = await salesService.createQuotation(
        TENANT_ID,
        {
          partyCode: customerCode,
          quoteDate: '2026-11-08',
          lines: [{ itemId: testItemId, quantity: 1, unitPrice: 100000, discount: 20000 }], // 20%
        },
        'manager-1',
        'sales_manager',
      );
      expect(managerQuote).toBeDefined();

      // 4. Manager with 30% discount (> 25%) is refused
      await expect(
        salesService.createQuotation(
          TENANT_ID,
          {
            partyCode: customerCode,
            quoteDate: '2026-11-08',
            lines: [{ itemId: testItemId, quantity: 1, unitPrice: 100000, discount: 30000 }], // 30%
          },
          'manager-1',
          'sales_manager',
        ),
      ).rejects.toThrow(BadRequestException);

      // 5. Owner with 50% discount succeeds
      const ownerQuote = await salesService.createQuotation(
        TENANT_ID,
        {
          partyCode: customerCode,
          quoteDate: '2026-11-08',
          lines: [{ itemId: testItemId, quantity: 1, unitPrice: 100000, discount: 50000 }], // 50%
        },
        'owner-1',
        'owner',
      );
      expect(ownerQuote).toBeDefined();

      // 6. Explicit manager role (20% <= 25%) succeeds
      const managerExplicitQuote = await salesService.createQuotation(
        TENANT_ID,
        {
          partyCode: customerCode,
          quoteDate: '2026-11-08',
          lines: [{ itemId: testItemId, quantity: 1, unitPrice: 100000, discount: 20000 }], // 20% <= 25%
        },
        'manager-explicit',
        'manager',
      );
      expect(managerExplicitQuote).toBeDefined();

      // 7. Non-sales role (accountant / hr_manager) fails closed (refused)
      await expect(
        salesService.createQuotation(
          TENANT_ID,
          {
            partyCode: customerCode,
            quoteDate: '2026-11-08',
            lines: [{ itemId: testItemId, quantity: 1, unitPrice: 100000, discount: 5000 }],
          },
          'accountant-1',
          'accountant',
        ),
      ).rejects.toThrow(BadRequestException);

      const salesQuote = await salesService.createQuotation(
        TENANT_ID,
        {
          partyCode: customerCode,
          quoteDate: '2026-11-08',
          lines: [{ itemId: testItemId, quantity: 1, unitPrice: 100000, discount: 5000 }], // 5% <= 10%
        },
        'sales-1',
        'sales',
      );
      expect(salesQuote).toBeDefined();
    });
  });

  describe('3. Negative Stock Policy', () => {
    it('enforces refuse and warn policies when inventory is depleted', async () => {
      // Current stock is 5 units.
      // Set policy: refuse (default)
      await policyService.set(
        TENANT_ID,
        { userId: 'admin-1', roleKey: 'owner' },
        'inventory.negative_stock.mode',
        'refuse',
        'Testing negative stock refuse',
      );

      // Requesting 8 units when 5 available throws InsufficientStockError
      await expect(
        inventoryRepo.persistOutbound(TENANT_ID, {
          sku: testSku,
          quantity: 8,
          warehouseId,
        }),
      ).rejects.toThrow(InsufficientStockError);

      // Set policy: warn
      await policyService.set(
        TENANT_ID,
        { userId: 'admin-1', roleKey: 'owner' },
        'inventory.negative_stock.mode',
        'warn',
        'Testing negative stock warn',
      );

      // Requesting 8 units now succeeds, stock quantity becomes -3, and returns warning
      const result = await inventoryRepo.persistOutbound(TENANT_ID, {
        sku: testSku,
        quantity: 8,
        warehouseId,
      });

      expect(result).toBeDefined();
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain('کسری موجودی');
      expect(Number(result.item.quantity)).toBe(-3);
      const negativeLayer = result.layers.find((l) => l.batchNumber === 'NEGATIVE-STOCK');
      expect(negativeLayer).toBeDefined();
      expect(negativeLayer?.quantity).toBe(3);
      expect(negativeLayer?.unitPurchaseCost).toBe(100000);
    });
  });

  describe('4. Budget Warning', () => {
    it('checks expense against project budget and warns or refuses', async () => {
      // Project budget is 50,000,000 Rial.
      // Set policy: refuse
      await policyService.set(
        TENANT_ID,
        { userId: 'admin-1', roleKey: 'owner' },
        'accounting.budget_warning.mode',
        'refuse',
        'Testing budget refuse',
      );

      // Post 45,000,000 Rial expense on PRJ-CTRL-1
      await accountingService.createJournalEntry(TENANT_ID, {
        date: '2026-11-08',
        description: 'هزینه پروژه ۱',
        status: JournalEntryStatus.POSTED,
        lines: [
          { accountCode: '5010', debit: '45000000', projectCode },
          { accountCode: '1010', credit: '45000000' },
        ],
      });

      // Next expense of 10,000,000 Rial brings total to 55M > 50M -> throws BadRequestException
      await expect(
        accountingService.createJournalEntry(TENANT_ID, {
          date: '2026-11-08',
          description: 'هزینه اضافی پروژه',
          status: JournalEntryStatus.POSTED,
          lines: [
            { accountCode: '5010', debit: '10000000', projectCode },
            { accountCode: '1010', credit: '10000000' },
          ],
        }),
      ).rejects.toThrow(BadRequestException);

      // Set policy: warn (default)
      await policyService.set(
        TENANT_ID,
        { userId: 'admin-1', roleKey: 'owner' },
        'accounting.budget_warning.mode',
        'warn',
        'Testing budget warn',
      );

      // Next expense of 10,000,000 Rial now succeeds and returns warning
      const voucherRes = await accountingService.createJournalEntry(TENANT_ID, {
        date: '2026-11-08',
        description: 'هزینه اضافی با هشدار',
        status: JournalEntryStatus.POSTED,
        lines: [
          { accountCode: '5010', debit: '10000000', projectCode },
          { accountCode: '1010', credit: '10000000' },
        ],
      });

      expect(voucherRes).toBeDefined();
      expect(voucherRes.warning).toBeDefined();
      expect(voucherRes.warning).toContain('سقف بودجه');
    });
  });
});
