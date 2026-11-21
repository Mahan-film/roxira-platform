import { ApiProperty } from '@nestjs/swagger';
import { TenantEntity } from '../entities/tenant.entity';
import { TenantRole } from '../enums/tenant-role.enum';

/**
 * پاسخ سازمان جاری کاربر (GET /tenants/me).
 * شناسه و اسلاگ سازمان از رکورد `tenants` و نقش از claim تأییدشده JWT می‌آید.
 */
export class TenantMeResponseDto {
  @ApiProperty({ example: '0b0f6a24-6d5f-4f5b-9f8e-2e5a3c1d7b90' })
  id: string;

  @ApiProperty({ example: 'شرکت توسعه فناوری پارس' })
  name: string;

  @ApiProperty({ example: 'pars-a1b2c3' })
  slug: string;

  @ApiProperty({
    enum: TenantRole,
    nullable: true,
    example: TenantRole.OWNER,
  })
  tenantRole: TenantRole | null;

  @ApiProperty({ description: 'کد کشور سازمان (ISO 3166-1 alpha-2)', example: 'IR' })
  countryCode: string;

  @ApiProperty({ description: 'نسخه بسته کشوری', example: '1.0.0' })
  packVersion: string;

  @ApiProperty({ description: 'کد ارز مبنا (ISO 4217)', example: 'IRR' })
  bookCurrencyCode: string;

  @ApiProperty({ description: 'تقویم پیش‌فرض سازمان', example: 'jalali' })
  defaultCalendar: string;

  @ApiProperty({ description: 'منطقه زمانی', example: 'Asia/Tehran' })
  timezone: string;

  @ApiProperty({ description: 'زبان و لوکال اصلی', example: 'fa-IR' })
  locale: string;

  @ApiProperty({ description: 'ماه شروع سال مالی (۱ تا ۱۲)', example: 1 })
  fiscalYearStartMonth: number;

  @ApiProperty({
    description: 'حالت بدون رصد کارکنان (Works-Council / BetrVG §87(1)6)',
    example: false,
  })
  noEmployeeTelemetry: boolean;

  static fromEntity(
    tenant: TenantEntity,
    tenantRole: TenantRole | null,
  ): TenantMeResponseDto {
    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      tenantRole,
      countryCode: tenant.countryCode ?? 'IR',
      packVersion: tenant.packVersion ?? '1.0.0',
      bookCurrencyCode: tenant.bookCurrencyCode ?? 'IRR',
      defaultCalendar: tenant.defaultCalendar ?? 'jalali',
      timezone: tenant.timezone ?? 'Asia/Tehran',
      locale: tenant.locale ?? 'fa-IR',
      fiscalYearStartMonth: tenant.fiscalYearStartMonth ?? 1,
      noEmployeeTelemetry: Boolean(tenant.noEmployeeTelemetry ?? false),
    };
  }
}
