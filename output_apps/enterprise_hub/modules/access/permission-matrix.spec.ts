import 'reflect-metadata';
import { ExecutionContext } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import * as fs from 'fs';
import * as path from 'path';
import { AccessStub } from '../../test/support/access-stub';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { AccessGuard } from './access.guard';
import {
  AccessAction,
  AccessModule,
  CORE_MODULES,
  SALARY_PROTECTED_HANDLERS,
  SYSTEM_ROLES,
  SensitiveField,
  SystemRole,
  requiredFieldForHandler,
  systemRoleFieldVisibility,
} from './catalogue';
import {
  ACCESS_ACTION_KEY,
  ACCESS_ALSO_KEY,
  ACCESS_FIELD_KEY,
  ACCESS_MODULE_KEY,
  ANY_MEMBER_KEY,
  AUTH_ONLY_KEY,
  actionForMethod,
} from './decorators';
import {
  ShadowDiff,
  evaluateAccess,
  evaluateWithShadow,
  redactSensitiveFields,
} from './policy-evaluator';

/**
 * Permission matrix over EVERY controller in the app: each route must declare
 * a policy, and the real AccessGuard is run for every route x system role.
 * The outcome is pinned in permission-matrix.snapshot.json, so any change to who
 * can do what shows up in review. Regenerate with UPDATE_PERMISSION_MATRIX=1.
 */

const ROOT = path.resolve(__dirname, '../..');
const SNAPSHOT = path.join(__dirname, 'permission-matrix.snapshot.json');
const HTTP = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];

function controllerFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'frontend' || e.name === 'test') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) controllerFiles(full, out);
    else if (/\.controller\.ts$/.test(e.name)) out.push(full);
  }
  return out;
}

interface Route {
  id: string;
  controller: Function;
  handler: Function;
  method: string;
  url: string;
}

function loadRoutes(): Route[] {
  const routes: Route[] = [];
  for (const file of controllerFiles(ROOT)) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(file) as Record<string, unknown>;
    for (const exported of Object.values(mod)) {
      if (typeof exported !== 'function' || Reflect.getMetadata(PATH_METADATA, exported) === undefined) continue;
      const base = Reflect.getMetadata(PATH_METADATA, exported) as string | string[];
      const proto = exported.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const verb = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
        if (verb === undefined) continue;
        const sub = Reflect.getMetadata(PATH_METADATA, handler) as string | string[];
        const url = `/${[Array.isArray(base) ? base[0] : base, Array.isArray(sub) ? sub[0] : sub].join('/')}`.replace(/\/+/g, '/');
        routes.push({
          id: `${HTTP[verb]} ${url} (${exported.name}.${name})`,
          controller: exported,
          handler: handler as Function,
          method: HTTP[verb],
          url,
        });
      }
    }
  }
  return routes.sort((a, b) => a.id.localeCompare(b.id));
}

const routes = loadRoutes();
const reflector = new Reflector();

type Kind = 'public' | 'authOnly' | 'platformAdmin' | 'anyMember' | 'module' | 'none';
function classify(r: Route): {
  kind: Kind;
  module?: AccessModule;
  also?: AccessModule[];
  action?: AccessAction;
  field?: SensitiveField;
} {
  const targets = [r.handler, r.controller];
  if (reflector.getAllAndOverride(IS_PUBLIC_KEY, targets)) return { kind: 'public' };
  if (reflector.getAllAndOverride(AUTH_ONLY_KEY, targets)) return { kind: 'authOnly' };
  const roles = reflector.getAllAndOverride<unknown[]>(ROLES_KEY, targets);
  if (roles?.length) return { kind: 'platformAdmin' };
  if (reflector.getAllAndOverride(ANY_MEMBER_KEY, targets)) return { kind: 'anyMember' };
  const module = reflector.getAllAndOverride<AccessModule>(ACCESS_MODULE_KEY, targets);
  if (!module) return { kind: 'none' };
  const action =
    reflector.getAllAndOverride<AccessAction>(ACCESS_ACTION_KEY, [r.handler]) ?? actionForMethod(r.method);
  const field =
    reflector.getAllAndOverride<SensitiveField | undefined>(ACCESS_FIELD_KEY, targets) ??
    requiredFieldForHandler(r.controller.name, r.handler.name);
  return {
    kind: 'module',
    module,
    also: reflector.getAllAndOverride<AccessModule[] | undefined>(ACCESS_ALSO_KEY, [r.handler]) ?? [],
    action,
    field,
  };
}

const TENANT = 'tenant-1';

