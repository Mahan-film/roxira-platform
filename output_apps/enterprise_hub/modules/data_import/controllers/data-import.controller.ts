import { AccessAction, AccessModule, permissionOf } from '../../access/catalogue';
import { AccessRequest, requireAccess } from '../../access/access-context';
import { ModuleAccess } from '../../access/decorators';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  ParseIntPipe,
  PayloadTooLargeException,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { IncomingMessage } from 'http';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import {
  DATA_IMPORT_RESOURCE,
  maxUploadBytes,
} from '../constants/data-import.constants';
import { MAX_CHUNK_BYTES, maxPackageBytes } from '../constants/package-import.constants';
import { InitUploadDto, PackageFromUploadsDto, UploadStatusDto } from '../dto/chunked-upload.dto';
import { ChunkedUploadService } from '../services/chunked-upload.service';
import { SUPPORT_MATRIX, SupportRow } from '../support-matrix';
import { BatchSummaryDto, UndoBatchResponseDto } from '../dto/batch-response.dto';
import { CommitImportDto } from '../dto/commit-import.dto';
import { CommitResponseDto } from '../dto/commit-response.dto';
import { EntityKeyPipe } from '../dto/entity-key.pipe';
import { EntityDescriptorDto } from '../dto/entity-descriptor-response.dto';
import { EntityCommitDto, PreviewRequestDto } from '../dto/entity-commit.dto';
import { EntityCommitResponseDto } from '../dto/entity-commit-response.dto';
import { EntityPreviewResponseDto } from '../dto/entity-preview-response.dto';
import { PackageCommitDto, PackageReviewQueryDto } from '../dto/package-commit.dto';
import {
  PackageCommitResponseDto,
  PackageCreatedDto,
  PackageProgressDto,
  PackageStatusDto,
  ReconciliationReportDto,
} from '../dto/package-response.dto';
import { PreviewResponseDto } from '../dto/preview-response.dto';
import {
  DataImportService,
  UploadedFilePayload,
} from '../services/data-import.service';
import { EntityImportService } from '../services/entity-import.service';
import { PackageImportService } from '../services/package-import.service';

/**
 * کنترلر ورود داده با کمک هوش مصنوعی.
 *
 * - `POST /enterprise-hub/data-import/crm-leads/preview`: بارگذاری فایل
 *   (multipart، XLSX/CSV تا ۱۰ مگابایت و PDF/تصویر تا ۱۵ مگابایت) و دریافت
 *   نگاشت پیشنهادی.
 * - `POST /enterprise-hub/data-import/crm-leads/commit`: تأیید نگاشت و ورود.
 * - `GET  /entities`: فهرست موجودیت‌ها و فیلدهای قابل نگاشت.
 * - `POST /preview`: بارگذاری فایل و تشخیص خودکار موجودیت.
 * - `POST /:entity/preview`: بارگذاری با موجودیت اجباری.
 * - `POST /commit`: تأیید نگاشت و ورود نهایی (همه موجودیت‌ها).
 * - `POST /batches/:batchId/undo`: بازگردانی یک دسته ورود.
 * - `GET  /batches`: آخرین دسته‌های ورود مستأجر.
 * مسیرهای قدیمی `crm-leads/preview` و `crm-leads/commit` بدون تغییر باقی
 * مانده‌اند تا سازگاری حفظ شود.
 *
 * شناسه مستأجر صرفاً از توکن تأییدشده JWT استخراج می‌شود — هرگز از
 * بدنه/کوئری/هدر (Rule #4 - AGENTS.md).
 */
@ApiTags('Data Import - ورود داده از نرم‌افزار دیگر')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ModuleAccess(AccessModule.DATA_IMPORT)
@Controller(DATA_IMPORT_RESOURCE)
export class DataImportController {
  constructor(
    private readonly dataImportService: DataImportService,
    private readonly entityImportService: EntityImportService,
    private readonly packageImportService: PackageImportService,
    private readonly chunkedUpload: ChunkedUploadService,
  ) {}

  @Get('entities')
  @ApiOperation({ summary: 'فهرست موجودیت‌های قابل ورود و فیلدهای آن‌ها' })
  @ApiResponse({ status: HttpStatus.OK, type: [EntityDescriptorDto] })
  listEntities(): EntityDescriptorDto[] {
    return this.entityImportService.listEntities();
  }

