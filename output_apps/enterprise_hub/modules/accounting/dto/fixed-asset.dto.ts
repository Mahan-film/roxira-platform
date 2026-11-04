import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { IsMoneyAmount } from './money.validator';

const CODE = /^[A-Za-z0-9._-]{1,32}$/;

export class CreateFixedAssetDto {
  @ApiProperty({ example: 'FA-001' })
  @Matches(CODE, { message: 'کد فقط حروف لاتین، عدد و . _ - تا ۳۲ نویسه' })
  code: string;

  @ApiProperty({ example: 'لپ‌تاپ مدیریت' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name: string;

  @ApiProperty({ example: 'FURNITURE', description: 'دسته دارایی (آزاد؛ برای گزارش)' })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  category: string;

  @ApiProperty({ example: '2026-04-10' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  acquisitionDate: string;

  @ApiProperty({ example: '120000000.00' })
  @IsMoneyAmount()
  cost: number | string;

  @ApiPropertyOptional({ example: '0' })
  @IsOptional()
  @IsMoneyAmount()
  salvageValue?: number | string;

  @ApiProperty({ enum: ['STRAIGHT_LINE', 'DECLINING_BALANCE'] })
  @IsIn(['STRAIGHT_LINE', 'DECLINING_BALANCE'])
  method: 'STRAIGHT_LINE' | 'DECLINING_BALANCE';

  @ApiPropertyOptional({ description: 'عمر مفید به ماه (خط مستقیم)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1200)
  lifeMonths?: number;

  @ApiPropertyOptional({ example: '0.25', description: 'نرخ سالانه نزولی به‌صورت نسبت' })
  @IsOptional()
  @Matches(/^(0(\.\d{1,6})?|1(\.0{1,6})?)$/)
  annualRate?: string;

  @ApiPropertyOptional({ description: 'منبع نرخ (ماده قانون یا بخشنامه)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rateSource?: string;

  @ApiProperty({ example: '1113' })
  @IsString()
  @MaxLength(32)
  assetAccountCode: string;

  @ApiProperty({ example: '1115' })
  @IsString()
  @MaxLength(32)
  accumulatedAccountCode: string;

  @ApiProperty({ example: '5030' })
  @IsString()
  @MaxLength(32)
  expenseAccountCode: string;
}

export class DepreciationRunDto {
  @ApiProperty({ example: 1405 })
  @Type(() => Number)
  @IsInt()
  @Min(1300)
  @Max(1600)
  year: number;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;
}
