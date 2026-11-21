import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AccessContext } from '../access-context';
import { denied } from '../access-errors';
import {
  AccessAction,
  AccessModule,
  PARTNER_ADVISOR_ROLE,
  SystemRole,
  canGrant,
  permissionOf,
  systemRolePermissions,
} from '../catalogue';
import { MembershipEntity } from '../entities/membership.entity';
import { MembershipsRepository } from '../repositories/memberships.repository';
import { AccessService } from './access.service';
import { AuditService } from './audit.service';
import { RefreshTokenRepository } from '../../auth/repositories/refresh-token.repository';

const MEMBERS_ADMIN = permissionOf(AccessModule.MEMBERS, AccessAction.ADMIN);
const SECURITY_ADMIN = permissionOf(AccessModule.SECURITY, AccessAction.ADMIN);

/**
 * Service managing accountant-firm users serving multiple client organisations (T196 / R16 Test 12).
 *
 * Scoped role (`SystemRole.PARTNER_ADVISOR`): view GL, request documents, adjustment-period journals
 * (enforced server-side); no bank-detail edits, no payments.
 *
 * Security invariants:
 * - Every assignment/revocation enforces verified actor authority (`AccessContext` / `members:admin`).
 * - Assignment never demotes/overwrites an existing non-advisor membership (e.g., owner/staff) and
 *   never silently reactivates a suspended membership.
 * - Multi-tenant revocation validates actor authority per tenant (fail closed), revokes all refresh
 *   tokens and evicts in-process caches BEFORE (and in `finally` after) per-tenant suspension so a
 *   partial failure never leaves sessions active.
 */
@Injectable()
export class AccountantFirmService {
  private readonly logger = new Logger(AccountantFirmService.name);

  constructor(
    private readonly memberships: MembershipsRepository,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly refreshTokens: RefreshTokenRepository,
  ) {}

  /**
   * Assigns the partner advisor role to a firm user in the actor's verified organisation.
   */
  async assignAdvisor(
    actor: AccessContext,
    firmUserId: string,
    options?: { branchId?: string | null; departmentId?: string | null },
    request?: Parameters<AuditService['record']>[0]['request'],
  ): Promise<MembershipEntity> {
    if (!actor.permissions.has(MEMBERS_ADMIN)) {
      throw denied('FORBIDDEN_ACTION', 'Only an organisation administrator can assign a partner advisor.');
    }
    if (!canGrant(actor.permissions, systemRolePermissions(SystemRole.PARTNER_ADVISOR))) {
      throw denied('FORBIDDEN_ACTION', 'You cannot assign a role with permissions you do not hold.');
    }

    const tenantId = actor.tenantId;
    const existing = await this.memberships.findByTenantUser(tenantId, firmUserId);
    let membership: MembershipEntity;

    if (existing) {
      if (existing.roleKey !== PARTNER_ADVISOR_ROLE) {
        throw new ConflictException(
          'کاربر در این سازمان دارای عضویت با نقش دیگری است و قابل جایگزینی با نقش حسابدار مؤسسه نیست.',
        );
      }
      if (existing.status === 'SUSPENDED') {
        throw new ConflictException(
          'عضویت این کاربر تعلیق شده است؛ فعال‌سازی مجدد از مسیر انتساب حسابدار مؤسسه مجاز نیست.',
        );
      }
      if (options?.branchId !== undefined) existing.branchId = options.branchId;
      if (options?.departmentId !== undefined) existing.departmentId = options.departmentId;
      membership = await this.memberships.save(existing);
    } else {
      membership = await this.memberships.create({
        tenantId,
        userId: firmUserId,
        roleKey: PARTNER_ADVISOR_ROLE,
        customRoleId: null,
        branchId: options?.branchId ?? null,
        departmentId: options?.departmentId ?? null,
        branchScoped: false,
        status: 'ACTIVE',
        invitedBy: actor.userId,
      });
    }

    await Promise.resolve(this.access.invalidateUser(firmUserId));
    await this.audit.record({
      tenantId,
      actorUserId: actor.userId,
      action: 'member.assign_partner_advisor',
      resourceType: 'membership',
      resourceId: membership.id,
      metadata: { firmUserId, role: PARTNER_ADVISOR_ROLE },
      request,
    });
    return membership;
  }

