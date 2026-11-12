import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export enum ElectronicBooksFormat {
  AUTO = 'auto',
  XLSX = 'xlsx',
  CSV = 'csv',
}

export enum ElectronicBooksUnitDto {
  MILLION_RIAL = 'million_rial',
  RIAL = 'rial',
}

export enum ElectronicBooksVoucherScopeDto {
  OPERATIONAL = 'operational',
  OPENING = 'opening',
  CLOSING_TEMP = 'closing_temp',
  CLOSING_PERM = 'closing_perm',
}

/**
 * Parameters selecting the period, unit, voucher scope, and aggregation for statutory electronic commercial books export.
 * If quarter, month, and half are omitted, the export covers the full Jalali year.
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

  @ApiPropertyOptional({ description: 'قالب خروجی (auto، xlsx یا csv)', enum: ElectronicBooksFormat })
  @IsOptional()
  @IsEnum(ElectronicBooksFormat, { message: 'قالب خروجی نامعتبر است.' })
  format?: ElectronicBooksFormat;

  @ApiPropertyOptional({ description: 'واحد مبلغ (million_rial یا rial)', enum: ElectronicBooksUnitDto })
  @IsOptional()
  @IsEnum(ElectronicBooksUnitDto, { message: 'واحد مبلغ نامعتبر است.' })
  unit?: 'million_rial' | 'rial';

  @ApiPropertyOptional({
    description: 'دامنه اسناد (operational، opening، closing_temp یا closing_perm)',
    enum: ElectronicBooksVoucherScopeDto,
  })
  @IsOptional()
  @IsEnum(ElectronicBooksVoucherScopeDto, { message: 'دامنه اسناد نامعتبر است.' })
  voucherScope?: 'operational' | 'opening' | 'closing_temp' | 'closing_perm';

  @ApiPropertyOptional({ description: 'تجمیع ماهانه در سطح معین با تاریخ آخرین روز ماه', example: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean({ message: 'مقدار تجمیع ماهانه باید بولی باشد.' })
  monthlyAggregate?: boolean;
}

export class QueryElectronicBooksPresetsDto {
  @ApiProperty({ description: 'سال شمسی (مثلاً ۱۴۰۴ یا ۱۴۰۵)', example: 1405 })
  @Type(() => Number)
  @IsInt({ message: 'سال باید عدد صحیح باشد.' })
  @Min(1300, { message: 'سال معتبر نیست.' })
  @Max(1600, { message: 'سال معتبر نیست.' })
  year: number;
}
