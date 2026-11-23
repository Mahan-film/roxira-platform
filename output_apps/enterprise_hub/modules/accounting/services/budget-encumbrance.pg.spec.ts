import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { AuditRepository } from '../../access/repositories/audit.repository';
import { AuditService } from '../../access/services/audit.service';
import { PolicyService } from '../../tenants/policy/policy.service';
import { BudgetControlService } from './budget-control.service';
import { R16_T6_BUDGET as T6 } from '../acceptance/r16-fixtures';
import { fromMinor } from '../money';

const HOST = process.env.ROXIRA_TEST_PG_HOST ?? (process.env.CI ? '127.0.0.1' : undefined);
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const ADMIN_DB = process.env.ROXIRA_TEST_PG_ADMIN_DB ?? (OWNER === 'mac' ? 'template1' : 'postgres');
const APP_PW = 'budget-enc-app-pw';
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

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

describePg('BudgetEncumbrance on PostgreSQL (NOSUPERUSER NOBYPASSRLS, FORCE RLS)', () => {
  const db = `rx_benc_${process.pid}_${Date.now()}`;
  const role = `rx_benc_app_${process.pid}`;
  let admin: DataSource;
  let appDs: DataSource;
  let service: BudgetControlService;

  beforeAll(async () => {
    admin = new DataSource(options(ADMIN_DB));
    await admin.initialize();
    await admin.query(`CREATE DATABASE "${db}"`);
    await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${APP_PW}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await admin.query(`GRANT CONNECT ON DATABASE "${db}" TO "${role}"`);
    await admin.destroy();

    const ownerDs = new DataSource(options(db));
    await ownerDs.initialize();
    await ownerDs.runMigrations();
    await ownerDs.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    await ownerDs.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${role}"`);
    await ownerDs.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${role}"`);

    // Seed tenant A & B fiscal years, cost centre, and October 5,000.00 budget
    for (const tid of [TENANT_A, TENANT_B]) {
      await ownerDs.query(
        `INSERT INTO "tenants" ("id", "name", "slug") VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [tid, `Tenant ${tid.slice(0, 4)}`, `t-${tid.slice(0, 8)}`],
      );
      const fyRows = (await ownerDs.query(
        `INSERT INTO "fin_fiscal_years" ("tenant_id", "name", "start_date", "end_date", "status")
         VALUES ($1, 'FY2026', '2026-01-01', '2026-12-31', 'OPEN') RETURNING "id"`,
        [tid],
      )) as Array<{ id: number }>;
      const dimRows = (await ownerDs.query(
        `INSERT INTO "fin_dimensions" ("tenant_id", "kind", "code", "name")
         VALUES ($1, 'COST_CENTER', $2, 'Marketing') RETURNING "id"`,
        [tid, T6.costCentre],
      )) as Array<{ id: number }>;
      await ownerDs.query(
        `INSERT INTO "fin_account_budgets" ("tenant_id", "fiscal_year_id", "cost_center_id", "account_code", "budget_amount")
         VALUES ($1, $2, $3, $4, $5)`,
        [tid, fyRows[0].id, dimRows[0].id, T6.account, fromMinor(T6.october).toString()],
      );

      // Prior fiscal year (FY2025) with a 1,000.00 budget cap to verify multi-fiscal-year scoping
      const fy2025 = (await ownerDs.query(
        `INSERT INTO "fin_fiscal_years" ("tenant_id", "name", "start_date", "end_date", "status")
         VALUES ($1, 'FY2025', '2025-01-01', '2025-12-31', 'CLOSED') RETURNING "id"`,
        [tid],
      )) as Array<{ id: number }>;
      await ownerDs.query(
        `INSERT INTO "fin_account_budgets" ("tenant_id", "fiscal_year_id", "cost_center_id", "account_code", "budget_amount")
         VALUES ($1, $2, $3, $4, '1000.00')`,
        [tid, fy2025[0].id, dimRows[0].id, T6.account],
      );
    }
    await ownerDs.destroy();

    appDs = new DataSource(options(db, role, APP_PW));
    await appDs.initialize();
    const scope = new TenantScope(appDs);
    const policy = new PolicyService(scope, new AuditService(new AuditRepository(scope, appDs)));
    service = new BudgetControlService(scope, policy);
  }, 60_000);

  afterAll(async () => {
    if (appDs?.isInitialized) await appDs.destroy();
    const cleanup = new DataSource(options(ADMIN_DB));
    await cleanup.initialize();
    await cleanup.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await cleanup.query(`DROP ROLE IF EXISTS "${role}"`);
    await cleanup.destroy();
  });

  it('warns at 84%, blocks at 104%, isolates tenants under RLS, and unblocks after revision', async () => {
    const po88 = await service.checkAndEncumberPo(TENANT_A, {
      accountCode: T6.account,
      costCenterCode: T6.costCentre,
      periodKey: '2026-10',
      sourceId: 'PO-88',
      amountMinor: T6.po88,
    });
    expect(po88.status).toBe('WARN');
    expect(po88.utilizationPercent).toBe(84);
    expect(po88.remainingMinor).toBe(T6.expected.po88Remaining);

    // Tenant B is unaffected by Tenant A's encumbrance under FORCE RLS
    const tenantBCheck = await service.checkAndEncumberPo(TENANT_B, {
      accountCode: T6.account,
      costCenterCode: T6.costCentre,
      periodKey: '2026-10',
      sourceId: 'PO-B1',
      amountMinor: T6.po89,
    });
    expect(tenantBCheck.status).toBe('OK');

    // PO-89 in Tenant A exceeds 100% -> blocked
    await expect(
      service.checkAndEncumberPo(TENANT_A, {
        accountCode: T6.account,
        costCenterCode: T6.costCentre,
        periodKey: '2026-10',
        sourceId: 'PO-89',
        amountMinor: T6.po89,
      }),
    ).rejects.toMatchObject({ status: 400 });

    // Revise Tenant A budget to 5,500.00 -> PO-89 passes leaving 300.00
    await new TenantScope(appDs).run(TENANT_A, async (m) => {
      await m.query(
        `UPDATE "fin_account_budgets" SET "budget_amount" = $1, "updated_at" = now() WHERE "tenant_id" = $2 AND "account_code" = $3`,
        [fromMinor(T6.revisedBudget).toString(), TENANT_A, T6.account],
      );
    });

    const po89Revised = await service.checkAndEncumberPo(TENANT_A, {
      accountCode: T6.account,
      costCenterCode: T6.costCentre,
      periodKey: '2026-10',
      sourceId: 'PO-89',
      amountMinor: T6.po89,
    });
    expect(po89Revised.allowed).toBe(true);
    expect(po89Revised.remainingMinor).toBe(T6.expected.remainingAfterRevision);

    // Multi-fiscal-year scoping check: period '2025-06' routes to FY2025 cap (1,000.00), blocking PO of 1,200.00
    await expect(
      service.checkAndEncumberPo(TENANT_A, {
        accountCode: T6.account,
        costCenterCode: T6.costCentre,
        periodKey: '2025-06',
        sourceId: 'PO-2025-1',
        amountMinor: 120_000n,
      }),
    ).rejects.toMatchObject({ status: 400 });

    // Release PO-88 encumbrance
    await service.releaseEncumbrance(TENANT_A, 'purchase_order', 'PO-88');

    // Multi-period cumulative encumbrance test within the same fiscal year:
    // Create PO-M3 in 2026-03 for 2,000.00 (200,000 minor)
    await service.checkAndEncumberPo(TENANT_A, {
      accountCode: T6.account,
      costCenterCode: T6.costCentre,
      periodKey: '2026-03',
      sourceId: 'PO-M3',
      amountMinor: 200_000n,
    });

    // In 2026-07, PO-M7 for 2,500.00 (250,000 minor) brings total commitments to 4,500.00 (81.8% of 5,500.00 budget) -> WARN
    const poM7 = await service.checkAndEncumberPo(TENANT_A, {
      accountCode: T6.account,
      costCenterCode: T6.costCentre,
      periodKey: '2026-07',
      sourceId: 'PO-M7',
      amountMinor: 250_000n,
    });
    expect(poM7.allowed).toBe(true);
    expect(poM7.status).toBe('WARN');

    // In 2026-10, PO-M10 for 1,500.00 would exceed the 5,500.00 budget (total 6,000.00 = 109%) -> BLOCKED
    await expect(
      service.checkAndEncumberPo(TENANT_A, {
        accountCode: T6.account,
        costCenterCode: T6.costCentre,
        periodKey: '2026-10',
        sourceId: 'PO-M10',
        amountMinor: 150_000n,
      }),
    ).rejects.toMatchObject({ status: 400 });

    // Releasing PO-M3 unblocks PO-M10
    await service.releaseEncumbrance(TENANT_A, 'purchase_order', 'PO-M3');
    const poM10AfterRelease = await service.checkAndEncumberPo(TENANT_A, {
      accountCode: T6.account,
      costCenterCode: T6.costCentre,
      periodKey: '2026-10',
      sourceId: 'PO-M10',
      amountMinor: 150_000n,
    });
    expect(poM10AfterRelease.allowed).toBe(true);
  });
});
