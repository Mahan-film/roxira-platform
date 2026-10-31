import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthRepository } from '../../auth/repositories/auth.repository';
import { TenantsService } from '../../tenants/services/tenants.service';
import { TenantsRepository } from '../../tenants/repositories/tenants.repository';
import { AccessContext } from '../access-context';
import { SystemRole } from '../catalogue';
import { MembershipsRepository, MembershipWithTenant } from '../repositories/memberships.repository';
import { AccessService } from './access.service';
import { AuditService } from './audit.service';
import { EntitlementsService } from './entitlements.service';

/** A user may own at most this many organisations (abuse guard for open signup). */
export const MAX_OWNED_ORGANIZATIONS = 30;

type Req = Parameters<AuditService['record']>[0]['request'];

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly tenantsService: TenantsService,
    private readonly tenants: TenantsRepository,
    private readonly memberships: MembershipsRepository,
    private readonly users: AuthRepository,
    private readonly entitlements: EntitlementsService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  listMine(userId: string): Promise<MembershipWithTenant[]> {
    return this.memberships.listForUser(userId);
  }

  /** A person who signed up alone creates an organisation later; they become its owner. */
  async create(userId: string, name: string, request?: Req): Promise<{ tenantId: string }> {
    const owned = (await this.memberships.listForUser(userId)).filter((m) => m.roleKey === SystemRole.OWNER);
    if (owned.length >= MAX_OWNED_ORGANIZATIONS) {
      throw new ConflictException('You have reached the limit of organisations you can own.');
    }
    const tenant = await this.tenantsService.create(name);
    await this.memberships.create({ tenantId: tenant.id, userId, roleKey: SystemRole.OWNER, status: 'ACTIVE' });
    await this.entitlements.grantDefaults(tenant.id);
    const user = await this.users.findById(userId);
    if (user && !user.tenantId) {
      user.tenantId = tenant.id;
      user.tenantRole = 'OWNER' as never;
      await this.users.save(user);
    }
    this.access.invalidateUser(userId);
    await this.audit.record({ tenantId: tenant.id, actorUserId: userId, action: 'organization.create', resourceType: 'tenant', resourceId: tenant.id, request });
    return { tenantId: tenant.id };
  }

  async getSecurity(ctx: AccessContext): Promise<{ require2fa: boolean }> {
    const t = await this.tenants.findById(ctx.tenantId);
    if (!t) throw new NotFoundException('Organisation not found.');
    return { require2fa: t.require2fa };
  }

  /**
   * Turn the mandatory-2FA policy on or off. Enabling is refused unless the
   * actor's own session already passed a second factor, so nobody locks themselves out.
   */
  async setRequire2fa(ctx: AccessContext, enabled: boolean, sessionMfa: boolean, request?: Req): Promise<{ require2fa: boolean }> {
    if (enabled && !sessionMfa) {
      throw new BadRequestException('Set up two-factor sign-in for yourself first, then sign in with it, before requiring it.');
    }
    await this.tenants.updateRequire2fa(ctx.tenantId, enabled);
    this.access.invalidateTenant(ctx.tenantId);
    await this.audit.record({ tenantId: ctx.tenantId, actorUserId: ctx.userId, action: 'organization.require2fa', resourceType: 'tenant', resourceId: ctx.tenantId, metadata: { enabled }, request });
    return { require2fa: enabled };
  }
}
