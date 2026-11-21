import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { JournalEntryStatus } from '../enums/accounting.enum';
import { IsMoneyAmount } from './money.validator';
import { IsSupportedCurrency } from '../../currency/normaliser/currency-normaliser';
import {
  MAX_JOURNAL_LINES,
  MIN_JOURNAL_LINES,
} from '../constants/accounting.constants';

/**
 * DTO یک سطر سند دوطرفه (بدهکار یا بستانکار).
 *
 * اعتبارسنجی نهایی «دقیقاً یکی از بدهکار/بستانکار بزرگ‌تر از صفر» و نیز
 * «برابری جمع بدهکار و بستانکار» در لایه Service انجام می‌شود.
 */
export class JournalEntryLineDto {
  @ApiProperty({ description: 'کد حساب دفتر کل', example: '1010' })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  accountCode: string;

  @ApiPropertyOptional({ description: 'مبلغ بدهکار (ریال)', example: 1000000, default: 0 })
  @IsOptional()
  @IsMoneyAmount()
  debit?: number | string;

  @ApiPropertyOptional({ description: 'مبلغ بستانکار (ریال)', example: 0, default: 0 })
  @IsOptional()
  @IsMoneyAmount()
  credit?: number | string;

  @ApiPropertyOptional({
    description:
      'ارز سطر؛ کد ISO 4217 یا مترادف فارسی/فینگلیش (پیش‌فرض IRR).',
    example: 'IRR',
    default: 'IRR',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @IsSupportedCurrency()
  currency?: string;

  @ApiPropertyOptional({
    description: 'مبلغ به ارز مبدأ (amount_fx) برای اسناد چندارزی',
    example: 100,
  })
  @IsOptional()
  @IsMoneyAmount(6)
  amountFx?: number | string;

  @ApiPropertyOptional({
    description: 'نرخ تبدیل ارز مبدأ به ریال (fx_rate)',
    example: 900000,
  })
  @IsOptional()
  @IsMoneyAmount(6)
  fxRate?: number | string;

  @ApiPropertyOptional({
    description: 'کد طرف حساب/تفضیلی (party reference)',
    example: 'TZ-1001',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  partyCode?: string;

  @ApiPropertyOptional({ description: 'کد تفصیلی شناور (باید قبلاً تعریف شده باشد)', example: 'P-1001' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  detailCode?: string;

  @ApiPropertyOptional({ description: 'کد مرکز هزینه', example: 'CC-100' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  costCenterCode?: string;

  @ApiPropertyOptional({ description: 'کد مرکز پروژه', example: 'PR-7' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  projectCode?: string;

  @ApiPropertyOptional({ description: 'شرح سطر', example: 'دریافت نقدی بابت فروش' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional({ description: 'شناسه شعبه سطر سند', example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'کد ارز معامله (ISO 4217)', example: 'USD' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  txCurrencyCode?: string;

  @ApiPropertyOptional({ description: 'نرخ تسعیر اعمال‌شده', example: 920000 })
  @IsOptional()
  @IsMoneyAmount(6)
  fxRateApplied?: number | string;

  @ApiPropertyOptional({ description: 'مبلغ بدهکار به ارز معامله', example: 100 })
  @IsOptional()
  @IsMoneyAmount()
  txDebit?: number | string;

  @ApiPropertyOptional({ description: 'مبلغ بستانکار به ارز معامله', example: 0 })
  @IsOptional()
  @IsMoneyAmount()
  txCredit?: number | string;

  @ApiPropertyOptional({ description: 'مبلغ بدهکار به ارز دفاتر', example: 92000000 })
  @IsOptional()
  @IsMoneyAmount()
  bookDebit?: number | string;

  @ApiPropertyOptional({ description: 'مبلغ بستانکار به ارز دفاتر', example: 0 })
  @IsOptional()
  @IsMoneyAmount()
  bookCredit?: number | string;

  @ApiPropertyOptional({ description: 'کد ارز گزارش‌گیری (ISO 4217)', example: 'USD' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  reportingCurrencyCode?: string;

  @ApiPropertyOptional({ description: 'نرخ تبدیل ارز دفاتر به ارز گزارش‌گیری', example: '1.085000' })
  @IsOptional()
  @IsMoneyAmount(6)
  reportingFxRate?: number | string;

  @ApiPropertyOptional({ description: 'مبلغ بدهکار به ارز گزارش‌گیری', example: '1283.01' })
  @IsOptional()
  @IsMoneyAmount()
  reportingDebit?: number | string;

  @ApiPropertyOptional({ description: 'مبلغ بستانکار به ارز گزارش‌گیری', example: '0' })
  @IsOptional()
  @IsMoneyAmount()
  reportingCredit?: number | string;

  @ApiPropertyOptional({ description: 'سطر تعدیل گردکردن ناشی از تسعیر ارز', default: false })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean()
  isRounding?: boolean;
}

/**
 * DTO ثبت سند حسابداری دوطرفه
 * (POST /enterprise-hub/accounting/journal-entries).
 */
export class CreateJournalEntryDto {
  @ApiPropertyOptional({
    description:
      'شمارهٔ کاری سند؛ اختیاری است. در صورت خالی بودن، سرور «JV-<تاریخ سند>-<۸ رقم تصادفی>» می‌سازد. «شمارهٔ قطعی» جداگانه و هنگام قطعی‌شدن داده می‌شود.',
    example: 'JV-1405-000001',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  entryNumber?: string;

  @ApiPropertyOptional({
    description: 'کلید یکتایی/عدم تکرار سند (Idempotency Key)؛ در ارسال مجدد همان سند برگردانده می‌شود.',
    example: 'req-pos-12345',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey?: string;

  @ApiPropertyOptional({
    description: 'تاریخ سند (ISO 8601)؛ در صورت عدم ارسال، زمان جاری سرور',
    example: '2026-09-11T10:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  date?: string;

  @ApiPropertyOptional({
    description: 'شناسه شعبه پیش‌فرض سند',
    example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiProperty({ description: 'شرح کلی سند', example: 'فروش نقدی خدمات مشاوره' })
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  description: string;

  @ApiProperty({
    type: [JournalEntryLineDto],
    description: 'سطرهای بدهکار/بستانکار سند (حداقل دو سطر)',
  })
  @IsArray()
  @ArrayMinSize(MIN_JOURNAL_LINES)
  @ArrayMaxSize(MAX_JOURNAL_LINES)
  @ValidateNested({ each: true })
  @Type(() => JournalEntryLineDto)
  lines: JournalEntryLineDto[];

  @ApiPropertyOptional({
    enum: [JournalEntryStatus.DRAFT, JournalEntryStatus.TEMPORARY, JournalEntryStatus.POSTED],
    default: JournalEntryStatus.POSTED,
    description:
      'DRAFT: پیش‌نویس (می‌تواند ناتراز باشد و در گزارش‌ها نمی‌آید). TEMPORARY: موقت (تراز، قابل ویرایش، خارج از گزارش‌ها). POSTED: قطعی و تغییرناپذیر.',
  })
  @IsOptional()
  @IsIn([JournalEntryStatus.DRAFT, JournalEntryStatus.TEMPORARY, JournalEntryStatus.POSTED])
  status?: JournalEntryStatus;

  @ApiPropertyOptional({
    description: 'برچسب سند (مانند PARTNER_ADJUSTMENT برای اسناد تعدیلی حسابدار مؤسسه)',
    example: 'PARTNER_ADJUSTMENT',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tag?: string;

  @ApiPropertyOptional({
    description: 'شناسه کاربر مؤسسه حسابداری ثبت‌کننده سند',
    example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  })
  @IsOptional()
  @IsUUID()
  firmUserId?: string;

  @ApiPropertyOptional({
    description: 'نشانگر سند دوره تعدیل (Adjustment Period)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isAdjustmentPeriod?: boolean;
}
