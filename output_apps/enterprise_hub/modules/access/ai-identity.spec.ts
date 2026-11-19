import { ForbiddenException } from '@nestjs/common';
import {
  AI_ASSISTANT_ROLE,
  AccessContext,
  assertNotAiIdentity,
  isAiActor,
  isAiIdentityContext,
} from './access-context';
import { AccessAction, AccessModule, permissionOf } from './catalogue';
import { evaluateAccess } from './policy-evaluator';

function makeAiContext(overrides: Partial<AccessContext> = {}): AccessContext {
  return {
    userId: 'user-ai-1',
    tenantId: 'tenant-1',
    membershipId: 'mem-1',
    roleKey: AI_ASSISTANT_ROLE,
    permissions: new Set([
      permissionOf(AccessModule.ASSISTANT, AccessAction.READ),
      permissionOf(AccessModule.ASSISTANT, AccessAction.CREATE),
      permissionOf(AccessModule.ACCOUNTING, AccessAction.READ),
      permissionOf(AccessModule.ACCOUNTING, AccessAction.CREATE),
      // Even if a misconfigured custom role grants POST/APPROVE/ADMIN, AI identity must still be blocked:
      permissionOf(AccessModule.ACCOUNTING, AccessAction.POST),
      permissionOf(AccessModule.ACCOUNTING, AccessAction.APPROVE),
      permissionOf(AccessModule.ACCOUNTING, AccessAction.ADMIN),
      permissionOf(AccessModule.TAX, AccessAction.POST),
      permissionOf(AccessModule.TAX, AccessAction.APPROVE),
    ]),
    entitledModules: new Set([
      AccessModule.ASSISTANT,
      AccessModule.ACCOUNTING,
      AccessModule.TAX,
      AccessModule.INVOICING,
    ]),
    branchId: null,
    branchScoped: false,
    require2fa: false,
    isAiIdentity: true,
    ...overrides,
  };
}

describe('T191 AI identity restrictions', () => {
  it('detects AI identities from flag, roleKey, or actor prefix', () => {
    expect(isAiIdentityContext({ isAiIdentity: true, roleKey: 'accountant', userId: 'u1' })).toBe(true);
    expect(isAiIdentityContext({ isAiIdentity: false, roleKey: AI_ASSISTANT_ROLE, userId: 'u1' })).toBe(true);
    expect(isAiActor('ai:assistant')).toBe(true);
    expect(isAiActor('ai-assistant')).toBe(true);
    expect(isAiActor('human-user-1')).toBe(false);
  });

  it('denies POST, APPROVE, and ADMIN on accounting/tax even if role permissions include them', () => {
    const ctx = makeAiContext();

    const postAccounting = evaluateAccess(ctx, {
      module: AccessModule.ACCOUNTING,
      action: AccessAction.POST,
    });
    expect(postAccounting).toMatchObject({ allowed: false, code: 'AI_IDENTITY_FORBIDDEN' });

    const lockOrAdmin = evaluateAccess(ctx, {
      module: AccessModule.ACCOUNTING,
      action: AccessAction.ADMIN,
    });
    expect(lockOrAdmin).toMatchObject({ allowed: false, code: 'AI_IDENTITY_FORBIDDEN' });

    const closeYear = evaluateAccess(ctx, {
      module: AccessModule.ACCOUNTING,
      action: AccessAction.APPROVE,
    });
    expect(closeYear).toMatchObject({ allowed: false, code: 'AI_IDENTITY_FORBIDDEN' });

    const fileReturn = evaluateAccess(ctx, {
      module: AccessModule.TAX,
      action: AccessAction.POST,
    });
    expect(fileReturn).toMatchObject({ allowed: false, code: 'AI_IDENTITY_FORBIDDEN' });
  });

  it('allows READ and CREATE drafts for AI identities', () => {
    const ctx = makeAiContext();
    expect(
      evaluateAccess(ctx, { module: AccessModule.ASSISTANT, action: AccessAction.CREATE }),
    ).toEqual({ allowed: true });
    expect(
      evaluateAccess(ctx, { module: AccessModule.ACCOUNTING, action: AccessAction.CREATE }),
    ).toEqual({ allowed: true });
  });

  it('assertNotAiIdentity throws ForbiddenException for AI actors and passes for humans', () => {
    expect(() => assertNotAiIdentity('ai:assistant', 'lock an accounting period')).toThrow(
      ForbiddenException,
    );
    expect(() => assertNotAiIdentity({ isAiIdentity: true }, 'file a tax return')).toThrow(
      ForbiddenException,
    );
    expect(() => assertNotAiIdentity('human-user-1', 'post a journal entry')).not.toThrow();
  });
});
