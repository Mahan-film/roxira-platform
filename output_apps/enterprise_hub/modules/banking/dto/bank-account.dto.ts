import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Currency } from '../../currency/enums/currency.enum';
import { BankCode } from '../enums/banking.enum';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** ایجاد حساب بانکی متصل به یک حساب دفتر کل. */
export class CreateBankAccountDto {
  @ApiProperty({ description: 'نام نمایشی حساب', example: 'جاری ملت شعبه مرکزی' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name: string;

  @ApiPropertyOptional({ enum: BankCode, default: BankCode.OTHER })
  @IsOptional()
  @IsEnum(BankCode)
  bankCode?: BankCode;

  @ApiProperty({ description: 'شماره حساب', example: '1234567890' })
  @Transform(trim)
  @IsString()
  @Matches(/^[0-9۰-۹][0-9۰-۹./ -]{2,62}$/, {
    message: 'شماره حساب فقط رقم، خط تیره، نقطه یا اسلش دارد.',
  })
  accountNumber: string;

  @ApiPropertyOptional({ description: 'شماره شبا', example: 'IR120170000000123456789012' })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/\s/g, '').toUpperCase() : value,
  )
  @Matches(/^IR\d{24}$/, { message: 'شماره شبا باید IR و ۲۴ رقم باشد.' })
  iban?: string;

  @ApiProperty({ description: 'شناسه حساب دفتر کل (fin_chart_of_accounts.id)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  ledgerAccountId: number;

  @ApiPropertyOptional({ enum: Currency, default: Currency.IRR })
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @ApiPropertyOptional({ description: 'مانده بانک پیش از نخستین سطر واردشده (ریال)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  openingBalance?: number;
}

export class BankAccountResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty({ enum: BankCode }) bankCode: BankCode;
  @ApiProperty() accountNumber: string;
  @ApiPropertyOptional({ nullable: true, type: String }) iban: string | null;
  @ApiProperty() ledgerAccountId: number;
  @ApiProperty() ledgerAccountCode: string;
  @ApiProperty() ledgerAccountName: string;
  @ApiProperty() currency: string;
  @ApiProperty() openingBalance: number;
}
