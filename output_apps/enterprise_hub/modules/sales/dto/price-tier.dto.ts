import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
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
} from 'class-validator';
import { CustomerGroup } from '../../parties/enums/customer-group.enum';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

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
  @IsNumberString()
  unitPriceMinor: string;

  @ApiPropertyOptional({ description: 'درصد تخفیف ردیف (۰ تا ۱۰۰)', default: 0 })
  @IsOptional()
  @IsNumber()
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
  effectiveTo?: string;
}

export class ResolvePriceDto {
  @ApiProperty({ description: 'کد کالا (SKU)' })
  @IsString()
  @MinLength(1)
  sku: string;

  @ApiPropertyOptional({ enum: CustomerGroup })
  @IsOptional()
  @IsEnum(CustomerGroup)
  customerGroup?: CustomerGroup;

  @ApiProperty({ description: 'قیمت پایه به ریال' })
  @IsNumberString()
  basePriceMinor: string;

  @ApiPropertyOptional({ description: 'تاریخ مبنا (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX)
  referenceDate?: string;
}

export class SetCommissionPolicyDto {
  @ApiProperty({ description: 'دسته‌بندی کالا/خدمت' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  category: string;

  @ApiProperty({ description: 'درصد کمیسیون فروشنده (۰ تا ۱۰۰)' })
  @IsNumber()
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
  salesRepId: string;

  @ApiProperty({ description: 'نام کارشناس فروش' })
  @IsString()
  salesRepName: string;

  @ApiProperty({ description: 'دسته‌بندی کالا' })
  @IsString()
  category: string;

  @ApiProperty({ description: 'مبلغ فروش به ریال' })
  @IsNumberString()
  saleAmountMinor: string;

  @ApiProperty({ description: 'شماره فاکتور' })
  @IsString()
  invoiceNumber: string;
}

export class CalculateCommissionDto {
  @ApiProperty({ description: 'دوره ماهانه، مثلا 1403-08' })
  @IsString()
  month: string;

  @ApiProperty({ type: [SalesLineForCommissionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalesLineForCommissionDto)
  lines: SalesLineForCommissionDto[];
}
