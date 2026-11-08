import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AggregateFunc, FilterOperator } from '../constants/report-builder.constants';

export class ReportFilterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  column!: string;

  @IsString()
  @IsIn([
    'eq',
    'neq',
    'gt',
    'gte',
    'lt',
    'lte',
    'contains',
    'in',
    'between',
    'is_null',
    'is_not_null',
  ])
  op!: FilterOperator;

  @IsOptional()
  value?: unknown;
}

export class ReportAggregateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  column!: string;

  @IsString()
  @IsIn(['sum', 'count', 'avg', 'min', 'max'])
  func!: AggregateFunc;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  alias?: string;
}

export class ReportOrderByDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  column!: string;

  @IsString()
  @IsIn(['asc', 'desc', 'ASC', 'DESC'])
  direction!: 'asc' | 'desc' | 'ASC' | 'DESC';
}

export class ExecuteReportQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  dataset!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  columns?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReportFilterDto)
  @ArrayMaxSize(30)
  filters?: ReportFilterDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  groupBy?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReportAggregateDto)
  @ArrayMaxSize(20)
  aggregates?: ReportAggregateDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReportOrderByDto)
  @ArrayMaxSize(10)
  orderBy?: ReportOrderByDto[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5000)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;
}

export class SaveReportTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  dataset!: string;

  @ValidateNested()
  @Type(() => ExecuteReportQueryDto)
  config!: ExecuteReportQueryDto;
}

export class ExportReportDto extends ExecuteReportQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(['xlsx', 'pdf'])
  format?: 'xlsx' | 'pdf';

  @IsOptional()
  @IsString()
  @MaxLength(128)
  title?: string;
}

export interface ReportQueryResultView {
  dataset: string;
  columns: Array<{ id: string; labelFa: string; type: string }>;
  rows: Array<Record<string, unknown>>;
  totalRows: number;
  durationMs: number;
  aggregates?: Record<string, string | number>;
}

export interface ReportTemplateView {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  dataset: string;
  config: ExecuteReportQueryDto;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}
