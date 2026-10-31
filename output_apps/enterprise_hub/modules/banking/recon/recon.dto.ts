import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UploadStatementQueryDto {
  @ApiPropertyOptional({ description: 'حساب بانکی مقصد (در صورت نبود، از روی فایل تشخیص داده می‌شود)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bankAccountId?: number;
}

export class ColumnMappingDto {
  @ApiProperty({
    description: 'نگاشت فیلد به شماره ستون (از صفر)، مثلاً {"date":0,"description":1,"withdrawal":3,"deposit":4}',
    example: { date: 0, description: 1, withdrawal: 3, deposit: 4, balance: 5 },
  })
  @IsObject()
  columnMap: Record<string, number>;
}

export class AnswerCheckDto {
  @ApiProperty({ example: 'account_match' })
  @IsString()
  @MaxLength(32)
  code: string;

  @ApiProperty({ example: 'account:3' })
  @IsString()
  @MaxLength(32)
  choice: string;
}

export class CreateAccountFromSessionDto {
  @ApiProperty({ example: 'جاری ملت' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name: string;

  @ApiProperty({ description: 'شناسه حساب دفتر کل بانک' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  ledgerAccountId: number;
}

export class AnswerQuestionDto {
  @ApiProperty({ example: 'purchase' })
  @IsString()
  @MaxLength(24)
  choiceId: string;

  @ApiPropertyOptional({ enum: ['real', 'legal', 'unknown'] })
  @IsOptional()
  @Matches(/^(real|legal|unknown)$/)
  personType?: 'real' | 'legal' | 'unknown';

  @ApiPropertyOptional({ description: 'کد حساب مقابل برای سند پیش‌نویس' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  counterAccountCode?: string;

  @ApiPropertyOptional({ description: 'عبارت کلیدی برای قانون ماندگار (اگر طرف حساب مشخص نیست)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  keyword?: string;

  @ApiPropertyOptional({ default: true, description: 'پاسخ به‌صورت قانون سازمان ذخیره شود' })
  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}

export class DecideMatchDto {
  @ApiProperty()
  @IsBoolean()
  accept: boolean;
}

export class ApproveDraftsDto {
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  @Min(1, { each: true })
  draftIds: number[];
}

export class ReverseDraftDto {
  @ApiProperty({ example: 'ثبت اشتباه، طرف حساب دیگر است' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

export class UpdateReconSettingsDto {
  @ApiPropertyOptional({ description: 'سقف کارمزد کوچک بانکی (ریال)', example: '5000000' })
  @IsOptional()
  @Matches(/^\d{1,15}$/)
  feeMaxRial?: string;

  @ApiPropertyOptional({ description: 'سقف هزینه پیامک (ریال)', example: '500000' })
  @IsOptional()
  @Matches(/^\d{1,15}$/)
  smsFeeMaxRial?: string;

  @ApiPropertyOptional({ description: 'ثبت خودکار کارمزدهای کوچک (فقط مدیر سازمان)' })
  @IsOptional()
  @IsBoolean()
  autoPostFees?: boolean;

  @ApiPropertyOptional({ example: 0.9 })
  @IsOptional()
  @Type(() => Number)
  @Min(0.5)
  @Max(1)
  autoMatchMinConfidence?: number;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(31)
  dateWindowDays?: number;

  @ApiPropertyOptional({
    description: 'کد حساب مقابل هر دسته، مثلاً {"bank_fee":"5090","sms_fee":"5090"}',
  })
  @IsOptional()
  @IsObject()
  categoryAccounts?: Record<string, string>;
}

export class AuditQueryDto {
  @ApiPropertyOptional({ example: 'draft' })
  @IsOptional()
  @IsString()
  @MaxLength(24)
  subjectType?: string;

  @ApiPropertyOptional({ example: '12' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  subjectId?: string;
}

export class ReportQueryDto {
  @ApiPropertyOptional({ enum: ['json', 'xlsx', 'csv', 'html'], default: 'json' })
  @IsOptional()
  @Matches(/^(json|xlsx|csv|html)$/)
  format?: 'json' | 'xlsx' | 'csv' | 'html';
}

export class ListReportsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bankAccountId?: number;
}
