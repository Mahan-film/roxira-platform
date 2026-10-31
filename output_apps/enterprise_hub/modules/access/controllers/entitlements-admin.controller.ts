import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../auth/enums/user-role.enum';
import { TenantsRepository } from '../../tenants/repositories/tenants.repository';
import { AccessRequest } from '../access-context';
import { SetEntitlementsDto } from '../dto/org.dto';
import { EntitlementsService } from '../services/entitlements.service';

/**
 * Platform-operator screen: which modules each customer organisation may use.
 * Restricted to the global ADMIN role (Roxira staff); tenant owners cannot
 * switch modules on for themselves. Carries no prices.
 */
@ApiTags('Admin - module entitlements')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('admin/entitlements')
export class EntitlementsAdminController {
  constructor(
    private readonly entitlements: EntitlementsService,
    private readonly tenants: TenantsRepository,
  ) {}

  @Get()
  async listTenants() {
    const rows = await this.tenants.listAll();
    return rows.map((t) => ({ id: t.id, name: t.name, slug: t.slug, isActive: t.isActive }));
  }

  @Get('requests/open')
  openRequests() {
    return this.entitlements.listOpenRequests();
  }

  @Get(':tenantId')
  get(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.entitlements.list(tenantId);
  }

  @Put(':tenantId')
  set(@Req() req: AccessRequest, @Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: SetEntitlementsDto) {
    return this.entitlements.setForTenant(req.user!.sub, tenantId, dto.changes, req);
  }
}
