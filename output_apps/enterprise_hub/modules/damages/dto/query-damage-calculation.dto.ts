import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * DTO فیلتر/صفحه‌بندی برای فهرست رکوردهای محاسبه‌شده.
 */
export class QueryDamageCalculationDto {
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

  @ApiPropertyOptional({ description: 'فیلتر بر اساس شماره قرارداد/فاکتور' })
  @IsOptional()
  @IsString()
  contractReferenceNumber?: string;
}
