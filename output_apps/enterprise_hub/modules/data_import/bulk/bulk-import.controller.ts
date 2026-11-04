import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { IncomingMessage } from 'http';
import { AccessModule } from '../../access/catalogue';
import { ModuleAccess } from '../../access/decorators';
import { AuthenticatedRequest, JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { DATA_IMPORT_RESOURCE } from '../constants/data-import.constants';
import { ApproveBulkDto, SignPartsDto, StartBulkUploadDto } from './bulk-import.dto';
import { BulkImportService } from './bulk-import.service';

/**
 * Bulk import: resumable direct-to-storage upload, then a background job with progress, pause, retry and
 * cancel, then a review gate before anything is posted. The tenant always comes from the verified token.
 */
@ApiTags('Data Import - ورود حجیم')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ModuleAccess(AccessModule.DATA_IMPORT)
@Controller(`${DATA_IMPORT_RESOURCE}/bulk`)
export class BulkImportController {
  constructor(private readonly service: BulkImportService) {}

  private tenant(request: AuthenticatedRequest): string {
    return requireTenantId(request);
  }

  @Get('config')
  @ApiOperation({ summary: 'تنظیمات ورود حجیم و سهمیهٔ فضا' })
  async config(@Req() request: AuthenticatedRequest) {
    return { ...this.service.config(), ...(await this.service.quota(this.tenant(request))) };
  }

  @Post('uploads')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'شروع بارگذاری چندبخشی و ازسرگیری‌پذیر مستقیم به فضای ذخیره‌سازی' })
  start(@Req() request: AuthenticatedRequest, @Body() dto: StartBulkUploadDto) {
    return this.service.startUpload(this.tenant(request), request.user?.sub ?? null, dto);
  }

  @Get('uploads/:id/parts')
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @ApiOperation({ summary: 'تکه‌های رسیده (برای ازسرگیری)' })
  parts(@Req() request: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.uploadedParts(this.tenant(request), id);
  }

  @Post('uploads/:id/sign')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @ApiOperation({ summary: 'نشانی‌های امضاشدهٔ بارگذاری تکه‌ها' })
  sign(@Req() request: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: SignPartsDto) {
    return this.service.signParts(this.tenant(request), id, dto.partNumbers);
  }

  @Put('uploads/:id/parts/:n')
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @ApiOperation({ summary: 'فقط توسعه/آزمون: دریافت تکه از طریق API' })
  putPart(
    @Req() request: AuthenticatedRequest & IncomingMessage,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('n', new ParseIntPipe()) n: number,
  ) {
    return this.service.putLocalPart(this.tenant(request), id, n, request);
  }

  @Post('uploads/:id/complete')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'پایان بارگذاری و صف‌کردن پردازش' })
  complete(@Req() request: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.completeUpload(this.tenant(request), id);
  }

  @Get('jobs')
  list(@Req() request: AuthenticatedRequest) {
    return this.service.list(this.tenant(request));
  }

  @Get('jobs/:id')
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  get(@Req() request: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.get(this.tenant(request), id);
  }

  @Post('jobs/:id/pause')
  @HttpCode(HttpStatus.OK)
  pause(@Req() request: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.pause(this.tenant(request), id);
  }

  @Post('jobs/:id/resume')
  @HttpCode(HttpStatus.OK)
  resume(@Req() request: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.resume(this.tenant(request), id);
  }

  @Post('jobs/:id/retry')
  @HttpCode(HttpStatus.OK)
  retry(@Req() request: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.retry(this.tenant(request), id);
  }

  @Post('jobs/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Req() request: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.cancel(this.tenant(request), id);
  }

  @Delete('jobs/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'لغو و حذف (همان cancel)' })
  remove(@Req() request: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.cancel(this.tenant(request), id);
  }

  @Get('jobs/:id/tables/:idx/rows')
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @ApiOperation({ summary: 'پیش‌نمایش صفحه‌ای ردیف‌های مرحله‌بندی‌شده' })
  rows(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('idx', new ParseIntPipe()) idx: number,
    @Query('after') after?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.rows(this.tenant(request), id, idx, Math.max(0, Number(after) || 0), Number(limit) || 50);
  }

  @Post('jobs/:id/approve')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'تأیید بازبینی و ثبت در ماژول‌ها (یک دستهٔ قابل‌بازگردانی)' })
  approve(@Req() request: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: ApproveBulkDto) {
    return this.service.approve(this.tenant(request), id, dto);
  }
}
