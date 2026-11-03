import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * DTO فیلتر/صفحه‌بندی فهرست کالاهای انبار
 * (GET /enterprise-hub/inventory/items).
 */
export class QueryStockItemDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ description: 'جست‌وجوی جزئی در SKU، بارکد یا نام کالا' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({
    description: 'فقط کالاهای زیر آستانه حداقل موجودی (کسری)',
    default: false,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  lowStockOnly?: boolean = false;

  @ApiPropertyOptional({
    description: 'فقط کالاهای بدون هیچ لایهٔ موجود (مثلاً واردشده از فایل و هنوز بدون موجودی اولیه)',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  noStockOnly?: boolean = false;
}
