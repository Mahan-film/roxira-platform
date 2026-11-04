import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { CreateFixedAssetDto, DepreciationRunDto } from '../dto/fixed-asset.dto';
import { FixedAssetService } from '../services/fixed-asset.service';

/** Fixed assets and monthly depreciation of the JWT tenant. */
@ApiTags('Accounting - دارایی‌های ثابت و استهلاک')
@ModuleAccess(AccessModule.ACCOUNTING)
@Controller('enterprise-hub/accounting/fixed-assets')
export class FixedAssetController {
  constructor(private readonly assets: FixedAssetService) {}

  @Get()
  @ApiOperation({ summary: 'فهرست دارایی‌های ثابت با ارزش دفتری' })
  @ApiResponse({ status: HttpStatus.OK })
  list(@Req() request: AuthenticatedRequest) {
    return this.assets.list(requireTenantId(request));
  }

  @RequireAction(AccessAction.CREATE)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ثبت دارایی ثابت' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'کد تکراری' })
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreateFixedAssetDto) {
    return this.assets.create(requireTenantId(request), String(request.user?.sub ?? 'unknown').slice(0, 64), dto);
  }

  @RequireAction(AccessAction.POST)
  @Post('depreciation-runs')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'ثبت سند استهلاک یک ماه شمسی',
    description: 'هر دارایی در هر ماه یک‌بار؛ ماه‌ها نباید جا بیفتند؛ دوره قفل‌شده رد می‌شود.',
  })
  @ApiResponse({ status: 423, description: 'دوره قفل است' })
  run(@Req() request: AuthenticatedRequest, @Body() dto: DepreciationRunDto) {
    return this.assets.runMonth(requireTenantId(request), dto);
  }
}
