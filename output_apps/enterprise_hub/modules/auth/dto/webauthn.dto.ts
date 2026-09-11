import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { IR_MOBILE_REGEX } from '../constants/auth.constants';
import {
  WEBAUTHN_CHALLENGE_BYTES,
  WEBAUTHN_PUBLIC_KEY_ALGORITHMS,
  WEBAUTHN_TIMEOUT_MS,
} from '../constants/webauthn.constants';
import { normalizeIranianMobile } from '../utils/phone.util';

/** الگوریتم‌های رمزنگاری مجاز برای Passkey (COSE). */
export class PublicKeyCredentialParameterDto {
  @ApiProperty({ example: 'public-key' })
  type: string;

  @ApiProperty({ example: -7, enum: WEBAUTHN_PUBLIC_KEY_ALGORITHMS })
  alg: number;
}

/** مشخصات کاربر در گزینه‌های ثبت Passkey. */
export class WebAuthnUserDescriptorDto {
  @ApiProperty({ example: 'dXNlci1pZC1iYXNlNjR1cmw' })
  id: string;

  @ApiProperty({ example: '09121234567' })
  name: string;

  @ApiProperty({ example: 'کاربر روکسیرا' })
  displayName: string;
}

/** اطلاعات Relying Party. */
export class WebAuthnRpDescriptorDto {
  @ApiProperty({ example: 'Roxira International' })
  name: string;

  @ApiProperty({ example: 'roxira.net' })
  id: string;
}

/** اعتبارنامه حذف‌شده از فهرست (خارج کردن Passkeyهای تکراری). */
export class WebAuthnExcludeCredentialDto {
  @ApiProperty({ example: 'public-key' })
  type: string;

  @ApiProperty({ example: 'bXktY3JlZGVudGlhbC1pZA' })
  id: string;

  @ApiPropertyOptional({ type: [String], example: ['internal', 'hybrid'] })
  transports?: string[];
}

/** گزینه‌های انتخاب Authenticator (بیومتریک/سخت‌افزاری). */
export class WebAuthnAuthenticatorSelectionDto {
  @ApiPropertyOptional({
    example: 'platform',
    description: 'در صورت نبود، هر دو حالت بیومتریک و سخت‌افزاری مجاز است',
  })
  authenticatorAttachment?: string;

  @ApiProperty({ example: 'preferred' })
  residentKey: string;

  @ApiProperty({ example: true })
  requireResidentKey: boolean;

  @ApiProperty({ example: 'preferred' })
  userVerification: string;
}

/**
 * درخواست تولید گزینه‌های ثبت Passkey جدید.
 */
export class WebAuthnRegistrationOptionsRequestDto {
  @ApiProperty({
    description: 'شماره همراه ایران (۱۱ رقم، با فرمت 09xxxxxxxxx)',
    example: '09121234567',
  })
  @Transform(({ value }) => normalizeIranianMobile(value))
  @Matches(IR_MOBILE_REGEX, {
    message: 'شماره همراه باید با فرمت 09xxxxxxxxx و ۱۱ رقم باشد.',
  })
  phone: string;
}

/**
 * پاسخ گزینه‌های ثبت Passkey (PublicKeyCredentialCreationOptions).
 */
export class WebAuthnRegistrationOptionsResponseDto {
  @ApiProperty({ example: 'Y2hhbGxlbmdlLWJhc2U2NHVybA' })
  challenge: string;

  @ApiProperty({ type: WebAuthnRpDescriptorDto })
  rp: WebAuthnRpDescriptorDto;

  @ApiProperty({ type: WebAuthnUserDescriptorDto })
  user: WebAuthnUserDescriptorDto;

  @ApiProperty({ type: [PublicKeyCredentialParameterDto] })
  pubKeyCredParams: PublicKeyCredentialParameterDto[];

  @ApiProperty({ example: WEBAUTHN_TIMEOUT_MS })
  timeout: number;

  @ApiProperty({ example: 'none' })
  attestation: string;

  @ApiProperty({ type: WebAuthnAuthenticatorSelectionDto })
  authenticatorSelection: WebAuthnAuthenticatorSelectionDto;

  @ApiProperty({ type: [WebAuthnExcludeCredentialDto] })
  excludeCredentials: WebAuthnExcludeCredentialDto[];

  @ApiPropertyOptional({ example: {} })
  extensions?: Record<string, unknown>;

  @ApiProperty({ example: WEBAUTHN_CHALLENGE_BYTES })
  challengeBytes: number;
}

/**
 * درخواست تولید گزینه‌های احراز هویت با Passkey.
 * ارسال شماره همراه اختیاری است؛ در صورت نبود آن، اعتبارنامه‌های Discoverable
 * (Passkey همگام‌شده) مجاز خواهند بود.
 */
export class WebAuthnAuthenticationOptionsRequestDto {
  @ApiPropertyOptional({
    description: 'شماره همراه ایران (در صورت ارائه، اعتبارنامه‌های همان کاربر محدود می‌شود)',
    example: '09121234567',
  })
  @IsOptional()
  @Transform(({ value }) => normalizeIranianMobile(value))
  @Matches(IR_MOBILE_REGEX, {
    message: 'شماره همراه باید با فرمت 09xxxxxxxxx و ۱۱ رقم باشد.',
  })
  phone?: string;
}

/**
 * پاسخ گزینه‌های احراز هویت با Passkey (PublicKeyCredentialRequestOptions).
 */
