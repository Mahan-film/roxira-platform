/**
 * T196 (R16 Test 12): Real PostgreSQL verification of Accountant-Firm Access under `roxira_app`
 * (`NOSUPERUSER NOBYPASSRLS`, FORCE RLS).
 *
 * Proves WITHOUT mocks on AccessService, SessionCheckRepository, RefreshTokenRepository, or
 * MembershipsRepository that:
 * 1. A firm user assigned `partner_advisor` across 3 client organisations resolves active access
 *    and active sessions (`auth_refresh_tokens`) on all 3 tenants.
 * 2. Partner advisor journal posting is refused (403) outside an open adjustment period, and
 *    succeeds with server-stamped `tag = 'PARTNER_ADJUSTMENT'` and `firm_user_id` when open.
 * 3. Revoking the firm user ends all sessions across all 3 tenants within 60 s:
 *    - `AccessService.isSessionActive` returns `false` immediately on both the primed instance
 *      and a cold replica instance;
 *    - `AccessService.resolve` returns `null` across all 3 tenants;
 *    - `audit_log` contains `security.firm_user_revoked` entries for all 3 tenants.
 *
 * Opt-in like all *.pg.spec.ts: skipped unless ROXIRA_TEST_PG_HOST is set.
 */
import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { createTestDatabase, describePg, TestDatabaseContext } from '../../test/support/test-pg';
import { RefreshTokenEntity } from '../auth/entities/refresh-token.entity';
import { RefreshTokenRepository } from '../auth/repositories/refresh-token.repository';
import { CurrencyService } from '../currency/services/currency.service';
import { TenantEntity } from '../tenants/entities/tenant.entity';
import { TenantsRepository } from '../tenants/repositories/tenants.repository';
import { R16_T12_ACCOUNTANT } from '../accounting/acceptance/r16-fixtures';
import { AccountingRepository } from '../accounting/repositories/accounting.repository';
import { FiscalYearRepository } from '../accounting/repositories/fiscal-year.repository';
import { AccountingService } from '../accounting/services/accounting.service';
import { PARTNER_ADVISOR_ROLE, SystemRole } from './catalogue';
import { EntitlementEntity } from './entities/entitlement.entity';
import { MembershipEntity } from './entities/membership.entity';
import { AuditRepository } from './repositories/audit.repository';
import { EntitlementsRepository } from './repositories/entitlements.repository';
import { MembershipsRepository } from './repositories/memberships.repository';
import { RolesRepository } from './repositories/roles.repository';
import { SessionCheckRepository } from './repositories/session-check.repository';
import { AccessService } from './services/access.service';
import { AccountantFirmService } from './services/accountant-firm.service';
import { AuditService } from './services/audit.service';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const T3 = '33333333-3333-4333-8333-333333333333';
const TENANTS = [T1, T2, T3];

const ADMIN_USER_ID = 'aaaa0001-0000-4000-8000-000000000001';
const FIRM_USER_ID = 'bbbb0002-0000-4000-8000-000000000002';
const SESSION_FAMILY_ID = 'cccc0003-0000-4000-8000-000000000003';

const configStub = {
  get: <T>(_k: string, def?: T) => def,
} as unknown as ConfigService;

const currencyStub = {
  convert: (v: number) => v,
  round: (v: number) => v,
} as unknown as CurrencyService;

