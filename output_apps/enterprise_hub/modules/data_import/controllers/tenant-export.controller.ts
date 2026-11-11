import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest, JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import {
  TenantExportService,
  TenantJsonArchive,
  TenantTabularExport,
} from '../services/tenant-export.service';

/**
 * Controller for tenant data export, guaranteeing customer data ownership (#230 / T77).
 * Protected by DATA_IMPORT module access and EXPORT action (strictly restricted to owner and admin).
 */
@ApiTags('Data Import - Tenant Export (استخراج داده‌های مستأجر)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ModuleAccess(AccessModule.DATA_IMPORT)
@Controller('enterprise-hub/data-import/export')
export class TenantExportController {
  constructor(private readonly exportService: TenantExportService) {}

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
}
