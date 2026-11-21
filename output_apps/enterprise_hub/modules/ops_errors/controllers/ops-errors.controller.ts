import { Controller, ForbiddenException, Get, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../auth/enums/user-role.enum';
import { PLATFORM_OPS_TENANT_ID } from '../constants/ops-errors.constants';
import { ListOpsErrorsQueryDto, OpsErrorListResponseDto } from '../dto/list-ops-errors.dto';
import { OpsErrorsQueryService } from '../services/ops-errors-query.service';

interface VerifiedOpsRequest {
  access?: { tenantId?: string };
  user?: { tenantId?: string };
}

/** Platform operator only: recent error fingerprints. Read-only, tenant- or platform-scoped. */
@ApiTags('Ops errors')
@Roles(UserRole.ADMIN)
@Controller('enterprise-hub/ops/error-events')
export class OpsErrorsController {
  constructor(private readonly query: OpsErrorsQueryService) {}

  @Get()
  @ApiOperation({ summary: 'List recent error fingerprints (platform admin, read-only)' })
  @ApiOkResponse({ type: OpsErrorListResponseDto })
  list(
    @Req() req: VerifiedOpsRequest,
    @Query() dto: ListOpsErrorsQueryDto,
  ): Promise<OpsErrorListResponseDto> {
    const tenantId =
      dto.scope === 'platform'
        ? PLATFORM_OPS_TENANT_ID
        : req?.access?.tenantId ?? req?.user?.tenantId;
    if (!tenantId) {
      throw new ForbiddenException('Verified tenant context is required (or pass scope=platform)');
    }
    return this.query.list(tenantId, dto);
  }
}
