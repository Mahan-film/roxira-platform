import {
  BadRequestException,
  Body, Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessRequest, requireAccess } from '../access-context';
import {
  ALL_ACTIONS,
  ALL_ROLE_SCOPE_TYPES,
  ALL_SENSITIVE_FIELDS,
  AccessAction,
  AccessModule,
  SYSTEM_ROLES,
  SystemRole,
} from '../catalogue';
import { AnyMember, AuthOnly, ModuleAccess, RequireAction } from '../decorators';
import {
  AuditQueryDto, CreateBranchDto, CreateDepartmentDto, CreateInvitationDto, CreateManagedMemberDto, CreateOrganizationDto,
  CreateRoleDto, RequestModuleDto, ResetManagedPasswordDto, UpdateBranchDto, UpdateMemberDto, UpdateRoleDto, UpdateSecurityPolicyDto,
} from '../dto/org.dto';
import {
  effectiveAmountLimits,
  effectiveFieldVisibility,
  effectiveScope,
} from '../policy-evaluator';
import { AccessService } from '../services/access.service';
import { AuditService } from '../services/audit.service';
import { EntitlementsService } from '../services/entitlements.service';
import { InvitationsService } from '../services/invitations.service';
import { MembersService } from '../services/members.service';
import { OrganizationsService } from '../services/organizations.service';
import { RolesService } from '../services/roles.service';
import { StructureService } from '../services/structure.service';
import { LoginWindowService } from '../services/login-window.service';
import { SetLoginScheduleDto } from '../dto/login-schedule.dto';

/**
 * Organisation administration: members, invitations, roles, structure, security
 * policy, entitlements (read-only here) and the audit log. All routes are scoped
 * to the organisation the AccessGuard verified; no tenant id is ever read from
 * the request.
 */
@ApiTags('Org - organisation access control')
@ApiBearerAuth()
@ModuleAccess(AccessModule.MEMBERS)
@Controller('org')
export class OrgController {
  constructor(
    private readonly access: AccessService,
    private readonly members: MembersService,
    private readonly invitations: InvitationsService,
    private readonly roles: RolesService,
    private readonly structure: StructureService,
    private readonly orgs: OrganizationsService,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
    private readonly loginWindow: LoginWindowService,
  ) {}

  // ---------------------------------------------------------------- self

  @AuthOnly()
  @Get('me')
  @ApiOperation({ summary: 'My access in the active organisation (for hiding UI; the server still decides)' })
  async me(@Req() req: AccessRequest) {
    const user = req.user;
    const ctx = user?.tenantId && user.sub ? await this.access.resolve(user.sub, user.tenantId) : null;
    if (!ctx) return { organization: null };
    return {
      organization: {
        tenantId: ctx.tenantId,
        roleKey: ctx.roleKey,
        customRoleId: ctx.customRoleId ?? null,
        permissions: [...ctx.permissions],
        entitledModules: [...ctx.entitledModules],
        branchId: ctx.branchId,
        branchScoped: ctx.branchScoped,
        require2fa: ctx.require2fa,
        mfa: user?.mfa === true,
        scope: effectiveScope(ctx),
        amountLimits: effectiveAmountLimits(ctx),
        fieldVisibility: effectiveFieldVisibility(ctx),
      },
    };
  }

  @AuthOnly()
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an organisation; the caller becomes its owner' })
  create(@Req() req: AccessRequest, @Body() dto: CreateOrganizationDto) {
    return this.orgs.create(req.user!.sub, dto.name, req);
  }

  // ------------------------------------------------------------- members

  @Get('members')
  listMembers(@Req() req: AccessRequest) {
    return this.members.list(requireAccess(req));
  }

  @RequireAction(AccessAction.ADMIN)
  @Post('members')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a staff account with a username and password in this organisation' })
  createManagedMember(@Req() req: AccessRequest, @Body() dto: CreateManagedMemberDto) {
    return this.members.createManaged(requireAccess(req), dto, req);
  }

