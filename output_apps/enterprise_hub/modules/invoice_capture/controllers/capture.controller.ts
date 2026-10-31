import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Req, Res,
  ServiceUnavailableException, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { CAPTURE_MAX_FILE_BYTES } from '../constants/capture.constants';
import { CaptureView } from '../dto/capture-view';
import {
  CreateCaptureDto, ReverseCaptureDto, UpdateDraftDto, UpdateSettingsDto, UpsertVendorRuleDto,
} from '../dto/capture.dto';
import { CaptureService, UploadedCaptureFile } from '../services/capture.service';

/**
 * Invoice capture in the assistant chat. Tenant comes ONLY from the JWT; AccessGuard decides: drafts are
 * `accounting:create`, posting and reversing `accounting:post`, settings and vendor rules `accounting:admin`. Off unless `ASSISTANT_ENABLED` is on (same switch as the assistant).
 */
@ApiTags('Assistant - ثبت خودکار فاکتور')
@ApiBearerAuth()
@ModuleAccess(AccessModule.ACCOUNTING)
@Controller('enterprise-hub/assistant/capture')
export class CaptureController {
  constructor(
    private readonly service: CaptureService,
    private readonly config: ConfigService,
  ) {}

  private ctx(request: AuthenticatedRequest): { tenantId: string; actor: string } {
    const tenantId = requireTenantId(request);
    const raw = String(this.config.get<string>('ASSISTANT_ENABLED', '') ?? '');
    if (!['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase())) {
      throw new ServiceUnavailableException('دستیار هوشمند در حال حاضر فعال نیست.');
    }
    return { tenantId, actor: String(request.user?.sub ?? 'unknown').slice(0, 64) };
  }

  @Post('documents')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: CAPTURE_MAX_FILE_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'ارسال عکس/PDF/صوت/متن فاکتور و دریافت پیش‌نویس سند' })
  create(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file: UploadedCaptureFile | undefined,
    @Body() dto: CreateCaptureDto,
  ): Promise<CaptureView> {
    const { tenantId, actor } = this.ctx(request);
    return this.service.create(tenantId, actor, file, dto);
  }

  @Get('documents')
  @ApiOperation({ summary: 'آخرین پیش‌نویس‌ها و اسناد' })
  recent(@Req() request: AuthenticatedRequest): Promise<CaptureView[]> {
    return this.service.recent(this.ctx(request).tenantId);
  }

  @Get('queue')
  @ApiOperation({ summary: 'صف بازبینی روزانه (نیازمند بازبینی + ثبت‌های خودکار ۲۴ ساعت اخیر)' })
  queue(@Req() request: AuthenticatedRequest): Promise<CaptureView[]> {
    return this.service.queue(this.ctx(request).tenantId);
  }

  @Get('settings')
  async getSettings(@Req() request: AuthenticatedRequest): Promise<Record<string, unknown>> {
    const { tenantId } = this.ctx(request);
    const s = await this.service.getSettings(tenantId);
    return {
      autoEnabled: s.autoEnabled,
      minConfidence: Number(s.minConfidence),
      dailyCostCapUsd: Number(s.dailyCostCapUsd),
      dailyDocCap: s.dailyDocCap,
    };
  }

  @RequireAction(AccessAction.ADMIN)
  @Put('settings')
  @ApiOperation({ summary: 'تنظیمات ثبت خودکار (فقط مدیر سازمان)' })
  async putSettings(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateSettingsDto,
  ): Promise<Record<string, unknown>> {
    const { tenantId, actor } = this.ctx(request);
    const s = await this.service.updateSettings(tenantId, actor, dto);
    return {
      autoEnabled: s.autoEnabled,
      minConfidence: Number(s.minConfidence),
      dailyCostCapUsd: Number(s.dailyCostCapUsd),
      dailyDocCap: s.dailyDocCap,
    };
  }

  @Get('vendor-rules')
  vendorRules(@Req() request: AuthenticatedRequest): Promise<unknown[]> {
    return this.service.listRules(this.ctx(request).tenantId);
  }

  @RequireAction(AccessAction.ADMIN)
  @Put('vendor-rules/:vendorId')
  @ApiOperation({ summary: 'قانون فروشنده (حساب پیش‌فرض و ثبت خودکار) - فقط مدیر سازمان' })
  putRule(
    @Req() request: AuthenticatedRequest,
    @Param('vendorId', new ParseUUIDPipe()) vendorId: string,
    @Body() dto: UpsertVendorRuleDto,
  ): Promise<unknown> {
    const { tenantId, actor } = this.ctx(request);
    return this.service.upsertRule(tenantId, actor, vendorId, dto);
  }

  @Get('documents/:id')
  one(@Req() request: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string): Promise<CaptureView> {
    return this.service.view(this.ctx(request).tenantId, id);
  }

  @Get('documents/:id/source')
  async source(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.service.source(this.ctx(request).tenantId, id);
    response.setHeader('Content-Type', file.mime);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Disposition', 'inline');
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    response.send(file.bytes);
  }

  @Patch('documents/:id')
  @ApiOperation({ summary: 'ویرایش فیلدهای پیش‌نویس (اعتبارسنجی دوباره سمت سرور)' })
  update(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateDraftDto,
  ): Promise<CaptureView> {
    const { tenantId, actor } = this.ctx(request);
    return this.service.update(tenantId, actor, id, dto);
  }

  @RequireAction(AccessAction.POST)
  @Post('documents/:id/post')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ثبت سند با یک کلیک (از طریق AccountingService)' })
  post(@Req() request: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string): Promise<CaptureView> {
    const { tenantId, actor } = this.ctx(request);
    return this.service.post(tenantId, actor, id);
  }

  @RequireAction(AccessAction.POST)
  @Post('documents/:id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@Req() request: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string): Promise<CaptureView> {
    const { tenantId, actor } = this.ctx(request);
    return this.service.reject(tenantId, actor, id);
  }

  @RequireAction(AccessAction.POST)
  @Post('documents/:id/review')
  @HttpCode(HttpStatus.OK)
  review(@Req() request: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string): Promise<CaptureView> {
    const { tenantId, actor } = this.ctx(request);
    return this.service.markReviewed(tenantId, actor, id);
  }

  @RequireAction(AccessAction.POST)
  @Post('documents/:id/reverse')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'اصلاح سند ثبت‌شده فقط با سند برگشتی' })
  reverse(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReverseCaptureDto,
  ): Promise<CaptureView> {
    const { tenantId, actor } = this.ctx(request);
    return this.service.reverse(tenantId, actor, id, dto.reason);
  }
}
