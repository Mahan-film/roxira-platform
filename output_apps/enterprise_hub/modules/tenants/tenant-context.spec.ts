import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { UserRole } from '../auth/enums/user-role.enum';
import {
  requireTenantAdmin,
  requireTenantId,
  requireTenantOwner,
} from './tenant-context';
import { TenantRole } from './enums/tenant-role.enum';

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

describe('requireTenantOwner', () => {
  it('allows the tenant OWNER', () => {
    expect(() =>
      requireTenantOwner(
        requestWith({ tenantId: 'tenant-1', tenantRole: TenantRole.OWNER }),
      ),
    ).not.toThrow();
  });

  it('denies a plain MEMBER', () => {
    expect(() =>
      requireTenantOwner(
        requestWith({ tenantId: 'tenant-1', tenantRole: TenantRole.MEMBER }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('denies a user with no tenant role claim', () => {
    expect(() => requireTenantOwner(requestWith({ tenantId: 'tenant-1' }))).toThrow(
      ForbiddenException,
    );
  });
});

describe('requireTenantAdmin', () => {
  it('allows a platform ADMIN', () => {
    expect(() =>
      requireTenantAdmin(
        requestWith({ tenantId: 'tenant-1', role: UserRole.ADMIN }),
      ),
    ).not.toThrow();
  });

  it('allows the tenant OWNER even without a platform role', () => {
    expect(() =>
      requireTenantAdmin(
        requestWith({
          tenantId: 'tenant-1',
          role: UserRole.USER,
          tenantRole: TenantRole.OWNER,
        }),
      ),
    ).not.toThrow();
  });

  it('denies a plain MEMBER', () => {
    expect(() =>
      requireTenantAdmin(
        requestWith({
          tenantId: 'tenant-1',
          role: UserRole.USER,
          tenantRole: TenantRole.MEMBER,
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('denies a user with no role claims at all', () => {
    expect(() =>
      requireTenantAdmin(requestWith({ tenantId: 'tenant-1' })),
    ).toThrow(ForbiddenException);
  });
});
