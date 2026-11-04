import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { WageTaxListType } from '../services/wage-tax-files';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MAX_PERIOD_YEAR, MIN_PERIOD_YEAR } from '../constants/hr.constants';
import { PayrollRunStatus } from '../enums/hr.enum';
import { PayslipResponseDto } from './hr-response.dto';

/** Monthly inputs of one employee in a payroll run (all optional, default 0). */
export class PayrollRunItemDto {
  @ApiProperty({ description: 'شناسه کارمند', example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  employeeId: number;

  @ApiPropertyOptional({
    description: 'ساعات اضافه‌کاری',
    example: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(400)
  overtimeHours?: number;

  @ApiPropertyOptional({
    description: 'ساعات شب‌کاری',
    example: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(400)
  nightHours?: number;

  @ApiPropertyOptional({
    description: 'ساعات کار در روز تعطیل',
    example: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(400)
  holidayHours?: number;

  @ApiPropertyOptional({ description: 'روزهای غیبت بدون حقوق', example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(31)
  absenceDays?: number;

  @ApiPropertyOptional({ description: 'عیدی پرداختی این ماه (ریال)', example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 0 })
  @Min(0)
  eidi?: number;

  @ApiPropertyOptional({ description: 'سایر کسورات (ریال)', example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 0 })
  @Min(0)
  otherDeductions?: number;
}

/** POST /enterprise-hub/hr/payroll-runs — calculate (or recalculate) a draft run. */
export class CreatePayrollRunDto {
  @ApiProperty({ description: 'سال شمسی دوره', example: 1405 })
  @Type(() => Number)
  @IsInt()
  @Min(MIN_PERIOD_YEAR)
  @Max(MAX_PERIOD_YEAR)
  periodYear: number;

  @ApiProperty({ description: 'ماه شمسی دوره', example: 7 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  periodMonth: number;

  @ApiPropertyOptional({ type: [PayrollRunItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => PayrollRunItemDto)
  items?: PayrollRunItemDto[];
}

/** GET /enterprise-hub/hr/payroll-runs/:id/insurance-list — workshop details. */
export class InsuranceListQueryDto {
  @ApiProperty({
    description: 'کد کارگاه تأمین اجتماعی',
    example: '1234567890',
  })
  @IsString()
  @Matches(/^\d{1,10}$/, { message: 'کد کارگاه باید ۱ تا ۱۰ رقم باشد.' })
  workshopCode: string;

  @ApiProperty({ description: 'نام کارگاه', example: 'شرکت نمونه' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  workshopName: string;

  @ApiProperty({ description: 'نام کارفرما', example: 'علی رضایی' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  employerName: string;

  @ApiPropertyOptional({ description: 'نشانی کارگاه' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  workshopAddress?: string;

  @ApiPropertyOptional({ description: 'ردیف پیمان', example: '000' })
  @IsOptional()
  @Matches(/^\d{1,6}$/)
  contractRow?: string;

  @ApiPropertyOptional({ description: 'شماره لیست', example: '01' })
  @IsOptional()
  @Matches(/^\d{1,2}$/)
  listNumber?: string;
}

export class PayrollRunSkippedDto {
  @ApiProperty() employeeId: number;
  @ApiProperty() employeeFullName: string;
  @ApiProperty() reason: string;
}

export class PayrollRunResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() periodYear: number;
  @ApiProperty() periodMonth: number;
  @ApiProperty({ enum: PayrollRunStatus }) status: PayrollRunStatus;
  @ApiProperty() statusLabel: string;
  @ApiProperty({ description: 'سال جدول نرخ‌های قانونی' }) ratesYear: number;
  @ApiProperty({ type: [String], description: 'مقادیر تأییدنشده هنگام محاسبه' })
  unverifiedKeys: string[];
  @ApiProperty() employeeCount: number;
  @ApiProperty() totalGross: number;
  @ApiProperty() totalInsurable: number;
  @ApiProperty() totalEmployeeInsurance: number;
  @ApiProperty() totalEmployerInsurance: number;
  @ApiProperty() totalUnemploymentInsurance: number;
  @ApiProperty() totalIncomeTax: number;
  @ApiProperty() totalOtherDeductions: number;
  @ApiProperty() totalNet: number;
  @ApiProperty({ nullable: true }) journalEntryId: number | null;
  @ApiProperty({ nullable: true }) journalEntryNumber: string | null;
  @ApiProperty({ nullable: true }) postedAt: string | null;
  @ApiProperty() createdAt: string;
  @ApiProperty({ type: [PayslipResponseDto] }) payslips: PayslipResponseDto[];
  @ApiProperty({ type: [PayrollRunSkippedDto] })
  skipped: PayrollRunSkippedDto[];
}

export class InsuranceListResponseDto {
  @ApiProperty({ example: 'DSKKAR00.csv' }) workshopFileName: string;
  @ApiProperty({ description: 'سطر سرجمع کارگاه (CSV، UTF-8)' })
  workshopFile: string;
  @ApiProperty({ example: 'DSKKAR00.DBF' }) workshopDbfFileName: string;
  @ApiProperty({ description: 'DSKKAR00.DBF به‌صورت base64' }) workshopDbf: string;
  @ApiProperty({ example: 'DSKWOR00.DBF' }) workersDbfFileName: string;
  @ApiProperty({ description: 'DSKWOR00.DBF به‌صورت base64' }) workersDbf: string;
  @ApiProperty({ description: 'فقط وقتی true است که unverified خالی باشد' })
  uploadReady: boolean;
  @ApiProperty({ type: [String], description: 'مواردی از مشخصات که هیچ منبعی تأیید نکرده است' })
  unverified: string[];
  @ApiProperty({ example: 'DSKWOR00.csv' }) workersFileName: string;
  @ApiProperty({ description: 'سطرهای کارکنان (CSV، UTF-8)' })
  workersFile: string;
  @ApiProperty({ type: [String] }) warnings: string[];
}

/** GET /enterprise-hub/hr/payroll-runs/:id/wage-tax-files */
export class WageTaxFilesQueryDto {
  @ApiPropertyOptional({ enum: ['MAIN', 'ADDITIONAL', 'CORRECTIVE'] })
  @IsOptional()
  @IsIn(['MAIN', 'ADDITIONAL', 'CORRECTIVE'])
  listType?: WageTaxListType;
}

export class WageTaxFilesResponseDto {
  @ApiProperty() wpFileName: string;
  @ApiProperty() wpFile: string;
  @ApiProperty() whFileName: string;
  @ApiProperty() whFile: string;
  @ApiProperty({ description: 'فقط وقتی true است که unverified خالی باشد' })
  uploadReady: boolean;
  @ApiProperty({ type: [String], description: 'مواردی از مشخصات که هیچ منبعی تأیید نکرده است' })
  unverified: string[];
  @ApiProperty() totalGross: number;
  @ApiProperty() totalTax: number;
  @ApiProperty({ type: [String] }) warnings: string[];
}

export class PayrollRatesResponseDto {
  @ApiProperty() year: number;
  @ApiProperty() source: string;
  @ApiProperty({
    description:
      'آیا همه مقادیر جاری این سال با متن رسمی تطبیق و تأیید شده‌اند؟',
  })
  verified: boolean;
  @ApiProperty({ type: [String], description: 'کلید مقادیر تأییدنشده' })
  unverifiedKeys: string[];
  @ApiProperty() minDailyWage: number;
  @ApiProperty() minMonthlyWage: number;
  @ApiProperty() housingAllowance: number;
  @ApiProperty() foodAllowance: number;
  @ApiProperty() childAllowancePerChild: number;
  @ApiProperty() seniorityPerYear: number;
  @ApiProperty() monthlyWorkHours: number;
  @ApiProperty() overtimePremium: number;
  @ApiProperty() nightShiftPremium: number;
  @ApiProperty() holidayPremium: number;
  @ApiProperty() employeeInsuranceRate: number;
  @ApiProperty() employerInsuranceRate: number;
  @ApiProperty() unemploymentInsuranceRate: number;
  @ApiProperty() maxInsurableMonthlyWage: number;
  @ApiProperty({ description: 'پله‌های سالانه مالیات (upTo=null یعنی بی‌سقف)' })
  annualTaxBrackets: { upTo: number | null; rate: number }[];
}
