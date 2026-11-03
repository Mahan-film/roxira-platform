import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Currency } from '../../currency/enums/currency.enum';
import { PAYMENT_METHODS } from '../constants/suite-events.constants';
import { InvoiceResponseDto } from './invoice-response.dto';

export class PosCustomerDto {
  @ApiPropertyOptional({ description: 'تلفن مشتری؛ تطابق دقیق با مشتری موجود، وگرنه رکورد حداقلی ساخته می‌شود', example: '09121234567' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional({ description: 'نام مشتری (اختیاری)', example: 'علی رضایی' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}

export class PosLineDto {
  @ApiPropertyOptional({ description: 'کد یا بارکد کالای انبار؛ بدون آن، شرح الزامی است (خدمت)' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  code?: string;

  @ApiPropertyOptional({ description: 'شرح سطر (برای سطر بدون کالا)' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;

  @ApiProperty({ example: 2 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity: number;

  @ApiProperty({ description: 'قیمت واحد به ارز فروش' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  unitPrice: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discount?: number;

  @ApiPropertyOptional({ description: 'نرخ مالیات سطر؛ در نبود، تنظیم سازمان' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  vatRate?: number;
}

export class PosPaymentDto {
  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsIn([...PAYMENT_METHODS])
  method: (typeof PAYMENT_METHODS)[number];

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;
}

export class CreatePosSaleDto {
  @ApiProperty({
    description: 'کلید یکتای درخواست؛ تکرار همان درخواست همان صورتحساب را برمی‌گرداند و دوباره ثبت نمی‌کند',
    example: 'pos-7-2026-11-03-000123',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9_.:-]+$/)
  idempotencyKey: string;

  @ApiPropertyOptional({ type: PosCustomerDto, description: 'اختیاری؛ بدون آن فروش به مشتری گذری ثبت می‌شود' })
  @IsOptional()
  @ValidateNested()
  @Type(() => PosCustomerDto)
  customer?: PosCustomerDto;

  @ApiProperty({ type: [PosLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PosLineDto)
  lines: PosLineDto[];

  @ApiProperty({ type: [PosPaymentDto], description: 'جمع پرداخت‌ها باید دقیقاً برابر مبلغ قابل پرداخت باشد' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => PosPaymentDto)
  payments: PosPaymentDto[];

  @ApiPropertyOptional({ description: 'انبار خروج کالا' })
  @IsOptional()
  @IsInt()
  @Min(1)
  warehouseId?: number;

  @ApiPropertyOptional({ enum: Currency, default: Currency.IRR })
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @ApiPropertyOptional({ description: 'نرخ تبدیل به ریال برای ارز غیرریالی' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @IsPositive()
  fxRate?: number;
}

export class PosSaleResponseDto {
  @ApiProperty({ type: InvoiceResponseDto })
  invoice: InvoiceResponseDto;

  @ApiProperty({ description: 'درخواست تکراری بود و همان صورتحساب قبلی برگردانده شد' })
  replayed: boolean;

  @ApiProperty({ enum: ['anonymous', 'phone', 'name_phone'] })
  customerLevel: 'anonymous' | 'phone' | 'name_phone';

  @ApiProperty({ description: 'برای این فروش مشتری تازه ساخته شد' })
  customerCreated: boolean;
}
