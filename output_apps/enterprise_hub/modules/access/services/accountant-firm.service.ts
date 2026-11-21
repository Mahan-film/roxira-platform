import { Injectable, Logger } from '@nestjs/common';
import { PARTNER_ADVISOR_ROLE } from '../catalogue';
import { MembershipEntity } from '../entities/membership.entity';
import { MembershipsRepository } from '../repositories/memberships.repository';
import { AccessService } from './access.service';
import { AuditService } from './audit.service';
import { RefreshTokenRepository } from '../../auth/repositories/refresh-token.repository';

/**
 * Service managing accountant-firm users serving multiple client organisations (T196 / R16 Test 12).
 *
 * Scoped role: view GL, request documents, adjustment-period journals; no bank-detail edits, no payments.
 * Revocation ends all sessions across all client organisations within 60 s with a security audit entry.
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
   * Assigns the partner advisor role to a firm user for a client organisation.
   */
  async assignAdvisor(
    tenantId: string,
    firmUserId: string,
    actor: { userId: string },
    options?: { branchId?: string | null; departmentId?: string | null },
  ): Promise<MembershipEntity> {
    const existing = await this.memberships.findByTenantUser(tenantId, firmUserId);
    let membership: MembershipEntity;
    if (existing) {
      existing.roleKey = PARTNER_ADVISOR_ROLE;
      existing.customRoleId = null;
      existing.status = 'ACTIVE';
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

    this.access.invalidateUser(firmUserId);
    await this.audit.record({
      tenantId,
      actorUserId: actor.userId,
      action: 'member.assign_partner_advisor',
      resourceType: 'membership',
      resourceId: membership.id,
      metadata: { firmUserId, role: PARTNER_ADVISOR_ROLE },
    });
    return membership;
  }

  /**
   * Revoking the firm user ends all sessions across all client organisations within 60 s
   * and writes a security audit entry.
   */
  async revokeFirmUser(
    actorUserId: string,
    firmUserId: string,
    tenantIds: string[],
    reason = 'Firm user revoked across all client organisations',
  ): Promise<void> {
    const revokedAt = new Date().toISOString();

    for (const tenantId of tenantIds) {
      const membership = await this.memberships.findByTenantUser(tenantId, firmUserId);
      if (membership) {
        membership.status = 'SUSPENDED';
        await this.memberships.save(membership);
      }

      await this.audit.record({
        tenantId,
        actorUserId,
        action: 'security.firm_user_revoked',
        resourceType: 'membership',
        resourceId: membership?.id,
        metadata: {
          firmUserId,
          role: PARTNER_ADVISOR_ROLE,
          reason,
          revokedAt,
        },
      });
    }

    // Revoke all refresh token sessions across the system
    await this.refreshTokens.revokeAllForUser(firmUserId);

    // Invalidate in-process cache immediately (well within 60 s SLA)
    this.access.invalidateUser(firmUserId);
  }

  /**
   * Check whether a session is active for the given user.
   */
  async isSessionActive(sid: string, userId: string): Promise<boolean> {
    return this.access.isSessionActive(sid, userId);
  }
}
