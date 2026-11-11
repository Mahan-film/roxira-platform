import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsNumberString,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
  ValidationArguments,
  ValidationOptions,
  registerDecorator,
} from 'class-validator';
import { CustomerGroup } from '../../parties/enums/customer-group.enum';
import { getCurrentTehranDate } from '../utils/sales-date.util';

const MONTH_REGEX = /^\d{4}-\d{2}$/;

function isValidCalendarDate(val: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return false;
  const [y, m, d] = val.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function IsCalendarDate(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isCalendarDate',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (value === undefined || value === null) return true;
          return typeof value === 'string' && isValidCalendarDate(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a valid calendar date in YYYY-MM-DD format`;
        },
      },
    });
  };
}

/**
 * Validates that a date string is chronologically greater than or equal to another date property.
 */
export function IsAfterOrEqualTo(property: string, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isAfterOrEqualTo',
      target: object.constructor,
      propertyName,
      constraints: [property],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          if (value === undefined || value === null) {
            return true;
          }
          const [relatedPropertyName] = args.constraints;
          const relatedValue = (args.object as Record<string, unknown>)[relatedPropertyName];
          const effectiveRelated =
            typeof relatedValue === 'string' && relatedValue.length > 0
              ? relatedValue
              : getCurrentTehranDate();
          if (typeof value === 'string') {
            return value >= effectiveRelated;
          }
          return true;
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be greater than or equal to ${args.constraints[0]}`;
        },
      },
    });
  };
}

export class ListPriceTiersQueryDto {
  @ApiPropertyOptional({ description: 'کد کالا (SKU)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sku?: string;

  @ApiPropertyOptional({ enum: CustomerGroup, description: 'گروه مشتری' })
  @IsOptional()
  @IsEnum(CustomerGroup)
  customerGroup?: CustomerGroup;
}

export class CreatePriceTierDto {
  @ApiProperty({ description: 'کد کالا (SKU)' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sku: string;

  @ApiProperty({ enum: CustomerGroup, description: 'گروه مشتری (مصرف‌کننده، عمده، همکار)' })
  @IsEnum(CustomerGroup)
  customerGroup: CustomerGroup;

  @ApiProperty({ description: 'قیمت واحد به ریال (minor units)' })
  @Matches(/^\d{1,18}$/, { message: 'unitPriceMinor must be positive integer up to 18 digits' })
  unitPriceMinor: string;

  @ApiPropertyOptional({ description: 'درصد تخفیف ردیف (۰ تا ۱۰۰)', default: 0 })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @ApiPropertyOptional({ description: 'تاریخ شروع اعتبار (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  @IsCalendarDate()
  effectiveFrom?: string;

  @ApiPropertyOptional({ description: 'تاریخ پایان اعتبار (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  @IsCalendarDate()
  @IsAfterOrEqualTo('effectiveFrom', { message: 'effectiveTo must be greater than or equal to effectiveFrom' })
  effectiveTo?: string;
}

export class ResolvePriceDto {
  @ApiProperty({ description: 'کد کالا (SKU)' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sku: string;

  @ApiPropertyOptional({ enum: CustomerGroup })
  @IsOptional()
  @IsEnum(CustomerGroup)
  customerGroup?: CustomerGroup;

  @ApiProperty({ description: 'قیمت پایه به ریال' })
  @Matches(/^\d{1,18}$/, { message: 'basePriceMinor must be positive integer up to 18 digits' })
  basePriceMinor: string;

  @ApiPropertyOptional({ description: 'تاریخ مبنا (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  @IsCalendarDate()
  referenceDate?: string;
}

export class SetCommissionPolicyDto {
  @ApiProperty({ description: 'دسته‌بندی کالا/خدمت' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  category: string;

  @ApiProperty({ description: 'درصد کمیسیون فروشنده (۰ تا ۱۰۰)' })
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  commissionRate: number;

  @ApiPropertyOptional({ description: 'فعال بودن سیاست', default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class SalesLineForCommissionDto {
  @ApiProperty({ description: 'شناسه کارشناس فروش' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  salesRepId: string;

  @ApiProperty({ description: 'نام کارشناس فروش' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  salesRepName: string;

  @ApiProperty({ description: 'دسته‌بندی کالا' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  category: string;

  @ApiProperty({ description: 'مبلغ فروش به ریال' })
  @Matches(/^\d{1,18}$/, { message: 'saleAmountMinor must be positive integer up to 18 digits' })
  saleAmountMinor: string;

  @ApiProperty({ description: 'شماره فاکتور' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  invoiceNumber: string;
}

export class CalculateCommissionDto {
  @ApiProperty({ description: 'دوره ماهانه، مثلا 1403-08' })
  @IsString()
  @Matches(MONTH_REGEX, { message: 'month must be YYYY-MM' })
  month: string;

  @ApiProperty({ type: [SalesLineForCommissionDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SalesLineForCommissionDto)
  lines: SalesLineForCommissionDto[];
}
