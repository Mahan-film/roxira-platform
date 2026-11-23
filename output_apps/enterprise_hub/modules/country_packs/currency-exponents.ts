/**
 * ISO 4217 currency minor-unit exponents (T169 / #901).
 *
 * Lives in country-pack data so every module (ledger, invoicing, treasury, inventory)
 * shares one authoritative source of truth for 0-, 2- and 3-decimal currencies.
 * Unknown currency codes fail closed (Rule 25).
 */

export type CurrencyExponent = 0 | 2 | 3;

export const ISO_4217_CURRENCY_EXPONENTS: Readonly<Record<string, CurrencyExponent>> = Object.freeze({
  // 0-decimal currencies
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  IRR: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,

  // 2-decimal currencies
  AED: 2,
  AFN: 2,
  AMD: 2,
  AUD: 2,
  AZN: 2,
  BRL: 2,
  CAD: 2,
  CHF: 2,
  CNY: 2,
  CZK: 2,
  DKK: 2,
  DZD: 2,
  EGP: 2,
  EUR: 2,
  GBP: 2,
  GEL: 2,
  HKD: 2,
  HUF: 2,
  IDR: 2,
  INR: 2,
  KES: 2,
  KZT: 2,
  LBP: 2,
  MAD: 2,
  MXN: 2,
  MYR: 2,
  NGN: 2,
  NOK: 2,
  NZD: 2,
  PHP: 2,
  PKR: 2,
  PLN: 2,
  QAR: 2,
  RUB: 2,
  SAR: 2,
  SEK: 2,
  SGD: 2,
  SYP: 2,
  THB: 2,
  TRY: 2,
  TWD: 2,
  USD: 2,
  UZS: 2,
  YER: 2,
  ZAR: 2,

  // 3-decimal currencies (fils / baisa / millime)
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
});

export class UnsupportedCurrencyError extends Error {
  constructor(code: string) {
    super(`Unsupported ISO 4217 currency code: "${code}".`);
    this.name = 'UnsupportedCurrencyError';
  }
}

export function isSupportedCurrency(currencyCode: string): boolean {
  const normalized = currencyCode.trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(ISO_4217_CURRENCY_EXPONENTS, normalized);
}

/**
 * Returns the ISO 4217 exponent (0, 2, or 3) for `currencyCode`.
 * Fails closed by throwing `UnsupportedCurrencyError` if the code is unknown.
 */
export function getCurrencyExponent(currencyCode: string): CurrencyExponent {
  const normalized = currencyCode.trim().toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(ISO_4217_CURRENCY_EXPONENTS, normalized)) {
    throw new UnsupportedCurrencyError(currencyCode);
  }
  return ISO_4217_CURRENCY_EXPONENTS[normalized];
}
