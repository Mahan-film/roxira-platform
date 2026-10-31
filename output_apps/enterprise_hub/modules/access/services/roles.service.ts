import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessContext } from '../access-context';
import { denied } from '../access-errors';
import { canGrant, isPermission, SYSTEM_ROLES } from '../catalogue';
import { CustomRoleEntity } from '../entities/custom-role.entity';
import { MembershipsRepository } from '../repositories/memberships.repository';
import { RolesRepository } from '../repositories/roles.repository';
import { AccessService } from './access.service';
import { AuditService } from './audit.service';

const isUniqueViolation = (e: unknown): boolean => (e as { code?: string })?.code === '23505';

@Injectable()
export class RolesService {
  constructor(
    private readonly roles: RolesRepository,
    private readonly memberships: MembershipsRepository,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  systemRoles() {
    return SYSTEM_ROLES.map((r) => ({ key: r.key, deprecated: !!r.deprecated, permissions: [...r.permissions] }));
  }

  list(ctx: AccessContext): Promise<CustomRoleEntity[]> {
    return this.roles.list(ctx.tenantId);
  }

  private validate(actor: AccessContext, permissions: string[]): string[] {
    const unique = [...new Set(permissions)];
    const bad = unique.filter((p) => !isPermission(p));
    if (bad.length) throw new BadRequestException(`Unknown permission: ${bad[0]}`);
    if (!canGrant(actor.permissions, unique)) {
      throw denied('FORBIDDEN_ACTION', 'A role cannot include permissions you do not hold yourself.');
    }
    return unique;
  }

  async create(actor: AccessContext, name: string, permissions: string[], request?: Parameters<AuditService['record']>[0]['request']): Promise<CustomRoleEntity> {
    const perms = this.validate(actor, permissions);
    try {
      const role = await this.roles.create({ tenantId: actor.tenantId, name: name.trim(), permissions: perms });
      await this.audit.record({ tenantId: actor.tenantId, actorUserId: actor.userId, action: 'role.create', resourceType: 'role', resourceId: role.id, metadata: { permissions: perms }, request });
      return role;
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('A role with this name already exists.');
      throw e;
    }
  }

  async update(actor: AccessContext, id: string, patch: { name?: string; permissions?: string[] }, request?: Parameters<AuditService['record']>[0]['request']): Promise<CustomRoleEntity> {
    const role = await this.roles.find(actor.tenantId, id);
    if (!role) throw new NotFoundException('Role not found.');
    if (patch.name !== undefined) role.name = patch.name.trim();
    if (patch.permissions !== undefined) role.permissions = this.validate(actor, patch.permissions);
    try {
      const saved = await this.roles.save(role);
      this.access.invalidateTenant(actor.tenantId);
      await this.audit.record({ tenantId: actor.tenantId, actorUserId: actor.userId, action: 'role.update', resourceType: 'role', resourceId: id, metadata: { permissions: saved.permissions }, request });
      return saved;
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('A role with this name already exists.');
      throw e;
    }
  }

  async remove(actor: AccessContext, id: string, request?: Parameters<AuditService['record']>[0]['request']): Promise<void> {
    const role = await this.roles.find(actor.tenantId, id);
    if (!role) throw new NotFoundException('Role not found.');
    if ((await this.memberships.countWithCustomRole(actor.tenantId, id)) > 0) {
      throw new ConflictException('Reassign the members of this role first.');
    }
    await this.roles.remove(actor.tenantId, id);
    await this.audit.record({ tenantId: actor.tenantId, actorUserId: actor.userId, action: 'role.delete', resourceType: 'role', resourceId: id, request });
  }
}
