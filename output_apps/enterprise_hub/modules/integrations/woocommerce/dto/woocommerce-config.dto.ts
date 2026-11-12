import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class UpdateWooCommerceConfigDto {
  @ApiProperty({ description: 'URL فروشگاه ووکامرس', example: 'https://shop.example.com' })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(500)
  storeUrl: string;

  @ApiPropertyOptional({ description: 'Consumer Key ووکامرس (ck_...)', example: 'ck_9a8b7c6d5e4f3a2b1c' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  consumerKey?: string;

  @ApiPropertyOptional({ description: 'Consumer Secret ووکامرس (cs_...)', example: 'cs_1a2b3c4d5e6f7a8b9c' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  consumerSecret?: string;

  @ApiPropertyOptional({ description: 'کلید وب‌هوک برای اعتبارسنجی امضا (در صورت خالی بودن تولید خودکار می‌شود)' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  webhookSecret?: string;

  @ApiPropertyOptional({ description: 'همگام‌سازی خودکار سفارش‌ها', default: true })
  @IsOptional()
  @IsBoolean()
  autoSyncOrders?: boolean;

  @ApiPropertyOptional({ description: 'ارسال خودکار تغییرات موجودی کالا به ووکامرس', default: true })
  @IsOptional()
  @IsBoolean()
  autoSyncStock?: boolean;
}

export class WooCommerceConfigResponseDto {
  @ApiProperty({ description: 'URL فروشگاه ووکامرس' })
  storeUrl: string;

  @ApiProperty({ description: 'کلید ماسک‌شده مصرف‌کننده' })
  maskedConsumerKey: string;

  @ApiProperty({ description: 'آیا کلید سکرت ذخیره شده است' })
  hasConsumerSecret: boolean;

  @ApiProperty({ description: 'کلید مخفی وب‌هوک' })
  webhookSecret: string;

  @ApiProperty({ description: 'آدرس وب‌هوک برای ثبت در تنظیمات ووکامرس' })
  webhookUrl: string;

  @ApiProperty({ description: 'همگام‌سازی خودکار سفارش‌ها' })
  autoSyncOrders: boolean;

  @ApiProperty({ description: 'همگام‌سازی خودکار موجودی' })
  autoSyncStock: boolean;

  @ApiPropertyOptional({ description: 'زمان آخرین همگام‌سازی' })
  lastSyncAt: Date | null;

  @ApiProperty({ description: 'تاریخ آخرین ویرایش' })
  updatedAt: Date;
}
