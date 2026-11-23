import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

/**
 * DTO تنظیمات سازمان (PATCH /tenants/me/settings).
 * نرخ VAT به‌صورت نسبت ذخیره می‌شود (۰٫۱ = ۱۰٪).
 * فیلدهای بومی‌سازی شرکت (WAVE 15 - T137 / R4 Decision 1).
 */
export class UpdateTenantSettingsDto {
  @ApiPropertyOptional({
    description: 'کد کشور سازمان (ISO 3166-1 alpha-2). پس از ثبت نخستین سند قطعی قفل می‌شود.',
    example: 'IR',
  })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  countryCode?: string;

  @ApiPropertyOptional({
    description: 'کد ارز مبنا (ISO 4217). پس از ثبت نخستین سند قطعی قفل می‌شود.',
    example: 'IRR',
  })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  bookCurrencyCode?: string;

  @ApiPropertyOptional({
    description: 'تقویم پیش‌فرض سازمان (jalali یا gregorian)',
    example: 'jalali',
  })
  @IsOptional()
  @IsString()
  defaultCalendar?: string;

  @ApiPropertyOptional({
    description: 'منطقه زمانی IANA',
    example: 'Asia/Tehran',
  })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({
    description: 'لوکال BCP 47',
    example: 'fa-IR',
  })
  @IsOptional()
  @IsString()
  locale?: string;

  @ApiPropertyOptional({
    description: 'ماه شروع سال مالی (۱ تا ۱۲)',
    example: 1,
    minimum: 1,
    maximum: 12,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  fiscalYearStartMonth?: number;

  @ApiPropertyOptional({
    description:
      'حالت بدون رصد کارکنان (BetrVG §87(1)6): داشبوردهای فعالیت فردی و آمار مصرف هوش مصنوعی کاربران را مخفی می‌کند.',
    example: true,
  })
  @IsOptional()
  @Transform(({ obj, key }) => (obj as Record<string, unknown>)[key])
  @IsBoolean()
  noEmployeeTelemetry?: boolean;
}
