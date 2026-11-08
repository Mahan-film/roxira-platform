import { parseMinor, toMinor } from '../accounting/money';
import { AccessContext } from './access-context';
import { AccessDeniedCode, denied } from './access-errors';
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
  systemRoleFieldVisibility,
} from './catalogue';

export interface AccessEvaluationQuery {
  module: AccessModule;
  also?: readonly AccessModule[];
  action: AccessAction;
  field?: SensitiveField;
  branchId?: string | null;
  warehouseId?: string | null;
  amount?: number | string | bigint;
}

export type AccessDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly code: AccessDeniedCode;
      readonly message: string;
    };

export interface ShadowDiff {
  readonly module: AccessModule;
  readonly action: AccessAction;
  readonly field?: SensitiveField;
  readonly roleKey: string;
  readonly legacyAllowed: boolean;
  readonly newAllowed: boolean;
  readonly newCode?: AccessDeniedCode;
}

/** Normalise optional fields on an `AccessContext` (keeps older test stubs working). */
export function effectiveFieldVisibility(ctx: AccessContext): FieldVisibilityMap {
  return ctx.fieldVisibility ?? systemRoleFieldVisibility(ctx.roleKey);
}

export function effectiveScope(ctx: AccessContext): RoleScope {
  if (ctx.scope) return ctx.scope;
  if (ctx.branchScoped && ctx.branchId) {
    return { type: 'branch', ids: [ctx.branchId] };
  }
  return { type: 'org', ids: [] };
}

export function effectiveAmountLimits(ctx: AccessContext): AmountLimitsMap {
  return ctx.amountLimits ?? {};
}

function toMinorBigInt(amount: number | string | bigint): bigint {
  if (typeof amount === 'bigint') return amount;
  return toMinor(amount);
}

/**
 * Legacy pre-#584-3 evaluation (module entitlement + `module:action` permission only).
 * Used for shadow-mode comparison against `permission-matrix.snapshot.json`.
 */
export function legacyEvaluateAccess(
  ctx: AccessContext,
  module: AccessModule,
  action: AccessAction,
  also: readonly AccessModule[] = [],
): AccessDecision {
  const candidates = [module, ...also];
  const anyEntitled = candidates.some((m) => CORE_MODULES.includes(m) || ctx.entitledModules.has(m));
  if (!anyEntitled) {
    return {
      allowed: false,
      code: 'MODULE_NOT_ENTITLED',
      message: 'This module is not enabled for your organisation.',
    };
  }
  const anyPermitted = candidates.some(
    (m) =>
      (CORE_MODULES.includes(m) || ctx.entitledModules.has(m)) &&
      ctx.permissions.has(permissionOf(m, action)),
  );
  if (!anyPermitted) {
    return {
      allowed: false,
      code: 'FORBIDDEN_ACTION',
      message: 'Your role does not allow this action.',
    };
  }
  return { allowed: true };
}

/**
 * Full in-process policy evaluator (#584-3):
 * 1. Module entitlement & `module:action` permission (across primary + `also` modules)
 * 2. Field visibility (`cost`, `margin`, `salary`)
 * 3. Role scope (`org`, `branch`, `warehouse`) + membership `branchScoped`
 * 4. Amount limits in integer minor units via `modules/accounting/money.ts`
 */
export function evaluateAccess(ctx: AccessContext, query: AccessEvaluationQuery): AccessDecision {
  const base = legacyEvaluateAccess(ctx, query.module, query.action, query.also);
  if (!base.allowed) return base;

  if (query.field) {
    const visibility = effectiveFieldVisibility(ctx);
    if (!visibility[query.field]) {
      return {
        allowed: false,
        code: 'FORBIDDEN_FIELD',
        message: `Your role does not allow viewing ${query.field}.`,
      };
    }
  }

  const scope = effectiveScope(ctx);
  if (query.branchId !== undefined && query.branchId !== null) {
    if (ctx.branchScoped && ctx.branchId && ctx.branchId !== query.branchId) {
      return {
        allowed: false,
        code: 'FORBIDDEN_SCOPE',
        message: 'This resource is outside your assigned branch scope.',
      };
    }
    if (scope.type === 'branch' && !scope.ids.includes(query.branchId)) {
      return {
        allowed: false,
        code: 'FORBIDDEN_SCOPE',
        message: 'This resource is outside your role branch scope.',
      };
    }
  }

  if (query.warehouseId !== undefined && query.warehouseId !== null) {
    if (scope.type === 'warehouse' && !scope.ids.includes(query.warehouseId)) {
      return {
        allowed: false,
        code: 'FORBIDDEN_SCOPE',
        message: 'This resource is outside your role warehouse scope.',
      };
    }
  }

  if (query.amount !== undefined) {
    const amountMinor = toMinorBigInt(query.amount);
    const limits = effectiveAmountLimits(ctx);
    const perm: Permission = permissionOf(query.module, query.action);
    const rawLimit = limits[perm] ?? limits['*'];
    if (rawLimit !== undefined) {
      const limitMinor = parseMinor(rawLimit);
      if (amountMinor > limitMinor) {
        return {
          allowed: false,
          code: 'AMOUNT_LIMIT_EXCEEDED',
          message: 'Amount exceeds your role limit for this action.',
        };
      }
    }
  }

  return { allowed: true };
}

/**
 * Runs both legacy and new evaluators and invokes `onDiff` when they diverge.
 * With `shadow` on (ACCESS_SHADOW_MODE) the LEGACY decision stays authoritative, so turning
 * the flag on never changes who can do what; the diffs are only logged. With `shadow` off
 * the new `evaluateAccess` decision is enforced.
 */
export function evaluateWithShadow(
  ctx: AccessContext,
  query: AccessEvaluationQuery,
  onDiff?: (diff: ShadowDiff) => void,
  shadow = false,
): AccessDecision {
  const legacy = legacyEvaluateAccess(ctx, query.module, query.action, query.also);
  const next = evaluateAccess(ctx, query);
  if (legacy.allowed !== next.allowed && onDiff) {
    onDiff({
      module: query.module,
      action: query.action,
      field: query.field,
      roleKey: ctx.roleKey,
      legacyAllowed: legacy.allowed,
      newAllowed: next.allowed,
      newCode: next.allowed ? undefined : next.code,
    });
  }
  return shadow ? legacy : next;
}

export function decisionToError(decision: AccessDecision): Error | undefined {
  if (decision.allowed) return undefined;
  return denied(decision.code, decision.message);
}

const DEFAULT_SENSITIVE_FIELD_KEYS: Readonly<Record<string, SensitiveField>> = {
  cost: 'cost',
  unitCost: 'cost',
  totalCost: 'cost',
  averageCost: 'cost',
  margin: 'margin',
  grossMargin: 'margin',
  marginPercent: 'margin',
  salary: 'salary',
  baseSalary: 'salary',
  grossPay: 'salary',
  netPay: 'salary',
};

/**
 * Redacts fields mapped to `'cost'`, `'margin'`, or `'salary'` from a response record
 * when the caller's role does not grant visibility for that category (#584-3).
 */
export function redactSensitiveFields<T extends Record<string, unknown>>(
  row: T,
  ctx: AccessContext,
  mapping: Readonly<Record<string, SensitiveField>> = DEFAULT_SENSITIVE_FIELD_KEYS,
): Partial<T> {
  const visibility = effectiveFieldVisibility(ctx);
  const copy: Record<string, unknown> = { ...row };
  for (const [prop, category] of Object.entries(mapping)) {
    if (prop in copy && !visibility[category]) {
      delete copy[prop];
    }
  }
  return copy as Partial<T>;
}
