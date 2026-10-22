import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_INVOICE_ITEMS } from '../constants/invoicing.constants';
import { Currency } from '../../currency/enums/currency.enum';
import { InvoiceStatus } from '../enums/invoice-status.enum';

/**
 * DTO اطلاعات یک طرف صورتحساب (فروشنده/خریدار).
 * تمام فیلدها با class-validator اعتبارسنجی می‌شوند (Rule #2 - AGENTS.md).
 */
export class InvoicePartyInfoDto {
  @ApiProperty({ description: 'نام شخص حقیقی/حقوقی', example: 'شرکت پیشرو تجارت' })
  @IsString()
  @MaxLength(256)
  name: string;

  @ApiPropertyOptional({ description: 'شناسه/کد ملی', example: '14001234567' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  nationalId?: string;

  @ApiPropertyOptional({ description: 'کد اقتصادی', example: '411234567890' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  economicCode?: string;

  @ApiPropertyOptional({ description: 'شماره ثبت/شناسه ملی', example: '123456789' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  registrationNumber?: string;

  @ApiPropertyOptional({ description: 'نشانی کامل', example: 'تهران، خیابان ولیعصر' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  address?: string;

  @ApiPropertyOptional({ description: 'تلفن تماس', example: '02112345678' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional({ description: 'رایانامه', example: 'billing@example.com' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  email?: string;
}

/**
 * DTO یک قلم کالا/خدمت در صورتحساب.
 * فیلدهای tax و total اختیاری‌اند و در سرویس به‌صورت معتبر بازمحاسبه می‌شوند.
 */
export class InvoiceItemDto {
  @ApiPropertyOptional({
    description: 'شناسه کالای انبار (اختیاری) برای پیوند سطر به موجودی',
    example: 12,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  itemId?: number;

  @ApiPropertyOptional({ description: 'شناسه یکتای کالا (SKU) در انبار', example: 'SKU-1001' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sku?: string;

  @ApiPropertyOptional({
    description: 'شرح کالا یا خدمت؛ در صورت انتخاب کالا از انبار خودکار پر می‌شود.',
    example: 'خدمات مشاوره فنی',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;

  @ApiProperty({ description: 'تعداد/مقدار', example: 2, minimum: 0.001 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity: number;

  @ApiProperty({ description: 'قیمت واحد به ریال', example: 5000000, minimum: 0.01 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  unitPrice: number;

  @ApiPropertyOptional({ description: 'تخفیف سطر به ریال', example: 100000, default: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discount?: number;

  @ApiPropertyOptional({
    description:
      'نرخ مالیات بر ارزش افزوده سطر؛ نسبت (۰٫۱ = ۱۰٪) یا درصد (۱۰). در نبود مقدار، تنظیم مستأجر (پیش‌فرض ۱۰٪) اعمال می‌شود.',
    example: 0.1,
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  vatRate?: number;

  @ApiPropertyOptional({ description: 'مالیات سطر (بازمحاسبه سمت سرور)', example: 900000 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  tax?: number;

  @ApiPropertyOptional({ description: 'جمع سطر (بازمحاسبه سمت سرور)', example: 10900000 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  total?: number;
}

/**
 * DTO ورودی ایجاد صورتحساب مالیاتی (POST /enterprise-hub/invoicing).
 */
export class CreateInvoiceDto {
  @ApiProperty({ description: 'شماره یکتای صورتحساب مالیاتی', example: 'TI-1405-000123' })
  @IsString()
  @MaxLength(64)
  taxInvoiceNumber: string;

  @ApiProperty({ type: InvoicePartyInfoDto, description: 'اطلاعات فروشنده' })
  @ValidateNested()
  @Type(() => InvoicePartyInfoDto)
  sellerInfo: InvoicePartyInfoDto;

  @ApiPropertyOptional({
    description:
      'اطلاعات خریدار؛ در صورت ارسال customerId اختیاری است و از سرنخ CRM تکمیل می‌شود.',
    type: InvoicePartyInfoDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => InvoicePartyInfoDto)
  buyerInfo?: InvoicePartyInfoDto;

  @ApiPropertyOptional({
    description: 'شناسه سرنخ/مشتری CRM برای پیوند صورتحساب به خریدار',
    example: 42,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  customerId?: number;

  @ApiProperty({ type: [InvoiceItemDto], description: 'اقلام کالا/خدمت صورتحساب' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_INVOICE_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  items: InvoiceItemDto[];

  @ApiPropertyOptional({
    description: 'وضعیت اولیه صورتحساب (پیش‌فرض DRAFT)',
    enum: InvoiceStatus,
    default: InvoiceStatus.DRAFT,
  })
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @ApiPropertyOptional({
    description:
      'ارز صورتحساب (پیش‌فرض IRR)؛ برای تسویه بین‌المللی USD/EUR/AED پشتیبانی می‌شود.',
    enum: Currency,
    default: Currency.IRR,
  })
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;
}
