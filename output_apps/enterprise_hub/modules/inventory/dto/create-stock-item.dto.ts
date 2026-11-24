import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { CostingMethod } from '../enums/costing-method.enum';

/**
 * DTO ایجاد کالای جدید در فهرست انبار
 * (POST /enterprise-hub/inventory/items).
 */
export class CreateStockItemDto {
  @ApiProperty({ description: 'شناسه یکتای کالا (SKU)', example: 'SKU-ROX-1001' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sku: string;

  @ApiProperty({ description: 'بارکد کالا', example: '6260001234567' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  barcode: string;

  @ApiProperty({ description: 'نام کالا', example: 'روتر سازمانی مدل RX-900' })
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ description: 'شماره دسته پیش‌فرض', example: 'B-2026-09' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  batchNumber?: string;

  @ApiPropertyOptional({
    description: 'آستانه حداقل موجودی برای هشدار کسری',
    example: 5,
    default: 0,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minQuantity?: number;

  @ApiPropertyOptional({
    description: 'موجودی اولیه کالا (بدون ساخت دسته FIFO)',
    example: 0,
    default: 0,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  quantity?: number;

  @ApiPropertyOptional({
    description: 'روش ارزش‌گذاری موجودی (FIFO, AVCO, STANDARD)',
    enum: CostingMethod,
    default: CostingMethod.FIFO,
  })
  @IsOptional()
  @IsEnum(CostingMethod)
  costingMethod?: CostingMethod;

  @ApiPropertyOptional({
    description: 'بهای تمام‌شده استاندارد کالا برای روش STANDARD (ریال)',
    example: 1100000,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  standardCost?: number;
}
