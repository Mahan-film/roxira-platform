import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
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
    description: 'تاریخ سند (ISO 8601)؛ در صورت عدم ارسال، زمان جاری سرور',
    example: '2026-09-11T10:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  date?: string;

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
}
