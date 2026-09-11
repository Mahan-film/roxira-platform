import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * DTO ورود کالا به انبار (Inbound / Receive).
 * هر ورود یک لایه FIFO جدید با بهای خرید مشخص می‌سازد.
 */
export class InboundStockDto {
  @ApiProperty({ description: 'شناسه کالا (SKU)', example: 'SKU-ROX-1001' })
  @IsString()
  @MaxLength(64)
  sku: string;

  @ApiProperty({ description: 'مقدار ورودی', example: 25, minimum: 0.01 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  quantity: number;

  @ApiProperty({ description: 'بهای خرید واحد به ریال', example: 18500000, minimum: 0.01 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  unitPurchaseCost: number;

  @ApiPropertyOptional({ description: 'شناسه انبار مقصد', example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  warehouseId?: number;

  @ApiPropertyOptional({
    description: 'شماره دسته (در صورت عدم ارسال خودکار تولید می‌شود)',
    example: 'B-2026-09-01',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  batchNumber?: string;

  @ApiPropertyOptional({ description: 'شرح/مرجع رسید ورود', example: 'خرید از تأمین‌کننده الف' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  reference?: string;
}

/**
 * DTO خروج کالا از انبار (Outbound / Issue).
 * مصرف دسته‌ها به‌ترتیب FIFO و محاسبه بهای تمام‌شده انجام می‌شود.
 */
export class OutboundStockDto {
  @ApiProperty({ description: 'شناسه کالا (SKU)', example: 'SKU-ROX-1001' })
  @IsString()
  @MaxLength(64)
  sku: string;

  @ApiProperty({ description: 'مقدار خروجی', example: 10, minimum: 0.01 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  quantity: number;

  @ApiPropertyOptional({
    description: 'شناسه انبار مبدأ (در صورت عدم ارسال از همه انبارها به‌ترتیب FIFO)',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  warehouseId?: number;

  @ApiPropertyOptional({ description: 'شرح/مرجع حواله خروج', example: 'فروش به مشتری ب' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  reference?: string;
}
