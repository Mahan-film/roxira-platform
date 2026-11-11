import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';

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

  @ApiPropertyOptional({ description: 'شناسه ۱۳ رقمی کالا/خدمت مودیان (SSTID)' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776))
          .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632))
          .replace(/\s+/g, '')
      : value,
  )
  @Matches(/^\d{13}$/, {
    message: 'شناسه کالا/خدمت مودیان (SSTID) باید دقیقاً ۱۳ رقم عددی باشد.',
  })
  taxCode?: string;
}
