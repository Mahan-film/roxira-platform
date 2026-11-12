import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  MoadianInvoiceIdParamDto,
  SubmitMoadianInvoiceDto,
} from '../dto/submit-moadian-invoice.dto';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import {
  MoadianCredentialResponseDto,
  MoadianSubmissionResponseDto,
} from '../dto/moadian-response.dto';
import { PutMoadianCredentialDto } from '../dto/put-moadian-credential.dto';
import {
  MoadianArticle6QueryDto,
  MoadianArticle6ReportDto,
  MoadianInboxAgeQueryDto,
  MoadianInboxAgeReportDto,
} from '../dto/moadian-compliance.dto';
import { MoadianPreFlightResult } from '../utils/moadian-preflight.validator';
import { MoadianService } from '../services/moadian.service';
import { MoadianCompliancePolicyService } from '../services/moadian-compliance-policy.service';

/**
 * اتصال زنده به سامانه مودیان (پشت پرچم MOADIAN_ENABLED).
 * شناسه مستأجر فقط از claim تأییدشده JWT خوانده می‌شود (Rule #4 - AGENTS.md).
 */
@ApiTags('Tax Compliance - اتصال زنده سامانه مودیان')
@ModuleAccess(AccessModule.TAX)
@Controller('enterprise-hub/tax-compliance/moadian')
export class MoadianController {
  constructor(
    private readonly moadianService: MoadianService,
    private readonly compliancePolicyService?: MoadianCompliancePolicyService,
  ) {}

  private tenantIdOf(request: AuthenticatedRequest): string {
    return requireTenantId(request);
  }

  @Get('status')
  @ApiOperation({
    summary: 'وضعیت پرچم اتصال زنده و ثبت‌بودن اطلاعات اتصال',
    description: 'حتی وقتی MOADIAN_ENABLED خاموش است پاسخ می‌دهد.',
  })
  async getStatus(@Req() request: AuthenticatedRequest): Promise<{ enabled: boolean; configured: boolean; defaultSstid: string | null }> {
    return this.moadianService.getStatus(this.tenantIdOf(request));
  }

  @RequireAction(AccessAction.READ)
  @Post('invoices/:invoiceId/pre-flight')
  @ApiOperation({ summary: 'اعتبارسنجی پیش از ارسال صورتحساب به سامانه مودیان' })
  @ApiResponse({ status: HttpStatus.OK })
  async preFlight(
    @Param() params: MoadianInvoiceIdParamDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<MoadianPreFlightResult> {
    return this.moadianService.preFlightValidate(this.tenantIdOf(request), params.invoiceId);
  }

  @RequireAction(AccessAction.ADMIN)
  @Put('credentials')
  @ApiOperation({
    summary: 'ثبت/جایگزینی شناسه حافظه، گواهی و کلید خصوصی مودیان',
    description: 'کلید خصوصی رمزشده ذخیره می‌شود و هرگز بازگردانده نمی‌شود.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: MoadianCredentialResponseDto })
  async putCredential(
    @Req() request: AuthenticatedRequest,
    @Body() dto: PutMoadianCredentialDto,
  ): Promise<MoadianCredentialResponseDto> {
    return this.moadianService.putCredential(this.tenantIdOf(request), dto);
  }

  @Get('credentials')
  @ApiOperation({ summary: 'اطلاعات عمومی اتصال مودیان سازمان' })
  @ApiResponse({ status: HttpStatus.OK, type: MoadianCredentialResponseDto })
  async getCredential(@Req() request: AuthenticatedRequest): Promise<MoadianCredentialResponseDto> {
    return this.moadianService.getCredential(this.tenantIdOf(request));
  }

  @RequireAction(AccessAction.POST)
  @Post('invoices/:invoiceId/submit')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'ارسال صورتحساب به سامانه مودیان (صف BullMQ)' })
  @ApiResponse({ status: HttpStatus.ACCEPTED, type: MoadianSubmissionResponseDto })
  async submit(
    @Req() request: AuthenticatedRequest,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @Body() body?: SubmitMoadianInvoiceDto,
  ): Promise<MoadianSubmissionResponseDto> {
    return this.moadianService.submitInvoice(this.tenantIdOf(request), invoiceId, body ?? {});
  }

  @Get('invoices/:invoiceId/status')
  @ApiOperation({ summary: 'وضعیت ارسال صورتحساب به سامانه مودیان' })
  @ApiResponse({ status: HttpStatus.OK, type: MoadianSubmissionResponseDto })
  async status(
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<MoadianSubmissionResponseDto> {
    return this.moadianService.getSubmission(this.tenantIdOf(request), invoiceId);
  }

  @RequireAction(AccessAction.READ)
  @Get('compliance/inbox-age')
  @ApiOperation({
    summary: 'گزارش سن و مهلت رسیدگی صورتحساب‌های خرید کارپوشه مؤدیان',
    description: 'بررسی فاکتورهای معوق بر اساس سیاست‌های هشدار ۲۰ روزه و بحرانی ۲۷ روزه کارپوشه (تبصره ماده ۵).',
  })
  @ApiResponse({ status: HttpStatus.OK, type: MoadianInboxAgeReportDto })
  async getInboxAge(
    @Req() request: AuthenticatedRequest,
    @Query() query: MoadianInboxAgeQueryDto,
  ): Promise<MoadianInboxAgeReportDto> {
    if (!this.compliancePolicyService) {
      throw new ServiceUnavailableException('Moadian compliance policy service is not available');
    }
    return this.compliancePolicyService.checkInboxAge(this.tenantIdOf(request), query);
  }

  @RequireAction(AccessAction.READ)
  @Get('compliance/article-6-sales-cap')
  @ApiOperation({
    summary: 'استعلام سقف مجاز صدور صورتحساب ماده ۶ سامانه مؤدیان',
    description: 'محاسبه میزان استفاده از سقف مجاز دوره و صدور هشدار پیشگیرانه در آستانه ۸۰٪.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: MoadianArticle6ReportDto })
  async getArticle6Cap(
    @Req() request: AuthenticatedRequest,
    @Query() query: MoadianArticle6QueryDto,
  ): Promise<MoadianArticle6ReportDto> {
    if (!this.compliancePolicyService) {
      throw new ServiceUnavailableException('Moadian compliance policy service is not available');
    }
    return this.compliancePolicyService.checkArticle6SalesCap(this.tenantIdOf(request), query);
  }

  @RequireAction(AccessAction.READ)
  @Post('compliance/check-article-6-cap')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'شبیه‌سازی و بررسی عبور از سقف ماده ۶ قبل از صدور صورتحساب جدید',
  })
  @ApiResponse({ status: HttpStatus.OK, type: MoadianArticle6ReportDto })
  async checkArticle6Cap(
    @Req() request: AuthenticatedRequest,
    @Body() body: MoadianArticle6QueryDto,
  ): Promise<MoadianArticle6ReportDto> {
    if (!this.compliancePolicyService) {
      throw new ServiceUnavailableException('Moadian compliance policy service is not available');
    }
    return this.compliancePolicyService.checkArticle6SalesCap(this.tenantIdOf(request), body);
  }
}
