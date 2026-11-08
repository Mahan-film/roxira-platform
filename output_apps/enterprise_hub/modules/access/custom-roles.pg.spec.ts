import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { AddCustomRoleScopesAndLimits1789900001200 } from '../../migrations/1789900001200-AddCustomRoleScopesAndLimits';
import { RefreshTokenEntity } from '../auth/entities/refresh-token.entity';
import { TenantEntity } from '../tenants/entities/tenant.entity';
import { TenantsRepository } from '../tenants/repositories/tenants.repository';
import { requireFieldVisibility, requireScopedAction } from './access-context';
import { AccessAction, AccessModule } from './catalogue';
import { EntitlementEntity } from './entities/entitlement.entity';
import { MembershipEntity } from './entities/membership.entity';
import { evaluateAccess } from './policy-evaluator';
import { AuditRepository } from './repositories/audit.repository';
import { EntitlementsRepository } from './repositories/entitlements.repository';
import { MembershipsRepository } from './repositories/memberships.repository';
import { RolesRepository } from './repositories/roles.repository';
import { SessionCheckRepository } from './repositories/session-check.repository';
import { AccessService } from './services/access.service';
import { AuditService } from './services/audit.service';
import { RolesService } from './services/roles.service';
import { TenantScope } from './services/tenant-scope';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const ROLE_NAME = `rx_custom_roles_${process.pid}`;
const ROLE_PW = 'custom-roles-rls-test';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const U_OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const U_ADMIN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const U_STAFF = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const WH_1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const WH_2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const BR_1 = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const BR_2 = '99999999-9999-4999-8999-999999999999';

