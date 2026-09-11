import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

/**
 * DTO پیش‌محاسبه حقوق یک قرارداد/کارمند
 * (POST /enterprise-hub/hr/payroll/calculate).
 *
 * تعیین `contractId` یا `employeeId` الزامی است؛ در حالت دوم آخرین
 * قرارداد فعال کارمند انتخاب می‌شود. این اعتبارسنجی در لایه Service
 * انجام می‌گیرد.
 */
export class CalculatePayrollDto {
  @ApiPropertyOptional({ description: 'شناسه قرارداد حقوقی', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  contractId?: number;

  @ApiPropertyOptional({ description: 'شناسه کارمند', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  employeeId?: number;

  @ApiPropertyOptional({ description: 'مبلغ اضافه‌کاری (ریال)', example: 5000000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  overtimeAmount?: number;

  @ApiPropertyOptional({ description: 'سایر کسورات (ریال)', example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  otherDeductions?: number;
}

/**
 * DTO صدور فیش حقوقی و ثبت خودکار سند هزینه حقوق
 * (POST /enterprise-hub/hr/payslips).
 */
export class IssuePayslipDto {
  @ApiPropertyOptional({ description: 'شناسه قرارداد حقوقی', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  contractId?: number;

  @ApiPropertyOptional({ description: 'شناسه کارمند', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  employeeId?: number;

  @ApiPropertyOptional({ description: 'سال دوره حقوقی (شمسی/میلادی)', example: 1405 })
  @Type(() => Number)
  @IsInt()
  @Min(1390)
  @Max(1450)
  periodYear: number;

  @ApiPropertyOptional({ description: 'ماه دوره حقوقی', example: 9 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  periodMonth: number;

  @ApiPropertyOptional({ description: 'مبلغ اضافه‌کاری (ریال)', example: 5000000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  overtimeAmount?: number;

  @ApiPropertyOptional({ description: 'سایر کسورات (ریال)', example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  otherDeductions?: number;
}
