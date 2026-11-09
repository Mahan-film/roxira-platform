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
 *   3. Strict cross-tenant isolation is enforced (Tenant A cannot see Tenant B's rows).
 *   4. Migration up() and down() are completely reversible.
 *
 * Opt-in like other pg specs: skipped unless ROXIRA_TEST_PG_HOST is set.
 */
import 'reflect-metadata';
import * as path from 'path';
import { DataSource } from 'typeorm';
import {
  EnableRlsPreTenantTables1789900001600,
  PRE_TENANT_RLS_TABLES,
} from '../../../migrations/1789900001600-EnableRlsPreTenantTables';
import { AuthRepository } from '../../auth/repositories/auth.repository';
import { RefreshTokenRepository } from '../../auth/repositories/refresh-token.repository';
import { UserEntity } from '../../auth/entities/user.entity';
import { RefreshTokenEntity } from '../../auth/entities/refresh-token.entity';
import { MembershipEntity } from '../entities/membership.entity';
import { InvitationEntity } from '../entities/invitation.entity';
import { EntitlementEntity } from '../entities/entitlement.entity';
import { ModuleRequestEntity } from '../entities/module-request.entity';
import { InvitationsRepository } from '../repositories/invitations.repository';
import { MembershipsRepository } from '../repositories/memberships.repository';
import { ContactMessageEntity } from '../../crm/entities/contact-message.entity';
import { EnterpriseInquiryEntity } from '../../inquiries/entities/enterprise-inquiry.entity';
import { TenantScope } from '../services/tenant-scope';

const HOST = process.env.ROXIRA_TEST_PG_HOST;
const describePg = HOST ? describe : describe.skip;
const OWNER = process.env.ROXIRA_TEST_PG_USER ?? 'postgres';
const OWNER_PW = process.env.ROXIRA_TEST_PG_PASSWORD;
const PORT = Number(process.env.ROXIRA_TEST_PG_PORT ?? 5432);
const APP_PW = 'pre-tenant-rls-app-test-only';
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
    await owner.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${role}`);

    app = await new DataSource({ ...options(db, role, APP_PW), extra: { max: 8 } }).initialize();
    scope = new TenantScope(app);

    authRepo = new AuthRepository(app.getRepository(UserEntity));
    refreshRepo = new RefreshTokenRepository(app.getRepository(RefreshTokenEntity));
    invitationsRepo = new InvitationsRepository(app.getRepository(InvitationEntity));
    membershipsRepo = new MembershipsRepository(app.getRepository(MembershipEntity));

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
      await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(() => undefined);
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
      INSERT INTO users (id, phone, username, login_email, tenant_id)
      VALUES ($1, '09121111111', 'user_one', 'user1@example.com', $2)
      ON CONFLICT DO NOTHING
    `, [user1Id, T1]);

    // Executed as unauthenticated NOSUPERUSER role (no app.tenant_id set)
    const byPhone = await authRepo.findByPhone('09121111111');
    expect(byPhone).not.toBeNull();
    expect(byPhone?.id).toBe(user1Id);

    const byUsername = await authRepo.findByUsername('user_one');
    expect(byUsername).not.toBeNull();
    expect(byUsername?.id).toBe(user1Id);

    const byEmail = await authRepo.findByLoginEmail('user1@example.com');
    expect(byEmail).not.toBeNull();
    expect(byEmail?.id).toBe(user1Id);

    const byId = await authRepo.findById(user1Id);
    expect(byId).not.toBeNull();
    expect(byId?.phone).toBe('09121111111');
  });

  it('allows token rotation lookup and enforces refresh token isolation', async () => {
    const tokenHash = 'refresh_token_test_1'.padEnd(64, '0');
    const familyId = 'ffffffff-1111-4111-8111-ffffffffffff';
    const userId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    const expiresAt = new Date(Date.now() + 3600000);

    await owner.query(`
      INSERT INTO auth_refresh_tokens (id, user_id, tenant_id, token_hash, family_id, expires_at)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
    `, [userId, T1, tokenHash, familyId, expiresAt]);

    // Opaque lookup without knowing tenant_id
    const token = await refreshRepo.findByHash(tokenHash);
    expect(token).not.toBeNull();
    expect(token?.familyId).toBe(familyId);
    expect(token?.tenantId).toBe(T1);

    // Cross-tenant direct query isolation: Tenant 2 cannot see Tenant 1's tokens
    await scope.run(T2, async (manager) => {
      const t1Tokens = await manager.getRepository(RefreshTokenEntity).find({
        where: { tenantId: T1 },
      });
      expect(t1Tokens).toHaveLength(0);
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
      for (const m of inScope) {
        expect(m.tenantId).toBe(T1);
      }
    });
  });

  it('allows invitation preview by hash without tenant context and isolates in scope', async () => {
    const inviteHash = 'invite_token_test_1'.padEnd(64, '0');
    const inviterId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    const expiresAt = new Date(Date.now() + 86400000);

    await owner.query(`
      INSERT INTO tenant_invitations (id, tenant_id, email, role_key, token_hash, expires_at, invited_by)
      VALUES (gen_random_uuid(), $1, 'invited@example.com', 'accountant', $2, $3, $4)
    `, [T1, inviteHash, expiresAt, inviterId]);

    // Preview invite by token hash without session
    const invite = await invitationsRepo.findByHash(inviteHash);
    expect(invite).not.toBeNull();
    expect(invite?.email).toBe('invited@example.com');
    expect(invite?.tenantId).toBe(T1);

    // Cross-tenant list isolation
    await scope.run(T2, async (manager) => {
      const list = await manager.getRepository(InvitationEntity).find();
      expect(list.find((i) => i.tenantId === T1)).toBeUndefined();
    });
  });

  it('allows public anonymous submissions for contact_messages and enterprise_inquiries', async () => {
    // 1. Anonymous visitor submits contact message
    const contactMsg = app.getRepository(ContactMessageEntity).create({
      tenantId: T1,
      senderName: 'Visitor One',
      senderPhone: '09129999999',
      subject: 'Inquiry about platform',
      message: 'Hello from public web form',
    });
    const savedMsg = await app.getRepository(ContactMessageEntity).save(contactMsg);
    expect(savedMsg.id).toBeDefined();

    // 2. Anonymous visitor submits enterprise inquiry (null tenant)
    const inquiry = app.getRepository(EnterpriseInquiryEntity).create({
      tenantId: null,
      name: 'Corporate Prospect',
      phone: '02188888888',
      email: 'corp@example.com',
      message: 'Enterprise pricing details please',
    });
    const savedInquiry = await app.getRepository(EnterpriseInquiryEntity).save(inquiry);
    expect(savedInquiry.id).toBeDefined();

    // 3. Tenant 2 cannot see Tenant 1 contact messages
    await scope.run(T2, async (manager) => {
      const msgs = await manager.getRepository(ContactMessageEntity).find({
        where: { tenantId: T1 },
      });
      expect(msgs).toHaveLength(0);
    });
  });

  it('reversibility: migration down() and up() work cleanly', async () => {
    const migration = new EnableRlsPreTenantTables1789900001600();
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
