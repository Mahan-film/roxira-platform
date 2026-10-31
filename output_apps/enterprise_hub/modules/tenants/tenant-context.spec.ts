import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { requireTenantId } from './tenant-context';

const requestWith = (user: unknown): AuthenticatedRequest =>
  ({ user }) as unknown as AuthenticatedRequest;

describe('requireTenantId', () => {
  it('returns the tenant id from the authenticated user', () => {
    expect(requireTenantId(requestWith({ tenantId: 'tenant-1' }))).toBe(
      'tenant-1',
    );
  });

  it('throws ForbiddenException when the tenant id is null', () => {
    expect(() => requireTenantId(requestWith({ tenantId: null }))).toThrow(
      ForbiddenException,
    );
  });

  it('throws ForbiddenException when the tenant id is missing', () => {
    expect(() => requireTenantId(requestWith({}))).toThrow(ForbiddenException);
  });

  it('fails closed and never falls back to the user id (sub)', () => {
    expect(() => requireTenantId(requestWith({ sub: 'user-1' }))).toThrow(
      ForbiddenException,
    );
  });

  it('throws when there is no authenticated user at all', () => {
    expect(() => requireTenantId(requestWith(undefined))).toThrow(
      ForbiddenException,
    );
  });
});
