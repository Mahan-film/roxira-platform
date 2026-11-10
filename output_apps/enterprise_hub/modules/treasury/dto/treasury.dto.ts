import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IsMoneyAmount } from '../../accounting/dto/money.validator';
import { MAX_DOC_ROWS } from '../constants/treasury.constants';
import { TreasuryDocKind, TreasuryMethod, TreasuryPartyType } from '../enums/treasury.enum';

const MONEY = { oneOf: [{ type: 'number' }, { type: 'string' }], example: '50000000.00' };

export class TreasuryMethodLineDto {
  @ApiProperty({ enum: TreasuryMethod })
  @IsEnum(TreasuryMethod)
  method: TreasuryMethod;

  @ApiProperty({ description: 'مبلغ (ریال)', ...MONEY })
  @IsMoneyAmount()
  amount: number | string;

  @ApiPropertyOptional({ description: 'حساب بانکی (انتقال بانکی و کارت)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  bankAccountId?: number;

  @ApiPropertyOptional({ description: 'صندوق (نقد)؛ تا مرحلهٔ صندوق‌ها فقط ثبت می‌شود' })
  @IsOptional()
  @IsInt()
  @Min(1)
  cashBoxId?: number;

  @ApiPropertyOptional({ description: 'فقط برای چک: شماره چک' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  chequeNumber?: string;

  @ApiPropertyOptional({ description: 'فقط برای چک: شناسه صیاد ۱۶ رقمی' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  sayadNumber?: string;

  @ApiPropertyOptional({ description: 'فقط برای چک: نام بانک' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  chequeBankName?: string;

  @ApiPropertyOptional({ description: 'نام بانک (نام مستعار chequeBankName)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  bankName?: string;

  @ApiPropertyOptional({ description: 'فقط برای چک: تاریخ سررسید (ISO)' })
  @IsOptional()
  @IsISO8601({ strict: true })
  dueDate?: string;

  @ApiPropertyOptional({ description: 'شماره پیگیری / مرجع تراکنش' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  reference?: string;
}

export class AllocationRowDto {
  @ApiProperty({ description: 'شناسه صورتحساب' })
  @IsUUID()
  invoiceId: string;

  @ApiProperty({ description: 'مبلغ تخصیص‌یافته به صورتحساب', ...MONEY })
  @IsMoneyAmount()
  amount: number | string;

  @ApiPropertyOptional({ description: 'تخفیف (مبلغ کوچک بخشوده‌شده)؛ فقط برای بستن کامل صورتحساب و تا سقف مجاز سازمان', ...MONEY })
  @IsOptional()
  @IsMoneyAmount()
  writeoff?: number | string;
}

export class CreateTreasuryDocumentDto {
  @ApiProperty({ enum: TreasuryDocKind })
  @IsEnum(TreasuryDocKind)
  kind: TreasuryDocKind;

  @ApiProperty({ enum: TreasuryPartyType })
  @IsEnum(TreasuryPartyType)
  partyType: TreasuryPartyType;

  @ApiProperty({ description: 'کد طرف حساب (همان کد تفضیلی دفتر)' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  partyCode: string;

  @ApiProperty({ description: 'نام طرف حساب' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  partyName: string;

  @ApiProperty({ description: 'تاریخ سند (ISO)', example: '2026-11-04' })
  @IsISO8601({ strict: true })
  docDate: string;

  @ApiProperty({ type: [TreasuryMethodLineDto], description: 'روش‌های پرداخت؛ چند ردیف یعنی پرداخت ترکیبی' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_DOC_ROWS)
  @ValidateNested({ each: true })
  @Type(() => TreasuryMethodLineDto)
  methods: TreasuryMethodLineDto[];

  @ApiPropertyOptional({ type: [AllocationRowDto], description: 'تخصیص به صورتحساب‌ها؛ مبلغ تخصیص‌نیافته پیش‌دریافت/پیش‌پرداخت می‌شود' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_DOC_ROWS)
  @ValidateNested({ each: true })
  @Type(() => AllocationRowDto)
  allocations?: AllocationRowDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;
}

export class AllocateAdvanceDto {
  @ApiProperty({ type: [AllocationRowDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_DOC_ROWS)
  @ValidateNested({ each: true })
  @Type(() => AllocationRowDto)
  allocations: AllocationRowDto[];

  @ApiPropertyOptional({ description: 'تاریخ تخصیص (ISO)؛ پیش‌فرض امروز' })
  @IsOptional()
  @IsISO8601({ strict: true })
  date?: string;
}

export class QueryTreasuryDocumentsDto {
  @ApiPropertyOptional({ enum: TreasuryDocKind })
  @IsOptional()
  @IsEnum(TreasuryDocKind)
  kind?: TreasuryDocKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  partyCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

export class SetToleranceDto {
  @ApiProperty({ description: 'سقف تخفیف (بخشش مبلغ کوچک) برای هر صورتحساب؛ صفر یعنی غیرفعال', ...MONEY })
  @IsMoneyAmount()
  writeoffTolerance: number | string;
}

export class QueryAllocationsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  partyCode?: string;

  @ApiPropertyOptional({ description: 'فقط تخصیص‌های تا این تاریخ' })
  @IsOptional()
  @IsISO8601({ strict: true })
  asOf?: string;
}

// ---------------------------------------------------------------------- responses

export class TreasuryLineResponseDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: TreasuryMethod }) method: TreasuryMethod;
  @ApiProperty(MONEY) amount: number | string;
  @ApiPropertyOptional({ nullable: true, type: Number }) bankAccountId: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) cashBoxId: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) chequeId: number | null;
  @ApiPropertyOptional({ nullable: true, type: String }) reference: string | null;
}

export class TreasuryAllocationResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() invoiceId: string;
  @ApiPropertyOptional({ nullable: true, type: String }) invoiceNumber: string | null;
  @ApiProperty(MONEY) amount: number | string;
  @ApiProperty(MONEY) writeoff: number | string;
  @ApiProperty() allocatedDate: string;
  @ApiPropertyOptional({ nullable: true, type: Number }) journalEntryId: number | null;
}

export class TreasuryDocumentResponseDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: TreasuryDocKind }) kind: TreasuryDocKind;
  @ApiProperty() docNumber: string;
  @ApiProperty() docDate: string;
  @ApiProperty({ enum: TreasuryPartyType }) partyType: TreasuryPartyType;
  @ApiProperty() partyCode: string;
  @ApiProperty() partyName: string;
  @ApiProperty(MONEY) total: number | string;
  @ApiProperty(MONEY) writeoffTotal: number | string;
  @ApiProperty({ description: 'بخش تخصیص‌نیافته (پیش‌دریافت/پیش‌پرداخت)', ...MONEY }) advanceRemaining: number | string;
  @ApiPropertyOptional({ nullable: true, type: String }) description: string | null;
  @ApiProperty() status: string;
  @ApiPropertyOptional({ nullable: true, type: Number }) journalEntryId: number | null;
}

export class TreasuryDocumentDetailResponseDto extends TreasuryDocumentResponseDto {
  @ApiProperty({ type: [TreasuryLineResponseDto] }) methods: TreasuryLineResponseDto[];
  @ApiProperty({ type: [TreasuryAllocationResponseDto] }) allocations: TreasuryAllocationResponseDto[];
}

export class OpenInvoiceResponseDto {
  @ApiProperty() invoiceId: string;
  @ApiProperty() invoiceNumber: string;
  @ApiProperty({ description: 'مانده قابل تخصیص', ...MONEY }) outstanding: number | string;
  @ApiPropertyOptional(MONEY) total?: number | string;
  @ApiPropertyOptional(MONEY) remainingAmount?: number | string;
}

export class AllocationReportRowDto {
  @ApiProperty() documentId: number;
  @ApiProperty() docNumber: string;
  @ApiProperty({ enum: TreasuryDocKind }) kind: TreasuryDocKind;
  @ApiProperty() partyCode: string;
  @ApiProperty() invoiceId: string;
  @ApiPropertyOptional({ nullable: true, type: String }) invoiceNumber: string | null;
  @ApiProperty(MONEY) amount: number | string;
  @ApiProperty(MONEY) writeoff: number | string;
  @ApiProperty() allocatedDate: string;
}
