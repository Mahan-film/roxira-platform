import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export enum ElectronicBooksFormat {
  XLSX = 'xlsx',
  CSV = 'csv',
}

/**
 * Parameters selecting the period for statutory electronic commercial books export.
 * If quarter, month, and half are omitted, the periodicity is resolved from the statutory settings store.
 */
export class QueryElectronicBooksDto {
  @ApiProperty({ description: 'سال شمسی (مثلاً ۱۴۰۴ یا ۱۴۰۵)', example: 1405 })
  @Type(() => Number)
  @IsInt({ message: 'سال باید عدد صحیح باشد.' })
  @Min(1300, { message: 'سال معتبر نیست.' })
  @Max(1600, { message: 'سال معتبر نیست.' })
  year: number;

  @ApiPropertyOptional({ description: 'فصل (۱ = بهار … ۴ = زمستان)', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'فصل باید عدد صحیح باشد.' })
  @Min(1, { message: 'فصل باید عددی از ۱ تا ۴ باشد.' })
  @Max(4, { message: 'فصل باید عددی از ۱ تا ۴ باشد.' })
  quarter?: number;

  @ApiPropertyOptional({ description: 'ماه شمسی (۱ تا ۱۲)', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'ماه باید عدد صحیح باشد.' })
  @Min(1, { message: 'ماه باید عددی از ۱ تا ۱۲ باشد.' })
  @Max(12, { message: 'ماه باید عددی از ۱ تا ۱۲ باشد.' })
  month?: number;

  @ApiPropertyOptional({ description: 'دوره ۶ ماهه (۱ = نیمه اول، ۲ = نیمه دوم)', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'دوره شش‌ماهه باید ۱ یا ۲ باشد.' })
  @Min(1, { message: 'دوره شش‌ماهه باید ۱ یا ۲ باشد.' })
  @Max(2, { message: 'دوره شش‌ماهه باید ۱ یا ۲ باشد.' })
  half?: number;

  @ApiPropertyOptional({ description: 'قالب خروجی (xlsx یا csv)', enum: ElectronicBooksFormat })
  @IsOptional()
  @IsEnum(ElectronicBooksFormat, { message: 'قالب خروجی نامعتبر است.' })
  format?: ElectronicBooksFormat;
}
