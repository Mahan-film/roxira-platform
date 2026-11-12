import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessContext } from '../access-context';
import { denied } from '../access-errors';
import { canGrant, isSystemRole, SystemRole, systemRolePermissions } from '../catalogue';
import { AuthRepository } from '../../auth/repositories/auth.repository';
import { RefreshTokenRepository } from '../../auth/repositories/refresh-token.repository';
import { UserEntity } from '../../auth/entities/user.entity';
import { AuthServiceDomain } from '../../auth/enums/auth-service.enum';
import { isBreachedPassword } from '../../auth/utils/breach-check.util';
import { isUsername, normalizeUsername, passwordPolicyViolation } from '../../auth/utils/identifier.util';
import { hashPassword } from '../../auth/utils/password-hasher.util';
import { TenantRole } from '../../tenants/enums/tenant-role.enum';
import { MembershipEntity } from '../entities/membership.entity';
import { MembershipsRepository, MembershipWithUser } from '../repositories/memberships.repository';
import { RolesRepository } from '../repositories/roles.repository';
import { StructureRepository } from '../repositories/structure.repository';
import { AccessService } from './access.service';
import { AuditService } from './audit.service';

export interface MemberPatch {
  roleKey?: string;
  customRoleId?: string | null;
  branchId?: string | null;
  departmentId?: string | null;
  branchScoped?: boolean;
  status?: 'ACTIVE' | 'SUSPENDED';
}

export interface ManagedMemberInput {
  username: string;
  password: string;
  displayName?: string;
  roleKey: string;
  customRoleId?: string;
  branchId?: string;
  departmentId?: string;
  branchScoped?: boolean;
}

const USERNAME_TAKEN = 'This username is taken; choose another one.';

/** Member management for one organisation. Callers pass the verified AccessContext, never a client tenant id. */
@Injectable()
export class MembersService {
  constructor(
    private readonly memberships: MembershipsRepository,
    private readonly roles: RolesRepository,
    private readonly structure: StructureRepository,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly users: AuthRepository,
    private readonly refreshTokens: RefreshTokenRepository,
  ) {}

  list(ctx: AccessContext): Promise<MembershipWithUser[]> {
    return this.memberships.listByTenant(ctx.tenantId);
  }

  /**
   * Validate a role choice for `actor`: the role must exist in this tenant, must
   * not give the actor-created member more than the actor holds, and only an
   * owner may hand out `owner`.
   */
  async resolveRoleGrant(
    actor: AccessContext,
    roleKey: string,
    customRoleId?: string | null,
  ): Promise<{ roleKey: string; customRoleId: string | null }> {
    if (roleKey === 'custom') {
      if (!customRoleId) throw new BadRequestException('customRoleId is required for a custom role.');
      const role = await this.roles.find(actor.tenantId, customRoleId);
      if (!role) throw new NotFoundException('Role not found.');
      if (!canGrant(actor.permissions, role.permissions)) {
        throw denied('FORBIDDEN_ACTION', 'You cannot assign a role with permissions you do not have.');
      }
      return { roleKey: 'custom', customRoleId: role.id };
    }
    if (!isSystemRole(roleKey)) throw new BadRequestException('Unknown role.');
    if (roleKey === SystemRole.LEGACY_MEMBER) throw new BadRequestException('This role is no longer assignable.');
    if (roleKey === SystemRole.OWNER && actor.roleKey !== SystemRole.OWNER) {
      throw denied('FORBIDDEN_ACTION', 'Only an owner can assign the owner role.');
    }
    if (!canGrant(actor.permissions, systemRolePermissions(roleKey))) {
      throw denied('FORBIDDEN_ACTION', 'You cannot assign a role with permissions you do not have.');
    }
    return { roleKey, customRoleId: null };
  }

  async assertPlacement(tenantId: string, branchId?: string | null, departmentId?: string | null): Promise<void> {
    if (branchId && !(await this.structure.findBranch(tenantId, branchId))) {
      throw new BadRequestException('Branch does not belong to this organisation.');
    }
    if (departmentId && !(await this.structure.findDepartment(tenantId, departmentId))) {
      throw new BadRequestException('Department does not belong to this organisation.');
    }
  }

  private async assertPassword(password: string, username: string): Promise<void> {
    const violation = passwordPolicyViolation(password, [username]);
    if (violation) throw new BadRequestException(violation);
    if (await isBreachedPassword(password)) throw new BadRequestException('This password has appeared in a data breach; choose another one.');
  }

