import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CancelTenantDto {
  @ApiPropertyOptional({
    description: 'دلیل لغو اشتراک سازمان',
    example: 'مهاجرت به نرم‌افزار دیگر یا پایان فعالیت',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @ApiPropertyOptional({
    description: 'تعداد روزهای نگهداری داده‌ها در حالت فقط خواندنی پیش از حذف دائم (بین ۳۰ تا ۹۰ روز)',
    example: 30,
    default: 30,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(90)
  gracePeriodDays?: number;
}

export class TenantCancellationStatusResponseDto {
  @ApiProperty({ example: 'cancelled_readonly' })
  status: string;

  @ApiProperty({ example: true })
  isReadonly: boolean;

  @ApiPropertyOptional({ example: '2026-11-16T10:00:00Z' })
  cancelledAt: string | null;

  @ApiPropertyOptional({ example: '2026-12-16T10:00:00Z' })
  deleteAfter: string | null;

  @ApiPropertyOptional({ example: 30 })
  daysRemaining: number | null;

  @ApiPropertyOptional({ example: 'پایان فعالیت تجاری' })
  cancellationReason: string | null;
}
