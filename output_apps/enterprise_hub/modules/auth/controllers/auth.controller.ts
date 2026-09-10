import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  AuthSessionDto,
  AuthUserDto,
  SendOtpResponseDto,
} from '../dto/auth-session.dto';
import { SendOtpDto } from '../dto/send-otp.dto';
import { VerifyOtpDto } from '../dto/verify-otp.dto';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../guards/jwt-auth.guard';
import { AuthService } from '../services/auth.service';

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
  constructor(private readonly authService: AuthService) {}

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
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'دریافت سشن کاربر جاری (نیازمند توکن Bearer)' })
  @ApiResponse({ status: HttpStatus.OK, type: AuthUserDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'توکن نامعتبر' })
  async me(@Req() request: AuthenticatedRequest): Promise<AuthUserDto> {
    return this.authService.getProfile(request.user?.sub ?? '');
  }
}
