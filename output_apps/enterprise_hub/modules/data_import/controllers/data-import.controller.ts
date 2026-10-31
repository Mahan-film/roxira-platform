import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
import { UserRole } from '../../auth/enums/user-role.enum';
import { TenantRole } from '../../tenants/enums/tenant-role.enum';
import { requireTenantId } from '../../tenants/tenant-context';
import {
  DATA_IMPORT_RESOURCE,
  maxUploadBytes,
} from '../constants/data-import.constants';
import { maxPackageBytes } from '../constants/package-import.constants';
import { BatchSummaryDto, UndoBatchResponseDto } from '../dto/batch-response.dto';
import { CommitImportDto } from '../dto/commit-import.dto';
import { CommitResponseDto } from '../dto/commit-response.dto';
import { EntityKeyPipe } from '../dto/entity-key.pipe';
import { EntityDescriptorDto } from '../dto/entity-descriptor-response.dto';
import { EntityCommitDto, PreviewRequestDto } from '../dto/entity-commit.dto';
import { EntityCommitResponseDto } from '../dto/entity-commit-response.dto';
import { EntityPreviewResponseDto } from '../dto/entity-preview-response.dto';
import { PackageCommitDto } from '../dto/package-commit.dto';
import {
  PackageCommitResponseDto,
  PackageCreatedDto,
  PackageProgressDto,
  PackageStatusDto,
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
@Controller(DATA_IMPORT_RESOURCE)
export class DataImportController {
  constructor(
    private readonly dataImportService: DataImportService,
    private readonly entityImportService: EntityImportService,
    private readonly packageImportService: PackageImportService,
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
    this.assertImportAccess(request);
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
    this.assertImportAccess(request);
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
    this.assertImportAccess(request);
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
    this.assertImportAccess(request);
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
    this.assertImportAccess(request);
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
    this.assertImportAccess(request);
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
    this.assertImportAccess(request);
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
    this.assertImportAccess(request);
    return this.packageImportService.createPackage(this.tenantIdOf(request), file);
  }

  @Get('packages/:id')
  @ApiOperation({ summary: 'وضعیت و نتیجهٔ تحلیل بستهٔ دیتابیس' })
  @ApiResponse({ status: HttpStatus.OK, type: PackageStatusDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'بسته یافت نشد' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'دسترسی غیرمجاز' })
  async getPackage(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<PackageStatusDto> {
    this.assertImportAccess(request);
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
    @Param('id') id: string,
    @Body() dto: PackageCommitDto,
  ): Promise<PackageCommitResponseDto> {
    this.assertImportAccess(request);
    return this.packageImportService.commitPackage(
      this.tenantIdOf(request),
      id,
      dto,
    );
  }

  @Get('packages/:id/progress')
  @ApiOperation({ summary: 'پیشرفت ثبت نهایی بستهٔ دیتابیس' })
  @ApiResponse({ status: HttpStatus.OK, type: PackageProgressDto })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'دسترسی غیرمجاز' })
  async getPackageProgress(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<PackageProgressDto> {
    this.assertImportAccess(request);
    return this.packageImportService.getProgress(this.tenantIdOf(request), id);
  }

  /** شناسه مستأجر فقط از پیلود JWT تأییدشده. */
  private tenantIdOf(request: AuthenticatedRequest): string {
    return requireTenantId(request);
  }
  /** اجازه ورود داده: مدیر پلتفرم یا مالک سازمان. */
  private assertImportAccess(request: AuthenticatedRequest): void {
    const isAdmin = request.user?.role === UserRole.ADMIN;
    const isOwner = request.user?.tenantRole === TenantRole.OWNER;
    if (!isAdmin && !isOwner) {
      throw new ForbiddenException(
        'ورود داده فقط برای مدیر پلتفرم یا مالک سازمان مجاز است.',
      );
    }
  }
}