  /**
   * Create a staff account directly: the actor picks the username and password and
   * hands them over. Usernames are unique across Roxira, so two organisations cannot
   * both use the same one. The role goes through the same no-escalation check as invitations.
   */
  async createManaged(actor: AccessContext, input: ManagedMemberInput, request?: Parameters<AuditService['record']>[0]['request']): Promise<{ id: string; userId: string; username: string }> {
    const username = normalizeUsername(input.username);
    if (!isUsername(username)) throw new BadRequestException('Username format is not valid.');
    const grant = await this.resolveRoleGrant(actor, input.roleKey, input.customRoleId);
    await this.assertPlacement(actor.tenantId, input.branchId, input.departmentId);
    if (input.branchScoped && !input.branchId) throw new BadRequestException('A branch-scoped member needs a branch.');
    await this.assertPassword(input.password, username);
    if (await this.users.findByUsername(username)) throw new ConflictException(USERNAME_TAKEN);

    let user: UserEntity;
    try {
      user = await this.users.create({
        phone: null,
        username,
        displayName: input.displayName || null,
        passwordHash: await hashPassword(input.password),
        passwordUpdatedAt: new Date(),
        serviceDomain: AuthServiceDomain.ROXIRA,
        managedByTenantId: actor.tenantId,
        tenantId: actor.tenantId,
        tenantRole: TenantRole.MEMBER,
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException(USERNAME_TAKEN);
      throw error;
    }
    const member = await this.memberships.create({
      tenantId: actor.tenantId,
      userId: user.id,
      roleKey: grant.roleKey,
      customRoleId: grant.customRoleId,
      branchId: input.branchId ?? null,
      departmentId: input.departmentId ?? null,
      branchScoped: input.branchScoped ?? false,
      status: 'ACTIVE',
      invitedBy: actor.userId,
    });
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: 'member.create_managed',
      resourceType: 'membership',
      resourceId: member.id,
      metadata: { role: grant.roleKey, username },
      request,
    });
    return { id: member.id, userId: user.id, username };
  }

  /** Only accounts this organisation created can be reset; a self-registered member keeps sole control of their password. */
  async resetManagedPassword(actor: AccessContext, membershipId: string, password: string, request?: Parameters<AuditService['record']>[0]['request']): Promise<void> {
    const target = await this.memberships.findById(actor.tenantId, membershipId);
    if (!target) throw new NotFoundException('Member not found.');
    const user = await this.users.findById(target.userId, { callerTenantId: actor.tenantId });
    if (!user || user.managedByTenantId !== actor.tenantId) {
      throw denied('FORBIDDEN_ACTION', 'This person manages their own password.');
    }
    await this.assertPassword(password, user.username ?? '');
    await this.users.updatePassword(user.id, await hashPassword(password));
    await this.refreshTokens.revokeAllForUser(user.id);
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: 'member.reset_password',
      resourceType: 'membership',
      resourceId: membershipId,
      request,
    });
  }

  async update(actor: AccessContext, membershipId: string, patch: MemberPatch, request?: Parameters<AuditService['record']>[0]['request']): Promise<MembershipEntity> {
    const target = await this.memberships.findById(actor.tenantId, membershipId);
    if (!target) throw new NotFoundException('Member not found.');
    if (target.roleKey === SystemRole.OWNER && actor.roleKey !== SystemRole.OWNER) {
      throw denied('FORBIDDEN_ACTION', 'Only an owner can change an owner.');
    }
    const before = { role: target.roleKey, status: target.status, branchId: target.branchId };

    if (patch.roleKey !== undefined) {
      const grant = await this.resolveRoleGrant(actor, patch.roleKey, patch.customRoleId);
      target.roleKey = grant.roleKey;
      target.customRoleId = grant.customRoleId;
    }
    if (patch.branchId !== undefined || patch.departmentId !== undefined) {
      await this.assertPlacement(actor.tenantId, patch.branchId, patch.departmentId);
      if (patch.branchId !== undefined) target.branchId = patch.branchId;
      if (patch.departmentId !== undefined) target.departmentId = patch.departmentId;
    }
    if (patch.branchScoped !== undefined) target.branchScoped = patch.branchScoped;
    if (patch.status !== undefined) target.status = patch.status;
    if (target.branchScoped && !target.branchId) {
      throw new BadRequestException('A branch-scoped member needs a branch.');
    }

    const losesOwner =
      before.role === SystemRole.OWNER && (target.roleKey !== SystemRole.OWNER || target.status !== 'ACTIVE');
    if (losesOwner && (await this.memberships.countActiveOwners(actor.tenantId)) <= 1) {
      throw new ConflictException('The organisation must keep at least one active owner.');
    }

    const saved = await this.memberships.save(target);
    this.access.invalidateUser(target.userId);
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: 'member.update',
      resourceType: 'membership',
      resourceId: saved.id,
      metadata: { before, after: { role: saved.roleKey, status: saved.status, branchId: saved.branchId } },
      request,
    });
    return saved;
  }

  async remove(actor: AccessContext, membershipId: string, request?: Parameters<AuditService['record']>[0]['request']): Promise<void> {
    const target = await this.memberships.findById(actor.tenantId, membershipId);
    if (!target) throw new NotFoundException('Member not found.');
    if (target.roleKey === SystemRole.OWNER) {
      if (actor.roleKey !== SystemRole.OWNER) throw denied('FORBIDDEN_ACTION', 'Only an owner can remove an owner.');
      if ((await this.memberships.countActiveOwners(actor.tenantId)) <= 1) {
        throw new ConflictException('The organisation must keep at least one active owner.');
      }
    }
    await this.memberships.remove(actor.tenantId, membershipId);
    this.access.invalidateUser(target.userId);
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: 'member.remove',
      resourceType: 'membership',
      resourceId: membershipId,
      metadata: { role: target.roleKey, self: target.userId === actor.userId },
      request,
    });
  }
}