export class WebAuthnAuthenticationOptionsResponseDto {
  @ApiProperty({ example: 'Y2hhbGxlbmdlLWJhc2U2NHVybA' })
  challenge: string;

  @ApiProperty({ example: 'roxira.net' })
  rpId: string;

  @ApiProperty({ example: WEBAUTHN_TIMEOUT_MS })
  timeout: number;

  @ApiProperty({ example: 'preferred' })
  userVerification: string;

  @ApiProperty({ type: [WebAuthnExcludeCredentialDto] })
  allowCredentials: WebAuthnExcludeCredentialDto[];

  @ApiProperty({ example: true })
  allowDiscoverable: boolean;
}

/** پاسخ اعتبارنامه در مراسم ثبت (Attestation). */
export class WebAuthnAttestationResponseDto {
  @ApiProperty({ example: 'Y2xpZW50RGF0YUpTT04=' })
  @IsString()
  @IsNotEmpty()
  clientDataJSON: string;

  @ApiProperty({ example: 'YXR0ZXN0YXRpb25PYmplY3Q=' })
  @IsString()
  @IsNotEmpty()
  attestationObject: string;
}

/** پاسخ اعتبارنامه در مراسم احراز هویت (Assertion). */
export class WebAuthnAssertionResponseDto {
  @ApiProperty({ example: 'Y2xpZW50RGF0YUpTT04=' })
  @IsString()
  @IsNotEmpty()
  clientDataJSON: string;

  @ApiProperty({ example: 'YXV0aGVudGljYXRvckRhdGE=' })
  @IsString()
  @IsNotEmpty()
  authenticatorData: string;

  @ApiProperty({ example: 'c2lnbmF0dXJl' })
  @IsString()
  @IsNotEmpty()
  signature: string;

  @ApiPropertyOptional({ example: 'dXNlckhhbmRsZQ' })
  @IsOptional()
  @IsString()
  userHandle?: string;
}

/**
 * درخواست تأیید ثبت Passkey جدید و ذخیره کلید عمومی.
 */
export class WebAuthnRegistrationVerifyRequestDto {
  @ApiProperty({ example: '09121234567' })
  @Transform(({ value }) => normalizeIranianMobile(value))
  @Matches(IR_MOBILE_REGEX, {
    message: 'شماره همراه باید با فرمت 09xxxxxxxxx و ۱۱ رقم باشد.',
  })
  phone: string;

  @ApiProperty({ example: 'Y3JlZGVudGlhbC1pZA' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({ example: 'Y3JlZGVudGlhbC1pZA' })
  @IsString()
  @IsNotEmpty()
  rawId: string;

  @ApiProperty({ example: 'public-key' })
  @IsIn(['public-key'])
  type: string;

  @ApiProperty({ type: WebAuthnAttestationResponseDto })
  @IsObject()
  @ValidateNested()
  @Type(() => WebAuthnAttestationResponseDto)
  response: WebAuthnAttestationResponseDto;

  @ApiPropertyOptional({ type: [String], example: ['internal', 'hybrid'] })
  @IsOptional()
  @IsString({ each: true })
  transports?: string[];

  @ApiPropertyOptional({ example: 'singleDevice' })
  @IsOptional()
  @IsString()
  deviceType?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  backedUp?: boolean;

  @ApiPropertyOptional({ example: 'iPhone 16 Pro' })
  @IsOptional()
  @IsString()
  label?: string;
}

/**
 * درخواست احراز هویت با Passkey و صدور سشن JWT.
 */
export class WebAuthnAuthenticationVerifyRequestDto {
  @ApiPropertyOptional({ example: '09121234567' })
  @IsOptional()
  @Transform(({ value }) => normalizeIranianMobile(value))
  @Matches(IR_MOBILE_REGEX, {
    message: 'شماره همراه باید با فرمت 09xxxxxxxxx و ۱۱ رقم باشد.',
  })
  phone?: string;

  @ApiProperty({ example: 'Y3JlZGVudGlhbC1pZA' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({ example: 'Y3JlZGVudGlhbC1pZA' })
  @IsString()
  @IsNotEmpty()
  rawId: string;

  @ApiProperty({ example: 'public-key' })
  @IsIn(['public-key'])
  type: string;

  @ApiProperty({ type: WebAuthnAssertionResponseDto })
  @IsObject()
  @ValidateNested()
  @Type(() => WebAuthnAssertionResponseDto)
  response: WebAuthnAssertionResponseDto;

  @ApiPropertyOptional({ example: 'singleDevice' })
  @IsOptional()
  @IsString()
  deviceType?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  backedUp?: boolean;
}

/**
 * پاسخ تأیید ثبت Passkey.
 */
export class WebAuthnRegistrationVerifyResponseDto {
  @ApiProperty({ example: true })
  verified: boolean;

  @ApiProperty({ example: 'Y3JlZGVudGlhbC1pZA' })
  credentialId: string;

  @ApiProperty({ example: -7 })
  algorithm: number;

  @ApiProperty({ example: '2026-09-11T12:00:00.000Z' })
  registeredAt: string;
}

/**
 * شناسه عددی نوع الگوریتم برای اسناد OpenAPI (بدون استفاده در زمان اجرا).
 */
export const WEBAUTHN_SUPPORTED_ALGORITHMS = WEBAUTHN_PUBLIC_KEY_ALGORITHMS;
