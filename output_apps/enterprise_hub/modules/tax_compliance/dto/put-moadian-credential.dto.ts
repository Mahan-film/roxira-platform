import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { MoadianSettlementMethod } from '../enums/moadian.enum';

/**
 * DTO ثبت/جایگزینی اطلاعات اتصال مستأجر به سامانه مودیان
 * (PUT /enterprise-hub/tax-compliance/moadian/credentials).
 *
 * کلید خصوصی فقط ورودی است؛ پیش از ذخیره با AES-256-GCM رمز می‌شود و هرگز در
 * هیچ پاسخی بازگردانده نمی‌شود.
 */
export class PutMoadianCredentialDto {
  @ApiProperty({ description: 'شناسه یکتای حافظه مالیاتی (۶ کاراکتر، از کارپوشه)', example: 'A1B2C3' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z0-9]{6}$/, { message: 'شناسه حافظه مالیاتی باید دقیقاً ۶ حرف/رقم باشد.' })
  memoryId: string;

  @ApiProperty({ description: 'شماره اقتصادی فروشنده (۱۱ تا ۱۴ رقم)', example: '10101010101' })
  @Matches(/^\d{11,14}$/, { message: 'شماره اقتصادی باید ۱۱ تا ۱۴ رقم باشد.' })
  economicCode: string;

  @ApiProperty({ description: 'گواهی امضای صادرشده توسط CA (PEM)' })
  @IsString()
  @MaxLength(16_384)
  @Matches(/-----BEGIN CERTIFICATE-----/, { message: 'گواهی باید در قالب PEM باشد.' })
  certificatePem: string;

  @ApiProperty({ description: 'کلید خصوصی RSA متناظر با گواهی (PEM، فقط ورودی)' })
  @IsString()
  @MaxLength(16_384)
  @Matches(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/, { message: 'کلید خصوصی باید در قالب PEM باشد.' })
  privateKeyPem: string;

  @ApiPropertyOptional({ description: 'شناسه ۱۳ رقمی پیش‌فرض کالا/خدمت', example: '2330001234567' })
  @IsOptional()
  @Matches(/^\d{13}$/, { message: 'شناسه کالا/خدمت باید ۱۳ رقم باشد.' })
  defaultSstid?: string;

  @ApiPropertyOptional({ description: 'کد واحد اندازه‌گیری پیش‌فرض (mu)' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  defaultMeasurementUnit?: string;

  @ApiPropertyOptional({ enum: MoadianSettlementMethod, default: MoadianSettlementMethod.CASH })
  @IsOptional()
  @IsEnum(MoadianSettlementMethod)
  settlementMethod?: MoadianSettlementMethod;
}
