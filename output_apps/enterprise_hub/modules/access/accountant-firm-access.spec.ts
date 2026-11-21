import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  AccessAction,
  AccessModule,
  PARTNER_ADVISOR_ROLE,
  SYSTEM_ROLES,
  SystemRole,
  isSystemRole,
  systemRolePermissions,
} from './catalogue';
import { evaluateAccess } from './policy-evaluator';
import { AccessContext } from './access-context';
import { denied } from './access-errors';
import { AccountantFirmService } from './services/accountant-firm.service';
import { R16_T12_ACCOUNTANT } from '../accounting/acceptance/r16-fixtures';
import { AccountingController } from '../accounting/controllers/accounting.controller';
import { AccountingRepository } from '../accounting/repositories/accounting.repository';
import { AccountingService } from '../accounting/services/accounting.service';
import { VoucherToolsService } from '../accounting/services/voucher-tools.service';

describe('T196 Accountant-firm access (R16 Test 12)', () => {
  const adminUserId = 'd0000001-0000-4000-8000-000000000001';
  const firmUserId = 'a1111111-1111-4111-8111-111111111111';
  const tenantIds = [
    '10000001-0000-4000-8000-000000000001',
    '20000002-0000-4000-8000-000000000002',
    '30000003-0000-4000-8000-000000000003',
  ];

  const buildContext = (
    tenantId: string,
    roleKey: SystemRole = SystemRole.PARTNER_ADVISOR,
    userId = firmUserId,
  ): AccessContext => ({
    userId,
    tenantId,
    membershipId: `m-${tenantId}`,
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
      AccessModule.MEMBERS,
      AccessModule.SECURITY,
      AccessModule.AUDIT,
    ]),
    branchId: null,
    branchScoped: false,
    require2fa: false,
    scope: { type: 'org', ids: [] },
    amountLimits: {},
    fieldVisibility: { cost: true, margin: true, salary: false },
  });

  describe('Scoped Role Permissions & SYSTEM_ROLES Integration', () => {
    it('is included in SYSTEM_ROLES with type predicate preserved on isSystemRole', () => {
      expect(SYSTEM_ROLES.some((r) => r.key === SystemRole.PARTNER_ADVISOR)).toBe(true);
      const roleStr: string = PARTNER_ADVISOR_ROLE;
      expect(isSystemRole(roleStr)).toBe(true);
      expect(isSystemRole('not_a_real_role')).toBe(false);

      const perms = systemRolePermissions(SystemRole.PARTNER_ADVISOR);
      expect(perms).toContain('accounting:read');
      expect(perms).toContain('accounting:create');
      expect(perms).toContain('accounting:post');
      expect(perms).toContain('accounting:export');
      expect(perms).toContain('invoicing:read');
      expect(perms).toContain('assistant:read');
      expect(perms).toContain('tax:read');

      // Read-only banking & cheques — NO bank edits, NO payments
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
  });

  describe('Server-only Journal Attribution & Adjustment Period Gate', () => {
    const buildAccounting = (adjustmentPeriodOpen: boolean) => {
      let capturedHeader: any = null;
      const repo = {
        countAccounts: async () => 2,
        findEntryByIdempotencyKey: async () => null,
        findEntryByNumber: async () => null,
        isDateInAdjustmentPeriod: jest.fn(async () => adjustmentPeriodOpen),
        findAccountsByCodes: async () => [
          { id: 1, code: '1010', level: 'MOEIN' },
          { id: 2, code: '5020', level: 'MOEIN' },
        ],
        persistJournalEntry: async (_tenantId: string, header: any) => {
          capturedHeader = header;
          return {
            id: 101,
            entryNumber: header.entryNumber,
            entryType: header.entryType,
            date: header.date,
            description: header.description,
            status: header.status,
            version: 1,
            tag: header.tag,
            firmUserId: header.firmUserId,
            lines: [
              { id: 1, accountId: 1, accountCode: '1010', debit: '1000.00', credit: '0.00', currency: 'IRR' },
              { id: 2, accountId: 2, accountCode: '5020', debit: '0.00', credit: '1000.00', currency: 'IRR' },
            ],
          } as any;
        },
      } as unknown as AccountingRepository;

      const service = new AccountingService(repo, { convert: (v: number) => v, round: (v: number) => v } as any);
      return { service, getCaptured: () => capturedHeader };
    };

    it('rejects partner_advisor journal posting outside an open adjustment period (403)', async () => {
      const { service } = buildAccounting(false);
      await expect(
        service.createJournalEntry(
          tenantIds[0],
          {
            description: 'Attempt outside adjustment period',
            lines: [
              { accountCode: '5020', debit: 1000, credit: 0 },
              { accountCode: '1010', debit: 0, credit: 1000 },
            ],
          },
          undefined,
          { actorRole: PARTNER_ADVISOR_ROLE, actorUserId: firmUserId },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('stamps PARTNER_ADJUSTMENT and firmUserId server-side regardless of any forged payload fields', async () => {
      const { service, getCaptured } = buildAccounting(true);
      const forgedDto = {
        description: 'Year-end accrual',
        tag: 'FORGED_TAG',
        firmUserId: '99999999-9999-4999-8999-999999999999',
        lines: [
          { accountCode: '5020', debit: 1000, credit: 0 },
          { accountCode: '1010', debit: 0, credit: 1000 },
        ],
      } as any;

      const res = await service.createJournalEntry(
        tenantIds[0],
        forgedDto,
        undefined,
        { actorRole: PARTNER_ADVISOR_ROLE, actorUserId: firmUserId },
      );

      expect(getCaptured().tag).toBe('PARTNER_ADJUSTMENT');
      expect(getCaptured().firmUserId).toBe(firmUserId);
      expect(res.tag).toBe('PARTNER_ADJUSTMENT');
      expect(res.firmUserId).toBe(firmUserId);
    });

    it('AccountingController reads actorRole strictly from verified request.access.roleKey', async () => {
      const createMock = jest.fn().mockResolvedValue({ id: 1 });
      const controller = new AccountingController(
        { createJournalEntry: createMock } as unknown as AccountingService,
        {} as unknown as VoucherToolsService,
      );

      await controller.createJournalEntry(
        {
          headers: {},
          user: { sub: firmUserId, tenantId: tenantIds[0], tenantRole: 'MEMBER', role: 'ADMIN' },
          access: buildContext(tenantIds[0], SystemRole.PARTNER_ADVISOR, firmUserId),
        } as never,
        { description: 'adj', lines: [] } as never,
      );
      expect(createMock).toHaveBeenCalledWith(
        tenantIds[0],
        expect.any(Object),
        undefined,
        { actorRole: SystemRole.PARTNER_ADVISOR, actorUserId: firmUserId },
      );
    });
  });

  describe('AccountantFirmService Authority, Safety & Revocation', () => {
    let service: AccountantFirmService;
    let mockMemberships: any;
    let mockAccess: any;
    let mockAudit: any;
    let mockRefreshTokens: any;

    const storedMemberships = new Map<string, any>();
    const auditLogs: any[] = [];
    const activeSessions = new Set<string>();
    const adminAuthorizedTenants = new Set<string>(tenantIds);

    beforeEach(() => {
      storedMemberships.clear();
      auditLogs.length = 0;
      activeSessions.clear();
      adminAuthorizedTenants.clear();
      for (const t of tenantIds) adminAuthorizedTenants.add(t);

      mockMemberships = {
        findByTenantUser: jest.fn(async (tenantId: string, userId: string) => {
          return storedMemberships.get(`${tenantId}:${userId}`) ?? null;
        }),
        listForUser: jest.fn(async (userId: string) => {
          if (userId === adminUserId) {
            return Array.from(adminAuthorizedTenants).map((tenantId) => ({
              membershipId: `adm-${tenantId}`,
              tenantId,
              tenantName: `Org ${tenantId}`,
              roleKey: SystemRole.ADMIN,
              status: 'ACTIVE',
            }));
          }
          return [];
        }),
        save: jest.fn(async (entity: any) => {
          storedMemberships.set(`${entity.tenantId}:${entity.userId}`, { ...entity });
          return entity;
        }),
        create: jest.fn(async (entity: any) => {
          const item = { id: `m-${entity.tenantId}-${entity.userId}`, ...entity };
          storedMemberships.set(`${entity.tenantId}:${entity.userId}`, item);
          return item;
        }),
      };

      mockAccess = {
        resolve: jest.fn(async (userId: string, tenantId: string) => {
          if (userId === adminUserId && adminAuthorizedTenants.has(tenantId)) {
            return buildContext(tenantId, SystemRole.ADMIN, adminUserId);
          }
          return null;
        }),
        // Async mock ensures missing `await` is caught
        invalidateUser: jest.fn(async (userId: string) => {
          for (const key of Array.from(activeSessions)) {
            if (key.startsWith(`${userId}:`)) activeSessions.delete(key);
          }
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

    it('refuses assignAdvisor without members:admin authority', async () => {
      const salesActor = buildContext(tenantIds[0], SystemRole.SALES, 'sales-1');
      await expect(service.assignAdvisor(salesActor, firmUserId)).rejects.toThrow(ForbiddenException);
    });

    it('never overwrites an existing owner/staff membership or reactivates a suspended member', async () => {
      const adminActor = buildContext(tenantIds[0], SystemRole.ADMIN, adminUserId);

      // Existing owner cannot be demoted
      storedMemberships.set(`${tenantIds[0]}:${firmUserId}`, {
        id: 'm-owner',
        tenantId: tenantIds[0],
        userId: firmUserId,
        roleKey: SystemRole.OWNER,
        status: 'ACTIVE',
      });
      await expect(service.assignAdvisor(adminActor, firmUserId)).rejects.toThrow(ConflictException);

      // Suspended advisor cannot be silently reactivated
      storedMemberships.set(`${tenantIds[0]}:${firmUserId}`, {
        id: 'm-susp',
        tenantId: tenantIds[0],
        userId: firmUserId,
        roleKey: SystemRole.PARTNER_ADVISOR,
        status: 'SUSPENDED',
      });
      await expect(service.assignAdvisor(adminActor, firmUserId)).rejects.toThrow(ConflictException);
    });

    it('refuses revokeFirmUser when actor lacks admin authority on any requested tenant (fail closed)', async () => {
      const foreignTenant = '99999999-0000-4000-8000-000000000009';
      await expect(
        service.revokeFirmUser(adminUserId, firmUserId, [tenantIds[0], foreignTenant]),
      ).rejects.toThrow(ForbiddenException);
      expect(mockRefreshTokens.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('revokes refresh tokens BEFORE the per-tenant loop so a partial DB failure still terminates sessions', async () => {
      for (const tenantId of tenantIds) {
        await service.assignAdvisor(buildContext(tenantId, SystemRole.ADMIN, adminUserId), firmUserId);
      }
      activeSessions.add(`${firmUserId}:sess-crash`);

      mockMemberships.save.mockRejectedValueOnce(new Error('transient DB write error'));

      await expect(
        service.revokeFirmUser(adminUserId, firmUserId, tenantIds),
      ).rejects.toThrow('transient DB write error');

      // Refresh tokens and cache were STILL revoked despite the mid-loop error!
      expect(mockRefreshTokens.revokeAllForUser).toHaveBeenCalledWith(firmUserId);
      expect(await service.isSessionActive('sess-crash', firmUserId)).toBe(false);
    });

    it('assigns and revokes partner advisor across 3 client organisations within 60 s with audit logs', async () => {
      for (const tenantId of tenantIds) {
        const m = await service.assignAdvisor(buildContext(tenantId, SystemRole.ADMIN, adminUserId), firmUserId);
        expect(m.roleKey).toBe(PARTNER_ADVISOR_ROLE);
        expect(m.status).toBe('ACTIVE');
      }

      const sid = 'sess-999';
      activeSessions.add(`${firmUserId}:${sid}`);
      expect(await service.isSessionActive(sid, firmUserId)).toBe(true);

      const startTime = Date.now();
      const result = await service.revokeFirmUser(adminUserId, firmUserId, tenantIds, 'Access revoked');
      expect(Date.now() - startTime).toBeLessThan(R16_T12_ACCOUNTANT.revokeWithinSeconds * 1000);
      expect(result.revokedTenantIds.sort()).toEqual(tenantIds.slice().sort());

      expect(await service.isSessionActive(sid, firmUserId)).toBe(false);
      for (const tenantId of tenantIds) {
        const m = await mockMemberships.findByTenantUser(tenantId, firmUserId);
        expect(m.status).toBe('SUSPENDED');
      }

      const securityLogs = auditLogs.filter((a) => a.action === 'security.firm_user_revoked');
      expect(securityLogs).toHaveLength(3);
    });
  });
});
