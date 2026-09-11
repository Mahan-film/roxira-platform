import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BASE_CURRENCY,
  CURRENCY_METADATA,
  CURRENCY_MONEY_SCALE,
  CURRENCY_RATE_ENV_KEYS,
  DEFAULT_RATES_PER_USD,
  SUPPORTED_CURRENCIES,
} from '../constants/currency.constants';
import {
  CurrencyMetadataDto,
  CurrencyRateDto,
  ExchangeRatesResponseDto,
  SupportedCurrenciesResponseDto,
} from '../dto/currency-response.dto';
import { Currency } from '../enums/currency.enum';

/**
 * سرویس مرکزی چندارزی (Multi-Currency Service).
 *
 * منطق کسب‌وکار تبدیل ارز و گردکردن مبالغ بین‌المللی اینجا متمرکز است تا
 * ماژول‌های Invoicing و Accounting بدون تکرار منطق از آن استفاده کنند.
 * نرخ‌های مرجع از متغیرهای محیطی قابل بازنویسی‌اند و در نبود آن‌ها از
 * نرخ‌های پیش‌فرض ثابت استفاده می‌شود (Rule #3 — AGENTS.md).
 */
@Injectable()
export class CurrencyService {
  constructor(private readonly config: ConfigService) {}

  /** آیا ارز در فهرست ارزهای پشتیبانی‌شده قرار دارد؟ */
  isSupported(currency: string): currency is Currency {
    return (SUPPORTED_CURRENCIES as string[]).includes(currency);
  }

  /** واکشی نرخ «واحد ارز به‌ازای ۱ دلار» با اولویت متغیر محیطی. */
  unitsPerUsd(currency: Currency): number {
    const envKey = CURRENCY_RATE_ENV_KEYS[currency];
    const configured = Number(this.config.get<string>(envKey, ''));
    if (Number.isFinite(configured) && configured > 0) {
      return configured;
    }
    return DEFAULT_RATES_PER_USD[currency];
  }

  /** فهرست ارزهای پشتیبانی‌شده به‌همراه فراداده نمایشی. */
  listSupported(): SupportedCurrenciesResponseDto {
    const currencies: CurrencyMetadataDto[] = SUPPORTED_CURRENCIES.map(
      (code) => {
        const meta = CURRENCY_METADATA[code];
        return {
          code,
          name: meta.name,
          symbol: meta.symbol,
          decimals: meta.decimals,
          isBase: meta.isBase,
        };
      },
    );

    return { baseCurrency: BASE_CURRENCY, currencies };
  }

  /** نرخ‌های تبدیل تمام ارزهای پشتیبانی‌شده نسبت به ارز پایه. */
  getRates(): ExchangeRatesResponseDto {
    const rates: CurrencyRateDto[] = SUPPORTED_CURRENCIES.map((code) => {
      const units = this.unitsPerUsd(code);
      return {
        code,
        unitsPerUsd: units,
        usdPerUnit: units > 0 ? 1 / units : 0,
      };
    });

    return {
      baseCurrency: BASE_CURRENCY,
      rates,
      asOf: new Date().toISOString(),
    };
  }

  /**
   * نرخ تبدیل از ارز `from` به ارز `to`:
   *   rate = unitsPerUsd[to] / unitsPerUsd[from]
   */
  getRate(from: Currency, to: Currency): number {
    if (!this.isSupported(from) || !this.isSupported(to)) {
      throw new BadRequestException(
        `ارز پشتیبانی نمی‌شود؛ ارزهای مجاز: ${SUPPORTED_CURRENCIES.join(', ')}`,
      );
    }
    const fromUnits = this.unitsPerUsd(from);
    const toUnits = this.unitsPerUsd(to);
    return toUnits / fromUnits;
  }

  /** تبدیل مبلغ میان دو ارز با گردکردن به دقت مالی استاندارد. */
  convert(amount: number, from: Currency, to: Currency): number {
    return this.round(amount * this.getRate(from, to), to);
  }

  /** گردکردن مبلغ بر مبنای دقت ارز مقصد (پیش‌فرض ۲ رقم اعشار). */
  round(amount: number, currency?: Currency): number {
    const decimals = currency
      ? CURRENCY_METADATA[currency].decimals
      : CURRENCY_MONEY_SCALE;
    const factor = 10 ** decimals;
    return Math.round((amount + Number.EPSILON) * factor) / factor;
  }

  /**
   * تبدیل مبلغ یک ارز به ارز پایه.
   * خروجی شامل نرخ اعمال‌شده (واحد ارز پایه به‌ازای ۱ واحد ارز مبدأ) است.
   */
  toBase(
    amount: number,
    from: Currency,
  ): { baseCurrency: Currency; exchangeRate: number; baseAmount: number } {
    const exchangeRate = this.getRate(from, BASE_CURRENCY);
    return {
      baseCurrency: BASE_CURRENCY,
      exchangeRate,
      baseAmount: this.round(amount * exchangeRate, BASE_CURRENCY),
    };
  }
}
