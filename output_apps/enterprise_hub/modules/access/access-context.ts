import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { denied } from './access-errors';
import {
  AccessAction,
  AccessModule,
  AmountLimitsMap,
  CORE_MODULES,
  FieldVisibilityMap,
  Permission,
  RoleScope,
  SensitiveField,
  permissionOf,
} from './catalogue';
import {
  decisionToError,
  effectiveFieldVisibility,
  evaluateAccess,
} from './policy-evaluator';

/** Verified, database-derived access of the caller inside the active organisation. */
export interface AccessContext {
  userId: string;
  tenantId: string;
  membershipId: string;
  roleKey: string;
  customRoleId?: string | null;
  permissions: ReadonlySet<string>;
  /** Sellable modules the tenant has enabled. Core modules are always allowed. */
  entitledModules: ReadonlySet<string>;
  branchId: string | null;
  branchScoped: boolean;
  require2fa: boolean;
  /** Scope restriction from custom role or branch-scoped membership (#584-3). */
  scope?: RoleScope;
  /** Per-permission (or `'*'`) maximum amount in exact decimal string (#584-3). */
  amountLimits?: AmountLimitsMap;
  /** Field visibility flags for `cost`, `margin`, and `salary` (#584-3). */
  fieldVisibility?: FieldVisibilityMap;
}

export interface AccessRequest extends AuthenticatedRequest {
  access?: AccessContext;
}

/** The verified context set by AccessGuard; throws if a handler runs without it (a wiring bug). */
export function requireAccess(request: AccessRequest): AccessContext {
  if (!request.access) {
    throw new Error('AccessGuard did not run for this route');
  }
  return request.access;
}

/**
 * Second line of defence for code reached through a generic route (assistant,
 * MCP tools): re-check the caller's role and the tenant's entitlement for the
 * module a tool actually touches.
 */
export function requireModulePermission(
  request: AuthenticatedRequest,
  module: AccessModule,
  action: AccessAction,
): void {
  const ctx = (request as AccessRequest).access;
  if (!ctx) {
    throw new ForbiddenException('Access context missing.');
  }
  if (!CORE_MODULES.includes(module) && !ctx.entitledModules.has(module)) {
    throw new ForbiddenException('This module is not enabled for your organisation.');
  }
  if (!ctx.permissions.has(permissionOf(module, action))) {
    throw new ForbiddenException('Your role does not allow this action.');
  }
}

/** Throws 403 (`FORBIDDEN_FIELD`) when the caller's role cannot see `field` (`cost`, `margin`, `salary`). */
export function requireFieldVisibility(ctx: AccessContext, field: SensitiveField): void {
  const vis = effectiveFieldVisibility(ctx);
  if (!vis[field]) {
    throw denied('FORBIDDEN_FIELD', `Your role does not allow viewing ${field}.`);
  }
}

/** Throws 403 (`FORBIDDEN_SCOPE` / `AMOUNT_LIMIT_EXCEEDED`) when scope or amount exceeds the caller's role. */
export function requireScopedAction(
  ctx: AccessContext,
  permission: Permission,
  options: {
    branchId?: string | null;
    warehouseId?: string | null;
    amount?: number | string | bigint;
  } = {},
): void {
  const [module, action] = permission.split(':') as [AccessModule, AccessAction];
  const decision = evaluateAccess(ctx, {
    module,
    action,
    branchId: options.branchId,
    warehouseId: options.warehouseId,
    amount: options.amount,
  });
  const err = decisionToError(decision);
  if (err) throw err;
}
