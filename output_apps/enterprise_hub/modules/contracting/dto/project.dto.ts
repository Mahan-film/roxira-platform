import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ProjectStatus } from '../enums/contracting.enum';

export const MONEY_STRING = /^\d{1,16}(\.\d{1,2})?$/;
export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class CreateProjectDto {
  @ApiProperty({ description: 'کد پروژه (یکتا در هر سازمان)', example: 'PRJ-01' })
  @IsString() @MinLength(1) @MaxLength(64) @Matches(/^[^\s]+$/, { message: 'کد پروژه نباید فاصله داشته باشد.' })
  code: string;

  @ApiProperty({ description: 'نام پروژه' })
  @IsString() @MinLength(1) @MaxLength(200) @Matches(/\S/, { message: 'نام پروژه نباید خالی باشد.' })
  name: string;

  @ApiPropertyOptional({ description: 'کد مرکز هزینه پروژه' })
  @IsOptional() @IsString() @MaxLength(64)
  costCentreCode?: string;

  @ApiPropertyOptional({ description: 'بودجه (ریال، رشته اعشاری)', example: '1000000000' })
  @IsOptional() @IsString() @Matches(MONEY_STRING, { message: 'مبلغ معتبر نیست.' })
  budget?: string;

  @ApiPropertyOptional({ description: 'تاریخ شروع (YYYY-MM-DD میلادی؛ در رابط جلالی نمایش داده می‌شود)' })
  @IsOptional() @IsISO8601({ strict: true }) @Matches(DATE_ONLY)
  startDate?: string;

  @ApiPropertyOptional({ description: 'تاریخ پایان' })
  @IsOptional() @IsISO8601({ strict: true }) @Matches(DATE_ONLY)
  endDate?: string;
}

/** `code` is never updatable. */
export class UpdateProjectDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) @Matches(/\S/, { message: 'نام پروژه نباید خالی باشد.' })
  name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64)
  costCentreCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(MONEY_STRING, { message: 'مبلغ معتبر نیست.' })
  budget?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) @Matches(DATE_ONLY)
  startDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) @Matches(DATE_ONLY)
  endDate?: string;
  @ApiPropertyOptional({ enum: ProjectStatus }) @IsOptional() @IsEnum(ProjectStatus)
  status?: ProjectStatus;
}

export class QueryProjectsDto {
  @ApiPropertyOptional({ enum: ProjectStatus }) @IsOptional() @IsEnum(ProjectStatus)
  status?: ProjectStatus;
  @ApiPropertyOptional({ description: 'جست‌وجو در کد یا نام' }) @IsOptional() @IsString() @MaxLength(100)
  search?: string;
  @ApiPropertyOptional({ default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  limit: number = 50;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset: number = 0;
}

export class ProjectResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ nullable: true, type: String }) costCentreCode: string | null;
  @ApiProperty({ description: 'بودجه؛ عدد دقیق یا رشته اعشاری', type: Object }) budget: number | string;
  @ApiPropertyOptional({ nullable: true, type: String }) startDate: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) endDate: string | null;
  @ApiProperty({ enum: ProjectStatus }) status: ProjectStatus;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class ProjectListResponseDto {
  @ApiProperty({ type: [ProjectResponseDto] }) data: ProjectResponseDto[];
  @ApiProperty() total: number;
}
