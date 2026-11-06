import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, Matches, Min } from 'class-validator';
import { DATE_ONLY } from './project.dto';

export class ProfitabilityQueryDto {
  @ApiPropertyOptional({ description: 'فقط یک پروژه' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  projectId?: number;

  @ApiPropertyOptional({ description: 'از تاریخ (YYYY-MM-DD)' })
  @IsOptional() @IsISO8601({ strict: true }) @Matches(DATE_ONLY)
  from?: string;

  @ApiPropertyOptional({ description: 'تا تاریخ (YYYY-MM-DD)' })
  @IsOptional() @IsISO8601({ strict: true }) @Matches(DATE_ONLY)
  to?: string;
}
