/**
 * Real PostgreSQL FORCE RLS test for Pre-Tenant Tables (#475 / T29).
 *
 * Verifies that:
 *   1. All 8 pre-tenant tables (`users`, `auth_refresh_tokens`, `tenant_memberships`,
 *      `tenant_invitations`, `tenant_module_entitlements`, `tenant_module_requests`,
 *      `contact_messages`, `enterprise_inquiries`) have `relrowsecurity = true` and
 *      `relforcerowsecurity = true`.
 *   2. The non-superuser `NOSUPERUSER NOBYPASSRLS` role can successfully execute
 *      pre-auth lookups (phone, username/email, token rotation, invite redemption, public forms)
 *      via SECURITY DEFINER lookup functions and permissive INSERT policies.
 *   3. Strict cross-tenant isolation is enforced (Tenant A cannot see Tenant B's rows,
 *      and unscoped connections without session settings read 0 rows even when tables are populated).
 *   4. Write paths (user signup, token issue/revocation, invitation acceptance, entitlement upsert)
 *      satisfy FORCE RLS WITH CHECK policies.
 *   5. Migration up() and down() are completely reversible.
 *
 * Opt-in like other pg specs: skipped unless ROXIRA_TEST_PG_HOST is set.
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import {
  EnableRlsPreTenantTables1789900002700,
  PRE_TENANT_RLS_TABLES,
} from '../../../migrations/1789900002700-EnableRlsPreTenantTables';
import { AuthRepository } from '../../auth/repositories/auth.repository';
import { RefreshTokenRepository } from '../../auth/repositories/refresh-token.repository';
import { SessionCheckRepository } from '../repositories/session-check.repository';
import { UserEntity } from '../../auth/entities/user.entity';
import { RefreshTokenEntity } from '../../auth/entities/refresh-token.entity';
import { MembershipEntity } from '../entities/membership.entity';
import { InvitationEntity } from '../entities/invitation.entity';
import { EntitlementEntity } from '../entities/entitlement.entity';
import { ModuleRequestEntity } from '../entities/module-request.entity';
import { InvitationsRepository } from '../repositories/invitations.repository';
import { MembershipsRepository } from '../repositories/memberships.repository';
import { EntitlementsRepository } from '../repositories/entitlements.repository';
import { ModuleRequestsRepository } from '../repositories/module-requests.repository';
import { ContactMessageEntity } from '../../crm/entities/contact-message.entity';
import { CrmLeadEntity } from '../../crm/entities/crm-lead.entity';
import { CrmRepository } from '../../crm/repositories/crm.repository';
import { EnterpriseInquiryEntity } from '../../inquiries/entities/enterprise-inquiry.entity';
import { InquiriesRepository } from '../../inquiries/repositories/inquiries.repository';
import { TenantScope } from '../services/tenant-scope';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const APP_PW = process.env.ROXIRA_TEST_APP_PASSWORD ?? `pre_tenant_app_pw_${process.pid}`;
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

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

describePg('Pre-Tenant Tables FORCE RLS on PostgreSQL (NOSUPERUSER NOBYPASSRLS) (#475 / T29)', () => {
  const db = `rx_pre_tenant_rls_${process.pid}_${Date.now()}`;
  const role = `rx_pre_tenant_app_${process.pid}`;
  let admin: DataSource;
  let owner: DataSource;
  let app: DataSource;
  let scope: TenantScope;

  let authRepo: AuthRepository;
  let refreshRepo: RefreshTokenRepository;
  let invitationsRepo: InvitationsRepository;
  let membershipsRepo: MembershipsRepository;
  let entitlementsRepo: EntitlementsRepository;
  let moduleRequestsRepo: ModuleRequestsRepository;
  let crmRepo: CrmRepository;
  let inquiriesRepo: InquiriesRepository;
  let sessionCheckRepo: SessionCheckRepository;

  beforeAll(async () => {
    admin = await new DataSource({ ...options('postgres'), entities: [], migrations: [] }).initialize();
    await admin.query(`CREATE DATABASE "${db}"`);
    await admin.query(`DROP ROLE IF EXISTS "${role}"`);
    await admin.query(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${APP_PW}'`);
    owner = await new DataSource(options(db)).initialize();
    await owner.runMigrations();

    await owner.query(`GRANT CONNECT ON DATABASE "${db}" TO "${role}"`);
    await owner.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    await owner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${role}"`);
    await owner.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${role}"`);
    await owner.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO "${role}"`);

    app = await new DataSource({ ...options(db, role, APP_PW), extra: { max: 8 } }).initialize();
    scope = new TenantScope(app);

    authRepo = new AuthRepository(app.getRepository(UserEntity));
    refreshRepo = new RefreshTokenRepository(app.getRepository(RefreshTokenEntity));
    invitationsRepo = new InvitationsRepository(app.getRepository(InvitationEntity));
    membershipsRepo = new MembershipsRepository(app.getRepository(MembershipEntity));
    entitlementsRepo = new EntitlementsRepository(app.getRepository(EntitlementEntity));
    moduleRequestsRepo = new ModuleRequestsRepository(app.getRepository(ModuleRequestEntity));
    crmRepo = new CrmRepository(app.getRepository(CrmLeadEntity), app.getRepository(ContactMessageEntity));
    inquiriesRepo = new InquiriesRepository(app.getRepository(EnterpriseInquiryEntity));
    sessionCheckRepo = new SessionCheckRepository(app.getRepository(RefreshTokenEntity));

    for (const tenantId of [T1, T2]) {
      await owner
        .query(`INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $2) ON CONFLICT DO NOTHING`, [
          tenantId,
          tenantId.slice(0, 8),
        ])
        .catch(() => undefined);
    }
  });

  afterAll(async () => {
    await app?.destroy().catch(() => undefined);
    await owner?.destroy().catch(() => undefined);
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${db}"`).catch(() => undefined);
      await admin.query(`DROP ROLE IF EXISTS "${role}"`).catch(() => undefined);
      await admin.destroy().catch(() => undefined);
    }
  });

  it('all 8 pre-tenant tables have relrowsecurity = true and relforcerowsecurity = true', async () => {
    const rows = await owner.query(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = ANY($1::text[])
    `, [PRE_TENANT_RLS_TABLES]);

    expect(rows).toHaveLength(8);
    for (const row of rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
    }
  });

  it('allows unauthenticated pre-tenant user lookups via SECURITY DEFINER functions', async () => {
    const user1Id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    await owner.query(`
      INSERT INTO users (id, phone, username, login_email, tenant_id, managed_by_tenant_id)
      VALUES ($1, '09121111111', 'user_one', 'user1@example.com', $2, $2)
      ON CONFLICT DO NOTHING
    `, [user1Id, T1]);

    // Executed as unauthenticated NOSUPERUSER role (no app.tenant_id set)
    const byPhone = await authRepo.findByPhone('09121111111');
    expect(byPhone).not.toBeNull();
    expect(byPhone?.id).toBe(user1Id);
    expect(byPhone?.managedByTenantId).toBe(T1);

    const byUsername = await authRepo.findByUsername('user_one');
    expect(byUsername).not.toBeNull();
    expect(byUsername?.id).toBe(user1Id);
    expect(byUsername?.managedByTenantId).toBe(T1);

    const byEmail = await authRepo.findByLoginEmail('user1@example.com');
    expect(byEmail).not.toBeNull();
    expect(byEmail?.id).toBe(user1Id);
    expect(byEmail?.managedByTenantId).toBe(T1);

    // Strict column separation: username lookup does not match email and vice versa
    const notUsername = await authRepo.findByUsername('user1@example.com');
    expect(notUsername).toBeNull();
    const notEmail = await authRepo.findByLoginEmail('user_one');
    expect(notEmail).toBeNull();

    const byId = await authRepo.findById(user1Id);
    expect(byId).not.toBeNull();
    expect(byId?.phone).toBe('09121111111');
    expect(byId?.managedByTenantId).toBe(T1);
  });

  it('allows user creation, updates, and password reset under FORCE RLS', async () => {
    // 1. Password signup: user inserted with no tenant_id
    const newUser = await authRepo.create({
      username: 'signup_user',
      displayName: 'Sign Up User',
      loginEmail: 'signup@example.com',
    });
    expect(newUser.id).toBeDefined();

    // 2. Update password
    await authRepo.updatePassword(newUser.id, 'hashed_password_123');

    // 3. Look up user with password hash
    const userWithPw = await authRepo.findWithPasswordHash({ id: newUser.id });
    expect(userWithPw?.passwordHash).toBe('hashed_password_123');
  });

  it('allows token rotation lookup, issue, and revocation under FORCE RLS', async () => {
    const tokenHash = 'refresh_token_test_1'.padEnd(64, '0');
    const familyId = 'ffffffff-1111-4111-8111-ffffffffffff';
    const userId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    const expiresAt = new Date(Date.now() + 3600000);

    // 1. Issue token via refreshRepo.create
    const createdToken = await refreshRepo.create({
      userId,
      tenantId: T1,
      tokenHash,
      familyId,
      expiresAt,
    });
    expect(createdToken.id).toBeDefined();

    // 2. Opaque lookup without knowing tenant_id
    const token = await refreshRepo.findByHash(tokenHash);
    expect(token).not.toBeNull();
    expect(token?.familyId).toBe(familyId);
    expect(token?.tenantId).toBe(T1);

    // 2b. Liveness check via SessionCheckRepository under unauthenticated NOSUPERUSER role (guard check)
    const isFamilyActive = await sessionCheckRepo.isFamilyActive(familyId, userId);
    expect(isFamilyActive).toBe(true);

    const isWrongUserActive = await sessionCheckRepo.isFamilyActive(familyId, '00000000-0000-4000-8000-000000000000');
    expect(isWrongUserActive).toBe(false);

    const isWrongFamilyActive = await sessionCheckRepo.isFamilyActive('00000000-0000-4000-8000-000000000000', userId);
    expect(isWrongFamilyActive).toBe(false);

    // 3. Revoke single token atomically
    const revoked = await refreshRepo.revokeIfActive(createdToken.id);
    expect(revoked).toBe(true);

    // 4. Revoke whole family
    await refreshRepo.revokeFamily(familyId);

    // Verify session liveness reflects revocation
    const isRevokedActive = await sessionCheckRepo.isFamilyActive(familyId, userId);
    expect(isRevokedActive).toBe(false);

    // 5. Cross-tenant direct query isolation: Tenant 2 cannot see Tenant 1's tokens
    await scope.run(T2, async (manager) => {
      const t1Tokens = await manager.getRepository(RefreshTokenEntity).find({
        where: { tenantId: T1 },
      });
      expect(t1Tokens).toHaveLength(0);
    });

    // 6. Cross-user isolation: User 2 cannot see User 1's tokens
    await app.manager.transaction(async (m) => {
      await m.query(`SELECT set_config('app.user_id', $1, true)`, ['bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb']);
      const tokens = await m.getRepository(RefreshTokenEntity).find({ where: { userId } });
      expect(tokens).toHaveLength(0);
    });
  });

  it('allows user membership resolution across tenants for login switcher', async () => {
    const userId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    await owner.query(`
      INSERT INTO tenant_memberships (id, tenant_id, user_id, role_key, status)
      VALUES (gen_random_uuid(), $1, $2, 'owner', 'ACTIVE')
      ON CONFLICT DO NOTHING
    `, [T1, userId]);

    await owner.query(`
      INSERT INTO tenant_memberships (id, tenant_id, user_id, role_key, status)
      VALUES (gen_random_uuid(), $1, $2, 'member', 'ACTIVE')
      ON CONFLICT DO NOTHING
    `, [T2, userId]);

    // Unauthenticated user switcher list
    const memberships = await membershipsRepo.listForUser(userId);
    expect(memberships.length).toBeGreaterThanOrEqual(2);
    const tenantIds = memberships.map((m) => m.tenantId);
    expect(tenantIds).toContain(T1);
    expect(tenantIds).toContain(T2);

    // Cross-tenant isolation inside TenantScope
    await scope.run(T1, async (manager) => {
      const inScope = await manager.getRepository(MembershipEntity).find();
      expect(inScope.length).toBeGreaterThanOrEqual(1);
      for (const m of inScope) {
        expect(m.tenantId).toBe(T1);
      }
    });
  });

  it('allows invitation preview, acceptance, and tenant isolation', async () => {
    const inviteHash = 'invite_token_test_1'.padEnd(64, '0');
    const inviterId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    const expiresAt = new Date(Date.now() + 86400000);

    const inv = await invitationsRepo.create({
      tenantId: T1,
      email: 'invited@example.com',
      roleKey: 'accountant',
      tokenHash: inviteHash,
      expiresAt,
      invitedBy: inviterId,
    });
    expect(inv.id).toBeDefined();

    // Preview invite by token hash without session
    const invite = await invitationsRepo.findByHash(inviteHash);
    expect(invite).not.toBeNull();
    expect(invite?.email).toBe('invited@example.com');
    expect(invite?.tenantId).toBe(T1);

    // Accept invite
    const accepted = await invitationsRepo.markAccepted(inv.id, inviterId, T1);
    expect(accepted).toBe(true);

    // Cross-tenant list isolation
    await scope.run(T2, async (manager) => {
      const list = await manager.getRepository(InvitationEntity).find();
      expect(list.find((i) => i.tenantId === T1)).toBeUndefined();
    });
  });

  it('allows module entitlements and requests under FORCE RLS', async () => {
    const userId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

    // 1. Entitlements upsert and list
    await entitlementsRepo.set(T1, 'accounting', true, null);
    const entitlements = await entitlementsRepo.list(T1);
    expect(entitlements.some((e) => e.module === 'accounting' && e.enabled)).toBe(true);

    // 2. Module requests create and list
    const req = await moduleRequestsRepo.create({
      tenantId: T1,
      module: 'custom_reports',
      status: 'OPEN',
      requestedBy: userId,
    });
    expect(req.id).toBeDefined();

    const t1Requests = await moduleRequestsRepo.listForTenant(T1);
    expect(t1Requests.some((r) => r.id === req.id)).toBe(true);

    // Open requests operator view
    const openRequests = await moduleRequestsRepo.listOpen();
    expect(openRequests.some((r) => r.id === req.id)).toBe(true);
  });

  it('allows public anonymous submissions for contact_messages and enterprise_inquiries', async () => {
    // 1. Submit contact message via CrmRepository
    const savedMsg = await crmRepo.createContactMessage(T1, {
      senderName: 'Visitor One',
      senderPhone: '09129999999',
      subject: 'Inquiry about platform',
      message: 'Hello from public web form',
    });
    expect(savedMsg.id).toBeDefined();

    // 2. Anonymous visitor submits enterprise inquiry (null tenant) via InquiriesRepository
    const savedInquiry = await inquiriesRepo.create({
      tenantId: null,
      name: 'Corporate Prospect',
      phone: '02188888888',
      email: 'corp@example.com',
      message: 'Enterprise pricing details please',
    });
    expect(savedInquiry.id).toBeDefined();

    // Verify findAndCount works under non-superuser roxira_app role via definer function
    const [inquiriesList, inqCount] = await inquiriesRepo.findAndCount({ skip: 0, take: 10 });
    expect(inqCount).toBeGreaterThanOrEqual(1);
    expect(inquiriesList.some((i) => i.name === 'Corporate Prospect')).toBe(true);

    // Verify CRM contact history and counts under non-superuser roxira_app role
    const lead = await crmRepo.createLead(T1, {
      fullName: 'Lead One',
    });
    const leadMsg = await crmRepo.createContactMessage(T1, {
      leadId: lead.id,
      senderName: 'Lead Contact',
      senderPhone: '09121111111',
      subject: 'Lead Subject',
      message: 'Hello lead',
    });
    const [messages, count] = await crmRepo.findContactMessagesAndCount(T1, lead.id, { skip: 0, take: 10 });
    expect(count).toBe(1);
    expect(messages[0].id).toBe(leadMsg.id);

    const contactCount = await crmRepo.countContactsByLeadId(T1, lead.id);
    expect(contactCount).toBe(1);

    const countsMap = await crmRepo.getContactCountsByLeadIds(T1, [lead.id]);
    expect(countsMap.get(lead.id)).toBe(1);

    // Cross-tenant count under T2 returns 0
    const t2Count = await crmRepo.countContactsByLeadId(T2, lead.id);
    expect(t2Count).toBe(0);

    // 3. Submitting an inquiry claiming another tenant without session context is denied
    await expect(
      inquiriesRepo.create({
        tenantId: T1,
        name: 'Spoofed Prospect',
      }),
    ).rejects.toThrow();

    // 4. Tenant 2 cannot see Tenant 1 contact messages
    await scope.run(T2, async (manager) => {
      const tenant2Msgs = await manager.getRepository(ContactMessageEntity).find({
        where: { tenantId: T1 },
      });
      expect(tenant2Msgs).toHaveLength(0);
    });
  });

  it('unscoped connection without session settings reads 0 rows from pre-tenant tables when rows exist', async () => {
    // Non-vacuous check: rows exist in the tables from previous test steps, but unscoped connection reads 0
    const msgs = await app.getRepository(ContactMessageEntity).find();
    expect(msgs).toHaveLength(0);

    const inquiries = await app.getRepository(EnterpriseInquiryEntity).find();
    expect(inquiries).toHaveLength(0);

    const users = await app.getRepository(UserEntity).find();
    expect(users).toHaveLength(0);

    const tokens = await app.getRepository(RefreshTokenEntity).find();
    expect(tokens).toHaveLength(0);

    const memberships = await app.getRepository(MembershipEntity).find();
    expect(memberships).toHaveLength(0);

    const invitations = await app.getRepository(InvitationEntity).find();
    expect(invitations).toHaveLength(0);

    const entitlements = await app.getRepository(EntitlementEntity).find();
    expect(entitlements).toHaveLength(0);

    const requests = await app.getRepository(ModuleRequestEntity).find();
    expect(requests).toHaveLength(0);
  });

  it('denies EXECUTE to an unprivileged role without grants', async () => {
    const unprivilegedRole = `rx_unprivileged_${process.pid}`;
    const unprivilegedPw = process.env.ROXIRA_TEST_APP_PASSWORD ?? `unprivileged_pw_${process.pid}`;
    await owner.query(`DROP ROLE IF EXISTS "${unprivilegedRole}"`);
    await owner.query(`CREATE ROLE "${unprivilegedRole}" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${unprivilegedPw}'`);
    await owner.query(`GRANT CONNECT ON DATABASE "${db}" TO "${unprivilegedRole}"`);

    const unprivilegedDs = await new DataSource({ ...options(db, unprivilegedRole, unprivilegedPw) }).initialize();
    try {
      await expect(
        unprivilegedDs.query(`SELECT * FROM public.lookup_user_by_phone('09121111111')`),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await unprivilegedDs.destroy().catch(() => undefined);
      await owner.query(`DROP ROLE IF EXISTS "${unprivilegedRole}"`).catch(() => undefined);
    }
  });

  it('enforces definer context guards when caller session settings are bound', async () => {
    const userA = '00000000-0000-4000-8000-0000000000a1';
    const userB = '00000000-0000-4000-8000-0000000000b1';

    // When app.user_id is set to userA, looking up userB by id or password raises an exception
    await app.query(`SELECT set_config('app.user_id', $1, false)`, [userA]);
    try {
      await expect(
        app.query(`SELECT * FROM public.lookup_user_by_id($1::uuid)`, [userB]),
      ).rejects.toThrow(/caller user context does not match target user/);

      await expect(
        app.query(`SELECT * FROM public.lookup_user_by_id_with_password($1::uuid)`, [userB]),
      ).rejects.toThrow(/caller user context does not match target user/);

      await expect(
        app.query(`SELECT * FROM public.lookup_user_memberships($1::uuid)`, [userB]),
      ).rejects.toThrow(/caller user context does not match target user/);
    } finally {
      await app.query(`SELECT set_config('app.user_id', '', false)`);
    }

    // When app.tenant_id is set to T1, looking up T2 entitlements raises an exception
    await app.query(`SELECT set_config('app.tenant_id', $1, false)`, [T1]);
    try {
      await expect(
        app.query(`SELECT * FROM public.lookup_tenant_entitlements($1::uuid)`, [T2]),
      ).rejects.toThrow(/caller tenant context does not match target tenant/);
    } finally {
      await app.query(`SELECT set_config('app.tenant_id', '', false)`);
    }
  });

  it('reversibility: migration down() and up() work cleanly', async () => {
    const migration = new EnableRlsPreTenantTables1789900002700();
    const qr = owner.createQueryRunner();

    try {
      // Revert
      await migration.down(qr);
      const rowsDown = await qr.query(`
        SELECT relname, relrowsecurity, relforcerowsecurity
        FROM pg_class
        WHERE relname = ANY($1::text[])
      `, [PRE_TENANT_RLS_TABLES]);
      for (const row of rowsDown) {
        expect(row.relrowsecurity).toBe(false);
        expect(row.relforcerowsecurity).toBe(false);
      }

      // Re-apply
      await migration.up(qr);
      const rowsUp = await qr.query(`
        SELECT relname, relrowsecurity, relforcerowsecurity
        FROM pg_class
        WHERE relname = ANY($1::text[])
      `, [PRE_TENANT_RLS_TABLES]);
      for (const row of rowsUp) {
        expect(row.relrowsecurity).toBe(true);
        expect(row.relforcerowsecurity).toBe(true);
      }
    } finally {
      await qr.release();
    }
  });
});
