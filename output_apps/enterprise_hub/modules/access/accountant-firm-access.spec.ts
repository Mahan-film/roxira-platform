import { ForbiddenException } from '@nestjs/common';
import { AccessAction, AccessModule } from './catalogue';
import { PARTNER_ADVISOR_ROLE, PARTNER_ADVISOR_ROLE_DEF, systemRolePermissions, isSystemRole } from './catalogue';
import { evaluateAccess } from './policy-evaluator';
import { AccessContext } from './access-context';
import { denied } from './access-errors';
import { AccountantFirmService } from './services/accountant-firm.service';
import { R16_T12_ACCOUNTANT } from '../accounting/acceptance/r16-fixtures';

describe('T196 Accountant-firm access (R16 Test 12)', () => {
  const firmUserId = 'a1111111-1111-1111-1111-111111111111';
  const tenantIds = [
    't0000001-0000-0000-0000-000000000001',
    't0000002-0000-0000-0000-000000000002',
    't0000003-0000-0000-0000-000000000003',
  ];

  const buildContext = (tenantId: string, roleKey = PARTNER_ADVISOR_ROLE): AccessContext => ({
    userId: firmUserId,
    tenantId,
    membershipId: 'm-123',
    roleKey,
    customRoleId: null,
    permissions: new Set(systemRolePermissions(roleKey)),
    entitledModules: new Set([
      AccessModule.ACCOUNTING,
      AccessModule.INVOICING,
      AccessModule.TAX,
      AccessModule.BANKING,
      AccessModule.CHEQUES,
      AccessModule.ASSISTANT,
    ]),
    branchId: null,
    branchScoped: false,
    require2fa: false,
    scope: { type: 'org', ids: [] },
    amountLimits: {},
    fieldVisibility: { cost: true, margin: true, salary: false },
  });

  describe('Scoped Role Permissions', () => {
    it('is recognized as a system role with correct permissions', () => {
      expect(isSystemRole(PARTNER_ADVISOR_ROLE)).toBe(true);
      const perms = systemRolePermissions(PARTNER_ADVISOR_ROLE);

      // View GL & post adjustment journals
      expect(perms).toContain('accounting:read');
      expect(perms).toContain('accounting:create');
      expect(perms).toContain('accounting:post');
      expect(perms).toContain('accounting:export');

      // Request documents & view invoices
      expect(perms).toContain('invoicing:read');
      expect(perms).toContain('assistant:read');
      expect(perms).toContain('tax:read');

      // Read-only banking & cheques — NO payments, NO bank edits
      expect(perms).toContain('banking:read');
      expect(perms).toContain('cheques:read');
      expect(perms).not.toContain('banking:create');
      expect(perms).not.toContain('banking:post');
      expect(perms).not.toContain('banking:admin');
      expect(perms).not.toContain('cheques:create');
      expect(perms).not.toContain('cheques:post');
      expect(perms).not.toContain('cheques:admin');
    });

    it('IBAN and bank account edits return 403 Forbidden for partner_advisor', () => {
      const ctx = buildContext(tenantIds[0]);

      // Attempting to create / edit bank account or IBAN
      const createDecision = evaluateAccess(ctx, {
        module: AccessModule.BANKING,
        action: AccessAction.POST,
      });

      expect(createDecision.allowed).toBe(false);
      if (!createDecision.allowed) {
        expect(createDecision.code).toBe('FORBIDDEN_ACTION');
        const error = denied(createDecision.code, createDecision.message || 'Forbidden');
        expect(error).toBeInstanceOf(ForbiddenException);
        expect(error.getStatus()).toBe(R16_T12_ACCOUNTANT.ibanEditStatus); // 403
      }
    });

    it('allows viewing general ledger and requesting documents', () => {
      const ctx = buildContext(tenantIds[0]);

      expect(
        evaluateAccess(ctx, { module: AccessModule.ACCOUNTING, action: AccessAction.READ }).allowed,
      ).toBe(true);
      expect(
        evaluateAccess(ctx, { module: AccessModule.INVOICING, action: AccessAction.READ }).allowed,
      ).toBe(true);
      expect(
        evaluateAccess(ctx, { module: AccessModule.ASSISTANT, action: AccessAction.READ }).allowed,
      ).toBe(true);
    });
  });

  describe('AccountantFirmService Multi-Tenant Management & Revocation', () => {
    let service: AccountantFirmService;
    let mockMemberships: any;
    let mockAccess: any;
    let mockAudit: any;
    let mockRefreshTokens: any;

    const storedMemberships = new Map<string, any>();
    const auditLogs: any[] = [];
    const activeSessions = new Set<string>();

    beforeEach(() => {
      storedMemberships.clear();
      auditLogs.length = 0;
      activeSessions.clear();

      mockMemberships = {
        findByTenantUser: jest.fn(async (tenantId: string, userId: string) => {
          return storedMemberships.get(`${tenantId}:${userId}`) ?? null;
        }),
        save: jest.fn(async (entity: any) => {
          storedMemberships.set(`${entity.tenantId}:${entity.userId}`, { ...entity });
          return entity;
        }),
        create: jest.fn(async (entity: any) => {
          const item = { id: `m-${Math.random()}`, ...entity };
          storedMemberships.set(`${entity.tenantId}:${entity.userId}`, item);
          return item;
        }),
      };

      mockAccess = {
        invalidateUser: jest.fn((userId: string) => {
          activeSessions.clear();
        }),
        isSessionActive: jest.fn(async (sid: string, userId: string) => {
          return activeSessions.has(`${userId}:${sid}`);
        }),
      };

      mockAudit = {
        record: jest.fn(async (entry: any) => {
          auditLogs.push(entry);
        }),
      };

      mockRefreshTokens = {
        revokeAllForUser: jest.fn(async (userId: string) => {
          for (const key of Array.from(activeSessions)) {
            if (key.startsWith(`${userId}:`)) activeSessions.delete(key);
          }
        }),
      };

      service = new AccountantFirmService(
        mockMemberships,
        mockAccess,
        mockAudit,
        mockRefreshTokens,
      );
    });

    it('assigns partner advisor across multiple client organisations', async () => {
      expect(tenantIds.length).toBe(R16_T12_ACCOUNTANT.tenants); // 3 tenants

      for (const tenantId of tenantIds) {
        const m = await service.assignAdvisor(tenantId, firmUserId, { userId: 'admin-1' });
        expect(m.roleKey).toBe(PARTNER_ADVISOR_ROLE);
        expect(m.status).toBe('ACTIVE');
      }

      expect(mockAccess.invalidateUser).toHaveBeenCalledTimes(3);
      expect(auditLogs.length).toBe(3);
      expect(auditLogs.every((a) => a.action === 'member.assign_partner_advisor')).toBe(true);
    });

    it('revoking firm user ends all sessions across all 3 organisations within 60s with security audit entry', async () => {
      // Setup active memberships
      for (const tenantId of tenantIds) {
        await service.assignAdvisor(tenantId, firmUserId, { userId: 'admin-1' });
      }

      // Simulate active session
      const sid = 'sess-999';
      activeSessions.add(`${firmUserId}:${sid}`);
      expect(await service.isSessionActive(sid, firmUserId)).toBe(true);

      const startTime = Date.now();

      // Revoke firm user across all 3 tenants
      await service.revokeFirmUser('sec-admin', firmUserId, tenantIds, 'Access revoked by firm administrator');

      const elapsedMs = Date.now() - startTime;
      expect(elapsedMs).toBeLessThan(R16_T12_ACCOUNTANT.revokeWithinSeconds * 1000); // < 60s

      // All sessions are ended
      expect(await service.isSessionActive(sid, firmUserId)).toBe(false);
      expect(mockRefreshTokens.revokeAllForUser).toHaveBeenCalledWith(firmUserId);
      expect(mockAccess.invalidateUser).toHaveBeenCalledWith(firmUserId);

      // Memberships on all 3 tenants are SUSPENDED
      for (const tenantId of tenantIds) {
        const m = await mockMemberships.findByTenantUser(tenantId, firmUserId);
        expect(m.status).toBe('SUSPENDED');
      }

      // Security audit entry written for each tenant
      const securityLogs = auditLogs.filter((a) => a.action === 'security.firm_user_revoked');
      expect(securityLogs.length).toBe(3);
      expect(securityLogs.map((l) => l.tenantId).sort()).toEqual(tenantIds.slice().sort());
      expect(securityLogs[0].metadata.firmUserId).toBe(firmUserId);
      expect(securityLogs[0].metadata.role).toBe(PARTNER_ADVISOR_ROLE);
    });
  });
});
