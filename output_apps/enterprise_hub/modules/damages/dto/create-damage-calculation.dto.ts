import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { MAX_BULK_ITEMS } from '../constants/damages.constants';
import { DamageCalculationMethod } from '../enums/calculation-method.enum';

/**
 * DTO ورودی برای محاسبه خسارت تاخیر تادیه.
 * تمام فیلدها با class-validator اعتبارسنجی می‌شوند (Rule #2 - AGENTS.md).
 */
export class CreateDamageCalculationDto {
  @ApiProperty({
    description: 'اصل مبلغ بدهی/دین به ریال',
    example: 500000000,
    minimum: 1,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  principalAmount: number;

  @ApiProperty({
    description: 'تاریخ سررسید دین (فرمت ISO 8601)',
    example: '2024-01-15',
  })
  @IsDateString()
  dueDate: string;

  @ApiProperty({
    description: 'تاریخ پرداخت واقعی (فرمت ISO 8601)',
    example: '2024-11-20',
  })
  @IsDateString()
  paymentDate: string;

  @ApiProperty({
    description: 'روش محاسبه خسارت تاخیر تادیه',
    enum: DamageCalculationMethod,
    example: DamageCalculationMethod.CPI_INDEX,
  })
  @IsEnum(DamageCalculationMethod)
  calculationMethod: DamageCalculationMethod;

  @ApiPropertyOptional({
    description:
      'شاخص قیمت بانک مرکزی در تاریخ سررسید (الزامی برای روش CPI_INDEX)',
    example: 185.4,
  })
  @ValidateIf((dto) => dto.calculationMethod === DamageCalculationMethod.CPI_INDEX)
  @IsNumber()
  @IsPositive()
  cpiIndexAtDueDate?: number;

  @ApiPropertyOptional({
    description:
      'شاخص قیمت بانک مرکزی در تاریخ پرداخت (الزامی برای روش CPI_INDEX)',
    example: 231.9,
  })
  @ValidateIf((dto) => dto.calculationMethod === DamageCalculationMethod.CPI_INDEX)
  @IsNumber()
  @IsPositive()
  cpiIndexAtPaymentDate?: number;

  @ApiPropertyOptional({
    description:
      'نرخ سود سالانه قراردادی به درصد (الزامی برای روش ANNUAL_RATE)',
    example: 18,
    minimum: 0,
    maximum: 100,
  })
  @ValidateIf((dto) => dto.calculationMethod === DamageCalculationMethod.ANNUAL_RATE)
  @IsNumber()
  @Min(0)
  @Max(100)
  annualInterestRate?: number;

  @ApiPropertyOptional({
    description: 'شماره قرارداد یا فاکتور مرجع جهت ردیابی',
    example: 'INV-2024-00231',
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  contractReferenceNumber?: string;
}

/**
 * DTO ورودی برای محاسبه دسته‌ای (Bulk) - پردازش ناهمزمان از طریق BullMQ.
 */
export class CreateBulkDamageCalculationDto {
  @ApiProperty({
    type: [CreateDamageCalculationDto],
    description: 'فهرست موارد جهت محاسبه دسته‌ای',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => CreateDamageCalculationDto)
  items: CreateDamageCalculationDto[];
}
