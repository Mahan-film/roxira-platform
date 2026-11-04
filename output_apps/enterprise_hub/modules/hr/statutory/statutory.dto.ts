import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsDefined,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { MAX_PERIOD_YEAR, MIN_PERIOD_YEAR } from '../constants/hr.constants';

export class StatutoryYearQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;
}

export class ContractTermsQueryDto {
  @ApiProperty({ example: '2026-06-01', description: 'Gregorian date the terms must be in force on' })
  @IsDateString({ strict: true })
  asOf: string;
}

export class SetStatutoryParameterDto {
  @ApiProperty({ example: 1405 })
  @IsInt()
  @Min(MIN_PERIOD_YEAR)
  @Max(MAX_PERIOD_YEAR)
  fiscalYear: number;

  @ApiProperty({ example: 'housing_allowance' })
  @IsString()
  @Matches(/^[a-z0-9_]{1,64}$/)
  key: string;

  @ApiProperty({
    description:
      'money and counts: whole number. Rates: decimal string such as "0.07". Brackets: [{upTo, rate}], last upTo null.',
  })
  @IsDefined()
  value: unknown;

  @ApiPropertyOptional({ description: 'Gregorian date inside the fiscal year' })
  @IsOptional()
  @IsDateString({ strict: true })
  effectiveFrom?: string;

  @ApiProperty({ description: 'Circular number, date, or where this value comes from' })
  @IsString()
  @Length(3, 500)
  source: string;

  @ApiProperty({ description: 'Checked by a person against the official text' })
  @IsBoolean()
  verified: boolean;
}

export class StatutoryParameterResponseDto {
  @ApiProperty() key: string;
  @ApiProperty() label: string;
  @ApiProperty() value: unknown;
  @ApiProperty() effectiveFrom: string;
  @ApiProperty() version: number;
  @ApiProperty() source: string;
  @ApiProperty() sourceKind: string;
  @ApiProperty() verified: boolean;
  @ApiProperty() unclear: boolean;
  @ApiProperty() tenantOverride: boolean;
}
