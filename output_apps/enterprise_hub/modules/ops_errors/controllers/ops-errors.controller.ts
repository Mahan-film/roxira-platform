import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../auth/enums/user-role.enum';
import { ListOpsErrorsQueryDto, OpsErrorListResponseDto } from '../dto/list-ops-errors.dto';
import { OpsErrorsQueryService } from '../services/ops-errors-query.service';

/** Platform operator only: recent error fingerprints. Read-only. */
@ApiTags('Ops errors')
@Roles(UserRole.ADMIN)
@Controller('enterprise-hub/ops/error-events')
export class OpsErrorsController {
  constructor(private readonly query: OpsErrorsQueryService) {}

  @Get()
  @ApiOperation({ summary: 'List recent error fingerprints (platform admin, read-only)' })
  @ApiOkResponse({ type: OpsErrorListResponseDto })
  list(@Query() dto: ListOpsErrorsQueryDto): Promise<OpsErrorListResponseDto> {
    return this.query.list(dto);
  }
}
