import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Max, Min } from 'class-validator';

/**
 * DTO تنظیمات سازمان (PATCH /tenants/me/settings).
 * نرخ VAT به‌صورت نسبت ذخیره می‌شود (۰٫۱ = ۱۰٪).
 */
export class UpdateTenantSettingsDto {
  @ApiProperty({
    description: 'نرخ پیش‌فرض مالیات بر ارزش افزوده (نسبت؛ ۰٫۱ = ۱۰٪)',
    example: 0.1,
    minimum: 0,
    maximum: 1,
  })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  defaultVatRate: number;
}
