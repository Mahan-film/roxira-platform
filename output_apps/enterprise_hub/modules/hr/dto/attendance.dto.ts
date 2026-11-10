import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * DTO ثبت یا به‌روزرسانی کارکرد و حضور و غیاب ماهانه پرسنل
 */
export class RecordAttendanceDto {
  @ApiProperty({ description: 'شناسه کارمند', example: 1 })
  @IsInt()
  @Type(() => Number)
  employeeId: number;

  @ApiProperty({ description: 'سال شمسی دوره', example: 1403 })
  @IsInt()
  @Min(1300)
  @Max(1500)
  @Type(() => Number)
  periodYear: number;

  @ApiProperty({ description: 'ماه دوره (۱ تا ۱۲)', example: 1 })
  @IsInt()
  @Min(1)
  @Max(12)
  @Type(() => Number)
  periodMonth: number;

  @ApiPropertyOptional({ description: 'روزهای کارکرد در ماه (پیش‌فرض ۳۰ یا روزهای تقویمی)', example: 30 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(31)
  @Type(() => Number)
  workDays?: number;

  @ApiPropertyOptional({ description: 'ساعات اضافه‌کاری', example: 12.5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  overtimeHours?: number;

  @ApiPropertyOptional({ description: 'ساعات شب‌کاری', example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  nightHours?: number;

  @ApiPropertyOptional({ description: 'ساعات تعطیل‌کاری یا جمعه‌کاری', example: 8 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  holidayHours?: number;

  @ApiPropertyOptional({ description: 'روزهای غیبت غیرموجه', example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(31)
  @Type(() => Number)
  absenceDays?: number;

  @ApiPropertyOptional({ description: 'روزهای مرخصی بدون حقوق', example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(31)
  @Type(() => Number)
  unpaidLeaveDays?: number;

  @ApiPropertyOptional({ description: 'یادداشت یا توضیحات', example: 'شیفت اول' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class QueryAttendanceDto {
  @ApiPropertyOptional({ description: 'سال شمسی دوره', example: 1403 })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  periodYear?: number;

  @ApiPropertyOptional({ description: 'ماه دوره (۱ تا ۱۲)', example: 1 })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  periodMonth?: number;

  @ApiPropertyOptional({ description: 'شناسه کارمند', example: 1 })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  employeeId?: number;
}

export class AttendanceResponseDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  employeeId: number;

  @ApiPropertyOptional()
  employeeName?: string;

  @ApiPropertyOptional()
  employeeNumber?: string;

  @ApiProperty()
  periodYear: number;

  @ApiProperty()
  periodMonth: number;

  @ApiProperty()
  workDays: number;

  @ApiProperty()
  overtimeHours: number;

  @ApiProperty()
  nightHours: number;

  @ApiProperty()
  holidayHours: number;

  @ApiProperty()
  absenceDays: number;

  @ApiProperty()
  unpaidLeaveDays: number;

  @ApiPropertyOptional()
  notes?: string | null;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}