  /**
   * Revokes a partner advisor within a single organisation (actor's verified tenant).
   */
  async revokeAdvisorInTenant(
    actor: AccessContext,
    firmUserId: string,
    reason = 'Partner advisor revoked by organisation administrator',
    request?: Parameters<AuditService['record']>[0]['request'],
  ): Promise<void> {
    if (!actor.permissions.has(MEMBERS_ADMIN) && !actor.permissions.has(SECURITY_ADMIN)) {
      throw denied('FORBIDDEN_ACTION', 'Only an organisation administrator can revoke a partner advisor.');
    }
    const existing = await this.memberships.findByTenantUser(actor.tenantId, firmUserId);
    if (!existing) {
      throw new NotFoundException('عضویت حسابدار مؤسسه در این سازمان یافت نشد.');
    }
    if (existing.roleKey !== PARTNER_ADVISOR_ROLE) {
      throw new ConflictException('این عضو دارای نقش حسابدار مؤسسه نیست و از این مسیر قابل لغو نیست.');
    }

    const revokedAt = new Date().toISOString();
    try {
      // Terminate sessions first so a subsequent DB/audit error never leaves tokens alive.
      await this.refreshTokens.revokeAllForUser(firmUserId);
      await Promise.resolve(this.access.invalidateUser(firmUserId));

      existing.status = 'SUSPENDED';
      await this.memberships.save(existing);

      await this.audit.record({
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: 'security.firm_user_revoked',
        resourceType: 'membership',
        resourceId: existing.id,
        metadata: {
          firmUserId,
          role: PARTNER_ADVISOR_ROLE,
          reason,
          revokedAt,
        },
        request,
      });
    } finally {
      await Promise.resolve(this.access.invalidateUser(firmUserId));
    }
  }

  /**
   * Revokes a firm user's `partner_advisor` memberships across all client organisations the actor
   * is authorised to administer (or an explicit validated subset), ending all sessions immediately
   * (within the 60 s SLA; in-process cache is evicted synchronously and replica TTL is 15 s) and
   * writing a `security.firm_user_revoked` audit entry per tenant.
   */
  async revokeFirmUser(
    actorUserId: string,
    firmUserId: string,
    requestedTenantIds?: string[],
    reason = 'Firm user revoked across all client organisations',
    request?: Parameters<AuditService['record']>[0]['request'],
  ): Promise<{ revokedTenantIds: string[] }> {
    const actorMemberships = await this.memberships.listForUser(actorUserId, actorUserId);
    const authorizedTenants = new Set<string>();
    for (const m of actorMemberships) {
      if (m.status !== 'ACTIVE') continue;
      const ctx = await this.access.resolve(actorUserId, m.tenantId);
      if (ctx && (ctx.permissions.has(MEMBERS_ADMIN) || ctx.permissions.has(SECURITY_ADMIN))) {
        authorizedTenants.add(m.tenantId);
      }
    }

    let targetTenantIds: string[];
    if (requestedTenantIds !== undefined) {
      if (requestedTenantIds.length === 0) {
        throw new BadRequestException('At least one tenantId must be provided when specifying tenantIds.');
      }
      const unique = Array.from(new Set(requestedTenantIds));
      const unauthorized = unique.filter((tid) => !authorizedTenants.has(tid));
      if (unauthorized.length > 0) {
        throw denied(
          'FORBIDDEN_ACTION',
          'You do not have administrative authority to revoke advisors in one or more requested organisations.',
        );
      }
      targetTenantIds = unique;
    } else {
      targetTenantIds = Array.from(authorizedTenants);
    }

    if (targetTenantIds.length === 0) {
      throw denied('FORBIDDEN_ACTION', 'You do not administer any client organisation for revocation.');
    }

    // Identify affected partner_advisor memberships first (never touch non-advisor roles like owner).
    const targets: Array<{ tenantId: string; membership: MembershipEntity }> = [];
    for (const tenantId of targetTenantIds) {
      const membership = await this.memberships.findByTenantUser(tenantId, firmUserId);
      if (membership && membership.roleKey === PARTNER_ADVISOR_ROLE) {
        targets.push({ tenantId, membership });
      }
    }

    const revokedAt = new Date().toISOString();
    const revokedTenantIds: string[] = [];

    try {
      // Revoke all refresh tokens FIRST so any failure in the per-tenant loop cannot leave sessions active.
      await this.refreshTokens.revokeAllForUser(firmUserId);
      await Promise.resolve(this.access.invalidateUser(firmUserId));

      for (const { tenantId, membership } of targets) {
        membership.status = 'SUSPENDED';
        await this.memberships.save(membership);
        revokedTenantIds.push(tenantId);

        await this.audit.record({
          tenantId,
          actorUserId,
          action: 'security.firm_user_revoked',
          resourceType: 'membership',
          resourceId: membership.id,
          metadata: {
            firmUserId,
            role: PARTNER_ADVISOR_ROLE,
            reason,
            revokedAt,
          },
          request,
        });
      }
    } finally {
      await Promise.resolve(this.access.invalidateUser(firmUserId));
    }

    this.logger.log(
      `Revoked partner advisor ${firmUserId} across ${revokedTenantIds.length} tenant(s) by ${actorUserId}`,
    );
    return { revokedTenantIds };
  }

  /**
   * Check whether a session is active for the given user.
   */
  async isSessionActive(sid: string, userId: string): Promise<boolean> {
    return this.access.isSessionActive(sid, userId);
  }
}