describePg('T196 Accountant-firm access on PostgreSQL (roxira_app FORCE RLS, real revocation)', () => {
  let testDb: TestDatabaseContext;
  let membershipsRepo: MembershipsRepository;
  let refreshRepo: RefreshTokenRepository;
  let auditRepo: AuditRepository;
  let accessService: AccessService;
  let replicaAccessService: AccessService;
  let firmService: AccountantFirmService;
  let accounting: AccountingService;
  let fiscalYears: FiscalYearRepository;

  beforeAll(async () => {
    testDb = await createTestDatabase('acct_firm');

    // Seed 3 active client tenants and 2 users (admin + external firm advisor) via owner connection
    for (let i = 0; i < TENANTS.length; i++) {
      await testDb.owner.query(
        `INSERT INTO "tenants" ("id", "name", "slug", "is_active") VALUES ($1, $2, $3, true) ON CONFLICT DO NOTHING`,
        [TENANTS[i], `Client Org ${i + 1}`, `client-org-${i + 1}`],
      );
    }
    await testDb.owner.query(
      `INSERT INTO "users" ("id", "phone", "displayName", "is_active")
       VALUES ($1, '09120000001', 'Firm Admin', true),
              ($2, '09120000002', 'External Advisor', true)
       ON CONFLICT DO NOTHING`,
      [ADMIN_USER_ID, FIRM_USER_ID],
    );

    // Build real repositories backed by `testDb.app` (roxira_app: NOSUPERUSER NOBYPASSRLS)
    membershipsRepo = new MembershipsRepository(testDb.app.getRepository(MembershipEntity));
    const rolesRepo = new RolesRepository(testDb.scope);
    const entitlementsRepo = new EntitlementsRepository(testDb.app.getRepository(EntitlementEntity));
    const tenantsRepo = new TenantsRepository(testDb.app.getRepository(TenantEntity));
    const sessionCheckRepo = new SessionCheckRepository(testDb.app.getRepository(RefreshTokenEntity));
    refreshRepo = new RefreshTokenRepository(testDb.app.getRepository(RefreshTokenEntity));
    auditRepo = new AuditRepository(testDb.scope, testDb.app);
    const auditService = new AuditService(auditRepo);

    accessService = new AccessService(
      membershipsRepo,
      rolesRepo,
      entitlementsRepo,
      tenantsRepo,
      sessionCheckRepo,
      configStub,
    );
    replicaAccessService = new AccessService(
      membershipsRepo,
      rolesRepo,
      entitlementsRepo,
      tenantsRepo,
      sessionCheckRepo,
      configStub,
    );
    firmService = new AccountantFirmService(
      membershipsRepo,
      accessService,
      auditService,
      refreshRepo,
    );

    const accRepo = new AccountingRepository(testDb.scope);
    accounting = new AccountingService(accRepo, currencyStub);
    fiscalYears = new FiscalYearRepository(testDb.app);

    // Admin is OWNER on all 3 client organisations
    for (const tenantId of TENANTS) {
      await membershipsRepo.create({
        tenantId,
        userId: ADMIN_USER_ID,
        roleKey: SystemRole.OWNER,
        customRoleId: null,
        branchId: null,
        departmentId: null,
        branchScoped: false,
        status: 'ACTIVE',
        invitedBy: ADMIN_USER_ID,
      });
    }

    // Create open fiscal year in T1 (adjustment_period_open = false initially)
    await testDb.scope.run(T1, async (m) => {
      await fiscalYears.save(
        T1,
        {
          name: '1405',
          startDate: '2026-03-21',
          endDate: '2027-03-20',
          adjustmentPeriodOpen: false,
        },
        m,
      );
    });
  }, 120000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('assigns partner_advisor across 3 tenants, enforces adjustment-period tagging, and revokes all real sessions within 60 s', async () => {
    // 1. Assign partner_advisor across all 3 tenants using verified AccessContext
    for (const tenantId of TENANTS) {
      const adminCtx = await accessService.resolve(ADMIN_USER_ID, tenantId);
      expect(adminCtx).not.toBeNull();
      const membership = await firmService.assignAdvisor(adminCtx!, FIRM_USER_ID);
      expect(membership.roleKey).toBe(PARTNER_ADVISOR_ROLE);
      expect(membership.status).toBe('ACTIVE');
    }

    // 2. Create a real active refresh-token session for the firm user
    await refreshRepo.create({
      userId: FIRM_USER_ID,
      tenantId: T1,
      familyId: SESSION_FAMILY_ID,
      tokenHash: createHash('sha256').update('real-refresh-token-value').digest('hex'),
      expiresAt: new Date(Date.now() + 3600_000),
      revokedAt: null,
    });

    // Prime real caches on primary AccessService
    expect(await accessService.isSessionActive(SESSION_FAMILY_ID, FIRM_USER_ID)).toBe(true);
    for (const tenantId of TENANTS) {
      const ctx = await accessService.resolve(FIRM_USER_ID, tenantId);
      expect(ctx?.roleKey).toBe(PARTNER_ADVISOR_ROLE);
    }

    // 3. Partner advisor cannot post outside an open adjustment period
    await expect(
      accounting.createJournalEntry(
        T1,
        {
          entryNumber: 'PA-BLOCKED-1',
          date: '2026-05-01T12:00:00.000Z',
          description: 'Regular period attempt',
          lines: [
            { accountCode: '5020', debit: '1000.00', credit: '0.00' },
            { accountCode: '1010', debit: '0.00', credit: '1000.00' },
          ],
        },
        undefined,
        { actorRole: PARTNER_ADVISOR_ROLE, actorUserId: FIRM_USER_ID },
      ),
    ).rejects.toThrow(ForbiddenException);

    // Open server-side adjustment period on T1 fiscal year -> posting succeeds with PARTNER_ADJUSTMENT
    await testDb.scope.run(T1, async (m) => {
      await m.query(
        `UPDATE "fin_fiscal_years" SET "adjustment_period_open" = true WHERE "tenant_id" = $1`,
        [T1],
      );
    });

    const entry = await accounting.createJournalEntry(
      T1,
      {
        entryNumber: 'PA-ADJ-1',
        date: '2026-05-01T12:00:00.000Z',
        description: 'Partner advisor adjustment entry',
        lines: [
          { accountCode: '5020', debit: '1000.00', credit: '0.00' },
          { accountCode: '1010', debit: '0.00', credit: '1000.00' },
        ],
      },
      undefined,
      { actorRole: PARTNER_ADVISOR_ROLE, actorUserId: FIRM_USER_ID },
    );
    expect(entry.tag).toBe(R16_T12_ACCOUNTANT.tag);
    expect(entry.firmUserId).toBe(FIRM_USER_ID);

    // 4. Revoke firm user across all 3 tenants and prove REAL session & access termination < 60 s
    const start = Date.now();
    const res = await firmService.revokeFirmUser(ADMIN_USER_ID, FIRM_USER_ID, TENANTS, 'Firm engagement ended');
    const elapsedMs = Date.now() - start;

    expect(elapsedMs).toBeLessThan(R16_T12_ACCOUNTANT.revokeWithinSeconds * 1000);
    expect(res.revokedTenantIds.sort()).toEqual(TENANTS.slice().sort());

    // Both primed instance and cold replica immediately observe terminated session and revoked memberships
    expect(await accessService.isSessionActive(SESSION_FAMILY_ID, FIRM_USER_ID)).toBe(false);
    expect(await replicaAccessService.isSessionActive(SESSION_FAMILY_ID, FIRM_USER_ID)).toBe(false);
    for (const tenantId of TENANTS) {
      expect(await accessService.resolve(FIRM_USER_ID, tenantId)).toBeNull();
      expect(await replicaAccessService.resolve(FIRM_USER_ID, tenantId)).toBeNull();
      const logs = await auditRepo.list(tenantId, { action: 'security.firm_user_revoked', limit: 10 });
      expect(logs.length).toBeGreaterThanOrEqual(1);
    }
  });
});
