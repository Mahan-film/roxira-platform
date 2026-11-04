import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const AMOUNT = /^-?\d{1,16}(\.\d{1,2})?$/;
const NON_NEGATIVE = /^\d{1,16}(\.\d{1,2})?$/;
const CODE = /^[0-9A-Za-z._-]+$/;

/** Inputs of the corporate income tax provision preview. Amounts are exact decimal strings in rials. */
export class CorporateTaxPreviewDto {
  @ApiProperty({ example: 1405 })
  @Type(() => Number)
  @IsInt()
  @Min(1300)
  @Max(1600)
  fiscalYear: number;

  @ApiProperty({ description: 'Accounting profit before tax; negative for a loss', example: '1000000000' })
  @IsString()
  @Matches(AMOUNT, { message: 'سود حسابداری باید عدد دهدهی دقیق باشد.' })
  accountingProfit: string;

  @ApiProperty({ example: '0' })
  @IsString()
  @Matches(NON_NEGATIVE, { message: 'مبلغ باید عدد غیرمنفی باشد.' })
  nonDeductibleAdditions: string;

  @ApiProperty({ example: '0' })
  @IsString()
  @Matches(NON_NEGATIVE, { message: 'مبلغ باید عدد غیرمنفی باشد.' })
  exemptIncomeAndDeductions: string;

  @ApiProperty({ example: '0' })
  @IsString()
  @Matches(NON_NEGATIVE, { message: 'مبلغ باید عدد غیرمنفی باشد.' })
  lossesBroughtForward: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(CODE)
  expenseAccountCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(CODE)
  payableAccountCode?: string;
}
