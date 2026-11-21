import { Body, Controller, Get, Post, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest, JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import {
  TenantExportService,
  TenantGoBDZ3Archive,
  TenantJsonArchive,
  TenantTabularExport,
} from '../services/tenant-export.service';
import { TenantRestoreResult, TenantRestoreService } from '../services/tenant-restore.service';

/**
 * Controller for tenant data export and restore (#230 / T77 / #1057 / T262 R26).
 * Guaranteed GoBD Z3 compliance and EU Data Act exit right.
 * Protected by DATA_IMPORT module access and EXPORT/IMPORT action.
 */
@ApiTags('Data Import - Tenant Export (استخراج داده‌های مستأجر)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ModuleAccess(AccessModule.DATA_IMPORT)
@Controller('enterprise-hub/data-import/export')
export class TenantExportController {
  constructor(
    private readonly exportService: TenantExportService,
    private readonly restoreService?: TenantRestoreService,
  ) {}

  @Get('json')
  @RequireAction(AccessAction.EXPORT)
  @ApiOperation({ summary: 'استخراج کامل داده‌های مستأجر به فرمت JSON همراه با کد اعتبارسنجی' })
  @ApiResponse({ status: 200, description: 'آرشیو داده‌های مستأجر به همراه متادیتا و چک‌سام' })
  async exportJson(@Req() req: AuthenticatedRequest): Promise<TenantJsonArchive> {
    const tenantId = requireTenantId(req);
    return this.exportService.exportTenantJson(tenantId);
  }

  @Get('tabular')
  @RequireAction(AccessAction.EXPORT)
  @ApiOperation({ summary: 'استخراج داده‌های مستأجر به صورت جداول بهسازی‌شده و ایمن از تزریق فرمول' })
  @ApiResponse({ status: 200, description: 'جداول ساختاریافته برای اکسل با ایمن‌سازی ضد Formula Injection' })
  async exportTabular(@Req() req: AuthenticatedRequest): Promise<TenantTabularExport> {
    const tenantId = requireTenantId(req);
    return this.exportService.exportTenantTabular(tenantId);
  }

  @Get('gobd-z3')
  @RequireAction(AccessAction.EXPORT)
  @ApiOperation({ summary: 'استخراج کامل GoBD Z3 همراه با مانیفست هش‌ها و فایل‌های مجزا به تفکیک ماژول' })
  @ApiResponse({ status: 200, description: 'بسته کامل خروجی GoBD Z3' })
  async exportGoBDZ3(@Req() req: AuthenticatedRequest): Promise<TenantGoBDZ3Archive> {
    const tenantId = requireTenantId(req);
    return this.exportService.exportTenantGoBDZ3(tenantId);
  }

  @Post('restore')
  @RequireAction(AccessAction.CREATE)
  @ApiOperation({ summary: 'بازیابی داده‌های مستأجر از بسته خروجی اعتبارسنجی‌شده' })
  @ApiResponse({ status: 200, description: 'نتیجه بازیابی داده‌های مستأجر' })
  async restoreTenant(
    @Req() req: AuthenticatedRequest,
    @Body() archive: TenantGoBDZ3Archive,
  ): Promise<TenantRestoreResult> {
    const tenantId = requireTenantId(req);
    if (!this.restoreService) {
      throw new BadRequestException('Tenant restore service not initialized');
    }
    return this.restoreService.restoreTenantFromExport(tenantId, archive);
  }
}
