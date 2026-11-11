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

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_REGEX = /^\d{4}-\d{2}$/;

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
          const [relatedPropertyName] = args.constraints;
          const relatedValue = (args.object as Record<string, unknown>)[relatedPropertyName];
          if (value === undefined || value === null || relatedValue === undefined || relatedValue === null) {
            return true;
          }
          if (typeof value === 'string' && typeof relatedValue === 'string') {
            return value >= relatedValue;
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
  @IsNumberString({ no_symbols: true }, { message: 'unitPriceMinor must be positive integer string' })
  @MinLength(1)
  @MaxLength(32)
  unitPriceMinor: string;

  @ApiPropertyOptional({ description: 'درصد تخفیف ردیف (۰ تا ۱۰۰)', default: 0 })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @ApiPropertyOptional({ description: 'تاریخ شروع اعتبار (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, { message: 'effectiveFrom must be YYYY-MM-DD' })
  effectiveFrom?: string;

  @ApiPropertyOptional({ description: 'تاریخ پایان اعتبار (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, { message: 'effectiveTo must be YYYY-MM-DD' })
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
  @IsNumberString({ no_symbols: true }, { message: 'basePriceMinor must be positive integer string' })
  @MinLength(1)
  @MaxLength(32)
  basePriceMinor: string;

  @ApiPropertyOptional({ description: 'تاریخ مبنا (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, { message: 'referenceDate must be YYYY-MM-DD' })
  referenceDate?: string;
}

export class SetCommissionPolicyDto {
  @ApiProperty({ description: 'دسته‌بندی کالا/خدمت' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  category: string;

  @ApiProperty({ description: 'درصد کمیسیون فروشنده (۰ تا ۱۰۰)' })
  @IsNumber({ allowNaN: false, allowInfinity: false })
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
  @IsNumberString({ no_symbols: true }, { message: 'saleAmountMinor must be positive integer string' })
  @MinLength(1)
  @MaxLength(32)
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
