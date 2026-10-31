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
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import {
  requireTenantId,
} from '../../tenants/tenant-context';
import { GenerateCsrDto } from '../dto/generate-csr.dto';
import { GenerateKeyPairDto } from '../dto/generate-key-pair.dto';
import { QueryTaxSignatureDto } from '../dto/query-tax-signature.dto';
import { SignInvoiceDto } from '../dto/sign-invoice.dto';
import { SigningKeyResponseDto } from '../dto/signing-key-response.dto';
import {
  PaginatedTaxSignaturesResponseDto,
  TaxSignatureDetailResponseDto,
} from '../dto/tax-signature-response.dto';
import { TaxComplianceService } from '../services/tax-compliance.service';

/**
 * کنترلر «تطبیق سامانه مودیان و امضای الکترونیک صورتحساب‌ها».
 *
 * فقط مسیریابی HTTP و اعتبارسنجی DTO؛ تمام منطق رمزنگاری و مالیاتی در
 * TaxComplianceService و دسترسی به پایگاه‌داده در Repository انجام می‌شود
 * (Rule #3 - AGENTS.md).
 *
 * شناسه مستأجر «تنها» از claim تأییدشده JWT خوانده می‌شود (`requireTenantId`)
 * و دسترسی بر اساس نقش با AccessGuard بررسی می‌شود؛ هرگز از بدنه/کوئری/
 * هدر درخواست (Rule #4 - AGENTS.md). احراز هویت از طریق گارد سراسری
 * JwtAuthGuard و RolesGuard اعمال می‌شود.
 */
@ApiTags('Tax Compliance - سامانه مودیان و امضای الکترونیک')
@ModuleAccess(AccessModule.TAX)
@Controller('enterprise-hub/tax-compliance')
export class TaxComplianceController {
  constructor(private readonly taxComplianceService: TaxComplianceService) {}

  /** استخراج شناسه مستأجر و بررسی دسترسی مدیریتی از کاربر تأییدشده. */
  private tenantIdOf(request: AuthenticatedRequest): string {
    return requireTenantId(request);
  }

  // ---------------------------------------------------------------------------
  // کلید مالیاتی و گواهی
  // ---------------------------------------------------------------------------

  @RequireAction(AccessAction.ADMIN)
  @Post('keys')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'تولید زوج‌کلید RSA مالیاتی (و CSR اختیاری)',
    description:
      'یک زوج‌کلید RSA جدید به‌عنوان کلید فعال امضای مالیاتی سازمان تولید و ذخیره می‌کند. کلید خصوصی هرگز بازگردانده نمی‌شود.',
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: SigningKeyResponseDto })
  async generateKeyPair(
    @Req() request: AuthenticatedRequest,
    @Body() dto: GenerateKeyPairDto,
  ): Promise<SigningKeyResponseDto> {
    return this.taxComplianceService.generateKeyPair(this.tenantIdOf(request), dto);
  }

  @Get('keys/active')
  @ApiOperation({ summary: 'اطلاعات عمومی کلید فعال مالیاتی سازمان' })
  @ApiResponse({ status: HttpStatus.OK, type: SigningKeyResponseDto })
  async getActiveKey(
    @Req() request: AuthenticatedRequest,
  ): Promise<SigningKeyResponseDto> {
    return this.taxComplianceService.getActiveSigningKey(this.tenantIdOf(request));
  }

  @RequireAction(AccessAction.ADMIN)
  @Post('csr')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'تولید درخواست امضای گواهی (CSR - PKCS#10)',
    description:
      'درخواست امضای گواهی را با کلید فعال سازمان یا کلید خصوصی ارسالی می‌سازد تا برای مرجع صدور گواهی ارسال شود.',
  })
  @ApiResponse({ status: HttpStatus.CREATED })
  async generateCsr(
    @Req() request: AuthenticatedRequest,
    @Body() dto: GenerateCsrDto,
  ): Promise<{
    keyId: string | null;
    keyFingerprint: string;
    certificateRequestPem: string;
  }> {
    return this.taxComplianceService.generateCertificateRequest(
      this.tenantIdOf(request),
      dto,
    );
  }

  // ---------------------------------------------------------------------------
  // امضا و ارسال صورتحساب
  // ---------------------------------------------------------------------------

  @RequireAction(AccessAction.POST)
  @Post('sign-invoice')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'امضای الکترونیک صورتحساب و تولید بسته مالیاتی',
    description:
      'بر اساس شناسه فاکتور، هش داده را محاسبه کرده، شناسه یکتای مالیاتی ۲۲ رقمی (TaxID) می‌سازد و امضای JWS (RS256) را روی بسته اعمال می‌کند.',
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: TaxSignatureDetailResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'صورتحساب یافت نشد' })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'صورتحساب قبلاً امضا شده است',
  })
  async signInvoice(
    @Req() request: AuthenticatedRequest,
    @Body() dto: SignInvoiceDto,
  ): Promise<TaxSignatureDetailResponseDto> {
    return this.taxComplianceService.signInvoice(this.tenantIdOf(request), dto);
  }

  @Get('signatures')
  @ApiOperation({ summary: 'فهرست صفحه‌بندی‌شده بسته‌های امضاشده مالیاتی سازمان' })
  @ApiResponse({ status: HttpStatus.OK, type: PaginatedTaxSignaturesResponseDto })
  async findAll(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryTaxSignatureDto,
  ): Promise<PaginatedTaxSignaturesResponseDto> {
    return this.taxComplianceService.findAll(this.tenantIdOf(request), query);
  }

  @Get('signatures/:id')
  @ApiOperation({ summary: 'دریافت جزئیات یک بسته امضاشده' })
  @ApiResponse({ status: HttpStatus.OK, type: TaxSignatureDetailResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'بسته یافت نشد' })
  async findOne(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TaxSignatureDetailResponseDto> {
    return this.taxComplianceService.findOne(this.tenantIdOf(request), id);
  }

  @RequireAction(AccessAction.EXPORT)
  @Get('signatures/:id/packet')
  @ApiOperation({ summary: 'دریافت بسته کامل JSON برای دانلود' })
  @ApiResponse({ status: HttpStatus.OK })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'بسته یافت نشد' })
  async getPacket(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Record<string, unknown>> {
    return this.taxComplianceService.getSignedPacket(
      this.tenantIdOf(request),
      id,
    );
  }

  @Get('signatures/:id/verify')
  @ApiOperation({ summary: 'راستی‌آزمایی صحت امضای JWS بسته مالیاتی' })
  @ApiResponse({ status: HttpStatus.OK })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'بسته یافت نشد' })
  async verify(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ valid: boolean; keyId: string; taxId: string; checkedAt: string }> {
    return this.taxComplianceService.verifySignature(this.tenantIdOf(request), id);
  }

  @RequireAction(AccessAction.POST)
  @Post('signatures/:id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'آماده‌سازی محلی بسته امضاشده و تولید شناسه داخلی (اتصال به سامانه مودیان فعال نیست)',
  })
  @ApiResponse({ status: HttpStatus.OK, type: TaxSignatureDetailResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'بسته یافت نشد' })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'بسته قبلاً به‌صورت محلی آماده ارسال شده است',
  })
  async submit(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TaxSignatureDetailResponseDto> {
    return this.taxComplianceService.submitSignature(
      this.tenantIdOf(request),
      id,
    );
  }
}
