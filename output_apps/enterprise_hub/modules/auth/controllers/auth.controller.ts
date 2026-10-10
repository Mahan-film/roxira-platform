import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AUTH_THROTTLE } from '../constants/auth.constants';
import { Public } from '../decorators/public.decorator';
import {
  AuthSessionDto,
  AuthUserDto,
  SendOtpResponseDto,
} from '../dto/auth-session.dto';
import { SendOtpDto } from '../dto/send-otp.dto';
import { VerifyOtpDto } from '../dto/verify-otp.dto';
import {
  WebAuthnAuthenticationOptionsRequestDto,
  WebAuthnAuthenticationOptionsResponseDto,
  WebAuthnAuthenticationVerifyRequestDto,
  WebAuthnRegistrationOptionsRequestDto,
  WebAuthnRegistrationOptionsResponseDto,
  WebAuthnRegistrationVerifyRequestDto,
  WebAuthnRegistrationVerifyResponseDto,
} from '../dto/webauthn.dto';
import { AuthenticatedRequest } from '../guards/jwt-auth.guard';
import { AuthService } from '../services/auth.service';
import {
  PasskeySummary,
  WebAuthnService,
} from '../services/webauthn.service';

/**
 * کنترلر احراز هویت پیامکی (Auth & Kavenegar OTP).
 *
 * مسیرهای واقعی زیر پیشوند نسخه‌بندی `v1` سرو می‌شوند:
 *   POST /v1/auth/send-otp   → از بیرون: /api/backend/auth/send-otp
 *   POST /v1/auth/verify-otp → از بیرون: /api/backend/auth/verify-otp
 *   GET  /v1/auth/me         → سشن کاربر احراز‌هویت‌شده
 *
 * فقط مسیریابی HTTP و اعتبارسنجی DTO؛ تمام منطق در AuthService است
 * (Rule #2 و Rule #3 - AGENTS.md).
 */
@ApiTags('Auth - احراز هویت پیامکی')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly webAuthnService: WebAuthnService,
  ) {}

  /** ثبت Passkey فقط برای شماره همراه خودِ کاربر احراز‌هویت‌شده مجاز است. */
  private assertOwnPhone(request: AuthenticatedRequest, phone: string): void {
    if (!request.user?.phone || request.user.phone !== phone) {
      throw new ForbiddenException('ثبت Passkey فقط برای حساب خودتان مجاز است.');
    }
  }

  @Public()
  @Throttle({ default: AUTH_THROTTLE })
  @Post('send-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'ارسال کد یک‌بارمصرف پیامکی',
    description:
      'تولید کد امن ۵ رقمی، ذخیره در Redis با انقضای ۱۲۰ ثانیه و ارسال پیامک با قالب ghazi-verify (دامنه قاضی) یا roxira-verify (دامنه روکسیرا) از طریق کاوه‌نگار.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: SendOtpResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'شماره همراه نامعتبر' })
  async sendOtp(
    @Body() dto: SendOtpDto,
    @Headers('host') host?: string,
  ): Promise<SendOtpResponseDto> {
    return this.authService.sendOtp(dto, host);
  }

  @Public()
  @Throttle({ default: AUTH_THROTTLE })
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'تأیید کد یک‌بارمصرف و صدور توکن JWT',
    description:
      'بررسی تطابق کد از Redis، ایجاد/یافتن کاربر، صدور توکن امضاشده JWT و بازگرداندن سشن کاربری.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: AuthSessionDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'کد نامعتبر یا منقضی' })
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Headers('host') host?: string,
  ): Promise<AuthSessionDto> {
    return this.authService.verifyOtp(dto, host);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'دریافت سشن کاربر جاری (نیازمند توکن Bearer)' })
  @ApiResponse({ status: HttpStatus.OK, type: AuthUserDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'توکن نامعتبر' })
  async me(@Req() request: AuthenticatedRequest): Promise<AuthUserDto> {
    return this.authService.getProfile(request.user?.sub ?? '');
  }

  @Post('webauthn/registration/options')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'تولید گزینه‌های ثبت Passkey (WebAuthn)',
    description:
      'تولید چالش تصادفی امن CSPRNG به‌همراه پارامترهای کلید عمومی (ES256/RS256) برای ثبت Passkey بیومتریک یا سخت‌افزاری. چالش ۹۰ ثانیه در Redis معتبر است.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: WebAuthnRegistrationOptionsResponseDto,
  })
  async webauthnRegistrationOptions(
    @Req() request: AuthenticatedRequest,
    @Body() dto: WebAuthnRegistrationOptionsRequestDto,
    @Headers('host') host?: string,
  ): Promise<WebAuthnRegistrationOptionsResponseDto> {
    this.assertOwnPhone(request, dto.phone);
    const domain = this.authService.resolveServiceDomain(undefined, host);
    return this.webAuthnService.generateRegistrationOptions(dto, domain);
  }

  @Post('webauthn/registration/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'تأیید و ذخیره Passkey جدید',
    description:
      'بررسی چالش/مبدأ، تجزیه Attestation و ذخیره کلید عمومی COSE جهت ورودهای بعدی.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: WebAuthnRegistrationVerifyResponseDto,
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'چالش نامعتبر' })
  async webauthnRegistrationVerify(
    @Req() request: AuthenticatedRequest,
    @Body() dto: WebAuthnRegistrationVerifyRequestDto,
  ): Promise<WebAuthnRegistrationVerifyResponseDto> {
    this.assertOwnPhone(request, dto.phone);
    return this.webAuthnService.verifyRegistration(dto);
  }

  @Public()
  @Throttle({ default: AUTH_THROTTLE })
  @Post('webauthn/authentication/options')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'تولید چالش احراز هویت Passkey',
    description:
      'تولید چالش و فهرست اعتبارنامه‌های مجاز برای ورود بیومتریک/سخت‌افزاری. ارسال شماره همراه اختیاری است (پشتیبانی از Passkeyهای Discoverable).',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: WebAuthnAuthenticationOptionsResponseDto,
  })
  async webauthnAuthenticationOptions(
    @Body() dto: WebAuthnAuthenticationOptionsRequestDto,
  ): Promise<WebAuthnAuthenticationOptionsResponseDto> {
    return this.webAuthnService.generateAuthenticationOptions(dto);
  }

  @Public()
  @Throttle({ default: AUTH_THROTTLE })
  @Post('webauthn/authentication/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'احراز هویت با Passkey و صدور توکن JWT',
    description:
      'بررسی امضای Assertion با کلید عمومی COSE، کنترل rpIdHash و شمارنده امضا، سپس صدور سشن کاربری.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: AuthSessionDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Passkey نامعتبر' })
  async webauthnAuthenticationVerify(
    @Body() dto: WebAuthnAuthenticationVerifyRequestDto,
  ): Promise<AuthSessionDto> {
    return this.webAuthnService.verifyAuthentication(dto);
  }

  @Get('webauthn/credentials')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'فهرست Passkeyهای ثبت‌شده کاربر جاری' })
  async webauthnCredentials(
    @Req() request: AuthenticatedRequest,
  ): Promise<PasskeySummary[]> {
    const phone = request.user?.phone ?? '';
    return this.webAuthnService.listCredentials(phone);
  }
}
