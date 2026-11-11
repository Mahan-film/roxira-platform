import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { LoanStatus } from '../enums/hr.enum';

export class CreateStaffLoanDto {
  @ApiProperty({ description: 'شناسه کارمند', example: 1 })
  @IsInt()
  @Type(() => Number)
  employeeId: number;

  @ApiPropertyOptional({ description: 'شماره پرونده وام', example: 'LN-1403-001' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  loanNumber?: string;

  @ApiProperty({ description: 'عنوان وام یا مساعده', example: 'وام ضروری پرسنل' })
  @IsString()
  @MaxLength(128)
  title: string;

  @ApiProperty({ description: 'اصل مبلغ وام به ریال (عدد صحیح)', example: 120_000_000 })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  principalAmount: number;

  @ApiProperty({ description: 'مبلغ هر قسط ماهانه به ریال (عدد صحیح)', example: 10_000_000 })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  instalmentAmount: number;

  @ApiProperty({ description: 'تعداد کل اقساط', example: 12 })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  totalInstalments: number;

  @ApiPropertyOptional({ description: 'تاریخ شروع کسر اقساط', example: '1403/05' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  startDate?: string;
}

export class QueryStaffLoanDto {
  @ApiPropertyOptional({ description: 'شناسه کارمند' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  employeeId?: number;

  @ApiPropertyOptional({ enum: LoanStatus, description: 'وضعیت وام' })
  @IsOptional()
  @IsEnum(LoanStatus)
  status?: LoanStatus;
}

export class StaffLoanResponseDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  employeeId: number;

  @ApiPropertyOptional()
  employeeName?: string;

  @ApiPropertyOptional()
  employeeNumber?: string;

  @ApiProperty()
  loanNumber: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  principalAmount: number;

  @ApiProperty()
  instalmentAmount: number;

  @ApiProperty()
  totalInstalments: number;

  @ApiProperty()
  paidInstalments: number;

  @ApiProperty()
  remainingAmount: number;

  @ApiProperty({ enum: LoanStatus })
  status: LoanStatus;

  @ApiProperty()
  statusLabel: string;

  @ApiPropertyOptional()
  startDate?: string | null;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}