async function allowed(
  r: Route,
  setup: (stub: AccessStub) => void,
  user: Record<string, unknown> = { sub: 'u1', tenantId: TENANT, sid: 's1', mfa: false },
): Promise<boolean> {
  const stub = new AccessStub();
  setup(stub);
  const guard = new AccessGuard(reflector, stub as never);
  const request = { method: r.method, originalUrl: r.url, url: r.url, user: { ...user } };
  const context = {
    getHandler: () => r.handler,
    getClass: () => r.controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  try {
    return await guard.canActivate(context);
  } catch {
    return false;
  }
}

const roleKeys = SYSTEM_ROLES.map((r) => r.key);

describe('permission matrix (every controller)', () => {
  it('finds the controllers of the app', () => {
    const names = new Set(routes.map((r) => r.controller.name));
    for (const expected of [
      'AccountingController', 'BankingController', 'CrmController', 'HrController', 'InventoryController',
      'InvoicingController', 'DamagesController', 'TaxComplianceController', 'MoadianController',
      'DataImportController', 'AssistantController', 'McpController', 'TenantsController', 'AuthController',
      'OrgController', 'InvitationsController', 'EntitlementsAdminController', 'RadarController',
    ]) {
      expect(names).toContain(expected);
    }
    expect(routes.length).toBeGreaterThan(100);
  });

  it('every route declares an access policy (default deny otherwise)', () => {
    const missing = routes.filter((r) => classify(r).kind === 'none').map((r) => r.id);
    expect(missing).toEqual([]);
  });

  it('a route without a policy is refused by the guard even for an owner', async () => {
    class Bare {
      get(): void {}
    }
    const r: Route = { id: 'bare', controller: Bare, handler: Bare.prototype.get, method: 'GET', url: '/bare' };
    await expect(allowed(r, (s) => s.grant('u1', TENANT, 'owner'))).resolves.toBe(false);
  });

  const moduleRoutes = routes.filter((r) => classify(r).kind === 'module');

  describe.each(roleKeys)('role %s', (role) => {
    it('matches the permission catalogue and field visibility on every module route', async () => {
      const wrong: string[] = [];
      for (const r of moduleRoutes) {
        const { module, also, action, field } = classify(r);
        const ok = await allowed(r, (s) => s.grant('u1', TENANT, role));
        const def = SYSTEM_ROLES.find((x) => x.key === role)!;
        const alternatives = [module!, ...(also ?? [])];
        const hasPerm = alternatives.some((m) => def.permissions.includes(`${m}:${action!}` as never));
        const hasField = !field || systemRoleFieldVisibility(role)[field];
        const expected = hasPerm && hasField;
        if (ok !== expected) wrong.push(`${r.id} expected ${expected} got ${ok}`);
      }
      expect(wrong).toEqual([]);
    });
  });

  describe('shadow mode and #584-3 custom role evaluator', () => {
    it('produces zero diffs against the legacy evaluator on every non-salary route', async () => {
      const diffs: ShadowDiff[] = [];
      for (const r of moduleRoutes) {
        const { module, also, action, field } = classify(r);
        if (field) continue;
        for (const role of roleKeys) {
          const stub = new AccessStub();
          stub.grant('u1', TENANT, role);
          const ctx = (await stub.resolve('u1', TENANT))!;
          evaluateWithShadow(ctx, { module: module!, also, action: action!, field }, (d) => diffs.push(d));
        }
      }
      expect(diffs).toEqual([]);
    });

    it('restricts payslip and payroll endpoints to hr and owner by default (blocks admin and read_only)', async () => {
      const salaryRoutes = moduleRoutes.filter((r) =>
        SALARY_PROTECTED_HANDLERS.has(`${r.controller.name}.${r.handler.name}`),
      );
      expect(salaryRoutes.length).toBe(SALARY_PROTECTED_HANDLERS.size);
      for (const r of salaryRoutes) {
        expect(await allowed(r, (s) => s.grant('u1', TENANT, SystemRole.OWNER))).toBe(true);
        expect(await allowed(r, (s) => s.grant('u1', TENANT, SystemRole.HR))).toBe(true);
        expect(await allowed(r, (s) => s.grant('u1', TENANT, SystemRole.ADMIN))).toBe(false);
        expect(await allowed(r, (s) => s.grant('u1', TENANT, SystemRole.READ_ONLY))).toBe(false);
        // Custom role with hr:read + salary:true is allowed on GET payslip routes
        if (classify(r).action === AccessAction.READ) {
          expect(
            await allowed(r, (s) => {
              s.grant('u1', TENANT, 'custom', { perms: ['hr:read'] });
              const baseResolve = s.resolve;
              s.resolve = async (uid, tid) => {
                const base = await baseResolve(uid, tid);
                return base
                  ? { ...base, fieldVisibility: { cost: false, margin: false, salary: true } }
                  : null;
              };
            }),
          ).toBe(true);
        }
      }
    });

    it('enforces custom role scope (branch / warehouse), amount limits (money.ts minor units) and field redaction', async () => {
      const stub = new AccessStub();
      stub.grant('u1', TENANT, 'custom', {
        perms: ['invoicing:approve', 'inventory:post'],
      });
      const baseCtx = (await stub.resolve('u1', TENANT))!;
      const ctx = {
        ...baseCtx,
        scope: { type: 'warehouse' as const, ids: ['11111111-1111-4111-8111-111111111111'] },
        amountLimits: { 'invoicing:approve': '50000000.00' },
        fieldVisibility: { cost: false, margin: true, salary: false },
      };

      expect(
        evaluateAccess(ctx, {
          module: AccessModule.INVENTORY,
          action: AccessAction.POST,
          warehouseId: '11111111-1111-4111-8111-111111111111',
        }),
      ).toEqual({ allowed: true });

      expect(
        evaluateAccess(ctx, {
          module: AccessModule.INVENTORY,
          action: AccessAction.POST,
          warehouseId: '22222222-2222-4222-8222-222222222222',
        }),
      ).toMatchObject({ allowed: false, code: 'FORBIDDEN_SCOPE' });

      expect(
        evaluateAccess(ctx, {
          module: AccessModule.INVOICING,
          action: AccessAction.APPROVE,
          amount: '50000000.00',
        }),
      ).toEqual({ allowed: true });

      expect(
        evaluateAccess(ctx, {
          module: AccessModule.INVOICING,
          action: AccessAction.APPROVE,
          amount: '50000000.01',
        }),
      ).toMatchObject({ allowed: false, code: 'AMOUNT_LIMIT_EXCEEDED' });

      const redacted = redactSensitiveFields(
        { id: 1, sku: 'A-1', unitCost: 12000, margin: 3000, baseSalary: 90000000 },
        ctx,
      );
      expect(redacted).toEqual({ id: 1, sku: 'A-1', margin: 3000 });
    });
  });

  describe('isolation of access decisions', () => {
    it('no membership -> denied on every module route, allowed on @AuthOnly routes', async () => {
      for (const r of routes) {
        const k = classify(r).kind;
        if (k === 'module' || k === 'anyMember') {
          expect(await allowed(r, () => undefined)).toBe(false);
        }
        if (k === 'authOnly') {
          expect(await allowed(r, () => undefined)).toBe(true);
        }
      }
    });

    it('a JWT claiming another tenant id gains nothing (membership is per tenant)', async () => {
      for (const r of moduleRoutes) {
        const ok = await allowed(r, (s) => s.grant('u1', 'tenant-A', 'owner'), {
          sub: 'u1', tenantId: 'tenant-B', sid: 's1', mfa: true,
        });
        expect(ok).toBe(false);
      }
    });

    it('owner is allowed on every module route; an un-bought module blocks everyone except core modules', async () => {
      for (const r of moduleRoutes) {
        const { module } = classify(r);
        expect(await allowed(r, (s) => s.grant('u1', TENANT, 'owner'))).toBe(true);
        const none = await allowed(r, (s) => s.grant('u1', TENANT, 'owner', { entitled: [] }));
        expect(none).toBe(CORE_MODULES.includes(module!));
      }
    });

    it('a revoked session or a removed member is refused at once', async () => {
      const r = moduleRoutes[0];
      const stub = new AccessStub();
      stub.grant('u1', TENANT, 'owner');
      stub.dead.add('s1');
      const guard = new AccessGuard(reflector, stub as never);
      const ctx = {
        getHandler: () => r.handler,
        getClass: () => r.controller,
        switchToHttp: () => ({ getRequest: () => ({ method: r.method, url: '/', user: { sub: 'u1', tenantId: TENANT, sid: 's1' } }) }),
      } as unknown as ExecutionContext;
      await expect(guard.canActivate(ctx)).rejects.toThrow(/Session ended/);
    });

    it('mandatory 2FA: a session without a second factor is refused, with one it is allowed', async () => {
      for (const r of moduleRoutes) {
        const need = (s: AccessStub) => s.grant('u1', TENANT, 'owner', { require2fa: true });
        expect(await allowed(r, need, { sub: 'u1', tenantId: TENANT, sid: 's1', mfa: false })).toBe(false);
        expect(await allowed(r, need, { sub: 'u1', tenantId: TENANT, sid: 's1', mfa: true })).toBe(true);
      }
    });
  });

  describe('named expectations from the product brief', () => {
    const can = async (role: string, module: AccessModule, action: AccessAction): Promise<boolean> => {
      const r = moduleRoutes.find((x) => {
        const c = classify(x);
        return c.module === module && c.action === action && !c.field;
      });
      if (!r) throw new Error(`no route for ${module}:${action}`);
      return allowed(r, (s) => s.grant('u1', TENANT, role));
    };

    it('sales only: CRM yes, accounting/HR/banking no', async () => {
      expect(await can(SystemRole.SALES, AccessModule.CRM, AccessAction.CREATE)).toBe(true);
      expect(await can(SystemRole.SALES, AccessModule.ACCOUNTING, AccessAction.READ)).toBe(false);
      expect(await can(SystemRole.SALES, AccessModule.HR, AccessAction.READ)).toBe(false);
      expect(await can(SystemRole.SALES, AccessModule.BANKING, AccessAction.READ)).toBe(false);
    });

    it('cheque reviewer: may read banking, may not post or touch anything else', async () => {
      expect(await can(SystemRole.CHEQUE_REVIEWER, AccessModule.BANKING, AccessAction.READ)).toBe(true);
      expect(await can(SystemRole.CHEQUE_REVIEWER, AccessModule.BANKING, AccessAction.POST)).toBe(false);
      expect(await can(SystemRole.CHEQUE_REVIEWER, AccessModule.ACCOUNTING, AccessAction.READ)).toBe(false);
      expect(await can(SystemRole.CHEQUE_REVIEWER, AccessModule.CRM, AccessAction.READ)).toBe(false);
    });

    it('read only: no write, approve, post or admin anywhere', async () => {
      for (const r of moduleRoutes) {
        const { action } = classify(r);
        if (action !== AccessAction.READ) {
          expect(await allowed(r, (s) => s.grant('u1', TENANT, SystemRole.READ_ONLY))).toBe(false);
        }
      }
    });

    it('accountant reads the party master through accounting:read but cannot create or update parties', async () => {
      const party = routes.filter((r) => r.controller.name === 'PartiesController');
      const byHandler = (name: string) => party.find((r) => r.id.endsWith(`PartiesController.${name})`));
      for (const handler of ['list', 'getByCode']) {
        expect(await allowed(byHandler(handler)!, (s) => s.grant('u1', TENANT, SystemRole.ACCOUNTANT))).toBe(true);
      }
      for (const handler of ['create', 'update']) {
        expect(await allowed(byHandler(handler)!, (s) => s.grant('u1', TENANT, SystemRole.ACCOUNTANT))).toBe(false);
      }
    });

    it('no role other than accountant, owner, admin, sales, read_only and legacy_member reads parties; hr and cheque_reviewer do not', async () => {
      const party = routes.filter((r) => r.controller.name === 'PartiesController');
      const list = party.find((r) => r.id.endsWith('PartiesController.list)'));
      for (const role of roleKeys) {
        const ok = await allowed(list!, (s) => s.grant('u1', TENANT, role));
        const expected = [
          SystemRole.OWNER, SystemRole.ADMIN, SystemRole.ACCOUNTANT,
          SystemRole.SALES, SystemRole.READ_ONLY, SystemRole.LEGACY_MEMBER,
        ].includes(role as SystemRole);
        expect(ok).toBe(expected);
      }
    });

    it('only owner and admin can manage members, roles and structure', async () => {
      for (const role of roleKeys) {
        const ok = await can(role, AccessModule.MEMBERS, AccessAction.ADMIN);
        expect(ok).toBe(role === SystemRole.OWNER || role === SystemRole.ADMIN);
      }
    });

    it('only an owner can change the organisation security policy; only owner/admin read the audit log', async () => {
      for (const role of roleKeys) {
        expect(await can(role, AccessModule.SECURITY, AccessAction.ADMIN)).toBe(role === SystemRole.OWNER);
        expect(await can(role, AccessModule.AUDIT, AccessAction.READ)).toBe(
          role === SystemRole.OWNER || role === SystemRole.ADMIN,
        );
      }
    });
  });

  it('matches the committed snapshot (review any change to who can do what)', async () => {
    const matrix: Record<string, Record<string, boolean | string>> = {};
    for (const r of routes) {
      const c = classify(r);
      const basePolicy =
        c.kind === 'module'
          ? [c.module, ...(c.also ?? [])].map((m) => `${m}:${c.action}`).join('|')
          : c.kind;
      const row: Record<string, boolean | string> = {
        policy: c.field ? `${basePolicy}+field:${c.field}` : basePolicy,
      };
      if (c.kind === 'module' || c.kind === 'anyMember') {
        for (const role of roleKeys) row[role] = await allowed(r, (s) => s.grant('u1', TENANT, role));
      }
      matrix[r.id] = row;
    }
    if (process.env.UPDATE_PERMISSION_MATRIX === '1' || !fs.existsSync(SNAPSHOT)) {
      fs.writeFileSync(SNAPSHOT, `${JSON.stringify(matrix, null, 2)}\n`);
    }
    expect(matrix).toEqual(JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')));
  });
});
