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
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
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
 */
@ApiTags('Tax Compliance - سامانه مودیان و امضای الکترونیک')
@Controller('enterprise-hub/tax-compliance')
export class TaxComplianceController {
  constructor(private readonly taxComplianceService: TaxComplianceService) {}

  // ---------------------------------------------------------------------------
  // کلید مالیاتی و گواهی
  // ---------------------------------------------------------------------------

  @Post('keys')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'تولید زوج‌کلید RSA مالیاتی (و CSR اختیاری)',
    description:
      'یک زوج‌کلید RSA جدید به‌عنوان کلید فعال امضای مالیاتی تولید و ذخیره می‌کند. کلید خصوصی هرگز بازگردانده نمی‌شود.',
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: SigningKeyResponseDto })
  async generateKeyPair(
    @Body() dto: GenerateKeyPairDto,
  ): Promise<SigningKeyResponseDto> {
    return this.taxComplianceService.generateKeyPair(dto);
  }

  @Get('keys/active')
  @ApiOperation({ summary: 'اطلاعات عمومی کلید فعال مالیاتی' })
  @ApiResponse({ status: HttpStatus.OK, type: SigningKeyResponseDto })
  async getActiveKey(): Promise<SigningKeyResponseDto> {
    return this.taxComplianceService.getActiveSigningKey();
  }

  @Post('csr')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'تولید درخواست امضای گواهی (CSR - PKCS#10)',
    description:
      'درخواست امضای گواهی را با کلید فعال سازمان یا کلید خصوصی ارسالی می‌سازد تا برای مرجع صدور گواهی ارسال شود.',
  })
  @ApiResponse({ status: HttpStatus.CREATED })
  async generateCsr(@Body() dto: GenerateCsrDto): Promise<{
    keyId: string | null;
    keyFingerprint: string;
    certificateRequestPem: string;
  }> {
    return this.taxComplianceService.generateCertificateRequest(dto);
  }

  // ---------------------------------------------------------------------------
  // امضا و ارسال صورتحساب
  // ---------------------------------------------------------------------------

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
    @Body() dto: SignInvoiceDto,
  ): Promise<TaxSignatureDetailResponseDto> {
    return this.taxComplianceService.signInvoice(dto);
  }

  @Get('signatures')
  @ApiOperation({ summary: 'فهرست صفحه‌بندی‌شده بسته‌های امضاشده مالیاتی' })
  @ApiResponse({ status: HttpStatus.OK, type: PaginatedTaxSignaturesResponseDto })
  async findAll(
    @Query() query: QueryTaxSignatureDto,
  ): Promise<PaginatedTaxSignaturesResponseDto> {
    return this.taxComplianceService.findAll(query);
  }

  @Get('signatures/:id')
  @ApiOperation({ summary: 'دریافت جزئیات یک بسته امضاشده' })
  @ApiResponse({ status: HttpStatus.OK, type: TaxSignatureDetailResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'بسته یافت نشد' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TaxSignatureDetailResponseDto> {
    return this.taxComplianceService.findOne(id);
  }

  @Get('signatures/:id/packet')
  @ApiOperation({ summary: 'دریافت بسته کامل JSON برای دانلود' })
  @ApiResponse({ status: HttpStatus.OK })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'بسته یافت نشد' })
  async getPacket(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Record<string, unknown>> {
    return this.taxComplianceService.getSignedPacket(id);
  }

  @Get('signatures/:id/verify')
  @ApiOperation({ summary: 'راستی‌آزمایی صحت امضای JWS بسته مالیاتی' })
  @ApiResponse({ status: HttpStatus.OK })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'بسته یافت نشد' })
  async verify(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ valid: boolean; keyId: string; taxId: string; checkedAt: string }> {
    return this.taxComplianceService.verifySignature(id);
  }

  @Post('signatures/:id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'ارسال بسته امضاشده به سامانه مودیان و ثبت شماره مرجع',
  })
  @ApiResponse({ status: HttpStatus.OK, type: TaxSignatureDetailResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'بسته یافت نشد' })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'بسته قبلاً پذیرفته شده است',
  })
  async submit(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TaxSignatureDetailResponseDto> {
    return this.taxComplianceService.submitSignature(id);
  }
}
