import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AmountLimitsMap,
  FieldVisibilityMap,
  RoleScope,
  SELLABLE_MODULES,
  SYSTEM_ROLES,
  resolveCustomRoleFieldVisibility,
  systemRoleFieldVisibility,
  systemRolePermissions,
} from '../catalogue';
import { AccessContext } from '../access-context';
import { EntitlementsRepository } from '../repositories/entitlements.repository';
import { MembershipsRepository } from '../repositories/memberships.repository';
import { RolesRepository } from '../repositories/roles.repository';
import { SessionCheckRepository } from '../repositories/session-check.repository';
import { TenantsRepository } from '../../tenants/repositories/tenants.repository';

const CACHE_TTL_MS = 15_000;

interface Cached<T> {
  value: T;
  expires: number;
}

/**
 * Resolves what a signed-in user may do in an organisation, straight from the
 * database. A short in-process cache keeps this cheap; revoking a session,
 * suspending a member or disabling a module therefore takes effect within
 * CACHE_TTL_MS everywhere, and immediately on the instance that made the change.
 */
@Injectable()
export class AccessService {
  private readonly contexts = new Map<string, Cached<AccessContext | null>>();
  private readonly sessions = new Map<string, Cached<boolean>>();

  constructor(
    private readonly memberships: MembershipsRepository,
    private readonly roles: RolesRepository,
    private readonly entitlements: EntitlementsRepository,
    private readonly tenants: TenantsRepository,
    private readonly sessionCheck: SessionCheckRepository,
    private readonly config: ConfigService,
  ) {}

  /** null when the user has no ACTIVE membership of an active tenant. */
  async resolve(userId: string, tenantId: string): Promise<AccessContext | null> {
    const key = `${userId}:${tenantId}`;
    const hit = this.contexts.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const value = await this.load(userId, tenantId);
    this.contexts.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
    return value;
  }

  private async load(userId: string, tenantId: string): Promise<AccessContext | null> {
    const membership = await this.memberships.findByTenantUser(tenantId, userId);
    if (!membership || membership.status !== 'ACTIVE') return null;
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant || !tenant.isActive) return null;

    let permissions: readonly string[];
    let scope: RoleScope;
    let amountLimits: AmountLimitsMap = {};
    let fieldVisibility: FieldVisibilityMap;

    if (membership.customRoleId) {
      const role = await this.roles.find(tenantId, membership.customRoleId);
      permissions = role?.permissions ?? [];
      const roleScopeType = role?.scopeType ?? 'org';
      const roleScopeIds = role?.scopeIds ?? [];
      if (roleScopeType !== 'org') {
        scope = { type: roleScopeType, ids: [...roleScopeIds] };
      } else if (membership.branchScoped && membership.branchId) {
        scope = { type: 'branch', ids: [membership.branchId] };
      } else {
        scope = { type: 'org', ids: [] };
      }
      amountLimits = { ...(role?.amountLimits ?? {}) };
      fieldVisibility = resolveCustomRoleFieldVisibility(role?.fieldVisibility);
    } else {
      permissions = systemRolePermissions(membership.roleKey);
      scope =
        membership.branchScoped && membership.branchId
          ? { type: 'branch', ids: [membership.branchId] }
          : { type: 'org', ids: [] };
      fieldVisibility = systemRoleFieldVisibility(membership.roleKey);
    }
    // Trial switch (ALL_MODULES_ENABLED, default true): every module is open to every tenant. Off = use stored entitlements.
    const open = (this.config.get<string>('ALL_MODULES_ENABLED', 'true') ?? 'true').toLowerCase() !== 'false';
    const entitled: string[] = open
      ? [...SELLABLE_MODULES]
      : (await this.entitlements.list(tenantId)).filter((e) => e.enabled).map((e) => e.module);
    return {
      userId,
      tenantId,
      membershipId: membership.id,
      roleKey: membership.roleKey,
      customRoleId: membership.customRoleId,
      permissions: new Set(permissions),
      entitledModules: new Set(entitled),
      branchId: membership.branchId,
      branchScoped: membership.branchScoped,
      require2fa: tenant.require2fa,
      scope,
      amountLimits,
      fieldVisibility,
    };
  }

  /**
   * Counts other ACTIVE members of the tenant whose effective permissions include `permission`.
   * Used by the supplier-invoice reviewer rule: `differs_unless_sole_approver` only lets the creator
   * accept when no other eligible approver exists (`excludeUserId` is normally the creator).
   */
  async countEligibleApprovers(tenantId: string, excludeUserId: string, permission: string): Promise<number> {
    const members = await this.memberships.listByTenant(tenantId);
    let count = 0;
    for (const member of members) {
      if (member.status !== 'ACTIVE' || member.userId === excludeUserId) continue;
      let permissions: readonly string[];
      if (member.customRoleId) {
        const role = await this.roles.find(tenantId, member.customRoleId);
        permissions = role?.permissions ?? [];
      } else {
        permissions = systemRolePermissions(member.roleKey);
      }
      if (permissions.includes(permission)) count += 1;
    }
    return count;
  }

  /** A session is the refresh-token family `sid`; revoked or expired families are dead. */
  async isSessionActive(sid: string, userId: string): Promise<boolean> {
    const key = `${userId}:${sid}`;
    const hit = this.sessions.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const value = await this.sessionCheck.isFamilyActive(sid, userId);
    this.sessions.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
    return value;
  }

  invalidateUser(userId: string): void {
    for (const k of this.contexts.keys()) if (k.startsWith(`${userId}:`)) this.contexts.delete(k);
    for (const k of this.sessions.keys()) if (k.startsWith(`${userId}:`)) this.sessions.delete(k);
  }

  invalidateTenant(tenantId: string): void {
    for (const k of this.contexts.keys()) if (k.endsWith(`:${tenantId}`)) this.contexts.delete(k);
  }

  /** Permissions of every non-deprecated system role (for the role picker). */
  assignableSystemRoles() {
    return SYSTEM_ROLES.filter((r) => !r.deprecated);
  }
}
