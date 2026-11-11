import { InvoiceResponseDto } from '../../invoicing/dto/invoice-response.dto';
import { Currency } from '../../currency/enums/currency.enum';

export interface MoadianPreFlightError {
  field: string;
  message: string;
  code: string;
}

export interface MoadianPreFlightResult {
  valid: boolean;
  errors: MoadianPreFlightError[];
}

/**
 * Normalises Persian and Arabic digits to ASCII Latin digits.
 */
export function toLatinDigits(str: string): string {
  return (str ?? '')
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632));
}

export function toPersianDigits(str: string): string {
  const p = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  return (str ?? '').replace(/\d/g, (d) => p[parseInt(d, 10)]);
}

/**
 * Validates 10-digit Iranian Individual National ID checksum (کد ملی).
 * Uses modulo 11 algorithm.
 */
export function validateNationalIdChecksum(nationalId: string): boolean {
  const cleaned = toLatinDigits(nationalId ?? '').replace(/\s+/g, '');
  if (!/^\d{10}$/.test(cleaned)) {
    return false;
  }

  // Reject all identical digits (0000000000, 1111111111, ..., 9999999999)
  if (/^(\d)\1{9}$/.test(cleaned)) {
    return false;
  }

  const digits = cleaned.split('').map(Number);
  const checkDigit = digits[9];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += digits[i] * (10 - i);
  }

  const remainder = sum % 11;
  if (remainder < 2) {
    return checkDigit === remainder;
  } else {
    return checkDigit === 11 - remainder;
  }
}

/**
 * Validates 11-digit Iranian Legal Entity ID (شناسه ملی اشخاص حقوقی).
 * Uses standard Modulo 11 weighted checksum (Variant A):
 * Coefficients: [29, 27, 23, 19, 17, 29, 27, 23, 19, 17]
 * Offset: add = d[9] + 2
 * Sum = sum_{i=0}^9 (d[i] + add) * coeff[i]
 * Remainder = Sum % 11
 * If remainder == 10 => check = 0, else check = remainder
 */
export function validateLegalEntityIdChecksum(legalId: string): boolean {
  const cleaned = toLatinDigits(legalId ?? '').replace(/\s+/g, '');
  if (!/^\d{11}$/.test(cleaned)) {
    return false;
  }

  if (/^(\d)\1{10}$/.test(cleaned)) {
    return false;
  }

  const digits = cleaned.split('').map(Number);
  const checkDigit = digits[10];
  const add = digits[9] + 2;
  const weights = [29, 27, 23, 19, 17, 29, 27, 23, 19, 17];

  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += (digits[i] + add) * weights[i];
  }

  const remainder = sum % 11;
  const expectedCheck = remainder === 10 ? 0 : remainder;
  return checkDigit === expectedCheck;
}

/**
 * Validates Iranian 10-digit postal code format (کد پستی ۱۰ رقمی).
 * Post office rules:
 * - Exactly 10 digits
 * - Cannot start with 0 or 2
 * - 5th digit cannot be 0 or 2
 * - No 5 repeating digits
 */
export function validatePostalCodeFormat(postalCode: string): boolean {
  const cleaned = toLatinDigits(postalCode ?? '').replace(/\s+/g, '');
  if (!/^\d{10}$/.test(cleaned)) {
    return false;
  }

  // Cannot start with 0 or 2
  if (cleaned[0] === '0' || cleaned[0] === '2') {
    return false;
  }

  // 5th digit cannot be 0 or 2
  if (cleaned[4] === '0' || cleaned[4] === '2') {
    return false;
  }

  // Reject 5 consecutive identical digits
  if (/(\d)\1{4}/.test(cleaned)) {
    return false;
  }

  return true;
}

/**
 * Extracts Jalali year from date, or null if date is invalid.
 */
export function getJalaliYear(date: Date | string | null | undefined): number | null {
  if (!date) return null;
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) {
    return null;
  }
  const parts = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
  }).formatToParts(d);
  const yearPart = parts.find((p) => p.type === 'year');
  return yearPart ? parseInt(yearPart.value, 10) : null;
}

/**
 * Validates that VAT rate corresponds to the statutory rate for the fiscal year.
 * For 1404 and 1405, standard rate is 10% (0.10), or 0% (0.0) for exempt/export goods.
 */
