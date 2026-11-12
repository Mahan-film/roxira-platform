import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AUTH_THROTTLE } from '../constants/auth.constants';
import { AuthOnly } from '../../access/decorators';
import { Public } from '../decorators/public.decorator';
import {
  AuthSessionDto,
  AuthUserDto,
  MfaChallengeDto,
  SendOtpResponseDto,
} from '../dto/auth-session.dto';
import {
  ForgotPasswordDto,
  GenericMessageDto,
  MfaLoginDto,
  PasswordLoginDto,
  RefreshTokenDto,
  ResetPasswordDto,
  SetPasswordDto,
  SignupDto,
  SwitchTenantDto,
  TotpCodeDto,
} from '../dto/password-auth.dto';
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
import { PasswordAuthService } from '../services/password-auth.service';
import { SessionsService } from '../services/sessions.service';
import { TotpService } from '../services/totp.service';
import { AuthRepository } from '../repositories/auth.repository';
import { RefreshTokenService } from '../services/refresh-token.service';
import { AuditService } from '../../access/services/audit.service';
import { MfaChallenge } from '../services/login-challenge.service';
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
    private readonly passwordAuth: PasswordAuthService,
    private readonly sessions: SessionsService,
    private readonly totp: TotpService,
    private readonly users: AuthRepository,
    private readonly refreshTokens: RefreshTokenService,
    private readonly audit: AuditService,
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
      'تولید کد امن ۶ رقمی، ذخیره هش آن در Redis با انقضای ۱۲۰ ثانیه و ارسال پیامک با قالب ghazi-verify (دامنه قاضی) یا roxira-verify (دامنه روکسیرا) از طریق کاوه‌نگار.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: SendOtpResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'شماره همراه نامعتبر' })
  @ApiResponse({ status: HttpStatus.TOO_MANY_REQUESTS, description: 'محدودیت ارسال کد' })
  async sendOtp(
    @Body() dto: SendOtpDto,
    @Ip() ip: string,
    @Headers('host') host?: string,
  ): Promise<SendOtpResponseDto> {
    return this.authService.sendOtp(dto, host, ip);
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
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('host') host?: string,
  ): Promise<AuthSessionDto | MfaChallengeDto> {
    return this.authService.verifyOtp(dto, host, { ip, userAgent });
  }

  @Public()
  @Throttle({ default: AUTH_THROTTLE })
  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Sign up with username or email and a password',
    description:
      'Creates the account and returns a session. No organisation is required: pass organizationName to create one now, inviteToken to join one, or do either later.',
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: AuthSessionDto })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Username or email unavailable (generic)' })
  async signup(
    @Body() dto: SignupDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AuthSessionDto | MfaChallengeDto> {
    return this.passwordAuth.signup(dto, ip, { ip, userAgent });
  }

  @Public()
  @Throttle({ default: AUTH_THROTTLE })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with username or email and password' })
  @ApiResponse({ status: HttpStatus.OK, type: AuthSessionDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Invalid username/email or password (generic)' })
  @ApiResponse({ status: HttpStatus.TOO_MANY_REQUESTS })
  async login(
    @Body() dto: PasswordLoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AuthSessionDto | MfaChallengeDto> {
    return this.passwordAuth.login(dto, ip, { ip, userAgent });
  }

  @Public()
  @Throttle({ default: AUTH_THROTTLE })
  @Post('login/mfa')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Second step of sign-in for accounts with an authenticator app' })
  @ApiResponse({ status: HttpStatus.OK, type: AuthSessionDto })
  async loginMfa(@Body() dto: MfaLoginDto): Promise<AuthSessionDto> {
    return this.authService.verifyMfa(dto.challenge, dto.code);
  }

  @Public()
  @Throttle({ default: AUTH_THROTTLE })
  @Post('password/forgot')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request a password-reset email',
    description: 'Always answers 200 with the same message, whether or not the account exists.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: GenericMessageDto })
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Ip() ip: string): Promise<GenericMessageDto> {
    return { message: await this.passwordAuth.forgotPassword(dto, ip) };
  }

  @Public()
  @Throttle({ default: AUTH_THROTTLE })
  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Choose a new password with a reset token' })
  @ApiResponse({ status: HttpStatus.OK, type: GenericMessageDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid/expired token or weak password' })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<GenericMessageDto> {
    await this.passwordAuth.resetPassword(dto);
    return { message: 'Password updated. Sign in with the new password.' };
  }

  @AuthOnly()
  @Post('password/set')
  @Throttle({ default: AUTH_THROTTLE })
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Set or change the password of the signed-in user',
    description:
      'An SMS-only user adds a username and/or email plus a password, so both methods open the same account. Returns a fresh session; older sessions are revoked.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: AuthSessionDto })
  async setPassword(
    @Req() request: AuthenticatedRequest,
    @Body() dto: SetPasswordDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AuthSessionDto> {
    return this.passwordAuth.setPassword(request.user?.sub ?? '', dto, {
      mfa: request.user?.mfa === true,
      tenantId: request.user?.tenantId,
      ip,
      userAgent,
    });
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the refresh token and get a new access token' })
  @ApiResponse({ status: HttpStatus.OK, type: AuthSessionDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Refresh token invalid, expired or revoked' })
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AuthSessionDto> {
    return this.authService.refreshSession(dto.refreshToken, { ip, userAgent });
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sign out: revoke the refresh token on the server' })
  async logout(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.authService.logout(dto.refreshToken);
  }

  @AuthOnly()
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'دریافت سشن کاربر جاری (نیازمند توکن Bearer)' })
  @ApiResponse({ status: HttpStatus.OK, type: AuthUserDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'توکن نامعتبر' })
  async me(@Req() request: AuthenticatedRequest): Promise<AuthUserDto> {
    return this.authService.getProfile(request.user?.sub ?? '');
  }

  @AuthOnly()
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

  @AuthOnly()
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
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AuthSessionDto> {
    return this.webAuthnService.verifyAuthentication(dto, { ip, userAgent });
  }

  @AuthOnly()
  @Get('webauthn/credentials')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'فهرست Passkeyهای ثبت‌شده کاربر جاری' })
  async webauthnCredentials(
    @Req() request: AuthenticatedRequest,
  ): Promise<PasskeySummary[]> {
    const phone = request.user?.phone ?? '';
    return this.webAuthnService.listCredentials(phone);
  }

  // -------------------------------------------- organisations and sessions

  @AuthOnly()
  @Get('organizations')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Organisations I belong to (for the switcher)' })
  organizations(@Req() request: AuthenticatedRequest) {
    return this.sessions.listOrganizations(request.user?.sub ?? '');
  }

  @AuthOnly()
  @Post('switch-tenant')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Switch the active organisation',
    description: 'Membership is verified on the server; returns a new access token for the same session.',
  })
  async switchTenant(
    @Req() request: AuthenticatedRequest,
    @Body() dto: SwitchTenantDto,
  ): Promise<{ accessToken: string; expiresIn: number; tenantId: string }> {
    return this.authService.switchTenant(request.user!, dto.tenantId, request);
  }

  @AuthOnly()
  @Get('sessions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'My signed-in devices' })
  listSessions(@Req() request: AuthenticatedRequest) {
    return this.sessions.list(request.user?.sub ?? '', request.user?.sid);
  }

  @AuthOnly()
  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  revokeSession(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.revoke(request.user!.sub, id, request.user?.tenantId, request);
  }

  @AuthOnly()
  @Delete('sessions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sign out every other device' })
  revokeOtherSessions(@Req() request: AuthenticatedRequest) {
    return this.sessions.revokeOthers(request.user!.sub, request.user?.sid, request.user?.tenantId, request);
  }

  // ------------------------------------------------------------------ TOTP

  @AuthOnly()
  @Get('totp')
  @ApiBearerAuth()
  async totpStatus(@Req() request: AuthenticatedRequest): Promise<{ enabled: boolean }> {
    return { enabled: await this.totp.isEnabled(request.user!.sub) };
  }

  @AuthOnly()
  @Post('totp/setup')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Start authenticator-app setup; returns the secret and otpauth URI once' })
  async totpSetup(@Req() request: AuthenticatedRequest) {
    const user = await this.users.findById(request.user!.sub, { callerUserId: request.user!.sub });
    return this.totp.begin(request.user!.sub, user?.loginEmail ?? user?.username ?? user?.phone ?? 'account');
  }

  @AuthOnly()
  @Post('totp/enable')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Confirm setup with a code; returns one-time recovery codes',
    description: 'Marks the current session as two-factor; call POST /auth/refresh afterwards to get a token that says so.',
  })
  async totpEnable(@Req() request: AuthenticatedRequest, @Body() dto: TotpCodeDto) {
    const recoveryCodes = await this.totp.confirm(request.user!.sub, dto.code);
    if (request.user?.sid) await this.refreshTokens.markSessionMfa(request.user.sub, request.user.sid);
    await this.audit.record({ tenantId: request.user?.tenantId ?? null, actorUserId: request.user!.sub, action: 'auth.totp.enable', request });
    return { recoveryCodes };
  }

  @AuthOnly()
  @Post('totp/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  async totpDisable(@Req() request: AuthenticatedRequest, @Body() dto: TotpCodeDto): Promise<void> {
    await this.totp.disable(request.user!.sub, dto.code);
    await this.audit.record({ tenantId: request.user?.tenantId ?? null, actorUserId: request.user!.sub, action: 'auth.totp.disable', request });
  }
}
