import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PeriodCalendarType } from '../enums/accounting.enum';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const toBoolean = ({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown => {
  const raw = obj?.[key];
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
};

export class CreateAccountingPeriodDto {
  @ApiProperty({ example: '2026-10' })
  @IsString()
  @MaxLength(32)
  code: string;

  @ApiProperty({ example: 'October 2026' })
  @IsString()
  @MaxLength(64)
  name: string;

  @ApiProperty({ example: '2026-10-01' })
  @Matches(DATE_ONLY, { message: 'periodStart must be YYYY-MM-DD' })
  periodStart: string;

  @ApiProperty({ example: '2026-10-31' })
  @Matches(DATE_ONLY, { message: 'periodEnd must be YYYY-MM-DD' })
  periodEnd: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  fiscalYearId?: number | null;

  @ApiPropertyOptional({ enum: PeriodCalendarType, default: PeriodCalendarType.GREGORIAN })
  @IsOptional()
  @IsEnum(PeriodCalendarType)
  calendarType?: PeriodCalendarType;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isAdjustment?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedRoles?: string[];
}

export class SoftLockPeriodDto {
  @ApiPropertyOptional({ type: [String], example: ['chief-accountant'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedRoles?: string[];

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class HardClosePeriodDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
