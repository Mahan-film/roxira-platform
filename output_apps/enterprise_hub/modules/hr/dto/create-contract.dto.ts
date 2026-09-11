import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ContractType } from '../enums/hr.enum';

/**
 * DTO تعریف قرارداد/حکم حقوقی جدید
 * (POST /enterprise-hub/hr/contracts).
 *
 * اجزای حقوق در صورت عدم ارسال با پیش‌فرض‌های قانونی
 * (`DEFAULT_HOUSING_ALLOWANCE` و `DEFAULT_FOOD_ALLOWANCE`) پر می‌شوند.
 */
export class CreateContractDto {
  @ApiProperty({ description: 'شناسه کارمند', example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  employeeId: number;

  @ApiPropertyOptional({
    description: 'شماره قرارداد یکتا؛ در صورت عدم ارسال خودکار تولید می‌شود',
    example: 'CT-000001',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  contractNumber?: string;

  @ApiPropertyOptional({ enum: ContractType, default: ContractType.PERMANENT })
  @IsOptional()
  @IsEnum(ContractType)
  contractType?: ContractType;

  @ApiProperty({ description: 'تاریخ شروع قرارداد (ISO 8601)', example: '2026-09-01' })
  @IsISO8601()
  startDate: string;

  @ApiPropertyOptional({ description: 'تاریخ پایان قرارداد (ISO 8601)', example: '2027-09-01' })
  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @ApiPropertyOptional({ description: 'عنوان شغلی؛ پیش‌فرض از پرونده کارمند' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  jobTitle?: string;

  @ApiPropertyOptional({ description: 'واحد سازمانی؛ پیش‌فرض از پرونده کارمند' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  department?: string;

  @ApiProperty({ description: 'حقوق پایه ماهانه (ریال)', example: 104000000 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  baseSalary: number;

  @ApiPropertyOptional({ description: 'حق مسکن ماهانه (ریال)', example: 9000000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  housingAllowance?: number;

  @ApiPropertyOptional({ description: 'بن خواربار ماهانه (ریال)', example: 11000000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  foodAllowance?: number;

  @ApiPropertyOptional({ description: 'حق اولاد ماهانه (ریال)', example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  childAllowance?: number;

  @ApiPropertyOptional({
    description: 'نرخ بیمه سهم کارگر (کسر اعشاری)؛ پیش‌فرض ۰٫۰۷',
    example: 0.07,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(0.5)
  insuranceRate?: number;

  @ApiPropertyOptional({ description: 'مشمول کسر بیمه', default: true })
  @IsOptional()
  @IsBoolean()
  isInsuranceSubject?: boolean;

  @ApiPropertyOptional({ description: 'توضیحات قرارداد' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
