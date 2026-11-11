import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

const STRICT_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DECIMAL_AMOUNT = /^\d+(\.\d{1,2})?$/;
const BOX_CODE = /^[A-Za-z0-9_-]+$/;

export class CreateCashBoxDto {
  @ApiProperty({ description: 'نام صندوق', example: 'صندوق مرکزی فروشگاه' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  name: string;

  @ApiProperty({ description: 'کد یکتای صندوق', example: 'BOX-01' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(BOX_CODE, { message: 'کد صندوق تنها می‌تواند شامل حروف، اعداد، خط فاصله و زیرخط باشد.' })
  code: string;

  @ApiProperty({ description: 'شناسه حساب متناظر در دفتر کل', example: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  ledgerAccountId: number;

  @ApiPropertyOptional({ description: 'واحد پول', default: 'IRR' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @ApiPropertyOptional({ description: 'مانده اولیه (ریال)', default: '0' })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL_AMOUNT, { message: 'مانده اولیه باید یک عدد اعشاری معتبر باشد.' })
  openingBalance?: string;
}

export class CashBankTransferDto {
  @ApiProperty({ description: 'شناسه صندوق', example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cashBoxId: number;

  @ApiProperty({ description: 'شناسه حساب بانکی', example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bankAccountId: number;

  @ApiProperty({ enum: ['TO_BANK', 'TO_CASH'], description: 'جهت انتقال وجه: واریز به بانک یا برداشت نقد' })
  @IsIn(['TO_BANK', 'TO_CASH'])
  direction: 'TO_BANK' | 'TO_CASH';

  @ApiProperty({ description: 'مبلغ انتقال (ریال)', example: '50000000' })
  @IsString()
  @Matches(DECIMAL_AMOUNT, { message: 'مبلغ انتقال باید یک عدد اعشاری مثبت باشد.' })
  amount: string;

  @ApiProperty({ description: 'تاریخ انتقال', example: '2026-05-15' })
  @Matches(STRICT_DATE, { message: 'date must be YYYY-MM-DD' })
  date: string;

  @ApiPropertyOptional({ description: 'توضیحات سند' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  description?: string;

  @ApiPropertyOptional({ description: 'کلید یکتایی عملیات (Idempotency Key)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  idempotencyKey?: string;
}

export class PosSettlementDto {
  @ApiProperty({ description: 'شناسه حساب بانکی مقصد واریز', example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bankAccountId: number;

  @ApiProperty({ description: 'شماره ترمینال پایانه پوز', example: 'POS-889900' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  terminalNumber: string;

  @ApiProperty({ description: 'تاریخ تسویه', example: '2026-05-15' })
  @Matches(STRICT_DATE, { message: 'date must be YYYY-MM-DD' })
  date: string;

  @ApiProperty({ description: 'مبلغ ناخالص فروش پوز (ریال)', example: '100000000' })
  @IsString()
  @Matches(DECIMAL_AMOUNT, { message: 'مبلغ ناخالص باید یک عدد اعشاری مثبت باشد.' })
  grossAmount: string;

  @ApiPropertyOptional({ description: 'کارمزد کسرشده توسط شاپرک/بانک (ریال)', default: '0', example: '12000' })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL_AMOUNT, { message: 'مبلغ کارمزد باید یک عدد اعشاری مثبت باشد.' })
  feeAmount?: string;

  @ApiPropertyOptional({ description: 'شماره پیگیری یا مرجع تسویه' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  referenceNumber?: string;

  @ApiPropertyOptional({ description: 'کلید یکتایی عملیات (Idempotency Key)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  idempotencyKey?: string;
}
