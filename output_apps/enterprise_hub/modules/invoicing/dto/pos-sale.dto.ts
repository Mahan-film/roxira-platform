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
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
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
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  quantity: number;

  @ApiPropertyOptional({ description: 'قیمت واحد به ارز فروش؛ در فروش الزامی، در برگشت نادیده (قیمت فروش اصلی)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  unitPrice?: number;

  @ApiPropertyOptional({ description: 'فقط در برگشت: شمارهٔ سطر فروش اصلی (از صفر)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(199)
  originalLine?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discount?: number;

  @ApiPropertyOptional({ description: 'Line discount in percent of quantity × unit price; not with discount' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  discountPercent?: number;

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

/** Refund of a return: by the methods the sale was paid with, or as credit on the customer's account. */
export const POS_REFUND_MODES = ['ORIGINAL', 'CREDIT'] as const;
export type PosRefundMode = (typeof POS_REFUND_MODES)[number];

export class PosReturnOfDto {
  @ApiProperty({ description: 'شناسهٔ صورتحساب فروش اصلی' })
  @IsUUID()
  invoiceId: string;

  @ApiProperty({
    enum: POS_REFUND_MODES,
    description: 'ORIGINAL: بازپرداخت به همان روش‌های پرداخت فروش؛ CREDIT: بستانکار شدن حساب مشتری',
  })
  @IsIn([...POS_REFUND_MODES])
  refund: PosRefundMode;
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

  @ApiPropertyOptional({ description: 'Discount on the whole sale (amount), spread over the lines before VAT' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  invoiceDiscount?: number;

  @ApiPropertyOptional({ description: 'Discount on the whole sale in percent; not with invoiceDiscount' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  invoiceDiscountPercent?: number;

  @ApiPropertyOptional({
    type: PosReturnOfDto,
    description:
      'برگشت از فروش: سطرها با originalLine و تعداد می‌آیند و قیمت، تخفیف و مالیات به نسبت از فروش اصلی گرفته می‌شود؛ payments نمی‌آید.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PosReturnOfDto)
  returnOf?: PosReturnOfDto;

  @ApiPropertyOptional({ type: [PosPaymentDto], description: 'در فروش الزامی؛ جمع پرداخت‌ها باید دقیقاً برابر مبلغ قابل پرداخت باشد. در برگشت نمی‌آید.' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => PosPaymentDto)
  payments?: PosPaymentDto[];

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

export class SyncPosSalesDto {
  @ApiProperty({ type: [CreatePosSaleDto], description: 'فهرست تراکنش‌های فروش آفلاین برای همگام‌سازی و ثبت در سرور' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsObject({ each: true })
  sales: CreatePosSaleDto[];
}

export class PosConflictDto {
  @ApiProperty({ description: 'شناسه یکتای سمت کلاینت (clientUuid)' })
  clientUuid: string;

  @ApiProperty({ enum: ['OUT_OF_STOCK', 'ITEM_NOT_FOUND', 'VALIDATION_FAILED', 'CONFLICT', 'UNKNOWN'] })
  code: 'OUT_OF_STOCK' | 'ITEM_NOT_FOUND' | 'VALIDATION_FAILED' | 'CONFLICT' | 'UNKNOWN';

  @ApiProperty({ description: 'شرح خطای عدم ثبت فروش یا کسری موجودی' })
  error: string;

  @ApiPropertyOptional({ description: 'شناسه یا کد کالاهای دارای کسری موجودی' })
  missingItems?: string[];
}

export class PosSyncedItemDto {
  @ApiProperty({ description: 'شناسه یکتای سمت کلاینت (clientUuid)' })
  clientUuid: string;

  @ApiProperty({ type: InvoiceResponseDto })
  invoice: InvoiceResponseDto;

  @ApiProperty({ description: 'درخواست قبلاً ثبت شده بوده و بازیابی شد' })
  replayed: boolean;
}

export class PosSyncResultDto {
  @ApiProperty({ type: [PosSyncedItemDto], description: 'فروش‌های با موفقیت ثبت شده' })
  synced: PosSyncedItemDto[];

  @ApiProperty({ type: [PosConflictDto], description: 'فروش‌های دارای مغایرت یا کسری موجودی' })
  conflicts: PosConflictDto[];

  @ApiProperty({ description: 'تعداد کل تراکنش‌های پردازش شده' })
  totalProcessed: number;
}
