import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
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
import { DATA_IMPORT_RESOURCE, MAX_UPLOAD_BYTES } from '../constants/data-import.constants';
import { CommitImportDto } from '../dto/commit-import.dto';
import { CommitResponseDto } from '../dto/commit-response.dto';
import { PreviewResponseDto } from '../dto/preview-response.dto';
import {
  DataImportService,
  UploadedFilePayload,
} from '../services/data-import.service';

/**
 * کنترلر ورود داده با کمک هوش مصنوعی (MVP سرنخ‌های CRM).
 *
 * - `POST /enterprise-hub/data-import/crm-leads/preview`: بارگذاری فایل
 *   (multipart، حداکثر ۵ مگابایت) و دریافت نگاشت پیشنهادی.
 * - `POST /enterprise-hub/data-import/crm-leads/commit`: تأیید نگاشت و ورود.
 *
 * دسترسی فقط برای مدیر پلتفرم (`UserRole.ADMIN`) یا مالک سازمان
 * (`TenantRole.OWNER`). شناسه مستأجر صرفاً از توکن تأییدشده JWT استخراج
 * می‌شود — هرگز از بدنه/کوئری/هدر (Rule #4 - AGENTS.md).
 */
@ApiTags('Data Import - ورود داده از نرم‌افزار دیگر')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller(DATA_IMPORT_RESOURCE)
export class DataImportController {
  constructor(private readonly dataImportService: DataImportService) {}

  @Post('crm-leads/preview')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'پیش‌نمایش فایل و نگاشت پیشنهادی ستون‌های سرنخ' })
  @ApiResponse({ status: HttpStatus.OK, type: PreviewResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'فایل نامعتبر' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'دسترسی غیرمجاز' })
  @ApiResponse({
    status: HttpStatus.PAYLOAD_TOO_LARGE,
    description: 'حجم فایل بیش از ۵ مگابایت',
  })
  async preview(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file: UploadedFilePayload,
  ): Promise<PreviewResponseDto> {
    this.assertImportAccess(request);
    return this.dataImportService.preview(this.tenantIdOf(request), file);
  }

  @Post('crm-leads/commit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تأیید نگاشت و ورود نهایی سرنخ‌ها' })
  @ApiResponse({ status: HttpStatus.OK, type: CommitResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'ورودی نامعتبر' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'دسترسی غیرمجاز' })
  async commit(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CommitImportDto,
  ): Promise<CommitResponseDto> {
    this.assertImportAccess(request);
    return this.dataImportService.commit(this.tenantIdOf(request), dto);
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