export function validateVatRateForYear(
  invoiceDate: Date | string,
  vatRate: number,
  expectedRate?: number | null,
): { valid: boolean; expected: number; isExempt: boolean } {
  const rate = Math.round(Number(vatRate) * 10000) / 10000;

  // Zero-rated / exempt is always permissible
  if (rate === 0) {
    return { valid: true, expected: 0, isExempt: true };
  }

  if (expectedRate !== undefined && expectedRate !== null) {
    const valid = Math.abs(rate - expectedRate) < 1e-4;
    return { valid, expected: expectedRate, isExempt: false };
  }

  const jalaliYear = getJalaliYear(invoiceDate);
  if (jalaliYear === 1404 || jalaliYear === 1405) {
    // Statutory general VAT rate is 10% (0.10)
    const valid = Math.abs(rate - 0.1) < 1e-4;
    return { valid, expected: 0.1, isExempt: false };
  }

  // Other years accept statutory rate in [0, 1]
  return { valid: rate >= 0 && rate <= 1, expected: 0.1, isExempt: false };
}

/**
 * Validates 13-digit Moadian item code (sstid).
 */
export function validateItemTaxCode(sstid: string): boolean {
  const cleaned = toLatinDigits(sstid ?? '').replace(/\s+/g, '');
  return /^\d{13}$/.test(cleaned);
}

export interface MoadianPreFlightOptions {
  sellerPostalCode?: string | null;
  buyerPostalCode?: string | null;
  defaultSstid?: string | null;
  itemSstids?: Array<string | null>;
  expectedVatRate?: number | null;
}

/**
 * Scale according to currency: IRR = 0, IRT = 1, others = 2 decimals.
 */
function getCurrencyScale(currency?: Currency | string): number {
  if (currency === Currency.IRR || currency === 'IRR') return 0;
  if (currency === Currency.IRT || currency === 'IRT') return 1;
  return 2;
}

function toMinorUnits(value: number | string | null | undefined, scale: number): bigint {
  if (value === null || value === undefined) return 0n;
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return 0n;
  const factor = 10 ** scale;
  return BigInt(Math.round(num * factor));
}

/**
 * Performs full pre-flight validation on an invoice before submission to Moadian.
 * Returns field-level Persian error messages.
 */
