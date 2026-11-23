import 'reflect-metadata';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
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
  SYSTEM_ROLES,
  SensitiveField,
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

/**
 * T355 (issue #1328): QA: authorization tests for every mutating controller route.
 *
 * Generated table test that:
 *  1. Identifies every mutating route (POST, PUT, PATCH, DELETE) across all controllers.
 *  2. Lists all mutating routes with no role/access policy guard.
 *  3. Verifies that unauthenticated callers are rejected with 401 Unauthorized (unless @Public).
 *  4. Verifies that authenticated members of ANOTHER tenant are rejected with 403 Forbidden.
 *  5. Verifies that every system role matches the permission matrix (403 Forbidden when unauthorized).
 *  6. Prints the exact offending route and controller on any discrepancy.
 */

const ROOT = path.resolve(__dirname, '../..');
const HTTP = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

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

const allRoutes = loadRoutes();
const mutatingRoutes = allRoutes.filter((r) => MUTATING_METHODS.has(r.method));
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

const PRIMARY_TENANT = 'tenant-target-1';
const OTHER_TENANT = 'tenant-unrelated-2';

const dummyLoginWindow = {
  assertAllowed: jest.fn(async () => undefined),
  checkLoginWindow: jest.fn(() => ({ allowed: true })),
} as any;

interface GuardResult {
  allowed: boolean;
  statusCode: 200 | 401 | 403;
  errorCode?: string;
  errorMessage?: string;
}

async function invokeGuard(
  r: Route,
  setup: (stub: AccessStub) => void,
  user?: Record<string, unknown>,
): Promise<GuardResult> {
  const stub = new AccessStub();
  setup(stub);
  const guard = new AccessGuard(reflector, stub as never, dummyLoginWindow);
  const request = {
    method: r.method,
    originalUrl: r.url,
    url: r.url,
    user: user ? { ...user } : undefined,
  };
  const context = {
    getHandler: () => r.handler,
    getClass: () => r.controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  try {
    const ok = await guard.canActivate(context);
    return { allowed: ok, statusCode: ok ? 200 : 403 };
  } catch (err: any) {
    if (err instanceof UnauthorizedException) {
      return { allowed: false, statusCode: 401, errorMessage: err.message };
    }
    const response = typeof err?.getResponse === 'function' ? err.getResponse() : null;
    return {
      allowed: false,
      statusCode: (err?.status as 401 | 403) || 403,
      errorCode: response?.error || response?.code || err?.name,
      errorMessage: response?.message || err?.message,
    };
  }
}

const roleKeys = SYSTEM_ROLES.map((r) => r.key);

describe('T355: QA authorization tests for every mutating controller route', () => {
  it('discovers mutating routes across all application controllers', () => {
    expect(mutatingRoutes.length).toBeGreaterThan(50);
  });

  describe('mutating routes with no role guard', () => {
    it('identifies and lists mutating routes lacking an explicit access policy', () => {
      const unguardedRoutes = mutatingRoutes.filter((r) => classify(r).kind === 'none');
      if (unguardedRoutes.length > 0) {
        // Output for audit / issue reporting
        // eslint-disable-next-line no-console
        console.warn(
          `[T355 FINDING] ${unguardedRoutes.length} mutating route(s) have no access policy:\n` +
            unguardedRoutes.map((r) => `  - ${r.id}`).join('\n'),
        );
      }
      // Every route must be guarded; unguarded routes fail the default-deny policy
      expect(unguardedRoutes.map((r) => r.id)).toEqual([]);
    });

    it('refuses any mutating route without an access policy even for an owner', async () => {
      class UnguardedController {
        create(): void {}
      }
      const fakeRoute: Route = {
        id: 'POST /api/unguarded (UnguardedController.create)',
        controller: UnguardedController,
        handler: UnguardedController.prototype.create,
        method: 'POST',
        url: '/api/unguarded',
      };
      const res = await invokeGuard(
        fakeRoute,
        (s) => s.grant('u-owner', PRIMARY_TENANT, 'owner'),
        { sub: 'u-owner', tenantId: PRIMARY_TENANT, sid: 's-1' },
      );
      expect(res.allowed).toBe(false);
      expect(res.statusCode).toBe(403);
    });
  });

  describe('unauthenticated invocation (expects 401 Unauthorized)', () => {
    it('refuses unauthenticated calls on every non-public mutating route with 401', async () => {
      const violations: string[] = [];

      for (const r of mutatingRoutes) {
        const { kind } = classify(r);
        if (kind === 'public') continue;

        const res = await invokeGuard(r, () => {});
        if (res.allowed || res.statusCode !== 401) {
          violations.push(
            `${r.id} -> expected 401 Unauthorized, got statusCode=${res.statusCode} (allowed=${res.allowed})`,
          );
        }
      }

      expect(violations).toEqual([]);
    });
  });

  describe('cross-tenant isolation (expects 403 Forbidden)', () => {
    it('refuses mutating route invocation when user belongs to ANOTHER tenant', async () => {
      const violations: string[] = [];

      for (const r of mutatingRoutes) {
        const { kind } = classify(r);
        // Public and purely user-auth endpoints are not tenant-scoped
        if (kind === 'public' || kind === 'authOnly' || kind === 'platformAdmin') continue;

        // User is granted owner membership in OTHER_TENANT, but attempts request for PRIMARY_TENANT
        const res = await invokeGuard(
          r,
          (s) => s.grant('u-alien', OTHER_TENANT, 'owner'),
          { sub: 'u-alien', tenantId: PRIMARY_TENANT, sid: 's-alien', mfa: false },
        );

        if (res.allowed) {
          violations.push(
            `CROSS-TENANT LEAK: ${r.id} allowed member of ${OTHER_TENANT} to mutate ${PRIMARY_TENANT}`,
          );
        } else if (res.statusCode !== 403) {
          violations.push(
            `${r.id} -> expected 403 Forbidden for cross-tenant member, got ${res.statusCode}`,
          );
        }
      }

      expect(violations).toEqual([]);
    });
  });

  describe('permission matrix validation per system role', () => {
    const moduleMutatingRoutes = mutatingRoutes.filter((r) => classify(r).kind === 'module');

    describe.each(roleKeys)('role %s', (role) => {
      it(`enforces exact mutating permissions for role ${role} (403 when forbidden)`, async () => {
        const roleDef = SYSTEM_ROLES.find((x) => x.key === role)!;
        const violations: string[] = [];

        for (const r of moduleMutatingRoutes) {
          const { module, also, action, field } = classify(r);
          const res = await invokeGuard(
            r,
            (s) => s.grant('u-role-test', PRIMARY_TENANT, role),
            { sub: 'u-role-test', tenantId: PRIMARY_TENANT, sid: 's-role-test', mfa: false },
          );

          const alternatives = [module!, ...(also ?? [])];
          const hasPerm = alternatives.some((m) => roleDef.permissions.includes(`${m}:${action!}` as never));
          const hasField = !field || systemRoleFieldVisibility(role)[field];
          const shouldBeAllowed = hasPerm && hasField;

          if (res.allowed !== shouldBeAllowed) {
            violations.push(
              `${r.id} [${role}] -> expected allowed=${shouldBeAllowed} (${shouldBeAllowed ? '200' : '403'}), got allowed=${res.allowed} (${res.statusCode})`,
            );
          }
        }

        expect(violations).toEqual([]);
      });
    });
  });
});
