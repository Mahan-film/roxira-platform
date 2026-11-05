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
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_INVOICE_ITEMS } from '../constants/invoicing.constants';
import { Currency } from '../../currency/enums/currency.enum';
import {
  INVOICE_JURISDICTIONS,
  InvoiceJurisdiction,
} from '../enums/invoice-jurisdiction.enum';
import {
  EInvoiceType,
  InvoiceDirection,
  InvoiceSubject,
} from '../enums/invoice-kind.enum';
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
      'Line discount as a percent of quantity × unit price (0-100); use either this or discount, not both.',
    example: 5,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  discountPercent?: number;

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

  @ApiPropertyOptional({ description: 'در برگشتی: شمارهٔ سطر صورتحساب مرجع (از صفر)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  originalLine?: number;

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
  @ApiPropertyOptional({
    description:
      'شماره یکتای صورتحساب؛ در نبود مقدار، سرور شماره یکتا می‌سازد. برای خرید، شمارهٔ فاکتور تأمین‌کننده.',
    example: 'TI-1405-000123',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  taxInvoiceNumber?: string;

  @ApiPropertyOptional({
    description: 'جهت: SALE فروش (پیش‌فرض) یا PURCHASE خرید',
    enum: InvoiceDirection,
    default: InvoiceDirection.SALE,
  })
  @IsOptional()
  @IsEnum(InvoiceDirection)
  direction?: InvoiceDirection;

  @ApiPropertyOptional({
    description: 'نوع صورتحساب الکترونیکی: ۱ با مشخصات خریدار، ۲ بدون، ۳ فروشگاهی',
    enum: EInvoiceType,
    default: EInvoiceType.WITH_BUYER,
  })
  @IsOptional()
  @IsEnum(EInvoiceType)
  einvoiceType?: EInvoiceType;

  @ApiPropertyOptional({
    description: 'موضوع: ۱ اصلی، ۲ اصلاحی، ۳ ابطالی، ۴ برگشتی. غیر از اصلی، relatedInvoiceId الزامی است.',
    enum: InvoiceSubject,
    default: InvoiceSubject.ORIGINAL,
  })
  @IsOptional()
  @IsEnum(InvoiceSubject)
  subject?: InvoiceSubject;

  @ApiPropertyOptional({ description: 'صورتحساب مرجع برای اصلاحی/ابطالی/برگشتی' })
  @IsOptional()
  @IsUUID()
  relatedInvoiceId?: string;

  @ApiPropertyOptional({
    description: 'انبار مقصد/مبدأ حرکت کالا هنگام ثبت (برای سطرهای پیوند‌خورده به کالا)',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  warehouseId?: number;

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
    description:
      'Invoice-level discount amount. It is spread over the lines in proportion to their net amount before VAT, so VAT is charged on the discounted base. Use either this or invoiceDiscountPercent.',
    example: 50000,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  invoiceDiscount?: number;

  @ApiPropertyOptional({
    description: 'Invoice-level discount as a percent (0-100) of the lines net of their own discounts.',
    example: 10,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  invoiceDiscountPercent?: number;

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
      'ارز صورتحساب (پیش‌فرض IRR)؛ برای تسویه بین‌المللی USD/EUR/AED/TRY/CNY/OMR پشتیبانی می‌شود.',
    enum: Currency,
    default: Currency.IRR,
  })
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @ApiPropertyOptional({
    description:
      'حوزه قضایی/مالیاتی صورتحساب (IR داخلی، INTL بین‌المللی). در نبود مقدار از روی ارز تعیین می‌شود.',
    enum: InvoiceJurisdiction,
    default: InvoiceJurisdiction.IR,
  })
  @IsOptional()
  @IsIn(INVOICE_JURISDICTIONS)
  jurisdiction?: InvoiceJurisdiction;

  @ApiPropertyOptional({
    description:
      'نرخ تبدیل ارز صورتحساب به ریال (amount_fx × fx_rate = معادل ریالی). برای ارزهای غیر از IRR/IRT الزامی است.',
    example: 920000,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @IsPositive()
  fxRate?: number;
}
