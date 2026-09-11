import { ApiProperty } from '@nestjs/swagger';
import { Currency } from '../enums/currency.enum';

/**
 * فراداده یک ارز پشتیبانی‌شده.
 */
export class CurrencyMetadataDto {
  @ApiProperty({ enum: Currency, example: Currency.USD })
  code: Currency;

  @ApiProperty({ example: 'US Dollar' })
  name: string;

  @ApiProperty({ example: '$' })
  symbol: string;

  @ApiProperty({ example: 2, description: 'تعداد ارقام اعشار چاپی' })
  decimals: number;

  @ApiProperty({ example: true, description: 'آیا ارز پایه سیستم است؟' })
  isBase: boolean;
}

/**
 * نرخ تبدیل یک ارز نسبت به ارز پایه (USD).
 */
export class CurrencyRateDto {
  @ApiProperty({ enum: Currency, example: Currency.EUR })
  code: Currency;

  @ApiProperty({
    example: 0.92,
    description: 'تعداد واحد این ارز به‌ازای ۱ دلار آمریکا',
  })
  unitsPerUsd: number;

  @ApiProperty({
    example: 1.0869,
    description: 'تعداد دلار به‌ازای ۱ واحد این ارز (معکوس نرخ پایه)',
  })
  usdPerUnit: number;
}

/**
 * پاسخ فهرست ارزهای پشتیبانی‌شده به‌همراه فراداده و ارز پایه.
 */
export class SupportedCurrenciesResponseDto {
  @ApiProperty({ enum: Currency, example: Currency.USD, description: 'ارز پایه' })
  baseCurrency: Currency;

  @ApiProperty({ type: [CurrencyMetadataDto] })
  currencies: CurrencyMetadataDto[];
}

/**
 * پاسخ نرخ‌های تبدیل ارز (نسبت به ارز پایه USD).
 */
export class ExchangeRatesResponseDto {
  @ApiProperty({ enum: Currency, example: Currency.USD, description: 'ارز پایه' })
  baseCurrency: Currency;

  @ApiProperty({ type: [CurrencyRateDto] })
  rates: CurrencyRateDto[];

  @ApiProperty({
    example: '2026-09-11T12:00:00.000Z',
    description: 'زمان تولید نرخ‌ها (UTC)',
  })
  asOf: string;
}
