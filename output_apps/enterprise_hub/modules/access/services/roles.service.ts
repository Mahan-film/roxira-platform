import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MoneyFormatError, minorToDecimal, parseMinor, toMinor } from '../../accounting/money';
import { AccessContext } from '../access-context';
import { denied } from '../access-errors';
import {
  ALL_SENSITIVE_FIELDS,
  DEFAULT_FIELD_VISIBILITY,
  RoleScopeType,
  SYSTEM_ROLES,
  SensitiveField,
  canGrant,
  canGrantFieldVisibility,
  isPermission,
  isRoleScopeType,
  isSensitiveField,
  resolveCustomRoleFieldVisibility,
} from '../catalogue';
import { CustomRoleEntity } from '../entities/custom-role.entity';
import {
  effectiveAmountLimits,
  effectiveFieldVisibility,
  effectiveScope,
} from '../policy-evaluator';
import { MembershipsRepository } from '../repositories/memberships.repository';
import { RolesRepository } from '../repositories/roles.repository';
import { AccessService } from './access.service';
import { AuditService } from './audit.service';

const isUniqueViolation = (e: unknown): boolean => (e as { code?: string })?.code === '23505';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CustomRoleOptions {
  scopeType?: RoleScopeType;
  scopeIds?: string[];
  amountLimits?: Record<string, string | number>;
  fieldVisibility?: Partial<Record<SensitiveField, boolean>>;
}

