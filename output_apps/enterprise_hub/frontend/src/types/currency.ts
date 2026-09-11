/**
 * تایپ‌های مشترک لایه چندارزی (Multi-Currency Layer).
 * منطبق بر DTOهای Swagger بک‌اند NestJS در `modules/currency/dto`
 * (Contract-First Synchronization — Rule #4 AGENTS.md).
 */

export enum Currency {
  USD = "USD",
  EUR = "EUR",
  AED = "AED",
  IRR = "IRR",
}

export interface CurrencyMetadata {
  code: Currency;
  name: string;
  symbol: string;
  decimals: number;
  isBase: boolean;
}

export interface CurrencyRate {
  code: Currency;
  unitsPerUsd: number;
  usdPerUnit: number;
}

export interface SupportedCurrenciesResponse {
  baseCurrency: Currency;
  currencies: CurrencyMetadata[];
}

export interface ExchangeRatesResponse {
  baseCurrency: Currency;
  rates: CurrencyRate[];
  asOf: string;
}

/** نگاشت نماد ارز برای نمایش سریع در رابط کاربری. */
export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  [Currency.USD]: "$",
  [Currency.EUR]: "€",
  [Currency.AED]: "AED",
  [Currency.IRR]: "IRR",
};

/** قالب‌بندی مبلغ بر مبنای ارز (با Intl.NumberFormat انگلیسی). */
export function formatCurrency(amount: number, currency: Currency): string {
  const fractionDigits = currency === Currency.IRR ? 0 : 2;
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amount);
  return `${CURRENCY_SYMBOLS[currency]} ${formatted}`;
}