  @Get('batches')
  @ApiOperation({ summary: 'آخرین دسته‌های ورود داده مستأجر' })
  @ApiResponse({ status: HttpStatus.OK, type: [BatchSummaryDto] })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'دسترسی غیرمجاز' })
  async listBatches(
    @Req() request: AuthenticatedRequest,
  ): Promise<BatchSummaryDto[]> {
    return this.entityImportService.listBatches(this.tenantIdOf(request));
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: maxUploadBytes() } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        entity: { type: 'string' },
      },
    },
  })
  @ApiOperation({ summary: 'پیش‌نمایش فایل و تشخیص خودکار موجودیت' })
  @ApiResponse({ status: HttpStatus.OK, type: EntityPreviewResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'فایل نامعتبر' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'دسترسی غیرمجاز' })
  async preview(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file: UploadedFilePayload,
    @Body() body: PreviewRequestDto,
  ): Promise<EntityPreviewResponseDto> {
    return this.entityImportService.preview(
      this.tenantIdOf(request),
      file,
      body?.entity,
    );
  }

  @Post('crm-leads/preview')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: maxUploadBytes() } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'پیش‌نمایش فایل (CSV/XLSX/PDF/تصویر) و نگاشت پیشنهادی ستون‌های سرنخ',
  })
  @ApiResponse({ status: HttpStatus.OK, type: PreviewResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'فایل نامعتبر' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'دسترسی غیرمجاز' })
  @ApiResponse({
    status: HttpStatus.PAYLOAD_TOO_LARGE,
    description: 'حجم فایل بیش از سقف مجاز است',
  })
  async previewCrmLeads(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file: UploadedFilePayload,
  ): Promise<PreviewResponseDto> {
    return this.dataImportService.preview(this.tenantIdOf(request), file);
  }

  @Post(':entity/preview')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: maxUploadBytes() } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiParam({ name: 'entity', description: 'کلید موجودیت مقصد' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'پیش‌نمایش فایل با موجودیت اجباری' })
  @ApiResponse({ status: HttpStatus.OK, type: EntityPreviewResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'فایل نامعتبر' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'دسترسی غیرمجاز' })
  async previewForEntity(
    @Req() request: AuthenticatedRequest,
    @Param('entity', EntityKeyPipe) entity: string,
    @UploadedFile() file: UploadedFilePayload,
  ): Promise<EntityPreviewResponseDto> {
    return this.entityImportService.preview(
      this.tenantIdOf(request),
      file,
      entity,
    );
  }

  @Post('commit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تأیید نگاشت و ورود نهایی برای یک موجودیت' })
  @ApiResponse({ status: HttpStatus.OK, type: EntityCommitResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'ورودی نامعتبر' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'دسترسی غیرمجاز' })
  async commit(
    @Req() request: AuthenticatedRequest,
    @Body() dto: EntityCommitDto,
  ): Promise<EntityCommitResponseDto> {
    return this.entityImportService.commit(this.tenantIdOf(request), dto);
  }

  @Post('crm-leads/commit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تأیید نگاشت و ورود نهایی سرنخ‌ها' })
  @ApiResponse({ status: HttpStatus.OK, type: CommitResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'ورودی نامعتبر' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'دسترسی غیرمجاز' })
  async commitCrmLeads(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CommitImportDto,
  ): Promise<CommitResponseDto> {
    return this.dataImportService.commit(this.tenantIdOf(request), dto);
  }

  @Post('batches/:batchId/undo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'بازگردانی کامل یک دسته ورود داده' })
  @ApiResponse({ status: HttpStatus.OK, type: UndoBatchResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'ورودی نامعتبر' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'دسترسی غیرمجاز' })
  async undoBatch(
    @Req() request: AuthenticatedRequest,
    @Param('batchId', new ParseUUIDPipe()) batchId: string,
  ): Promise<UndoBatchResponseDto> {
    return this.entityImportService.undoBatch(
      this.tenantIdOf(request),
      batchId,
    );
  }

  @Post('packages')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: maxPackageBytes() } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'بارگذاری بستهٔ دیتابیس (SQLite/SQL/ZIP) و شروع تحلیل',
  })
  @ApiResponse({ status: HttpStatus.ACCEPTED, type: PackageCreatedDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'فایل نامعتبر' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'دسترسی غیرمجاز' })
  async createPackage(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file: UploadedFilePayload,
  ): Promise<PackageCreatedDto> {
    return this.packageImportService.createPackage(this.tenantIdOf(request), file);
  }

  @Get('packages/:id')
  @ApiOperation({ summary: 'وضعیت و نتیجهٔ تحلیل بستهٔ دیتابیس' })
  @ApiResponse({ status: HttpStatus.OK, type: PackageStatusDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'بسته یافت نشد' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'دسترسی غیرمجاز' })
  async getPackage(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<PackageStatusDto> {
    return this.packageImportService.getPackage(this.tenantIdOf(request), id);
  }

  @Post('packages/:id/commit')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'ثبت نهایی بستهٔ دیتابیس و ساخت دستهٔ ورود' })
  @ApiResponse({ status: HttpStatus.ACCEPTED, type: PackageCommitResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'ورودی نامعتبر' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'دسترسی غیرمجاز' })
  async commitPackage(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PackageCommitDto,
  ): Promise<PackageCommitResponseDto> {
    return this.packageImportService.commitPackage(
      this.tenantIdOf(request),
      id,
      dto,
      { canOverrideImbalance: this.canOverrideImbalance(request), userId: request.user?.sub },
    );
  }

  @Get('packages/:id/progress')
  @ApiOperation({ summary: 'پیشرفت ثبت نهایی بستهٔ دیتابیس' })
  @ApiResponse({ status: HttpStatus.OK, type: PackageProgressDto })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'دسترسی غیرمجاز' })
  async getPackageProgress(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<PackageProgressDto> {
    return this.packageImportService.getProgress(this.tenantIdOf(request), id);
  }

  @Get('formats')
  @ApiOperation({ summary: 'جدول صادقانهٔ قالب‌های پشتیبانی‌شده (منبع حقیقت UI و docs)' })
  listFormats(): readonly SupportRow[] {
    return SUPPORT_MATRIX;
  }

  @Post('packages/:id/reconcile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'مغایرت‌گیری پیش از ثبت: تعداد، جمع بدهکار/بستانکار، تکراری، ستون‌های بی‌نگاشت' })
  @ApiResponse({ status: HttpStatus.OK, type: ReconciliationReportDto })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'دسترسی غیرمجاز' })
  async reconcilePackage(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PackageCommitDto,
  ): Promise<ReconciliationReportDto> {
    return this.packageImportService.reconcile(this.tenantIdOf(request), id, dto);
  }

  @Post('packages/:id/review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'بازبینی پیش از ثبت: سرفصل، افتتاحیه، اشخاص، کالا و همهٔ سندهای پیشنهادی (صفحه‌به‌صفحه)' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'دسترسی غیرمجاز' })
  async reviewPackage(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Query() query: PackageReviewQueryDto,
    @Body() dto: PackageCommitDto,
  ) {
    return this.packageImportService.review(this.tenantIdOf(request), id, dto, query.page ?? 1);
  }

  @Post('uploads')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @ApiOperation({ summary: 'شروع بارگذاری تکه‌ای و قابل‌ازسرگیری یک فایل' })
  @ApiResponse({ status: HttpStatus.CREATED, type: UploadStatusDto })
  async initUpload(
    @Req() request: AuthenticatedRequest,
    @Body() dto: InitUploadDto,
  ): Promise<UploadStatusDto> {
    return this.chunkedUpload.init(this.tenantIdOf(request), dto);
  }

  @Get('uploads/:uploadId')
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @ApiOperation({ summary: 'وضعیت بارگذاری (تکه‌های رسیده/جاافتاده) برای ازسرگیری' })
  @ApiResponse({ status: HttpStatus.OK, type: UploadStatusDto })
  async uploadStatus(
    @Req() request: AuthenticatedRequest,
    @Param('uploadId', new ParseUUIDPipe()) uploadId: string,
  ): Promise<UploadStatusDto> {
    return this.chunkedUpload.status(this.tenantIdOf(request), uploadId);
  }

  @Put('uploads/:uploadId/chunks/:index')
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @ApiConsumes('application/octet-stream')
  @ApiOperation({ summary: 'ارسال یک تکه (بدنهٔ خام، حداکثر ۸ مگابایت؛ ارسال دوباره بی‌ضرر است)' })
  @ApiResponse({ status: HttpStatus.OK, type: UploadStatusDto })
  async putChunk(
    @Req() request: AuthenticatedRequest & IncomingMessage,
    @Param('uploadId', new ParseUUIDPipe()) uploadId: string,
    @Param('index', new ParseIntPipe()) index: number,
  ): Promise<UploadStatusDto> {
    const body = await readCappedBody(request, MAX_CHUNK_BYTES);
    return this.chunkedUpload.writeChunk(this.tenantIdOf(request), uploadId, index, body);
  }

  @Post('packages/from-uploads')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'ساخت بسته از بارگذاری‌های تکه‌ای کامل (یک فایل، چند فایل یا پوشه)' })
  @ApiResponse({ status: HttpStatus.ACCEPTED, type: PackageCreatedDto })
  async createPackageFromUploads(
    @Req() request: AuthenticatedRequest,
    @Body() dto: PackageFromUploadsDto,
  ): Promise<PackageCreatedDto> {
    return this.packageImportService.createFromUploads(this.tenantIdOf(request), dto.uploadIds);
  }

  /** شناسه مستأجر فقط از پیلود JWT تأییدشده. */
  private tenantIdOf(request: AuthenticatedRequest): string {
    return requireTenantId(request);
  }

  /** ثبت با وجود عدم‌تراز به دسترسی مدیریتی ورود داده نیاز دارد، نه فقط دسترسی ایجاد. */
  private canOverrideImbalance(request: AccessRequest): boolean {
    return requireAccess(request).permissions.has(permissionOf(AccessModule.DATA_IMPORT, AccessAction.ADMIN));
  }
}

/** خواندن بدنهٔ خام درخواست با سقف سخت؛ از سقف عبور کند، اتصال قطع می‌شود. */
function readCappedBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    request.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > limit) {
        request.destroy();
        reject(new PayloadTooLargeException(`اندازهٔ تکه بیش از ${Math.round(limit / 1024 / 1024)} مگابایت است.`));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}
