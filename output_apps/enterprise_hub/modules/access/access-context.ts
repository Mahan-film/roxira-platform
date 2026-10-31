import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { AccessAction, AccessModule, CORE_MODULES, permissionOf } from './catalogue';

/** Verified, database-derived access of the caller inside the active organisation. */
export interface AccessContext {
  userId: string;
  tenantId: string;
  membershipId: string;
  roleKey: string;
  permissions: ReadonlySet<string>;
  /** Sellable modules the tenant has enabled. Core modules are always allowed. */
  entitledModules: ReadonlySet<string>;
  branchId: string | null;
  branchScoped: boolean;
  require2fa: boolean;
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
