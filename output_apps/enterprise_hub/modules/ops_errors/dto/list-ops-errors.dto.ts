import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { OPS_ERROR_SOURCES } from '../constants/ops-errors.constants';

/** Query for the admin list of recent error fingerprints. */
export class ListOpsErrorsQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 25;

  @ApiPropertyOptional({ enum: OPS_ERROR_SOURCES })
  @IsOptional()
  @IsIn(OPS_ERROR_SOURCES as unknown as string[])
  source?: string;
}

export class OpsErrorItemDto {
  id!: string;
  fingerprint!: string;
  shortId!: string;
  day!: string;
  source!: string;
  errorClass!: string;
  firstSeen!: Date;
  lastSeen!: Date;
  count!: number;
  route!: string | null;
  httpMethod!: string | null;
  status!: number | null;
  release!: string | null;
  sampleMessage!: string | null;
}

export class OpsErrorListResponseDto {
  items!: OpsErrorItemDto[];
  total!: number;
  page!: number;
  limit!: number;
}
