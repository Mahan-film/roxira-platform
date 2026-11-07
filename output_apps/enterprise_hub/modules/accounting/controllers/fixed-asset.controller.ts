import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { assetRegisterTable, depreciationScheduleTable } from '../assets/asset-register';
import { CreateFixedAssetDto, DepreciationRunDto, DisposeFixedAssetDto, FixedAssetReportQueryDto } from '../dto/fixed-asset.dto';
import { jalali } from '../reports/report-tables';
import { FixedAssetService } from '../services/fixed-asset.service';
import { moneyJson } from '../services/financial-reports.service';
import { ReportExportService } from '../services/report-export.service';

/** Fixed assets and monthly depreciation of the JWT tenant. */
@ApiTags('Accounting - دارایی‌های ثابت و استهلاک')
@ModuleAccess(AccessModule.ACCOUNTING)
@Controller('enterprise-hub/accounting/fixed-assets')
export class FixedAssetController {
  constructor(
    private readonly assets: FixedAssetService,
    private readonly exporter: ReportExportService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'فهرست دارایی‌های ثابت با ارزش دفتری' })
  @ApiResponse({ status: HttpStatus.OK })
  list(@Req() request: AuthenticatedRequest) {
    return this.assets.list(requireTenantId(request));
  }

  @Get('register')
  @ApiOperation({ summary: 'دفتر دارایی‌های ثابت: بها، استهلاک انباشته و ارزش دفتری (JSON، یا فایل با format)' })
  @ApiResponse({ status: HttpStatus.OK })
  async register(
    @Req() request: AuthenticatedRequest,
    @Query() query: FixedAssetReportQueryDto,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void },
  ) {
    const result = await this.assets.register(requireTenantId(request));
    if (!query.format) {
      return moneyJson(result);
    }
    return this.exporter.download(
      await this.exporter.render(assetRegisterTable(result, jalali), query.format, 'fixed-asset-register'),
      response,
    );
  }

  @Get(':code/schedule')
  @ApiOperation({ summary: 'جدول استهلاک ماهانهٔ یک دارایی (JSON، یا فایل با format)' })
  @ApiResponse({ status: HttpStatus.OK })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'دارایی یافت نشد' })
  async schedule(
    @Req() request: AuthenticatedRequest,
    @Param('code') code: string,
    @Query() query: FixedAssetReportQueryDto,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void },
  ) {
    const result = await this.assets.schedule(requireTenantId(request), code);
    if (!query.format) {
      return moneyJson(result);
    }
    return this.exporter.download(
      await this.exporter.render(depreciationScheduleTable(result, jalali), query.format, `depreciation-schedule-${code}`),
      response,
    );
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

  @RequireAction(AccessAction.POST)
  @Post(':id/dispose')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'فروش دارایی ثابت',
    description:
      'بهای تمام‌شده، استهلاک انباشته سندهای ثبت‌شده و عواید فروش در یک سند تراز ثبت می‌شود؛ سود یا زیان فروش خودکار محاسبه می‌شود.',
  })
  @ApiResponse({ status: HttpStatus.OK })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'دارایی قبلاً فروش رفته است' })
  @ApiResponse({ status: 423, description: 'دوره قفل است یا سال مالی بسته است' })
  dispose(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: DisposeFixedAssetDto) {
    return this.assets.dispose(requireTenantId(request), id, dto);
  }
}
