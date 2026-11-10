import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class ChequeCalculationItemDto {
  @ApiPropertyOptional({ description: 'شناسه اختیاری چک در پایگاه داده یا شماره ردیف', example: 101 })
  @IsOptional()
  id?: string | number;

  @ApiProperty({ description: 'مبلغ چک (ریال)', example: '50000000' })
  @IsNotEmpty({ message: 'مبلغ چک الزامی است.' })
  amount: string;

  @ApiProperty({ description: 'تاریخ سررسید چک (YYYY-MM-DD یا ISO)', example: '2026-12-01' })
  @IsNotEmpty({ message: 'تاریخ سررسید الزامی است.' })
  @IsString()
  dueDate: string;

  @ApiPropertyOptional({ description: 'شماره ۱۶ رقمی صیاد', example: '1234567890123456' })
  @IsOptional()
  @IsString()
  sayadNumber?: string;

  @ApiPropertyOptional({ description: 'شرح یا بابت', example: 'تسویه فاکتور فروشگاه' })
  @IsOptional()
  @IsString()
  description?: string;
}

export class CalculateRasgiriDto {
  @ApiProperty({
    description: 'فهرست چک‌ها برای محاسبه راس‌گیری',
    type: [ChequeCalculationItemDto],
  })
  @IsArray({ message: 'فهرست چک‌ها باید آرایه باشد.' })
  @ValidateNested({ each: true })
  @Type(() => ChequeCalculationItemDto)
  items: ChequeCalculationItemDto[];

  @ApiPropertyOptional({
    description: 'تاریخ مبنا (پیش‌فرض: امروز YYYY-MM-DD)',
    example: '2026-11-11',
  })
  @IsOptional()
  @IsString()
  baseDate?: string;
}

export class CalculateDiscountDto {
  @ApiProperty({
    description: 'فهرست چک‌ها برای محاسبه تنزیل',
    type: [ChequeCalculationItemDto],
  })
  @IsArray({ message: 'فهرست چک‌ها باید آرایه باشد.' })
  @ValidateNested({ each: true })
  @Type(() => ChequeCalculationItemDto)
  items: ChequeCalculationItemDto[];

  @ApiProperty({
    description: 'نرخ تنزیل سالانه به درصد (مثلاً ۲۴ برای ۲۴٪)',
    example: 24,
  })
  @IsNumber({}, { message: 'نرخ تنزیل باید عدد باشد.' })
  @Min(0, { message: 'نرخ تنزیل نمی‌تواند منفی باشد.' })
  annualRatePercent: number;

  @ApiPropertyOptional({
    description: 'تاریخ مبنا (پیش‌فرض: امروز YYYY-MM-DD)',
    example: '2026-11-11',
  })
  @IsOptional()
  @IsString()
  baseDate?: string;
}

export class CalculateSingleDiscountDto {
  @ApiProperty({ description: 'مبلغ چک (ریال)', example: '100000000' })
  @IsNotEmpty({ message: 'مبلغ چک الزامی است.' })
  amount: string;

  @ApiProperty({ description: 'تعداد روز تا سررسید', example: 90 })
  @IsNumber({}, { message: 'تعداد روز باید عدد باشد.' })
  @Min(0, { message: 'تعداد روز نمی‌تواند منفی باشد.' })
  days: number;

  @ApiProperty({ description: 'نرخ سالانه درصد', example: 24 })
  @IsNumber({}, { message: 'نرخ تنزیل باید عدد باشد.' })
  @Min(0, { message: 'نرخ تنزیل نمی‌تواند منفی باشد.' })
  annualRatePercent: number;
}