@Injectable()
export class RolesService {
  constructor(
    private readonly roles: RolesRepository,
    private readonly memberships: MembershipsRepository,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  systemRoles() {
    return SYSTEM_ROLES.map((r) => ({
      key: r.key,
      deprecated: !!r.deprecated,
      permissions: [...r.permissions],
      fieldVisibility: { ...(r?.fieldVisibility ?? DEFAULT_FIELD_VISIBILITY) },
    }));
  }

  list(ctx: AccessContext): Promise<CustomRoleEntity[]> {
    return this.roles.list(ctx.tenantId);
  }

  private validatePermissions(actor: AccessContext, permissions: string[]): string[] {
    const unique = [...new Set(permissions)];
    const bad = unique.filter((p) => !isPermission(p));
    if (bad.length) throw new BadRequestException(`Unknown permission: ${bad[0]}`);
    if (!canGrant(actor.permissions, unique)) {
      throw denied('FORBIDDEN_ACTION', 'A role cannot include permissions you do not hold yourself.');
    }
    return unique;
  }

  private validateScope(
    actor: AccessContext,
    scopeType: RoleScopeType = 'org',
    scopeIds: string[] = [],
  ): { scopeType: RoleScopeType; scopeIds: string[] } {
    if (!isRoleScopeType(scopeType)) {
      throw new BadRequestException(`Unknown role scope type: ${String(scopeType)}`);
    }
    const uniqueIds = [...new Set(scopeIds)];
    for (const id of uniqueIds) {
      if (!UUID_RE.test(id)) {
        throw new BadRequestException(`Invalid scope UUID: ${id}`);
      }
    }
    if (scopeType === 'org' && uniqueIds.length > 0) {
      throw new BadRequestException('An org-wide role must not specify branch or warehouse scopeIds.');
    }
    if (scopeType !== 'org' && uniqueIds.length === 0) {
      throw new BadRequestException(`A ${scopeType}-scoped role must list at least one ${scopeType} id.`);
    }

    const actorScope = effectiveScope(actor);
    if (actorScope.type !== 'org') {
      if (scopeType !== actorScope.type) {
        throw denied('FORBIDDEN_SCOPE', 'You cannot create or update a role with a wider scope than your own.');
      }
      const outside = uniqueIds.filter((id) => !actorScope.ids.includes(id));
      if (outside.length > 0) {
        throw denied('FORBIDDEN_SCOPE', 'A role cannot include scope ids outside your own scope.');
      }
    }
    return { scopeType, scopeIds: uniqueIds };
  }

  private validateAmountLimits(
    actor: AccessContext,
    rawLimits?: Record<string, string | number>,
  ): Record<string, string> {
    const normalized: Record<string, string> = {};
    if (rawLimits) {
      for (const [key, rawValue] of Object.entries(rawLimits)) {
        if (key !== '*' && !isPermission(key)) {
          throw new BadRequestException(`Unknown permission in amountLimits: ${key}`);
        }
        let minor: bigint;
        try {
          minor = toMinor(rawValue);
        } catch (err) {
          if (err instanceof MoneyFormatError) {
            throw new BadRequestException(err.message);
          }
          throw err;
        }
        if (minor < 0n) {
          throw new BadRequestException(`Amount limit for ${key} cannot be negative.`);
        }
        normalized[key] = minorToDecimal(minor);
      }
    }

    const actorLimits = effectiveAmountLimits(actor);
    for (const [actorKey, actorLimitStr] of Object.entries(actorLimits)) {
      if (!actorLimitStr) continue;
      const actorMax = parseMinor(actorLimitStr);
      const targetStr = normalized[actorKey] ?? normalized['*'];
      if (!targetStr || parseMinor(targetStr) > actorMax) {
        throw denied(
          'AMOUNT_LIMIT_EXCEEDED',
          `A role cannot omit or exceed your own amount limit on ${actorKey}.`,
        );
      }
    }
    return normalized;
  }

  private validateFieldVisibility(
    actor: AccessContext,
    rawVisibility?: Partial<Record<SensitiveField, boolean>>,
  ): Record<SensitiveField, boolean> {
    if (rawVisibility) {
      for (const [k, v] of Object.entries(rawVisibility)) {
        if (!isSensitiveField(k)) {
          throw new BadRequestException(`Unknown sensitive field: ${k}`);
        }
        if (typeof v !== 'boolean') {
          throw new BadRequestException(`Field visibility for ${k} must be boolean.`);
        }
      }
    }
    const actorVisibility = effectiveFieldVisibility(actor);
    if (!canGrantFieldVisibility(actorVisibility, rawVisibility)) {
      throw denied(
        'FORBIDDEN_FIELD',
        'A role cannot grant visibility to a sensitive field that you cannot view yourself.',
      );
    }
    const resolved = resolveCustomRoleFieldVisibility(rawVisibility);
    return {
      cost: resolved.cost,
      margin: resolved.margin,
      salary: resolved.salary,
    };
  }

  async create(
    actor: AccessContext,
    name: string,
    permissions: string[],
    request?: Parameters<AuditService['record']>[0]['request'],
    options: CustomRoleOptions = {},
  ): Promise<CustomRoleEntity> {
    const perms = this.validatePermissions(actor, permissions);
    const { scopeType, scopeIds } = this.validateScope(actor, options.scopeType ?? 'org', options.scopeIds ?? []);
    const amountLimits = this.validateAmountLimits(actor, options.amountLimits);
    const fieldVisibility = this.validateFieldVisibility(actor, options.fieldVisibility);
    try {
      const role = await this.roles.create({
        tenantId: actor.tenantId,
        name: name.trim(),
        permissions: perms,
        scopeType,
        scopeIds,
        amountLimits,
        fieldVisibility,
      });
      await this.audit.record({
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: 'role.create',
        resourceType: 'role',
        resourceId: role.id,
        metadata: {
          permissions: perms,
          scopeType,
          scopeIds,
          amountLimits,
          fieldVisibility,
        },
        request,
      });
      return role;
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('A role with this name already exists.');
      throw e;
    }
  }

  async update(
    actor: AccessContext,
    id: string,
    patch: {
      name?: string;
      permissions?: string[];
      scopeType?: RoleScopeType;
      scopeIds?: string[];
      amountLimits?: Record<string, string | number>;
      fieldVisibility?: Partial<Record<SensitiveField, boolean>>;
    },
    request?: Parameters<AuditService['record']>[0]['request'],
  ): Promise<CustomRoleEntity> {
    const role = await this.roles.find(actor.tenantId, id);
    if (!role) throw new NotFoundException('Role not found.');
    if (patch.name !== undefined) role.name = patch.name.trim();
    if (patch.permissions !== undefined) role.permissions = this.validatePermissions(actor, patch.permissions);
    if (patch.scopeType !== undefined || patch.scopeIds !== undefined) {
      const nextScope = this.validateScope(
        actor,
        patch.scopeType ?? role.scopeType ?? 'org',
        patch.scopeIds ?? role.scopeIds ?? [],
      );
      role.scopeType = nextScope.scopeType;
      role.scopeIds = nextScope.scopeIds;
    }
    if (patch.amountLimits !== undefined) {
      role.amountLimits = this.validateAmountLimits(actor, patch.amountLimits);
    }
    if (patch.fieldVisibility !== undefined) {
      const merged: Partial<Record<SensitiveField, boolean>> = {
        ...(role?.fieldVisibility ?? DEFAULT_FIELD_VISIBILITY),
        ...patch.fieldVisibility,
      };
      for (const f of ALL_SENSITIVE_FIELDS) {
        if (merged[f] === undefined) merged[f] = false;
      }
      role.fieldVisibility = this.validateFieldVisibility(actor, merged);
    }
    try {
      const saved = await this.roles.save(role);
      this.access.invalidateTenant(actor.tenantId);
      await this.audit.record({
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: 'role.update',
        resourceType: 'role',
        resourceId: id,
        metadata: {
          permissions: saved.permissions,
          scopeType: saved.scopeType,
          scopeIds: saved.scopeIds,
          amountLimits: saved.amountLimits,
          fieldVisibility: saved.fieldVisibility,
        },
        request,
      });
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
