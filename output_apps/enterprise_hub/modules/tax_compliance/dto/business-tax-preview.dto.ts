import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

const NON_NEGATIVE = /^\d{1,16}(\.\d{1,2})?$/;

export class BusinessUnitDto {
  @ApiProperty({ example: '5000000000', description: 'Revenue of the business unit for the year, rials' })
  @IsString()
  @Matches(NON_NEGATIVE, { message: 'درآمد باید عدد غیرمنفی باشد.' })
  revenue: string;

  @ApiProperty({ example: '3000000000', description: 'Deductible expenses of the unit, rials' })
  @IsString()
  @Matches(NON_NEGATIVE, { message: 'هزینه باید عدد غیرمنفی باشد.' })
  deductibleExpenses: string;
}

export class PartnerDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiProperty({ description: 'Share in basis points (10000 = 100%)', example: 5000 })
  @Type(() => Number)
  @IsInt({ message: 'سهم شریک باید عدد صحیح (ده‌هزارم) باشد.' })
  @Min(1)
  @Max(10000)
  shareBps: number;

  @ApiPropertyOptional({ description: 'Partners with the same group id are spouses and count as one partner for the exemption' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  spouseGroup?: string;
}

/** Inputs of the business owner / civil partnership income tax preview. */
export class BusinessTaxPreviewDto {
  @ApiProperty({ example: 1405 })
  @Type(() => Number)
  @IsInt()
  @Min(1300)
  @Max(1600)
  fiscalYear: number;

  @ApiProperty({ enum: ['SOLE', 'PARTNERSHIP'] })
  @IsIn(['SOLE', 'PARTNERSHIP'], { message: 'نوع مؤدی باید SOLE یا PARTNERSHIP باشد.' })
  mode: 'SOLE' | 'PARTNERSHIP';

  @ApiProperty({ type: [BusinessUnitDto], description: 'Every business unit of the taxpayer or the partnership' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => BusinessUnitDto)
  units: BusinessUnitDto[];

  @ApiPropertyOptional({ type: [PartnerDto], description: 'Required for PARTNERSHIP, at least two partners' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PartnerDto)
  partners?: PartnerDto[];
}
