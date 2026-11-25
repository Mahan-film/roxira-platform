import 'reflect-metadata';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import * as fs from 'fs';
import * as path from 'path';
import { AccessStub } from '../../test/support/access-stub';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { UserRole } from '../auth/enums/user-role.enum';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AccessGuard } from './access.guard';
import { AccessService } from './services/access.service';
import { LoginWindowService } from './services/login-window.service';
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
 * T355 (issue #1328): QA authorization tests for every mutating controller route.
 *
 * Exercises the full guard chain (`JwtAuthGuard` -> `RolesGuard` -> `AccessGuard`)
 * against every mutating route (POST, PUT, PATCH, DELETE) across all controllers:
 *  1. Verifies every mutating route declares an explicit access policy (no unguarded routes).
 *  2. Verifies unauthenticated callers are rejected with 401 Unauthorized (unless @Public).
 *  3. Verifies `@Roles()` platform-operator routes reject tenant owners with 403 Forbidden.
 *  4. Verifies `@AuthOnly()` mutating routes match the explicit user-scoped allowlist.
 *  5. Verifies authenticated members of another tenant are rejected with 403 Forbidden.
 *  6. Verifies every system role matches the permission matrix (403 Forbidden when unauthorized).
 */

const HTTP = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const PRIMARY_TENANT = 'tenant-target-1';
const OTHER_TENANT = 'tenant-unrelated-2';

/**
 * Explicit allowlist of mutating routes permitted to use `@AuthOnly()` (purely
 * user-scoped auth/session/onboarding endpoints that execute before or outside a
 * single tenant's data scope). Any new `@AuthOnly()` mutating route outside this
 * allowlist fails the cross-tenant isolation suite.
 */
const ALLOWED_AUTH_ONLY_MUTATING_CONTROLLERS = new Set(['AuthController']);
const ALLOWED_AUTH_ONLY_MUTATING_ROUTE_IDS = new Set([
  'POST /invitations/accept (InvitationsController.accept)',
  'POST /org/ (OrgController.create)',
]);

interface Route {
  id: string;
  controller: Function;
  handler: Function;
  method: string;
  url: string;
}

type Kind = 'public' | 'authOnly' | 'platformAdmin' | 'anyMember' | 'module' | 'none';

interface RouteClassification {
  kind: Kind;
  platformRoles?: UserRole[];
  module?: AccessModule;
  also?: AccessModule[];
  action?: AccessAction;
  field?: SensitiveField;
}

interface GuardResult {
  allowed: boolean;
  statusCode: 200 | 401 | 403;
  errorCode?: string;
  errorMessage?: string;
}

function controllerFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'frontend' || e.name === 'test') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) controllerFiles(full, out);
    else if (/\.controller\.ts$/.test(e.name)) out.push(full);
  }
  return out;
}

