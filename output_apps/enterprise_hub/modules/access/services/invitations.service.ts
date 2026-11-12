import { BadRequestException, ConflictException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { MailService } from '../../auth/services/mail.service';
import { UiLocale } from '../../auth/constants/password-auth.constants';
import { isEmail, normalizeEmail } from '../../auth/utils/identifier.util';
import { normalizeIranianMobile } from '../../auth/utils/phone.util';
import { IR_MOBILE_REGEX } from '../../auth/constants/auth.constants';
import { TenantsRepository } from '../../tenants/repositories/tenants.repository';
import { AccessContext } from '../access-context';
import { InvitationEntity } from '../entities/invitation.entity';
import { InvitationsRepository } from '../repositories/invitations.repository';
import { MembershipsRepository } from '../repositories/memberships.repository';
import { AccessService } from './access.service';
import { AuditService } from './audit.service';
import { MembersService } from './members.service';

const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;
const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');

type Req = Parameters<AuditService['record']>[0]['request'];

export interface CreateInvitationInput {
  email?: string;
  phone?: string;
  roleKey: string;
  customRoleId?: string | null;
  branchId?: string | null;
  departmentId?: string | null;
  branchScoped?: boolean;
  locale?: UiLocale;
}

/**
 * Invitations by link, email or phone. The raw token exists only in the link
 * returned to the inviter (and emailed); the database keeps its SHA-256.
 * Whoever holds the link can join, so it is single-use and expires in 7 days.
 * Staff who join this way are never asked for an organisation name.
 */
@Injectable()
export class InvitationsService {
  constructor(
    private readonly invitations: InvitationsRepository,
    private readonly memberships: MembershipsRepository,
    private readonly tenants: TenantsRepository,
    private readonly members: MembersService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  async create(actor: AccessContext, input: CreateInvitationInput, request?: Req) {
    const grant = await this.members.resolveRoleGrant(actor, input.roleKey, input.customRoleId);
    if (grant.roleKey === 'owner') throw new BadRequestException('Owners cannot be invited; transfer ownership instead.');
    await this.members.assertPlacement(actor.tenantId, input.branchId, input.departmentId);
    if (input.branchScoped && !input.branchId) throw new BadRequestException('A branch-scoped invitation needs a branch.');

    const email = input.email ? normalizeEmail(input.email) : null;
    if (email && !isEmail(email)) throw new BadRequestException('Email format is not valid.');
    const phone = input.phone ? normalizeIranianMobile(input.phone) : null;
    if (phone && !IR_MOBILE_REGEX.test(phone)) throw new BadRequestException('Phone number is not valid.');

    const token = randomBytes(32).toString('base64url');
    const invitation = await this.invitations.create({
      tenantId: actor.tenantId,
      email,
      phone,
      roleKey: grant.roleKey,
      customRoleId: grant.customRoleId,
      branchId: input.branchId ?? null,
      departmentId: input.departmentId ?? null,
      branchScoped: input.branchScoped ?? false,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      invitedBy: actor.userId,
    });

    const locale: UiLocale = input.locale ?? 'en';
    const link = `${this.mail.portalUrl(locale)}/account/invite/${token}?lang=${locale}`;
    let emailed = false;
    if (email) {
      const tenant = await this.tenants.findById(actor.tenantId);
      emailed = await this.mail.sendInvitation(email, link, tenant?.name ?? 'Roxira', locale);
    }
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: 'invitation.create',
      resourceType: 'invitation',
      resourceId: invitation.id,
      metadata: { role: grant.roleKey, channel: email ? 'email' : phone ? 'phone' : 'link' },
      request,
    });
    // The link is returned once so the inviter can share it (phone invites have no SMS template yet).
    return { invitation, link, emailed };
  }

  listPending(ctx: AccessContext): Promise<InvitationEntity[]> {
    return this.invitations.listPending(ctx.tenantId);
  }

  async revoke(actor: AccessContext, id: string, request?: Req): Promise<void> {
    const inv = await this.invitations.find(actor.tenantId, id);
    if (!inv || inv.acceptedAt) throw new NotFoundException('Invitation not found.');
    inv.revokedAt = new Date();
    await this.invitations.save(inv);
    await this.audit.record({ tenantId: actor.tenantId, actorUserId: actor.userId, action: 'invitation.revoke', resourceType: 'invitation', resourceId: id, request });
  }

  private async openInvitation(token: string): Promise<InvitationEntity> {
    const inv = await this.invitations.findByHash(sha256(token));
    // Same answer for unknown, used and revoked links: nothing to probe.
    if (!inv || inv.revokedAt || inv.acceptedAt) throw new NotFoundException('This invitation is not valid.');
    if (inv.expiresAt.getTime() <= Date.now()) throw new GoneException('This invitation has expired.');
    return inv;
  }

  /** Public preview for the landing page: organisation name and role only. */
  async preview(token: string): Promise<{ organizationName: string; roleKey: string; expiresAt: Date }> {
    const inv = await this.openInvitation(token);
    const tenant = await this.tenants.findById(inv.tenantId);
    if (!tenant?.isActive) throw new NotFoundException('This invitation is not valid.');
    return { organizationName: tenant.name, roleKey: inv.roleKey, expiresAt: inv.expiresAt };
  }

  /** The signed-in user joins the organisation. Idempotent for existing members (role is NOT changed). */
  async accept(userId: string, token: string, request?: Req): Promise<{ tenantId: string }> {
    const inv = await this.openInvitation(token);
    const tenant = await this.tenants.findById(inv.tenantId);
    if (!tenant?.isActive) throw new NotFoundException('This invitation is not valid.');

    const existing = await this.memberships.findByTenantUser(inv.tenantId, userId);
    if (existing) {
      throw new ConflictException('You are already a member of this organisation.');
    }
    if (!(await this.invitations.markAccepted(inv.id, userId, inv.tenantId, {
      callerUserId: userId,
      callerTenantId: inv.tenantId,
    }))) {
      throw new NotFoundException('This invitation is not valid.');
    }
    await this.memberships.create({
      tenantId: inv.tenantId,
      userId,
      roleKey: inv.roleKey,
      customRoleId: inv.customRoleId,
      branchId: inv.branchId,
      departmentId: inv.departmentId,
      branchScoped: inv.branchScoped,
      status: 'ACTIVE',
      invitedBy: inv.invitedBy,
    });
    this.access.invalidateUser(userId);
    await this.audit.record({
      tenantId: inv.tenantId,
      actorUserId: userId,
      action: 'invitation.accept',
      resourceType: 'invitation',
      resourceId: inv.id,
      metadata: { role: inv.roleKey },
      request,
    });
    return { tenantId: inv.tenantId };
  }
}
