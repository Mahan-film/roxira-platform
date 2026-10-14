import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { CrmController } from './crm.controller';

const requestWith = (user: unknown): AuthenticatedRequest =>
  ({ user }) as unknown as AuthenticatedRequest;

describe('CrmController — tenant isolation', () => {
  const controller = new CrmController({} as never);
  const tenantIdOf = (request: AuthenticatedRequest): string =>
    (controller as unknown as {
      tenantIdOf: (req: AuthenticatedRequest) => string;
    }).tenantIdOf(request);

  it('rejects a user with a null tenant', () => {
    expect(() => tenantIdOf(requestWith({ tenantId: null }))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects a user with no tenant claim at all', () => {
    expect(() => tenantIdOf(requestWith({ sub: 'user-1' }))).toThrow(
      ForbiddenException,
    );
  });

  it('resolves the tenant id from the JWT claim', () => {
    expect(tenantIdOf(requestWith({ tenantId: 'tenant-1' }))).toBe('tenant-1');
  });
});