function loadRoutes(rootDir: string): Route[] {
  const routes: Route[] = [];
  for (const file of controllerFiles(rootDir)) {
    // Jest runs against TypeScript sources via ts-jest (`testPathIgnorePatterns: ['/dist/']`).
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
        const basePaths = Array.isArray(base) ? base : [base];
        const subPaths = Array.isArray(sub) ? sub : [sub];
        for (const b of basePaths) {
          for (const s of subPaths) {
            const url = `/${[b, s].filter(Boolean).join('/')}`.replace(/\/+/g, '/');
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
    }
  }
  return routes.sort((a, b) => a.id.localeCompare(b.id));
}

function classify(reflector: Reflector, r: Route): RouteClassification {
  const targets = [r.handler, r.controller];
  if (reflector.getAllAndOverride(IS_PUBLIC_KEY, targets)) return { kind: 'public' };
  if (reflector.getAllAndOverride(AUTH_ONLY_KEY, targets)) return { kind: 'authOnly' };
  // @Roles(...roles: UserRole[]) is strictly for global platform-operator roles enforced by
  // RolesGuard before AccessGuard (see roles.decorator.ts, roles.guard.ts, access.guard.ts:80-84).
  const roles = reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, targets);
  if (roles?.length) return { kind: 'platformAdmin', platformRoles: roles };
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

describe('T355: QA authorization tests for every mutating controller route', () => {
  let reflector: Reflector;
  let allRoutes: Route[];
  let mutatingRoutes: Route[];
  let globalUserRoles: Set<string>;

  beforeAll(() => {
    const rootDir = path.resolve(__dirname, '../..');
    reflector = new Reflector();
    allRoutes = loadRoutes(rootDir);
    mutatingRoutes = allRoutes.filter((r) => MUTATING_METHODS.has(r.method));
    globalUserRoles = new Set<string>(Object.values(UserRole));
  });

  function createDummyLoginWindow(): LoginWindowService {
    return {
      assertAllowed: jest.fn(async () => undefined),
      checkLoginWindow: jest.fn(() => ({ allowed: true })),
    } as unknown as LoginWindowService;
  }

  async function invokeGuardChain(
    r: Route,
    setup: (stub: AccessStub) => void,
    user?: Record<string, unknown>,
    options: { includeJwtGuard?: boolean } = { includeJwtGuard: true },
  ): Promise<GuardResult> {
    const stub = new AccessStub();
    setup(stub);
    const jwtServiceStub = {
      verifyAsync: jest.fn(async () => {
        if (!user) throw new UnauthorizedException('Missing user');
        return { ...user };
      }),
    } as unknown as JwtService;
    const jwtAuthGuard = new JwtAuthGuard(jwtServiceStub, reflector);
    const rolesGuard = new RolesGuard(reflector);
    const accessGuard = new AccessGuard(
      reflector,
      stub as unknown as AccessService,
      createDummyLoginWindow(),
    );
    const request: {
      method: string;
      originalUrl: string;
      url: string;
      headers: Record<string, string>;
      user?: Record<string, unknown>;
    } = {
      method: r.method,
      originalUrl: r.url,
      url: r.url,
      headers: user ? { authorization: 'Bearer test-token' } : {},
      user: options.includeJwtGuard === false && user ? { ...user } : undefined,
    };
    const context = {
      getHandler: () => r.handler,
      getClass: () => r.controller,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    try {
      if (options.includeJwtGuard !== false) {
        const jwtOk = await jwtAuthGuard.canActivate(context);
        if (!jwtOk) {
          return { allowed: false, statusCode: 401 };
        }
      }
      if (request.user) {
        const rolesOk = rolesGuard.canActivate(context);
        if (!rolesOk) {
          return { allowed: false, statusCode: 403 };
        }
      }
      const ok = await accessGuard.canActivate(context);
      return { allowed: ok, statusCode: ok ? 200 : 403 };
    } catch (err: unknown) {
      if (err instanceof UnauthorizedException) {
        return { allowed: false, statusCode: 401, errorMessage: err.message };
      }
      const httpErr = err as { status?: number; name?: string; getResponse?: () => Record<string, unknown>; message?: string };
      const response = typeof httpErr?.getResponse === 'function' ? httpErr.getResponse() : null;
      return {
        allowed: false,
        statusCode: (httpErr?.status as 401 | 403) || 403,
        errorCode: (response?.error as string | undefined) || (response?.code as string | undefined) || httpErr?.name,
        errorMessage: (response?.message as string | undefined) || httpErr?.message,
      };
    }
  }

  it('discovers mutating routes across all application controllers', () => {
    expect(mutatingRoutes.length).toBeGreaterThan(0);
  });

  describe('mutating routes with no role guard', () => {
    it('identifies and lists mutating routes lacking an explicit access policy', () => {
      const unguardedRoutes = mutatingRoutes.filter((r) => classify(reflector, r).kind === 'none');
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
      const res = await invokeGuardChain(
        fakeRoute,
        (s) => s.grant('u-owner', PRIMARY_TENANT, 'owner'),
        { sub: 'u-owner', tenantId: PRIMARY_TENANT, sid: 's-1' },
      );
      expect(res.allowed).toBe(false);
      expect(res.statusCode).toBe(403);
    });
  });

  describe('unauthenticated invocation (expects 401 Unauthorized)', () => {
    it('refuses unauthenticated calls through JwtAuthGuard -> RolesGuard -> AccessGuard with 401', async () => {
      const violations: string[] = [];

      for (const r of mutatingRoutes) {
        const { kind } = classify(reflector, r);
        if (kind === 'public') continue;

        const fullChainRes = await invokeGuardChain(r, () => {}, undefined, { includeJwtGuard: true });
        if (fullChainRes.allowed || fullChainRes.statusCode !== 401) {
          violations.push(
            `${r.id} [JwtAuthGuard chain] -> expected 401 Unauthorized, got statusCode=${fullChainRes.statusCode} (allowed=${fullChainRes.allowed})`,
          );
        }

        const accessOnlyRes = await invokeGuardChain(r, () => {}, undefined, { includeJwtGuard: false });
        if (accessOnlyRes.allowed || accessOnlyRes.statusCode !== 401) {
          violations.push(
            `${r.id} [AccessGuard fallback] -> expected 401 Unauthorized, got statusCode=${accessOnlyRes.statusCode} (allowed=${accessOnlyRes.allowed})`,
          );
        }
      }

      expect(violations).toEqual([]);
    });
  });

  describe('platform-operator @Roles() routes', () => {
    it('uses only global UserRole enum values (never tenant-scoped roles) in @Roles()', () => {
      const platformRoutes = mutatingRoutes.filter((r) => classify(reflector, r).kind === 'platformAdmin');
      const violations: string[] = [];

      for (const r of platformRoutes) {
        const roles = classify(reflector, r).platformRoles ?? [];
        const invalid = roles.filter((role) => !globalUserRoles.has(String(role)));
        if (invalid.length > 0) {
          violations.push(`${r.id} -> non-global @Roles values: ${invalid.join(', ')}`);
        }
      }

      expect(violations).toEqual([]);
    });

    it('refuses non-operator tenant owners with 403 Forbidden via RolesGuard', async () => {
      const platformRoutes = mutatingRoutes.filter((r) => classify(reflector, r).kind === 'platformAdmin');
      const violations: string[] = [];

      for (const r of platformRoutes) {
        const res = await invokeGuardChain(
          r,
          (s) => s.grant('u-tenant-owner', PRIMARY_TENANT, 'owner'),
          { sub: 'u-tenant-owner', tenantId: PRIMARY_TENANT, role: UserRole.USER, sid: 's-owner', mfa: false },
        );

        if (res.allowed || res.statusCode !== 403) {
          violations.push(
            `${r.id} -> expected 403 Forbidden for non-operator tenant owner, got statusCode=${res.statusCode} (allowed=${res.allowed})`,
          );
        }
      }

      expect(violations).toEqual([]);
    });
  });

  describe('cross-tenant isolation (expects 403 Forbidden)', () => {
    it('restricts @AuthOnly() mutating routes to the explicit user-scoped allowlist', () => {
      const unexpectedAuthOnly = mutatingRoutes
        .filter((r) => classify(reflector, r).kind === 'authOnly')
        .filter(
          (r) =>
            !ALLOWED_AUTH_ONLY_MUTATING_CONTROLLERS.has(r.controller.name) &&
            !ALLOWED_AUTH_ONLY_MUTATING_ROUTE_IDS.has(r.id),
        )
        .map((r) => r.id);

      expect(unexpectedAuthOnly).toEqual([]);
    });

    it('refuses mutating route invocation when user belongs to ANOTHER tenant', async () => {
      const violations: string[] = [];

      for (const r of mutatingRoutes) {
        const { kind } = classify(reflector, r);
        // Public routes and verified user-scoped @AuthOnly routes (auth, org creation, invitation accept)
        // are not bound to a single pre-existing tenant's data.
        // platformAdmin (@Roles) routes are NOT skipped: a non-operator member of OTHER_TENANT
        // (role: UserRole.USER) must also be rejected with 403 Forbidden by RolesGuard.
        if (kind === 'public' || kind === 'authOnly') continue;

        const res = await invokeGuardChain(
          r,
          (s) => s.grant('u-alien', OTHER_TENANT, 'owner'),
          { sub: 'u-alien', tenantId: PRIMARY_TENANT, role: UserRole.USER, sid: 's-alien', mfa: false },
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
    it('enforces exact mutating permissions for every system role (403 when forbidden)', async () => {
      const moduleMutatingRoutes = mutatingRoutes.filter((r) => classify(reflector, r).kind === 'module');
      const violations: string[] = [];

      for (const roleDef of SYSTEM_ROLES) {
        const role = roleDef.key;
        for (const r of moduleMutatingRoutes) {
          const { module, also, action, field } = classify(reflector, r);
          const res = await invokeGuardChain(
            r,
            (s) => s.grant('u-role-test', PRIMARY_TENANT, role),
            { sub: 'u-role-test', tenantId: PRIMARY_TENANT, sid: 's-role-test', mfa: false },
          );

          const alternatives = [module!, ...(also ?? [])];
          const hasPerm = alternatives.some((m) =>
            roleDef.permissions.some((p) => String(p) === `${m}:${action!}`),
          );
          const hasField = !field || systemRoleFieldVisibility(role)[field];
          const shouldBeAllowed = hasPerm && hasField;

          if (res.allowed !== shouldBeAllowed) {
            violations.push(
              `${r.id} [${role}] -> expected allowed=${shouldBeAllowed} (${shouldBeAllowed ? '200' : '403'}), got allowed=${res.allowed} (${res.statusCode})`,
            );
          }
        }
      }

      expect(violations).toEqual([]);
    });
  });
});
