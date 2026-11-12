import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { BankCode } from '../../banking/enums/banking.enum';
import { TreasuryDocKind, TreasuryPartyType } from '../enums/treasury.enum';
import { TreasurySmsDraftStatus } from '../entities/treasury-sms-draft.entity';
import { BankSmsDirection } from '../sms/bank-sms.types';
import { AllocationRowDto } from './treasury.dto';
import { MAX_DOC_ROWS } from '../constants/treasury.constants';

export class ParseBankSmsDto {
  @ApiProperty({ description: 'متن پیامک ارسالی از بانک' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  text: string;
}

export class CaptureBankSmsDto {
  @ApiProperty({ description: 'متن پیامک ارسالی از بانک جهت ثبت پیش‌نویس' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  text: string;
}

export class QueryTreasurySmsDraftsDto {
  @ApiPropertyOptional({ enum: TreasurySmsDraftStatus })
  @IsOptional()
  @IsEnum(TreasurySmsDraftStatus)
  status?: TreasurySmsDraftStatus;

  @ApiPropertyOptional({ enum: TreasuryDocKind })
  @IsOptional()
  @IsEnum(TreasuryDocKind)
  docKind?: TreasuryDocKind;
}

export class ConfirmTreasurySmsDraftDto {
  @ApiProperty({ description: 'کد تفضیلی طرف حساب' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  partyCode: string;

  @ApiProperty({ description: 'نام طرف حساب' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  partyName: string;

  @ApiPropertyOptional({ enum: TreasuryPartyType })
  @IsOptional()
  @IsEnum(TreasuryPartyType)
  partyType?: TreasuryPartyType;

  @ApiPropertyOptional({ description: 'تاریخ سند (ISO)؛ پیش‌فرض تاریخ پیامک یا امروز' })
  @IsOptional()
  @IsISO8601({ strict: true })
  docDate?: string;

  @ApiProperty({ description: 'شناسه حساب بانکی واریز یا برداشت' })
  @IsInt()
  @Min(1)
  bankAccountId: number;

  @ApiPropertyOptional({ type: [AllocationRowDto], description: 'تخصیص به فاکتورها' })
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

/** JSON-safe parse preview: amounts are exact decimal strings, never bigint. */
export class ParsedBankSmsResponseDto {
  @ApiPropertyOptional({ enum: BankCode, nullable: true })
  bank: BankCode | null;

  @ApiProperty()
  bankNameFa: string;

  @ApiProperty({ enum: ['deposit', 'withdraw'] })
  direction: BankSmsDirection;

  @ApiProperty({ enum: TreasuryDocKind })
  docKind: TreasuryDocKind;

  @ApiProperty({ description: 'مبلغ به ریال (رشته اعشاری دقیق)' })
  amount: string;

  @ApiPropertyOptional({ description: 'مانده حساب به ریال' })
  balance?: string;

  @ApiPropertyOptional()
  dateTime?: string;

  @ApiPropertyOptional()
  cardTail?: string;

  @ApiPropertyOptional()
  accountTail?: string;

  @ApiPropertyOptional()
  reference?: string;

  @ApiProperty()
  rawText: string;
}

export class TreasurySmsDraftResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: BankCode })
  bank: BankCode;

  @ApiProperty()
  bankNameFa: string;

  @ApiProperty({ enum: ['deposit', 'withdraw'] })
  direction: BankSmsDirection;

  @ApiProperty({ enum: TreasuryDocKind })
  docKind: TreasuryDocKind;

  @ApiProperty({ description: 'مبلغ به ریال (رشته اعشاری دقیق)' })
  amount: string;

  @ApiPropertyOptional({ description: 'مانده حساب به ریال' })
  balance?: string | null;

  @ApiPropertyOptional()
  accountTail?: string | null;

  @ApiPropertyOptional()
  cardTail?: string | null;

  @ApiPropertyOptional()
  reference?: string | null;

  @ApiPropertyOptional()
  dateTime?: string | null;

  @ApiProperty()
  rawText: string;

  @ApiProperty({ enum: TreasurySmsDraftStatus })
  status: TreasurySmsDraftStatus;

  @ApiPropertyOptional()
  matchedDocumentId?: number | null;

  @ApiProperty()
  createdAt: Date;
}
