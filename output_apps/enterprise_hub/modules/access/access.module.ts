import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RefreshTokenEntity } from '../auth/entities/refresh-token.entity';
import { UserEntity } from '../auth/entities/user.entity';
import { AuthRepository } from '../auth/repositories/auth.repository';
import { RefreshTokenRepository } from '../auth/repositories/refresh-token.repository';
import { MailService } from '../auth/services/mail.service';
import { TenantsModule } from '../tenants/tenants.module';
import { AccessGuard } from './access.guard';
import { AuditInterceptor } from './audit.interceptor';
import { EntitlementsAdminController } from './controllers/entitlements-admin.controller';
import { InvitationsController } from './controllers/invitations.controller';
import { OrgController } from './controllers/org.controller';
import { AuditLogEntity } from './entities/audit-log.entity';
import { BranchEntity } from './entities/branch.entity';
import { CustomRoleEntity } from './entities/custom-role.entity';
import { DepartmentEntity } from './entities/department.entity';
import { EntitlementEntity } from './entities/entitlement.entity';
import { InvitationEntity } from './entities/invitation.entity';
import { ModuleRequestEntity } from './entities/module-request.entity';
import { MembershipEntity } from './entities/membership.entity';
import { ModuleRequestsRepository } from './repositories/module-requests.repository';
import { TenantScope } from './services/tenant-scope';
import { AuditRepository } from './repositories/audit.repository';
import { EntitlementsRepository } from './repositories/entitlements.repository';
import { InvitationsRepository } from './repositories/invitations.repository';
import { MembershipsRepository } from './repositories/memberships.repository';
import { RolesRepository } from './repositories/roles.repository';
import { SessionCheckRepository } from './repositories/session-check.repository';
import { StructureRepository } from './repositories/structure.repository';
import { AccessService } from './services/access.service';
import { AuditService } from './services/audit.service';
import { LedgerAuditService } from './services/ledger-audit.service';
import { EntitlementsService } from './services/entitlements.service';
import { InvitationsService } from './services/invitations.service';
import { MembersService } from './services/members.service';
import { OrganizationsService } from './services/organizations.service';
import { RolesService } from './services/roles.service';
import { StructureService } from './services/structure.service';
import { LoginWindowService } from './services/login-window.service';
import { CostMaskingService } from './services/cost-masking.service';
import { CostMaskingInterceptor } from './cost-masking.interceptor';
import { UserLoginScheduleEntity } from './entities/user-login-schedule.entity';
import { LoginSchedulesRepository } from './repositories/login-schedules.repository';

/**
 * Organisation access control. Sits below AuthModule (Auth imports this one;
 * this module never imports Auth), so there is no module cycle. It reads
 * `users` and `auth_refresh_tokens` only through the entities/repositories it
 * lists here.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      MembershipEntity, BranchEntity, DepartmentEntity, CustomRoleEntity, InvitationEntity,
      EntitlementEntity, AuditLogEntity, ModuleRequestEntity, RefreshTokenEntity, UserEntity,
      UserLoginScheduleEntity,
    ]),
    TenantsModule,
  ],
  controllers: [OrgController, InvitationsController, EntitlementsAdminController],
  providers: [
    MembershipsRepository, StructureRepository, RolesRepository, InvitationsRepository,
    EntitlementsRepository, ModuleRequestsRepository, TenantScope, AuditRepository, SessionCheckRepository, AuthRepository, RefreshTokenRepository, MailService,
    AccessService, AuditService, LedgerAuditService, MembersService, RolesService, StructureService,
    EntitlementsService, InvitationsService, OrganizationsService,
    LoginSchedulesRepository,
    LoginWindowService, CostMaskingService,
    AccessGuard, AuditInterceptor, CostMaskingInterceptor,
  ],
  exports: [
    AccessService, AuditService, LedgerAuditService, MembershipsRepository, OrganizationsService, InvitationsService,
    EntitlementsService, LoginSchedulesRepository, LoginWindowService, CostMaskingService, AccessGuard, AuditInterceptor, CostMaskingInterceptor,
  ],
})
export class AccessModule {}