  @RequireAction(AccessAction.ADMIN)
  @Post('members/:id/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Set a new password for a staff account this organisation created' })
  resetManagedPassword(@Req() req: AccessRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResetManagedPasswordDto) {
    return this.members.resetManagedPassword(requireAccess(req), id, dto.password, req);
  }

  @RequireAction(AccessAction.ADMIN)
  @Patch('members/:id')
  updateMember(@Req() req: AccessRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMemberDto) {
    return this.members.update(requireAccess(req), id, dto, req);
  }

  @RequireAction(AccessAction.ADMIN)
  @Delete('members/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(@Req() req: AccessRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.members.remove(requireAccess(req), id, req);
  }

  @Get('members/:userId/login-schedule')
  @ApiOperation({ summary: 'Get allowed login time window schedule for a member' })
  async getLoginSchedule(
    @Req() req: AccessRequest,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    const ctx = requireAccess(req);
    return this.loginWindow.findByTenantUser(ctx.tenantId, userId);
  }

  @RequireAction(AccessAction.ADMIN)
  @Put('members/:userId/login-schedule')
  @ApiOperation({ summary: 'Update allowed login time window schedule for a member' })
  async setLoginSchedule(
    @Req() req: AccessRequest,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SetLoginScheduleDto,
  ) {
    const ctx = requireAccess(req);
    const members = await this.members.list(ctx);
    const targetMember = members.find((m) => m.userId === userId);
    if (!targetMember) {
      throw new NotFoundException('عضو مورد نظر در این سازمان یافت نشد.');
    }

    const existing = await this.loginWindow.findByTenantUser(ctx.tenantId, userId);
    const effectiveEnforce = dto.enforceSchedule ?? existing?.enforceSchedule ?? true;
    if (effectiveEnforce) {
      const isCaller = userId === ctx.userId;
      const isOwner = targetMember.roleKey === SystemRole.OWNER;
      if (isCaller || isOwner) {
        const check = this.loginWindow.checkLoginWindow(
          {
            timezone: dto.timezone ?? existing?.timezone ?? 'Asia/Tehran',
            enforceSchedule: true,
            windows: dto.windows ?? existing?.windows ?? [],
          },
          new Date(),
        );
        if (!check.allowed) {
          throw new BadRequestException('امکان تنظیم برنامه‌ای که دسترسی مدیر/مالک یا خود شما را در زمان فعلی مسدود کند وجود ندارد.');
        }
      }
    }

    return this.loginWindow.saveSchedule(ctx.tenantId, userId, dto);
  }

  // --------------------------------------------------------- invitations

  @Get('invitations')
  listInvitations(@Req() req: AccessRequest) {
    return this.invitations.listPending(requireAccess(req));
  }

  @RequireAction(AccessAction.ADMIN)
  @Post('invitations')
  @HttpCode(HttpStatus.CREATED)
  invite(@Req() req: AccessRequest, @Body() dto: CreateInvitationDto) {
    return this.invitations.create(requireAccess(req), dto, req);
  }

  @RequireAction(AccessAction.ADMIN)
  @Delete('invitations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeInvitation(@Req() req: AccessRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.invitations.revoke(requireAccess(req), id, req);
  }

  // --------------------------------------------------------------- roles

  @Get('roles')
  async listRoles(@Req() req: AccessRequest) {
    const ctx = requireAccess(req);
    return {
      system: this.roles.systemRoles(),
      custom: await this.roles.list(ctx),
      catalogue: {
        modules: Object.values(AccessModule),
        actions: ALL_ACTIONS,
        scopeTypes: ALL_ROLE_SCOPE_TYPES,
        sensitiveFields: ALL_SENSITIVE_FIELDS,
      },
    };
  }

  @RequireAction(AccessAction.ADMIN)
  @Post('roles')
  @HttpCode(HttpStatus.CREATED)
  createRole(@Req() req: AccessRequest, @Body() dto: CreateRoleDto) {
    return this.roles.create(requireAccess(req), dto.name, dto.permissions, req, {
      scopeType: dto.scopeType,
      scopeIds: dto.scopeIds,
      amountLimits: dto.amountLimits,
      fieldVisibility: dto.fieldVisibility,
    });
  }

  @RequireAction(AccessAction.ADMIN)
  @Patch('roles/:id')
  updateRole(@Req() req: AccessRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto) {
    return this.roles.update(requireAccess(req), id, dto, req);
  }

  @RequireAction(AccessAction.ADMIN)
  @Delete('roles/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteRole(@Req() req: AccessRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.roles.remove(requireAccess(req), id, req);
  }

  // ----------------------------------------------------------- structure

  @Get('branches')
  listBranches(@Req() req: AccessRequest) {
    return this.structure.listBranches(requireAccess(req));
  }

  @RequireAction(AccessAction.ADMIN)
  @Post('branches')
  @HttpCode(HttpStatus.CREATED)
  createBranch(@Req() req: AccessRequest, @Body() dto: CreateBranchDto) {
    return this.structure.createBranch(requireAccess(req), dto, req);
  }

  @RequireAction(AccessAction.ADMIN)
  @Patch('branches/:id')
  updateBranch(@Req() req: AccessRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBranchDto) {
    return this.structure.updateBranch(requireAccess(req), id, dto, req);
  }

  @RequireAction(AccessAction.ADMIN)
  @Delete('branches/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteBranch(@Req() req: AccessRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.structure.deleteBranch(requireAccess(req), id, req);
  }

  @Get('departments')
  listDepartments(@Req() req: AccessRequest) {
    return this.structure.listDepartments(requireAccess(req));
  }

  @RequireAction(AccessAction.ADMIN)
  @Post('departments')
  @HttpCode(HttpStatus.CREATED)
  createDepartment(@Req() req: AccessRequest, @Body() dto: CreateDepartmentDto) {
    return this.structure.createDepartment(requireAccess(req), dto, req);
  }

  @RequireAction(AccessAction.ADMIN)
  @Delete('departments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteDepartment(@Req() req: AccessRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.structure.deleteDepartment(requireAccess(req), id, req);
  }

  // -------------------------------------------------------- entitlements

  @AnyMember()
  @Get('module-catalogue')
  @ApiOperation({ summary: 'Add-modules page: every module, its state, its dependencies and any open request' })
  moduleCatalogue(@Req() req: AccessRequest) {
    return this.entitlements.catalogue(requireAccess(req).tenantId);
  }

  @RequireAction(AccessAction.ADMIN)
  @Post('module-requests')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Ask Roxira to enable a module (no purchase happens here)' })
  requestModule(@Req() req: AccessRequest, @Body() dto: RequestModuleDto) {
    return this.entitlements.request(requireAccess(req), dto.module, req);
  }

  @Get('entitlements')
  @ApiOperation({ summary: 'Modules enabled for this organisation (read-only; changed by Roxira)' })
  listEntitlements(@Req() req: AccessRequest) {
    return this.entitlements.list(requireAccess(req).tenantId);
  }

  // ------------------------------------------------------------ security

  @ModuleAccess(AccessModule.SECURITY)
  @Get('security')
  getSecurity(@Req() req: AccessRequest) {
    return this.orgs.getSecurity(requireAccess(req));
  }

  @ModuleAccess(AccessModule.SECURITY)
  @RequireAction(AccessAction.ADMIN)
  @Patch('security')
  setSecurity(@Req() req: AccessRequest, @Body() dto: UpdateSecurityPolicyDto) {
    return this.orgs.setRequire2fa(requireAccess(req), dto.require2fa, req.user?.mfa === true, req);
  }

  // --------------------------------------------------------------- audit

  @ModuleAccess(AccessModule.AUDIT)
  @Get('audit')
  @ApiOperation({ summary: 'Immutable audit log of this organisation, newest first' })
  async auditLog(@Req() req: AccessRequest, @Query() q: AuditQueryDto) {
    const ctx = requireAccess(req);
    const rows = await this.audit.list(ctx.tenantId, {
      limit: q.limit ?? 50,
      beforeId: q.before && /^\d+$/.test(q.before) ? q.before : undefined,
      action: q.action,
      actorUserId: q.actor,
    });
    return { items: rows, nextBefore: rows.length ? rows[rows.length - 1].id : null };
  }

  @ModuleAccess(AccessModule.AUDIT)
  @Get('audit/verify')
  @ApiOperation({ summary: 'Check the audit log hash chain; reports the first row that does not match' })
  verifyAudit(@Req() req: AccessRequest) {
    return this.audit.verify(requireAccess(req).tenantId);
  }
}

export const SYSTEM_ROLE_KEYS = SYSTEM_ROLES.map((r) => r.key);
