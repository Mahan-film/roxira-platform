import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Put, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { SetStatutoryParameterDto, StatutoryParameterResponseDto, StatutoryYearQueryDto } from './statutory.dto';
import { StatutoryService } from './statutory.service';

/**
 * Statutory parameters. Reading follows `hr:read`; changing a value is `hr:admin`, which only the
 * owner and admin roles hold. The tenant and the actor come from the verified JWT only.
 */
@ApiTags('HR - پارامترهای قانونی')
@ModuleAccess(AccessModule.HR)
@Controller('enterprise-hub/hr/statutory-parameters')
export class StatutoryController {
  constructor(private readonly statutory: StatutoryService) {}

  @Get(':year')
  @ApiOperation({ summary: 'مقادیر جاری یک سال با منبع و وضعیت تأیید' })
  @ApiResponse({ status: HttpStatus.OK, type: [StatutoryParameterResponseDto] })
  list(
    @Req() request: AuthenticatedRequest,
    @Param('year', ParseIntPipe) year: number,
    @Query() query: StatutoryYearQueryDto,
  ): Promise<StatutoryParameterResponseDto[]> {
    return this.statutory.list(requireTenantId(request), year, query.month);
  }

  @Get(':year/:key/history')
  @ApiOperation({ summary: 'همه نسخه‌های یک مقدار' })
  history(
    @Req() request: AuthenticatedRequest,
    @Param('year', ParseIntPipe) year: number,
    @Param('key') key: string,
  ) {
    return this.statutory.history(requireTenantId(request), year, key);
  }

  @RequireAction(AccessAction.ADMIN)
  @Put()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ثبت نسخه جدید یک مقدار قانونی برای این سازمان' })
  @ApiResponse({ status: HttpStatus.OK, type: [StatutoryParameterResponseDto] })
  set(
    @Req() request: AuthenticatedRequest,
    @Body() dto: SetStatutoryParameterDto,
  ): Promise<StatutoryParameterResponseDto[]> {
    return this.statutory.setValue(requireTenantId(request), request.user?.sub ?? 'unknown', dto);
  }
}
