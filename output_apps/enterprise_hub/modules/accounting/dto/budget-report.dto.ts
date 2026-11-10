import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class BudgetVsActualQueryDto {
  @ApiProperty({ description: 'شناسه سال مالی', example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  fiscalYearId: number;

  @ApiPropertyOptional({ description: 'شناسه مرکز هزینه', example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  costCenterId?: number;

  @ApiPropertyOptional({ description: 'کد مرکز هزینه', example: 'CC-101' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  costCenterCode?: string;
}

export class SetAccountBudgetDto {
  @ApiProperty({ description: 'شناسه سال مالی', example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  fiscalYearId: number;

  @ApiProperty({ description: 'کد حساب کل یا معین', example: '5010' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  accountCode: string;

  @ApiPropertyOptional({ description: 'شناسه مرکز هزینه (اختیاری)', example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  costCenterId?: number;

  @ApiProperty({ description: 'سقف مبلغ بودجه (ریال)', example: '1000000000' })
  @IsNotEmpty()
  budgetAmount: number | string;
}