const dsOptions = (database: string, username = OWNER, password = OWNER_PW) => ({
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

describePg('T1 (#584-3): Custom roles with scope, amount limits, and field visibility under FORCE RLS', () => {
  const db = `custom_roles_${process.pid}`;
  let adminDs: DataSource;
  let ownerDs: DataSource;
  let appDs: DataSource;
  let scope: TenantScope;
  let rolesRepo: RolesRepository;
  let membershipsRepo: MembershipsRepository;
  let accessService: AccessService;
  let rolesService: RolesService;

  beforeAll(async () => {
    adminDs = await new DataSource({ ...dsOptions('postgres'), entities: [], migrations: [] }).initialize();
    await adminDs.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await adminDs.query(`CREATE DATABASE "${db}"`);
    await adminDs.query(`DROP ROLE IF EXISTS "${ROLE_NAME}"`);
    await adminDs.query(`CREATE ROLE "${ROLE_NAME}" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${ROLE_PW}'`);

    ownerDs = await new DataSource(dsOptions(db)).initialize();
    await ownerDs.runMigrations();

    for (const [id, slug, name] of [
      [T1, 't1-roles', 'Tenant One'],
      [T2, 't2-roles', 'Tenant Two'],
    ]) {
      await ownerDs.query(
        `INSERT INTO "tenants" ("id", "slug", "name", "is_active", "require_2fa") VALUES ($1, $2, $3, true, false)`,
        [id, slug, name],
      );
    }
    for (const [id, email, phone] of [
      [U_OWNER, 'owner@t1.example', '09120000001'],
      [U_ADMIN, 'admin@t1.example', '09120000002'],
      [U_STAFF, 'staff@t1.example', '09120000003'],
    ]) {
      await ownerDs.query(
        `INSERT INTO "users" ("id", "email", "phone", "password_hash", "role", "tenant_id", "tenant_role")
         VALUES ($1, $2, $3, 'hash', 'USER', $4, 'MEMBER')`,
        [id, email, phone, T1],
      );
    }
    await ownerDs.query(
      `INSERT INTO "tenant_memberships" ("tenant_id", "user_id", "role_key", "status")
       VALUES ($1, $2, 'owner', 'ACTIVE'), ($1, $3, 'admin', 'ACTIVE'), ($1, $4, 'sales', 'ACTIVE')`,
      [T1, U_OWNER, U_ADMIN, U_STAFF],
    );

    await ownerDs.query(`GRANT CONNECT ON DATABASE "${db}" TO "${ROLE_NAME}"`);
    await ownerDs.query(`GRANT USAGE ON SCHEMA public TO "${ROLE_NAME}"`);
    await ownerDs.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${ROLE_NAME}"`);
    await ownerDs.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${ROLE_NAME}"`);

    appDs = await new DataSource(dsOptions(db, ROLE_NAME, ROLE_PW)).initialize();
    scope = new TenantScope(appDs);
    rolesRepo = new RolesRepository(scope);
    membershipsRepo = new MembershipsRepository(appDs.getRepository(MembershipEntity));
    const entitlementsRepo = new EntitlementsRepository(appDs.getRepository(EntitlementEntity));
    const tenantsRepo = new TenantsRepository(appDs.getRepository(TenantEntity));
    const sessionCheckRepo = new SessionCheckRepository(appDs.getRepository(RefreshTokenEntity));
    const auditRepo = new AuditRepository(scope, appDs);
    const auditService = new AuditService(auditRepo);
    const configService = { get: (_k: string, def?: string) => def ?? 'true' } as unknown as ConfigService;

    accessService = new AccessService(
      membershipsRepo,
      rolesRepo,
      entitlementsRepo,
      tenantsRepo,
      sessionCheckRepo,
      configService,
    );
    rolesService = new RolesService(rolesRepo, membershipsRepo, accessService, auditService);
  }, 240_000);

  afterAll(async () => {
    await appDs?.destroy();
    await ownerDs?.destroy();
    await adminDs?.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await adminDs?.query(`DROP ROLE IF EXISTS "${ROLE_NAME}"`);
    await adminDs?.destroy();
  });

  it('connects as NOSUPERUSER NOBYPASSRLS and verifies FORCE RLS on tenant_roles', async () => {
    const [roleRow] = await appDs.query(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    expect(roleRow).toEqual({ rolsuper: false, rolbypassrls: false });

    const [tblRow] = await appDs.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'tenant_roles'`,
    );
    expect(tblRow).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it('creates, updates, isolates across tenants, and resolves custom roles with scope, amount limits, and field visibility', async () => {
    const ownerCtx = (await accessService.resolve(U_OWNER, T1))!;
    expect(ownerCtx.fieldVisibility).toEqual({ cost: true, margin: true, salary: true });

    const created = await rolesService.create(
      ownerCtx,
      'سرپرست انبار و حقوق',
      ['inventory:read', 'inventory:post', 'invoicing:approve', 'hr:read'],
      undefined,
      {
        scopeType: 'warehouse',
        scopeIds: [WH_1],
        amountLimits: { 'invoicing:approve': '25000000.00' },
        fieldVisibility: { cost: true, margin: false, salary: true },
      },
    );

    expect(created.scopeType).toBe('warehouse');
    expect(created.scopeIds).toEqual([WH_1]);
    expect(created.amountLimits).toEqual({ 'invoicing:approve': '25000000.00' });
    expect(created.fieldVisibility).toEqual({ cost: true, margin: false, salary: true });

    // Tenant B cannot see or load Tenant A's custom role under FORCE RLS
    expect(await rolesRepo.list(T2)).toEqual([]);
    expect(await rolesRepo.find(T2, created.id)).toBeNull();

    // Assign staff member in Tenant A to this custom role
    const staffMembership = (await membershipsRepo.findByTenantUser(T1, U_STAFF))!;
    staffMembership.roleKey = 'custom';
    staffMembership.customRoleId = created.id;
    await membershipsRepo.save(staffMembership);
    accessService.invalidateTenant(T1);

    const staffCtx = (await accessService.resolve(U_STAFF, T1))!;
    expect(staffCtx.customRoleId).toBe(created.id);
    expect(staffCtx.scope).toEqual({ type: 'warehouse', ids: [WH_1] });
    expect(staffCtx.amountLimits).toEqual({ 'invoicing:approve': '25000000.00' });
    expect(staffCtx.fieldVisibility).toEqual({ cost: true, margin: false, salary: true });

    // Field visibility enforcement
    expect(() => requireFieldVisibility(staffCtx, 'cost')).not.toThrow();
    expect(() => requireFieldVisibility(staffCtx, 'salary')).not.toThrow();
    expect(() => requireFieldVisibility(staffCtx, 'margin')).toThrow(/margin/);

    // Scope & amount limit enforcement
    expect(() =>
      requireScopedAction(staffCtx, 'inventory:post', { warehouseId: WH_1 }),
    ).not.toThrow();
    expect(() =>
      requireScopedAction(staffCtx, 'inventory:post', { warehouseId: WH_2 }),
    ).toThrow(/warehouse scope/);
    expect(() =>
      requireScopedAction(staffCtx, 'invoicing:approve', { amount: '25000000.00' }),
    ).not.toThrow();
    expect(() =>
      requireScopedAction(staffCtx, 'invoicing:approve', { amount: '25000000.01' }),
    ).toThrow(/limit/);

    // Update role to branch scope and lower limit
    const updated = await rolesService.update(ownerCtx, created.id, {
      scopeType: 'branch',
      scopeIds: [BR_1],
      amountLimits: { 'invoicing:approve': 10_000_000 },
      fieldVisibility: { salary: false },
    });
    expect(updated.scopeType).toBe('branch');
    expect(updated.scopeIds).toEqual([BR_1]);
    expect(updated.amountLimits).toEqual({ 'invoicing:approve': '10000000.00' });
    expect(updated.fieldVisibility).toEqual({ cost: true, margin: false, salary: false });

    const reloadedCtx = (await accessService.resolve(U_STAFF, T1))!;
    expect(reloadedCtx.scope).toEqual({ type: 'branch', ids: [BR_1] });
    expect(reloadedCtx.fieldVisibility?.salary).toBe(false);
    expect(
      evaluateAccess(reloadedCtx, {
        module: AccessModule.HR,
        action: AccessAction.READ,
        field: 'salary',
      }),
    ).toMatchObject({ allowed: false, code: 'FORBIDDEN_FIELD' });
  });

  it('prevents privilege escalation on fieldVisibility, scope, and amountLimits', async () => {
    const adminCtx = (await accessService.resolve(U_ADMIN, T1))!;
    // Admin has salary: false by default, so admin cannot grant salary: true
    expect(adminCtx.fieldVisibility?.salary).toBe(false);
    await expect(
      rolesService.create(adminCtx, 'Escalated Salary Role', ['hr:read'], undefined, {
        fieldVisibility: { salary: true },
      }),
    ).rejects.toThrow(/sensitive field/);

    // Branch-scoped admin cannot create an org-wide role or include another branch
    const branchAdminCtx = {
      ...adminCtx,
      scope: { type: 'branch' as const, ids: [BR_1] },
      amountLimits: { 'invoicing:approve': '5000000.00' },
    };
    await expect(
      rolesService.create(branchAdminCtx, 'Org Wide Escape', ['invoicing:read'], undefined, {
        scopeType: 'org',
      }),
    ).rejects.toThrow(/wider scope/);

    await expect(
      rolesService.create(branchAdminCtx, 'Other Branch Escape', ['invoicing:read'], undefined, {
        scopeType: 'branch',
        scopeIds: [BR_2],
      }),
    ).rejects.toThrow(/outside your own scope/);

    await expect(
      rolesService.create(branchAdminCtx, 'Higher Limit Escape', ['invoicing:approve'], undefined, {
        scopeType: 'branch',
        scopeIds: [BR_1],
        amountLimits: { 'invoicing:approve': '6000000.00' },
      }),
    ).rejects.toThrow(/exceed your own amount limit/);
  });

  it('migration AddCustomRoleScopesAndLimits1789900001200 down() and up() are reversible', async () => {
    const migration = new AddCustomRoleScopesAndLimits1789900001200();
    const qr = ownerDs.createQueryRunner();
    try {
      await migration.down(qr);
      await migration.up(qr);
    } finally {
      await qr.release();
    }
    const cols = (await ownerDs.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'tenant_roles'
         AND column_name IN ('scope_type', 'scope_ids', 'amount_limits', 'field_visibility')
       ORDER BY column_name`,
    )) as Array<{ column_name: string }>;
    expect(cols.map((c) => c.column_name)).toEqual([
      'amount_limits',
      'field_visibility',
      'scope_ids',
      'scope_type',
    ]);
  });
});
