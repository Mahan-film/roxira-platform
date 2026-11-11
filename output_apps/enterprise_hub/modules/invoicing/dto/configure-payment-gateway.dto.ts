import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ConfigurePaymentGatewayDto {
  @ApiProperty({
    description: 'کد مرچنت درگاه پرداخت (مثلاً zibal)',
    example: 'zibal',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  merchantId: string;

  @ApiPropertyOptional({
    description: 'نام درگاه پرداخت',
    example: 'zibal',
    default: 'zibal',
  })
  @IsString()
  @IsOptional()
  @MaxLength(32)
  gateway?: string = 'zibal';
}

export class PaymentGatewayConfigResponseDto {
  @ApiProperty({ description: 'نام درگاه پرداخت', example: 'zibal' })
  gateway: string;

  @ApiProperty({ description: 'کد مرچنت ماسک‌شده', example: 'zib-****-bal' })
  maskedMerchantId: string;

  @ApiProperty({ description: 'وضعیت فعال‌بودن درگاه', example: true })
  isActive: boolean;

  @ApiProperty({ description: 'تاریخ آخرین به‌روزرسانی' })
  updatedAt: Date;
}
