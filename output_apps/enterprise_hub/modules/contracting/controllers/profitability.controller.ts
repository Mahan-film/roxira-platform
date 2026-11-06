import { Controller, Get, HttpStatus, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessModule } from '../../access/catalogue';
import { ModuleAccess } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { ProfitabilityQueryDto } from '../dto/profitability.dto';
import { ProfitabilityService } from '../services/profitability.service';

@ApiTags('Contracting - سودآوری پروژه')
@ModuleAccess(AccessModule.ACCOUNTING)
@Controller('enterprise-hub/contracting/reports')
export class ProfitabilityController {
  constructor(private readonly profitability: ProfitabilityService) {}

  @Get('profitability')
  @ApiOperation({ summary: 'سودآوری پروژه‌ها: بودجه، هزینه واقعی و مبلغ صورت‌حساب‌شده' })
  @ApiResponse({ status: HttpStatus.OK })
  report(@Req() request: AuthenticatedRequest, @Query() query: ProfitabilityQueryDto) {
    return this.profitability.report(requireTenantId(request), query);
  }
}