export function runMoadianPreFlightValidation(
  invoice: InvoiceResponseDto,
  options?: MoadianPreFlightOptions,
): MoadianPreFlightResult {
  const errors: MoadianPreFlightError[] = [];

  // 1. Seller national ID / economic code validation
  const rawSellerId = invoice.sellerInfo?.nationalId ?? '';
  const rawSellerEco = invoice.sellerInfo?.economicCode ?? '';
  const sellerId = toLatinDigits(rawSellerId).replace(/\s+/g, '');
  const sellerEco = toLatinDigits(rawSellerEco).replace(/\s+/g, '');

  if (!sellerId && !sellerEco) {
    errors.push({
      field: 'sellerInfo.nationalId',
      message: 'شناسه ملی یا کد اقتصادی فروشنده الزامی است.',
      code: 'SELLER_ID_MISSING',
    });
  } else {
    if (sellerId) {
      if (sellerId.length === 10) {
        if (!validateNationalIdChecksum(sellerId)) {
          errors.push({
            field: 'sellerInfo.nationalId',
            message: 'کد ملی فروشنده دارای رقم کنترلی معتبر نیست.',
            code: 'SELLER_NATIONAL_ID_CHECKSUM_INVALID',
          });
        }
      } else if (sellerId.length === 11) {
        if (!validateLegalEntityIdChecksum(sellerId)) {
          errors.push({
            field: 'sellerInfo.nationalId',
            message: 'شناسه ملی شخص حقوقی فروشنده نامعتبر است.',
            code: 'SELLER_LEGAL_ID_CHECKSUM_INVALID',
          });
        }
      } else {
        errors.push({
          field: 'sellerInfo.nationalId',
          message: 'شناسه ملی فروشنده باید ۱۰ رقم (شخص حقیقی) یا ۱۱ رقم (شخص حقوقی) باشد.',
          code: 'SELLER_ID_LENGTH_INVALID',
        });
      }
    }
    if (sellerEco) {
      if (!/^\d{11,14}$/.test(sellerEco)) {
        errors.push({
          field: 'sellerInfo.economicCode',
          message: 'کد اقتصادی فروشنده باید ۱۱ تا ۱۴ رقم عددی باشد.',
          code: 'SELLER_ECONOMIC_CODE_INVALID',
        });
      }
    }
  }

  // 2. Buyer national ID / economic code checksum validation (if buyer info provided)
  const rawBuyerId = invoice.buyerInfo?.nationalId ?? '';
  const rawBuyerEco = invoice.buyerInfo?.economicCode ?? '';
  const buyerId = toLatinDigits(rawBuyerId).replace(/\s+/g, '');
  const buyerEco = toLatinDigits(rawBuyerEco).replace(/\s+/g, '');

  if (buyerId) {
    if (buyerId.length === 10) {
      if (!validateNationalIdChecksum(buyerId)) {
        errors.push({
          field: 'buyerInfo.nationalId',
          message: 'کد ملی خریدار دارای رقم کنترلی معتبر نیست.',
          code: 'BUYER_NATIONAL_ID_CHECKSUM_INVALID',
        });
      }
    } else if (buyerId.length === 11) {
      if (!validateLegalEntityIdChecksum(buyerId)) {
        errors.push({
          field: 'buyerInfo.nationalId',
          message: 'شناسه ملی شخص حقوقی خریدار نامعتبر است.',
          code: 'BUYER_LEGAL_ID_CHECKSUM_INVALID',
        });
      }
    } else if (buyerId.length === 12) {
      // 12-digit foreign passport / fida code
      if (!/^\d{12}$/.test(buyerId)) {
        errors.push({
          field: 'buyerInfo.nationalId',
          message: 'کد فراگیر اتباع خارجی خریدار باید ۱۲ رقم عددی باشد.',
          code: 'BUYER_FOREIGN_ID_INVALID',
        });
      }
    } else {
      errors.push({
        field: 'buyerInfo.nationalId',
        message: 'شناسه خریدار باید کد ملی ۱۰ رقمی، شناسه حقوقی ۱۱ رقمی یا کد فراگیر ۱۲ رقمی باشد.',
        code: 'BUYER_ID_LENGTH_INVALID',
      });
    }
  }
  if (buyerEco) {
    if (!/^\d{11,14}$/.test(buyerEco)) {
      errors.push({
        field: 'buyerInfo.economicCode',
        message: 'کد اقتصادی خریدار باید ۱۱ تا ۱۴ رقم عددی باشد.',
        code: 'BUYER_ECONOMIC_CODE_INVALID',
      });
    }
  }

  // 3. Postal code 10-digit format validation
  const rawSellerPostal = options?.sellerPostalCode ?? invoice.sellerInfo?.postalCode;
  const sellerPostal = toLatinDigits(rawSellerPostal ?? '').replace(/\s+/g, '');
  if (sellerPostal && !validatePostalCodeFormat(sellerPostal)) {
    errors.push({
      field: 'sellerInfo.postalCode',
      message: 'کد پستی فروشنده باید ۱۰ رقمی استاندارد و معتبر باشد.',
      code: 'SELLER_POSTAL_CODE_INVALID',
    });
  }

  const rawBuyerPostal = options?.buyerPostalCode ?? invoice.buyerInfo?.postalCode;
  const buyerPostal = toLatinDigits(rawBuyerPostal ?? '').replace(/\s+/g, '');
  if (buyerPostal && !validatePostalCodeFormat(buyerPostal)) {
    errors.push({
      field: 'buyerInfo.postalCode',
      message: 'کد پستی خریدار باید ۱۰ رقمی استاندارد و معتبر باشد.',
      code: 'BUYER_POSTAL_CODE_INVALID',
    });
  }

  // 4. Line items validation (tax code, VAT rate, math totals)
  const items = invoice.items ?? [];
  if (items.length === 0) {
    errors.push({
      field: 'items',
      message: 'صورتحساب فاقد سطر اقلام است.',
      code: 'ITEMS_EMPTY',
    });
  }

  const rawDate = invoice.issuedAt ?? invoice.createdAt;
  if (!rawDate) {
    errors.push({
      field: 'issuedAt',
      message: 'تاریخ صدور صورتحساب مشخص نیست.',
      code: 'INVOICE_DATE_MISSING',
    });
  }

  const dateObj = rawDate ? new Date(rawDate) : null;
  const jalaliYear = getJalaliYear(dateObj);
  if (rawDate && (!dateObj || isNaN(dateObj.getTime()) || jalaliYear === null)) {
    errors.push({
      field: 'issuedAt',
      message: 'تاریخ صدور صورتحساب نامعتبر است.',
      code: 'INVOICE_DATE_INVALID',
    });
  }

  const scale = getCurrencyScale(invoice.currency);
  const factor = 10 ** scale;

  let calculatedTotalAmountUnits = 0n;
  let calculatedTotalDiscountUnits = 0n;
  let calculatedTotalTaxUnits = 0n;

  items.forEach((item, index) => {
    const fieldPrefix = `items[${index}]`;

    // Item tax code (SSTID)
    const itemRecord = item as unknown as Record<string, unknown>;
    const sstid = toLatinDigits(
      (item.taxCode as string) ??
      (itemRecord.sstid as string) ??
      options?.itemSstids?.[index] ??
      options?.defaultSstid ??
      '',
    ).trim();

    if (!sstid || !validateItemTaxCode(sstid)) {
      errors.push({
        field: `${fieldPrefix}.sstid`,
        message: `سطر ${index + 1}: شناسه کالا/خدمت (sstid) باید کد ۱۳ رقمی معتبر باشد.`,
        code: 'ITEM_SSTID_INVALID',
      });
    }

    // Tax rate for fiscal year
    const vatRate = Number(item.vatRate ?? 0);
    const vatCheck = validateVatRateForYear(dateObj ?? new Date(), vatRate, options?.expectedVatRate);
    if (!vatCheck.valid) {
      const displayYear = jalaliYear ? toPersianDigits(jalaliYear.toString()) : '';
      const displayExpected = toPersianDigits(Math.round(vatCheck.expected * 100).toString());
      errors.push({
        field: `${fieldPrefix}.vatRate`,
        message: `سطر ${index + 1}: نرخ مالیات بر ارزش افزوده برای سال مالی ${displayYear} باید ${displayExpected}٪ (یا ۰٪ برای اقلام معاف) باشد؛ مقدار فعلی ${toPersianDigits(Math.round(vatRate * 100).toString())}٪ است.`,
        code: 'ITEM_VAT_RATE_MISMATCH_FISCAL_YEAR',
      });
    }

    // Line math consistency using exact integer minor units
    const qty = Number(item.quantity ?? 0);
    const unitPrice = Number(item.unitPrice ?? 0);
    const discount = Number(item.discount ?? 0);

    const grossUnits = toMinorUnits(Math.round(qty * unitPrice * factor) / factor, scale);
    const discountUnits = toMinorUnits(discount, scale);
    const netUnits = grossUnits > discountUnits ? grossUnits - discountUnits : 0n;
    const expectedTaxUnits = toMinorUnits(Math.round((Number(netUnits) / factor) * vatRate * factor) / factor, scale);
    const expectedLineTotalUnits = netUnits + expectedTaxUnits;

    calculatedTotalAmountUnits += grossUnits;
    calculatedTotalDiscountUnits += discountUnits;
    calculatedTotalTaxUnits += item.tax !== undefined ? toMinorUnits(item.tax, scale) : expectedTaxUnits;

    if (item.tax !== undefined) {
      const actualTaxUnits = toMinorUnits(item.tax, scale);
      if (actualTaxUnits !== expectedTaxUnits) {
        errors.push({
          field: `${fieldPrefix}.tax`,
          message: `سطر ${index + 1}: مبلغ مالیات (${item.tax}) با حاصل‌ضرب نرخ در خالص سطر همخوانی ندارد.`,
          code: 'ITEM_TAX_MATH_MISMATCH',
        });
      }
    }

    if (item.total !== undefined) {
      const actualTotalUnits = toMinorUnits(item.total, scale);
      if (actualTotalUnits !== expectedLineTotalUnits) {
        errors.push({
          field: `${fieldPrefix}.total`,
          message: `سطر ${index + 1}: جمع سطر (${item.total}) با مجموع خالص و مالیات برابر نیست.`,
          code: 'ITEM_TOTAL_MATH_MISMATCH',
        });
      }
    }
  });

  // 5. Header totals consistency using exact minor units
  if (invoice.totalAmount !== undefined && toMinorUnits(invoice.totalAmount, scale) !== calculatedTotalAmountUnits) {
    errors.push({
      field: 'totalAmount',
      message: `مجموع ناخالص صورتحساب (${invoice.totalAmount}) با مجموع سطرهای اقلام مطابقت ندارد.`,
      code: 'HEADER_TOTAL_AMOUNT_MISMATCH',
    });
  }

  if (invoice.totalTax !== undefined && toMinorUnits(invoice.totalTax, scale) !== calculatedTotalTaxUnits) {
    errors.push({
      field: 'totalTax',
      message: `مجموع مالیات صورتحساب (${invoice.totalTax}) با مجموع مالیات سطرها مطابقت ندارد.`,
      code: 'HEADER_TOTAL_TAX_MISMATCH',
    });
  }

  const expectedFinalPayableUnits =
    calculatedTotalAmountUnits - calculatedTotalDiscountUnits + calculatedTotalTaxUnits;
  if (
    invoice.finalPayable !== undefined &&
    toMinorUnits(invoice.finalPayable, scale) !== expectedFinalPayableUnits
  ) {
    errors.push({
      field: 'finalPayable',
      message: `مبلغ نهایی قابل پرداخت (${invoice.finalPayable}) با مجموع خالص و مالیات اقلام برابر نیست.`,
      code: 'HEADER_FINAL_PAYABLE_MISMATCH',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
