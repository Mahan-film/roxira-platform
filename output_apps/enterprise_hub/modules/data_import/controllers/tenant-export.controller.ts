import { InjectQueue } from '@nestjs/bullmq';
import {
  Body,
  Controller,
  Get,
  Optional,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Queue } from 'bullmq';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest, JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AllowDuringCancellation } from '../../tenants/decorators/allow-during-cancellation.decorator';
import { TENANT_EXPORT_QUEUE } from '../../tenants/services/tenant-cancellation.service';
import { requireTenantId } from '../../tenants/tenant-context';
import {
  TenantExportService,
  TenantGoBDZ3Archive,
  TenantJsonArchive,
  TenantTabularExport,
} from '../services/tenant-export.service';
import { TenantRestoreResult, TenantRestoreService } from '../services/tenant-restore.service';
import { RestoreTenantDto } from '../dto/restore-tenant.dto';

/**
 * Controller for tenant data export and restore (#230 / T77 / #1057 / T262 R26).
 * Guaranteed GoBD Z3 compliance and EU Data Act exit right.
 * Protected by DATA_IMPORT module access and EXPORT/CREATE action.
 */
@ApiTags('Data Import - Tenant Export (استخراج داده‌های مستأجر)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ModuleAccess(AccessModule.DATA_IMPORT)
@Controller('enterprise-hub/data-import/export')
export class TenantExportController {
  constructor(
    private readonly exportService: TenantExportService,
    private readonly restoreService: TenantRestoreService,
    @Optional() @InjectQueue(TENANT_EXPORT_QUEUE) private readonly exportQueue?: Queue,
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
  @ApiQuery({ name: 'dryRun', required: false, type: Boolean, description: 'اعتبارسنجی بدون ذخیره در پایگاه داده' })
  @ApiResponse({ status: 200, description: 'نتیجه بازیابی داده‌های مستأجر' })
  async restoreTenant(
    @Req() req: AuthenticatedRequest,
    @Body() body: RestoreTenantDto | TenantGoBDZ3Archive,
    @Query('dryRun') dryRunQuery?: string,
  ): Promise<TenantRestoreResult> {
    const tenantId = requireTenantId(req);
    const isDto = 'archive' in body && body.archive != null;
    const archive = isDto ? (body as RestoreTenantDto).archive : (body as TenantGoBDZ3Archive);
    const dryRun = isDto
      ? (body as RestoreTenantDto).dryRun ?? (dryRunQuery === 'true')
      : dryRunQuery === 'true';
    const allowNonEmptyTenant = isDto ? (body as RestoreTenantDto).allowNonEmptyTenant : false;

    return this.restoreService.restoreTenantFromExport(tenantId, archive, {
      dryRun,
      allowNonEmptyTenant,
    });
  }

  @Get('full-archive')
  @AllowDuringCancellation()
  @RequireAction(AccessAction.EXPORT)
  @ApiOperation({ summary: 'دانلود آرشیو کامل داده‌های کلیه جداول مستأجر به صورت فایل فشرده ZIP' })
  @ApiResponse({ status: 200, description: 'فایل ZIP حاوی فایل‌های CSV و JSON و متادیتا' })
  async downloadFullArchive(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: any,
  ): Promise<StreamableFile> {
    const tenantId = requireTenantId(req);
    const { buffer, filename } = await this.exportService.generateFullExportZip(tenantId);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length,
    });
    return new StreamableFile(buffer);
  }

  @Post('full-archive')
  @AllowDuringCancellation()
  @RequireAction(AccessAction.EXPORT)
  @ApiOperation({ summary: 'شروع یا بررسی درخواست پردازش استخراج کامل داده‌ها (BullMQ job)' })
  @ApiResponse({ status: 200, description: 'شناسه پردازش صف استخراج کامل' })
  async queueFullExport(
    @Req() req: AuthenticatedRequest,
  ): Promise<{ enqueued: boolean; jobId: string; tenantId: string; message: string }> {
    const tenantId = requireTenantId(req);
    if (!this.exportQueue) {
      throw new ServiceUnavailableException('صف استخراج کامل در دسترس نیست.');
    }
    const job = await this.exportQueue.add('tenant-full-export', {
      tenantId,
      requestedAt: new Date().toISOString(),
    });
    return {
      enqueued: true,
      jobId: String(job?.id ?? ''),
      tenantId,
      message: 'Full export job enqueued successfully.',
    };
  }
}
