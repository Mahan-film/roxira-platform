import 'reflect-metadata';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PartiesController } from './controllers/parties.controller';
import { AccessStub } from '../../test/support/access-stub';
import { AccessGuard } from '../access/access.guard';
import { AccessModule, SYSTEM_ROLES, SystemRole } from '../access/catalogue';
import { ACCESS_ALSO_KEY, actionForMethod } from '../access/decorators';

/**
 * Access decisions for the party master: reads are open through CRM *or*
 * ACCOUNTING (accountant), writes stay CRM-only.
 */

const TENANT = 'tenant-1';
const reflector = new Reflector();

const HANDLERS: Array<[keyof PartiesController, string]> = [
  ['list', 'GET'],
  ['getByCode', 'GET'],
  ['create', 'POST'],
  ['update', 'PUT'],
];

async function allowed(
  handler: keyof PartiesController,
  setup: (stub: AccessStub) => void,
  user: Record<string, unknown> = { sub: 'u1', tenantId: TENANT, sid: 's1', mfa: false },
): Promise<boolean> {
  const stub = new AccessStub();
  setup(stub);
  const guard = new AccessGuard(reflector, stub as never);
  const method = HANDLERS.find(([h]) => h === handler)![1];
  const request = { method, originalUrl: '/enterprise-hub/parties', url: '/enterprise-hub/parties', user: { ...user } };
  const context = {
    getHandler: () => (PartiesController.prototype as unknown as Record<string, unknown>)[handler as string],
    getClass: () => PartiesController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  try {
    return await guard.canActivate(context);
  } catch {
    return false;
  }
}

const roleKeys = SYSTEM_ROLES.map((r) => r.key);

describe('party master access', () => {
  it('the read alternatives are only on list and getByCode, never class-level', () => {
    const proto = PartiesController.prototype as unknown as Record<string, object>;
    expect(Reflect.getMetadata(ACCESS_ALSO_KEY, proto['list'])).toEqual([AccessModule.ACCOUNTING]);
    expect(Reflect.getMetadata(ACCESS_ALSO_KEY, proto['getByCode'])).toEqual([AccessModule.ACCOUNTING]);
    expect(Reflect.getMetadata(ACCESS_ALSO_KEY, proto['create'])).toBeUndefined();
    expect(Reflect.getMetadata(ACCESS_ALSO_KEY, proto['update'])).toBeUndefined();
    expect(Reflect.getMetadata(ACCESS_ALSO_KEY, PartiesController)).toBeUndefined();
  });

  it.each(roleKeys)('role %s matches the catalogue on the four party handlers', async (role) => {
    const expectedRead = [SystemRole.OWNER, SystemRole.ADMIN, SystemRole.ACCOUNTANT, SystemRole.SALES,
      SystemRole.READ_ONLY, SystemRole.LEGACY_MEMBER].includes(role as SystemRole);
    const expectedWrite = [SystemRole.OWNER, SystemRole.ADMIN, SystemRole.SALES, SystemRole.LEGACY_MEMBER]
      .includes(role as SystemRole);
    for (const handler of ['list', 'getByCode'] as const) {
      expect(await allowed(handler, (s) => s.grant('u1', TENANT, role))).toBe(expectedRead);
    }
    for (const handler of ['create', 'update'] as const) {
      // PUT maps to the `create` action, so the same role table applies.
      expect(await allowed(handler, (s) => s.grant('u1', TENANT, role))).toBe(expectedWrite);
    }
  });

  it('accountant without crm:read in the role table still reads parties through accounting:read', async () => {
    for (const handler of ['list', 'getByCode'] as const) {
      expect(await allowed(handler, (s) => s.grant('u1', TENANT, SystemRole.ACCOUNTANT))).toBe(true);
    }
    for (const handler of ['create', 'update'] as const) {
      expect(await allowed(handler, (s) => s.grant('u1', TENANT, SystemRole.ACCOUNTANT))).toBe(false);
    }
  });

  it('the primary module entitlement is still checked first: accounting not entitled -> accountant denied', async () => {
    for (const handler of ['list', 'getByCode'] as const) {
      expect(
        await allowed(handler, (s) => s.grant('u1', TENANT, SystemRole.ACCOUNTANT, { entitled: ['crm'] })),
      ).toBe(false);
    }
  });

  it('entitlement of the alternative counts: crm not entitled, accounting entitled -> accountant reads', async () => {
    for (const handler of ['list', 'getByCode'] as const) {
      expect(
        await allowed(handler, (s) => s.grant('u1', TENANT, SystemRole.ACCOUNTANT, { entitled: ['accounting'] })),
      ).toBe(true);
    }
  });

  it('a role without accounting:read gains nothing from the alternative: sales with crm not entitled is denied', async () => {
    for (const handler of ['list', 'getByCode'] as const) {
      expect(
        await allowed(handler, (s) => s.grant('u1', TENANT, SystemRole.SALES, { entitled: ['accounting'] })),
      ).toBe(false);
    }
  });

  it('reads map to the read action and PUT maps to the create action', () => {
    expect(actionForMethod('GET')).toBe('read');
    expect(actionForMethod('PUT')).toBe('create');
  });
});
