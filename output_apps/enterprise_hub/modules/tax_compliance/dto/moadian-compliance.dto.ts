import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class MoadianInboxAgeQueryDto {
  @ApiPropertyOptional({
    description: 'تاریخ مبنای محاسبه سن صورتحساب‌ها (ISO 8601؛ پیش‌فرض: زمان حال)',
    example: '2026-11-09T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  asOf?: string;
}

export class MoadianInboxAlertItemDto {
  @ApiProperty({ description: 'شناسه صورتحساب' })
  @IsString()
  invoiceId: string;

  @ApiProperty({ description: 'شماره صورتحساب' })
  @IsString()
  taxInvoiceNumber: string;

  @ApiProperty({ description: 'تاریخ صدور فاکتور (ISO یا YYYY/MM/DD)' })
  @IsString()
  invoiceDate: string;

  @ApiProperty({ description: 'تعداد روزهای گذشته از تاریخ فاکتور' })
  @IsInt()
  ageDays: number;

  @ApiProperty({ description: 'تعداد روزهای باقی‌مانده تا تأیید خودکار سامانه (روز ۳۰ام)' })
  @IsInt()
  remainingDaysToAutoAccept: number;

  @ApiProperty({ enum: ['ok', 'warn', 'critical'], description: 'سطح هشدار' })
  @IsEnum(['ok', 'warn', 'critical'])
  severity: 'ok' | 'warn' | 'critical';

  @ApiProperty({ description: 'متن هشدار فارسی' })
  @IsString()
  messageFa: string;

  @ApiPropertyOptional({ description: 'نام فروشنده' })
  @IsOptional()
  @IsString()
  sellerName?: string;

  @ApiProperty({ description: 'مبلغ قابل پرداخت فاکتور (ریال)' })
  @IsString()
  amountRial: string;
}

export class MoadianInboxAgeReportDto {
  @ApiProperty({ enum: ['refuse', 'warn', 'off'], description: 'شیوه اعمال سیاست (پیش‌فرض: warn)' })
  @IsEnum(['refuse', 'warn', 'off'])
  mode: 'refuse' | 'warn' | 'off';

  @ApiProperty({ description: 'آستانه روز هشدار اولیه (پیش‌فرض: ۲۰)' })
  @IsInt()
  warnDays: number;

  @ApiProperty({ description: 'آستانه روز هشدار بحرانی (پیش‌فرض: ۲۷)' })
  @IsInt()
  criticalDays: number;

  @ApiProperty({ description: 'تعداد کل فاکتورهای خرید باز/تعیین‌تکلیف‌نشده' })
  @IsInt()
  totalPending: number;

  @ApiProperty({ description: 'تعداد فاکتورهای دارای هشدار اولیه' })
  @IsInt()
  warningCount: number;

  @ApiProperty({ description: 'تعداد فاکتورهای دارای هشدار بحرانی' })
  @IsInt()
  criticalCount: number;

  @ApiProperty({ description: 'آیا فاکتور با وضعیت بحرانی وجود دارد؟' })
  hasCritical: boolean;

  @ApiProperty({ description: 'آیا فاکتور با وضعیت هشدار وجود دارد؟' })
  hasWarning: boolean;

  @ApiProperty({ type: [MoadianInboxAlertItemDto], description: 'فهرست اخطارها و فاکتورهای معوق' })
  alerts: MoadianInboxAlertItemDto[];
}

export class MoadianArticle6QueryDto {
  @ApiPropertyOptional({
    description: 'مبلغ فاکتور فروش در حال صدور جهت شبیه‌سازی عبور از سقف (ریال)',
    example: 100000000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  newSalesAmountRial?: number;

  @ApiPropertyOptional({
    description: 'تاریخ مبنا جهت تشخیص فصل مالیاتی (ISO 8601)',
    example: '2026-11-09T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  asOf?: string;

  @ApiPropertyOptional({ description: 'سال شمسی (اختیاری)', example: 1405 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1300)
  @Max(1600)
  year?: number;

  @ApiPropertyOptional({ description: 'فصل شمسی (۱ تا ۴؛ اختیاری)', example: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  quarter?: number;
}

export class MoadianArticle6ReportDto {
  @ApiProperty({ enum: ['refuse', 'warn', 'off'], description: 'شیوه اعمال سیاست (پیش‌فرض: warn)' })
  @IsEnum(['refuse', 'warn', 'off'])
  mode: 'refuse' | 'warn' | 'off';

  @ApiProperty({ description: 'درصد آستانه هشدار سقف (پیش‌فرض: ۸۰)' })
  @IsInt()
  warningPercent: number;

  @ApiProperty({ description: 'سال شمسی' })
  @IsInt()
  fiscalYear: number;

  @ApiProperty({ description: 'فصل شمسی (۱ تا ۴)' })
  @IsInt()
  quarter: number;

  @ApiProperty({ description: 'عنوان بازه زمانی فصل' })
  @IsString()
  quarterLabel: string;

  @ApiProperty({ description: 'میزان فروش قطعی دوره تا این لحظه (ریال)' })
  @IsString()
  currentSalesRial: string;

  @ApiProperty({ description: 'مبلغ فروش جدید شبیه‌سازی‌شده (ریال)' })
  @IsString()
  newSalesRial: string;

  @ApiProperty({ description: 'جمع فروش پیش‌بینی‌شده با احتساب فاکتور جدید (ریال)' })
  @IsString()
  projectedSalesRial: string;

  @ApiProperty({ description: 'سقف مجاز فروش ماده ۶ برای دوره (ریال)' })
  @IsString()
  ceilingRial: string;

  @ApiProperty({ description: 'درصد استفاده از سقف مجاز' })
  @IsNumber()
  utilizationPercent: number;

  @ApiProperty({ description: 'آیا به آستانه هشدار (۸۰٪) رسیده است؟' })
  isWarning: boolean;

  @ApiProperty({ description: 'آیا سقف به صورت کامل پر/رد شده است (>= ۱۰۰٪)؟' })
  isExceeded: boolean;

  @ApiPropertyOptional({ description: 'پیام هشدار فارسی' })
  warningMessage: string | null;

  @ApiProperty({ description: 'آیا صدور صورتحساب طبق سیاست مجاز است؟' })
  allowed: boolean;
}
