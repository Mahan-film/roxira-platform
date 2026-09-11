import { Currency } from '../enums/currency.enum';

/**
 * ثابت‌های لایه چندارزی (Multi-Currency Layer).
 */

/** ارز پایه سیستم برای تجمیع و گزارش‌گیری بین‌المللی. */
export const BASE_CURRENCY = Currency.USD;

/** دقت پیش‌فرض گردکردن مبالغ مالی (تعداد ارقام اعشار). */
export const CURRENCY_MONEY_SCALE = 2;

/**
 * نرخ مرجع هر ارز بر حسب «واحد ارز به‌ازای ۱ دلار آمریکا» (units per USD).
 *
 * این نرخ‌ها به‌عنوان fallback داخلی استفاده می‌شوند و در محیط تولید از
 * طریق متغیرهای محیطی قابل بازنویسی هستند (بدون تغییر کد):
 *   CURRENCY_RATE_USD, CURRENCY_RATE_EUR, CURRENCY_RATE_AED, CURRENCY_RATE_IRR
 */
export const DEFAULT_RATES_PER_USD: Record<Currency, number> = {
  [Currency.USD]: 1,
  [Currency.EUR]: 0.92,
  [Currency.AED]: 3.6725,
  [Currency.IRR]: 920000,
};

/** متغیر محیطی متناظر با هر ارز جهت بازنویسی نرخ مرجع. */
export const CURRENCY_RATE_ENV_KEYS: Record<Currency, string> = {
  [Currency.USD]: 'CURRENCY_RATE_USD',
  [Currency.EUR]: 'CURRENCY_RATE_EUR',
  [Currency.AED]: 'CURRENCY_RATE_AED',
  [Currency.IRR]: 'CURRENCY_RATE_IRR',
};

/** فراداده نمایشی هر ارز (نماد، نام انگلیسی و تعداد اعشار چاپی). */
export interface CurrencyMetadata {
  code: Currency;
  name: string;
  symbol: string;
  decimals: number;
  isBase: boolean;
}

export const CURRENCY_METADATA: Record<Currency, CurrencyMetadata> = {
  [Currency.USD]: {
    code: Currency.USD,
    name: 'US Dollar',
    symbol: '$',
    decimals: 2,
    isBase: true,
  },
  [Currency.EUR]: {
    code: Currency.EUR,
    name: 'Euro',
    symbol: '€',
    decimals: 2,
    isBase: false,
  },
  [Currency.AED]: {
    code: Currency.AED,
    name: 'UAE Dirham',
    symbol: 'د.إ',
    decimals: 2,
    isBase: false,
  },
  [Currency.IRR]: {
    code: Currency.IRR,
    name: 'Iranian Rial',
    symbol: '﷼',
    decimals: 0,
    isBase: false,
  },
};

/** فهرست ارزهای مجاز (برای اعتبارسنجی DTO). */
export const SUPPORTED_CURRENCIES: Currency[] = [
  Currency.USD,
  Currency.EUR,
  Currency.AED,
  Currency.IRR,
];
