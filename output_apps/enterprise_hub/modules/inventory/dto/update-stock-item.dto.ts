import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { CostingMethod } from '../enums/costing-method.enum';

/**
 * DTO ویرایش کالای موجود (PATCH /enterprise-hub/inventory/items/:id).
 * تمام فیلدها اختیاری‌اند و فقط موارد ارسال‌شده به‌روزرسانی می‌شوند.
 */
export class UpdateStockItemDto {
  @ApiPropertyOptional({ description: 'بارکد جدید کالا' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  barcode?: string;

  @ApiPropertyOptional({ description: 'نام جدید کالا' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ description: 'شماره دسته پیش‌فرض' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  batchNumber?: string;

  @ApiPropertyOptional({ description: 'آستانه حداقل موجودی', minimum: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minQuantity?: number;

  @ApiPropertyOptional({
    description: 'روش قیمت‌گذاری (FIFO, AVCO, STANDARD)',
    enum: CostingMethod,
  })
  @IsOptional()
  @IsEnum(CostingMethod)
  costingMethod?: CostingMethod;

  @ApiPropertyOptional({
    description: 'بهای تمام‌شده استاندارد برای روش STANDARD',
    minimum: 0,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  standardCost?: number;
}
