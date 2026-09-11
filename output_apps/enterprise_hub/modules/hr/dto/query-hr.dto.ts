import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { EmployeeStatus } from '../enums/hr.enum';

/**
 * DTO فیلتر و صفحه‌بندی پرسنل
 * (GET /enterprise-hub/hr/employees).
 */
export class QueryEmployeeDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ description: 'جست‌وجو در نام، نام خانوادگی، کد پرسنلی یا کد ملی' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ description: 'فیلتر وضعیت استخدامی', enum: EmployeeStatus })
  @IsOptional()
  @IsEnum(EmployeeStatus)
  status?: EmployeeStatus;

  @ApiPropertyOptional({ description: 'فیلتر واحد سازمانی' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  department?: string;
}

/**
 * DTO فیلتر و صفحه‌بندی فیش‌های حقوقی
 * (GET /enterprise-hub/hr/payslips).
 */
export class QueryPayslipDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ description: 'فیلتر شناسه کارمند' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  employeeId?: number;

  @ApiPropertyOptional({ description: 'فیلتر سال دوره حقوقی' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1390)
  @Max(1450)
  periodYear?: number;

  @ApiPropertyOptional({ description: 'فیلتر ماه دوره حقوقی' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  periodMonth?: number;
}
