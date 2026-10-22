import { BadRequestException, Logger } from '@nestjs/common';
import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * ماژول عادی‌سازی ارز (Currency Normaliser) — قابلیت مشترک چندارزی.
 *
 * ورودی‌های ERP (واسط‌های فارسی/فینگلیش) ارز را با نام‌های گوناگون ثبت
 * می‌کنند («ریال»، «Rial»، «تومان»، «درهم»، «MULTI» …). این لایه آن‌ها را به
 * کدهای متعارف نگاشت می‌کند تا ورود بسته داده و دفتر کل چندارزی روی یک
 * قرارداد واحد کار کنند. ارز گزارش‌گیری ریال (IRR) است؛ تومان (IRT) با
 * ضریب ۱۰ به ریال تبدیل می‌شود.
 */
export enum NormalisedCurrency {
  IRR = 'IRR',
  IRT = 'IRT',
  USD = 'USD',
  EUR = 'EUR',
  TRY = 'TRY',
  AED = 'AED',
  CNY = 'CNY',
  OMR = 'OMR',
  MULTI = 'MULTI',
}

/** ضریب تبدیل تومان به ریال. */
export const TOMAN_TO_RIAL_FACTOR = 10;

const logger = new Logger('CurrencyNormaliser');

/**
 * نگاشت نام‌های متعارف و مترادف‌های فارسی/انگلیسی/فینگلیش به کد ارز.
 * کلیدها پس از `normaliseKey` (حذف نیم‌فاصله، یکسان‌سازی فاصله و
 * بزرگ‌حروف‌سازی لاتین) مقایسه می‌شوند.
 */
const CURRENCY_SYNONYMS: Readonly<Record<string, NormalisedCurrency>> = {
  IRR: NormalisedCurrency.IRR,
  RIAL: NormalisedCurrency.IRR,
  RLS: NormalisedCurrency.IRR,
  ریال: NormalisedCurrency.IRR,
  ريال: NormalisedCurrency.IRR,
  IRT: NormalisedCurrency.IRT,
  TOMAN: NormalisedCurrency.IRT,
  TMN: NormalisedCurrency.IRT,
  تومان: NormalisedCurrency.IRT,
  USD: NormalisedCurrency.USD,
  $: NormalisedCurrency.USD,
  US$: NormalisedCurrency.USD,
  دلار: NormalisedCurrency.USD,
  EUR: NormalisedCurrency.EUR,
  '€': NormalisedCurrency.EUR,
  یورو: NormalisedCurrency.EUR,
  TRY: NormalisedCurrency.TRY,
  '₺': NormalisedCurrency.TRY,
  لیر: NormalisedCurrency.TRY,
  AED: NormalisedCurrency.AED,
  درهم: NormalisedCurrency.AED,
  'د.إ': NormalisedCurrency.AED,
  CNY: NormalisedCurrency.CNY,
  RMB: NormalisedCurrency.CNY,
  یوان: NormalisedCurrency.CNY,
  OMR: NormalisedCurrency.OMR,
  'ریال عمان': NormalisedCurrency.OMR,
  'ريال عمان': NormalisedCurrency.OMR,
  MULTI: NormalisedCurrency.MULTI,
  چندارزی: NormalisedCurrency.MULTI,
  'چند ارزی': NormalisedCurrency.MULTI,
};

/** یکسان‌سازی کلید جست‌وجو: حذف نویسه‌های کنترلی، فاصله‌ها و بزرگ‌حروف لاتین. */
function normaliseKey(raw: string): string {
  return raw
    .replace(/[\u200c\u200e\u200f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * نگاشت یک نام ارز خام به کد متعارف.
 *
 * ISO 4217 به‌همراه مترادف‌های فارسی/انگلیسی/فینگلیش پشتیبانی می‌شوند:
 *   ریال/IRR/Rial/RLS → IRR؛ تومان/IRT/Toman/TMN → IRT؛
 *   دلار/USD/$ → USD؛ یورو/EUR/€ → EUR؛ لیر/TRY/₺ → TRY؛
 *   درهم/AED → AED؛ یوان/CNY/RMB → CNY؛ ریال عمان/OMR → OMR؛
 *   MULTI/چندارزی → MULTI (تنها در سطح حساب).
 *
 * ورودی ناشناخته `null` برمی‌گرداند و هشدار ثبت می‌کند.
 */
export function normalizeCurrency(
  raw: string | null | undefined,
): NormalisedCurrency | null {
  if (raw == null) {
    return null;
  }
  const key = normaliseKey(String(raw));
  if (!key) {
    return null;
  }
  const code = CURRENCY_SYNONYMS[key];
  if (!code) {
    logger.warn(`ارز ناشناخته: "${raw}"`);
    return null;
  }
  return code;
}

/**
 * تبدیل مبلغ یک ارز به معادل ریالی (ارز گزارش‌گیری).
 *
 * قواعد: IRT = مبلغ × ۱۰؛ IRR = مبلغ؛ سایر ارزها = مبلغ × نرخ تبدیل
 * (نرخ برای ارزهای غیرریالی الزامی است). ورودی ناشناخته `null` می‌دهد.
 */
export function toRial(
  amount: number,
  currency: string | NormalisedCurrency | null | undefined,
  rate?: number | null,
): number | null {
  const code = normalizeCurrency(currency as string | null | undefined);
  if (!code) {
    return null;
  }
  if (code === NormalisedCurrency.IRT) {
    return amount * TOMAN_TO_RIAL_FACTOR;
  }
  if (code === NormalisedCurrency.IRR) {
    return amount;
  }
  if (code === NormalisedCurrency.MULTI) {
    return null;
  }
  if (rate == null || !Number.isFinite(rate) || rate <= 0) {
    throw new BadRequestException(
      `برای تبدیل ارز ${code} به ریال، نرخ تبدیل (rate) الزامی است.`,
    );
  }
  return amount * rate;
}

/**
 * اعتبارسنج class-validator برای فیلدهای ارز در DTOها.
 * هر ورودی که `normalizeCurrency` نتواند آن را بشناسد رد می‌شود.
 */
export function IsSupportedCurrency(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isSupportedCurrency',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return (
            typeof value === 'string' && normalizeCurrency(value) !== null
          );
        },
      },
    });
  };
}
