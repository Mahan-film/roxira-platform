import { AccessContext } from '../../modules/access/access-context';
import { SELLABLE_MODULES, systemRolePermissions } from '../../modules/access/catalogue';
import { AccessService } from '../../modules/access/services/access.service';
import { AuditService } from '../../modules/access/services/audit.service';

/**
 * Test double for the database-backed AccessService: membership is whatever the
 * test registered with `grant()`. Lets controller specs run through the real
 * AccessGuard without a database.
 */
export class AccessStub {
  private readonly members = new Map<string, Partial<AccessContext> & { roleKey: string; perms?: string[] }>();
  dead = new Set<string>();

  grant(userId: string, tenantId: string, roleKey: string, extra: Partial<AccessContext> & { perms?: string[]; entitled?: string[] } = {}): void {
    this.members.set(`${userId}:${tenantId}`, { roleKey, ...extra });
  }

  revoke(userId: string, tenantId: string): void {
    this.members.delete(`${userId}:${tenantId}`);
  }

  clear(): void {
    this.members.clear();
    this.dead.clear();
  }

  resolve = async (userId: string, tenantId: string): Promise<AccessContext | null> => {
    const m = this.members.get(`${userId}:${tenantId}`) as
      | (Partial<AccessContext> & { roleKey: string; perms?: string[]; entitled?: string[] })
      | undefined;
    if (!m) return null;
    return {
      userId,
      tenantId,
      membershipId: `m-${userId}-${tenantId}`,
      roleKey: m.roleKey,
      permissions: new Set(m.perms ?? systemRolePermissions(m.roleKey)),
      entitledModules: new Set(m.entitled ?? SELLABLE_MODULES),
      branchId: m.branchId ?? null,
      branchScoped: m.branchScoped ?? false,
      require2fa: m.require2fa ?? false,
    };
  };

  isSessionActive = async (sid: string): Promise<boolean> => !this.dead.has(sid);
  invalidateUser = jest.fn();
  invalidateTenant = jest.fn();
}

/** Providers every spec that uses GLOBAL_GUARD_PROVIDERS needs (guard + audit interceptor dependencies). */
export function accessTestProviders(stub: AccessStub = new AccessStub()) {
  return {
    stub,
    providers: [
      { provide: AccessService, useValue: stub },
      { provide: AuditService, useValue: { record: jest.fn(async () => undefined) } },
    ],
  };
}

/**
 * Build a request the way AccessGuard leaves it: `user` plus a verified `access`
 * context. `roleKey` defaults to the system role implied by the old claims
 * (OWNER or platform ADMIN -> owner, MEMBER -> legacy_member).
 */
export function requestWithAccess(user: Record<string, unknown>, roleKey?: string): never {
  const role =
    roleKey ??
    (user.tenantRole === 'MEMBER' ? 'legacy_member' : 'owner');
  return {
    user,
    access: {
      userId: String(user.sub ?? 'u1'),
      tenantId: (user.tenantId as string) ?? 't',
      membershipId: 'm1',
      roleKey: role,
      permissions: new Set(systemRolePermissions(role)),
      entitledModules: new Set(SELLABLE_MODULES),
      branchId: null,
      branchScoped: false,
      require2fa: false,
    },
  } as never;
}
