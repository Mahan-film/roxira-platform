import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { FiscalYearStatus } from '../enums/accounting.enum';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class CreateFiscalYearDto {
  @ApiProperty({ example: '1405' })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  name: string;

  @ApiProperty({ example: '2026-03-21' })
  @Matches(DATE_ONLY, { message: 'startDate must be YYYY-MM-DD' })
  startDate: string;

  @ApiProperty({ example: '2027-03-20' })
  @Matches(DATE_ONLY, { message: 'endDate must be YYYY-MM-DD' })
  endDate: string;
}

export class CloseFiscalYearDto {
  @ApiPropertyOptional({
    type: CreateFiscalYearDto,
    description: 'The next year, unless it already exists. It must start the day after this year ends.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateFiscalYearDto)
  nextYear?: CreateFiscalYearDto;
}

export class ReopenFiscalYearDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason: string;
}

export class FiscalYearResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty() startDate: string;
  @ApiProperty() endDate: string;
  @ApiProperty({ enum: FiscalYearStatus }) status: FiscalYearStatus;
  @ApiProperty({ nullable: true }) closedAt: Date | null;
  @ApiProperty({ nullable: true }) closedBy: string | null;
}

export class CloseResultDto {
  @ApiProperty({ type: FiscalYearResponseDto }) year: FiscalYearResponseDto;
  @ApiProperty({ type: FiscalYearResponseDto }) nextYear: FiscalYearResponseDto;
  @ApiProperty({ description: 'Numbers of the entries the close posted', type: [String] }) entryNumbers: string[];
}

export class ChartTemplateResponseDto {
  @ApiProperty() key: string;
  @ApiProperty() name: string;
  @ApiProperty() description: string;
  @ApiProperty() accountCount: number;
}

export class ApplyChartTemplateResponseDto {
  @ApiProperty({ description: 'Accounts added to the chart' }) added: number;
  @ApiProperty({ description: 'Existing accounts given a level and a statement line' }) classified: number;
}
