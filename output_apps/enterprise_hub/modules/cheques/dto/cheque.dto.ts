import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { IsMoneyAmount } from '../../accounting/dto/money.validator';
import { MAX_DUE_WINDOW_DAYS } from '../constants/cheque.constants';
import { ChequeDirection, ChequeStatus } from '../enums/cheque.enum';
import { SayadRegistrationStatus } from '../sayad/sayad';

const toLatinDigits = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value
        .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
        .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
        .trim()
    : value;

const emptyToUndefined = ({ value }: { value: unknown }) => (value === '' ? undefined : value);

export class CreateChequeDto {
  @ApiProperty({ enum: ChequeDirection })
  @IsEnum(ChequeDirection)
  direction: ChequeDirection;

  @ApiPropertyOptional({ description: 'شناسه صیاد (۱۶ رقم). ثبت دستی است؛ اتصال زنده به سامانه صیاد وجود ندارد.', example: '1234567890123456' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @Transform(toLatinDigits)
  @Matches(/^[0-9]{16}$/, { message: 'شناسه صیاد باید ۱۶ رقم باشد.' })
  sayadNumber?: string;

  @ApiPropertyOptional({ description: 'کاربر اعلام می‌کند چک در سامانه صیاد ثبت/تأیید شده است (تأیید خودکار نیست).' })
  @IsOptional()
  @IsBoolean()
  sayadVerified?: boolean;

  @ApiPropertyOptional({ enum: SayadRegistrationStatus, description: 'وضعیت ثبت در سامانه صیاد، طبق اعلام کاربر (خوانده نمی‌شود از صیاد)' })
  @IsOptional()
  @IsEnum(SayadRegistrationStatus)
  sayadRegistrationStatus?: SayadRegistrationStatus;

  @ApiPropertyOptional({ description: 'کد/شناسه ملی دریافت‌کننده (ذی‌نفع) در ثبت صیاد: ۱۰ رقم حقیقی، ۱۱ رقم حقوقی', example: '0499370899' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @Transform(toLatinDigits)
  @Matches(/^([0-9]{10}|[0-9]{11})$/, { message: 'کد ملی باید ۱۰ رقم و شناسه ملی ۱۱ رقم باشد.' })
  receiverNationalId?: string;

  @ApiProperty({ description: 'شماره سری/سریال چک', example: '123456' })
  @Transform(toLatinDigits)
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  chequeNumber: string;

  @ApiPropertyOptional({ description: 'نام بانک' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  bankName?: string;

  @ApiProperty({ description: 'مبلغ (ریال)؛ عدد یا رشته اعشاری دقیق برای مبالغ بزرگ', example: '50000000.00', oneOf: [{ type: 'number' }, { type: 'string' }] })
  @IsMoneyAmount()
  amount: number | string;

  @ApiProperty({ description: 'تاریخ صدور (میلادی ISO؛ رابط کاربری تاریخ شمسی را تبدیل می‌کند)', example: '2026-10-31' })
  @IsISO8601({ strict: true })
  issueDate: string;

  @ApiProperty({ description: 'تاریخ سررسید (میلادی ISO)', example: '2026-12-21' })
  @IsISO8601({ strict: true })
  dueDate: string;

  @ApiProperty({ description: 'صادرکننده (چک دریافتی) یا ذی‌نفع (چک صادرشده)' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  partyName: string;

  @ApiPropertyOptional({ description: 'کد طرف حساب/تفضیلی' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  partyCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;
}

export class TransitionChequeDto {
  @ApiProperty({ enum: ChequeStatus, description: 'وضعیت مقصد' })
  @IsEnum(ChequeStatus)
  status: ChequeStatus;

  @ApiPropertyOptional({ description: 'تاریخ رویداد (ISO)؛ پیش‌فرض امروز' })
  @IsOptional()
  @IsISO8601({ strict: true })
  eventDate?: string;

  @ApiPropertyOptional({ description: 'نام شخص ثالث؛ برای خرج چک الزامی است' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  spentToName?: string;

  @ApiPropertyOptional({ description: 'کد طرف حساب شخص ثالث (خرج چک)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  spentToCode?: string;

  @ApiPropertyOptional({ description: 'کد/شناسه ملی شخص ثالث (خرج چک)' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @Transform(toLatinDigits)
  @Matches(/^([0-9]{10}|[0-9]{11})$/, { message: 'کد ملی باید ۱۰ رقم و شناسه ملی ۱۱ رقم باشد.' })
  spentToNationalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  note?: string;
}

export class PartialPaymentDto {
  @ApiProperty({ description: 'مبلغ پرداخت‌شده (ریال)؛ کمتر از مانده چک', oneOf: [{ type: 'number' }, { type: 'string' }] })
  @IsMoneyAmount()
  amount: number | string;

  @ApiPropertyOptional({ description: 'تاریخ رویداد (ISO)؛ پیش‌فرض امروز' })
  @IsOptional()
  @IsISO8601({ strict: true })
  eventDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  note?: string;
}

export class VerifySayadDto {
  @ApiProperty({ description: 'true = کاربر در سامانه صیاد بررسی کرده است؛ false = لغو تأیید' })
  @IsBoolean()
  verified: boolean;

  @ApiPropertyOptional({ enum: SayadRegistrationStatus })
  @IsOptional()
  @IsEnum(SayadRegistrationStatus)
  sayadRegistrationStatus?: SayadRegistrationStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  note?: string;
}

export class QueryChequesDto {
  @ApiPropertyOptional({ enum: ChequeDirection })
  @IsOptional()
  @IsEnum(ChequeDirection)
  direction?: ChequeDirection;

  @ApiPropertyOptional({ enum: ChequeStatus })
  @IsOptional()
  @IsEnum(ChequeStatus)
  status?: ChequeStatus;

  @ApiPropertyOptional({ description: 'سررسید از (ISO)' })
  @IsOptional()
  @IsISO8601({ strict: true })
  dueFrom?: string;

  @ApiPropertyOptional({ description: 'سررسید تا (ISO)' })
  @IsOptional()
  @IsISO8601({ strict: true })
  dueTo?: string;
}

export class QueryDueChequesDto {
  @ApiPropertyOptional({ description: 'تعداد روز پیش‌رو (پیش‌فرض ۳۰)', default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_DUE_WINDOW_DAYS)
  days?: number;

  @ApiPropertyOptional({ description: 'مبنای محاسبه (ISO)؛ پیش‌فرض امروز' })
  @IsOptional()
  @IsISO8601({ strict: true })
  asOf?: string;
}

export class ChequeResponseDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: ChequeDirection }) direction: ChequeDirection;
  @ApiProperty({ nullable: true }) sayadNumber: string | null;
  @ApiProperty() sayadVerified: boolean;
  @ApiProperty({ enum: SayadRegistrationStatus }) sayadRegistrationStatus: SayadRegistrationStatus;
  @ApiProperty({ nullable: true }) sayadVerifiedBy: string | null;
  @ApiProperty({ nullable: true, description: 'ISO' }) sayadVerifiedAt: string | null;
  @ApiProperty({ nullable: true }) receiverNationalId: string | null;
  @ApiProperty() chequeNumber: string;
  @ApiProperty({ nullable: true }) bankName: string | null;
  @ApiProperty({ description: 'عدد یا رشته اعشاری دقیق', oneOf: [{ type: 'number' }, { type: 'string' }] }) amount: number | string;
  @ApiProperty() issueDate: string;
  @ApiProperty() dueDate: string;
  @ApiProperty() partyName: string;
  @ApiProperty({ nullable: true }) partyCode: string | null;
  @ApiProperty({ nullable: true }) spentToName: string | null;
  @ApiProperty({ nullable: true }) spentToCode: string | null;
  @ApiProperty({ nullable: true }) spentToNationalId: string | null;
  @ApiProperty({ description: 'بخش پرداخت‌شده توسط بانک (ریال)', oneOf: [{ type: 'number' }, { type: 'string' }] }) settledAmount: number | string;
  @ApiProperty({ description: 'مانده قابل وصول (ریال)', oneOf: [{ type: 'number' }, { type: 'string' }] }) remainingAmount: number | string;
  @ApiProperty({ enum: ChequeStatus }) status: ChequeStatus;
  @ApiProperty({ type: [String], description: 'وضعیت‌های مجاز بعدی' }) allowedNext: ChequeStatus[];
  @ApiProperty({ nullable: true }) description: string | null;
}

export class ChequeEventResponseDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: ChequeStatus, nullable: true }) fromStatus: ChequeStatus | null;
  @ApiProperty({ enum: ChequeStatus }) toStatus: ChequeStatus;
  @ApiProperty() eventDate: string;
  @ApiProperty({ nullable: true }) journalEntryId: number | null;
  @ApiProperty({ nullable: true, oneOf: [{ type: 'number' }, { type: 'string' }] }) amount: number | string | null;
  @ApiProperty({ nullable: true }) note: string | null;
}

export class ChequeDetailResponseDto extends ChequeResponseDto {
  @ApiProperty({ type: [ChequeEventResponseDto] }) events: ChequeEventResponseDto[];
}

export class DueChequeDto extends ChequeResponseDto {
  @ApiProperty({ description: 'روز تا سررسید؛ منفی یعنی معوق' }) daysUntilDue: number;
  @ApiProperty() overdue: boolean;
}

export class DueChequesResponseDto {
  @ApiProperty() asOf: string;
  @ApiProperty() until: string;
  @ApiProperty({ type: [DueChequeDto] }) items: DueChequeDto[];
  @ApiProperty({ description: 'جمع چک‌های دریافتی در بازه (ریال)', oneOf: [{ type: 'number' }, { type: 'string' }] }) receivedTotal: number | string;
  @ApiProperty({ description: 'جمع چک‌های صادرشده در بازه (ریال)', oneOf: [{ type: 'number' }, { type: 'string' }] }) issuedTotal: number | string;
}

export class QueryBouncedChequesDto {
  @ApiPropertyOptional({ description: 'مبنای محاسبه سن (ISO)؛ پیش‌فرض امروز' })
  @IsOptional()
  @IsISO8601({ strict: true })
  asOf?: string;

  @ApiPropertyOptional({ enum: ChequeDirection })
  @IsOptional()
  @IsEnum(ChequeDirection)
  direction?: ChequeDirection;
}

export class BouncedChequeDto extends ChequeResponseDto {
  @ApiProperty({ description: 'تاریخ برگشت (آخرین رویداد برگشت)؛ در نبود رویداد، تاریخ سررسید' }) bouncedOn: string;
  @ApiProperty({ description: 'روز از برگشت تا مبنای محاسبه' }) ageDays: number;
  @ApiProperty({ enum: ['0-30', '31-60', '61-90', '90+'] }) bucket: string;
}

export class BouncedBucketDto {
  @ApiProperty() bucket: string;
  @ApiProperty() count: number;
  @ApiProperty({ description: 'مانده چک‌های برگشتی دریافتی (ریال)', oneOf: [{ type: 'number' }, { type: 'string' }] }) receivedTotal: number | string;
  @ApiProperty({ description: 'مانده چک‌های برگشتی صادرشده (ریال)', oneOf: [{ type: 'number' }, { type: 'string' }] }) issuedTotal: number | string;
}

export class BouncedChequesResponseDto {
  @ApiProperty() asOf: string;
  @ApiProperty({ type: [BouncedChequeDto] }) items: BouncedChequeDto[];
  @ApiProperty({ type: [BouncedBucketDto] }) buckets: BouncedBucketDto[];
  @ApiProperty({ oneOf: [{ type: 'number' }, { type: 'string' }] }) receivedTotal: number | string;
  @ApiProperty({ oneOf: [{ type: 'number' }, { type: 'string' }] }) issuedTotal: number | string;
}

export class QueryChequeReconDto {
  @ApiProperty({ description: 'شناسه حساب بانکی ماژول بانک' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bankAccountId: number;

  @ApiPropertyOptional({ description: 'از تاریخ رویداد وصول (ISO)' })
  @IsOptional()
  @IsISO8601({ strict: true })
  fromDate?: string;

  @ApiPropertyOptional({ description: 'تا تاریخ رویداد وصول (ISO)' })
  @IsOptional()
  @IsISO8601({ strict: true })
  toDate?: string;

  @ApiPropertyOptional({ description: 'پنجرهٔ تاریخ تطبیق بر حسب روز (پیش‌فرض ۵)', default: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(30)
  windowDays?: number;
}

export class ChequeReconMatchDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) bankAccountId: number;
  @ApiProperty({ description: 'شناسه رویداد وصول چک' }) @Type(() => Number) @IsInt() @Min(1) eventId: number;
  @ApiProperty({ description: 'شناسه سطر صورتحساب بانک' }) @Type(() => Number) @IsInt() @Min(1) statementLineId: number;
}

export class ChequeReconApplyDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) bankAccountId: number;

  @ApiPropertyOptional({ description: 'فقط رویدادهای از این تاریخ' })
  @IsOptional()
  @IsISO8601({ strict: true })
  fromDate?: string;

  @ApiPropertyOptional({ description: 'فقط رویدادهای تا این تاریخ' })
  @IsOptional()
  @IsISO8601({ strict: true })
  toDate?: string;

  @ApiPropertyOptional({ default: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(30)
  windowDays?: number;
}

export class ReconCandidateDto {
  @ApiProperty() statementLineId: number;
  @ApiProperty() txnDate: string;
  @ApiProperty({ nullable: true }) description: string | null;
  @ApiProperty({ nullable: true }) reference: string | null;
}

export class ChequeReconItemDto {
  @ApiProperty() eventId: number;
  @ApiProperty() chequeId: number;
  @ApiProperty({ enum: ChequeDirection }) direction: ChequeDirection;
  @ApiProperty() chequeNumber: string;
  @ApiProperty({ nullable: true }) sayadNumber: string | null;
  @ApiProperty() partyName: string;
  @ApiProperty() eventDate: string;
  @ApiProperty({ description: 'مبلغ وصول/پرداخت (ریال)', oneOf: [{ type: 'number' }, { type: 'string' }] }) amount: number | string;
  @ApiProperty() journalEntryId: number;
  @ApiProperty({
    enum: ['reconciled', 'suggested', 'unmatched', 'no_bank_line'],
    description: 'reconciled: تطبیق‌شده؛ suggested: یک یا چند سطر بانک مطابق؛ unmatched: سطری یافت نشد؛ no_bank_line: سند وصول روی حساب دفتر کل این بانک نیست',
  })
  state: 'reconciled' | 'suggested' | 'unmatched' | 'no_bank_line';
  @ApiProperty({ nullable: true }) matchedStatementLineId: number | null;
  @ApiProperty({ type: [ReconCandidateDto] }) candidates: ReconCandidateDto[];
}

export class ChequeReconResponseDto {
  @ApiProperty({ type: [ChequeReconItemDto] }) items: ChequeReconItemDto[];
  @ApiProperty() counts: Record<string, number>;
}

export class ChequeReconApplyResponseDto {
  @ApiProperty() matched: number;
  @ApiProperty() skippedAmbiguous: number;
  @ApiProperty({ description: 'جفت‌هایی که ماژول بانک پذیرفت نکرد' }) failed: number;
}
