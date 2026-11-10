import type { InvoiceResponseDto } from "@/types/invoicing";

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
 * Validates 10-digit Iranian Individual National ID checksum (کد ملی).
 * Uses modulo 11 algorithm.
 */
export function validateNationalIdChecksum(nationalId: string): boolean {
  const cleaned = (nationalId ?? "").replace(/\s+/g, "");
  if (!/^\d{10}$/.test(cleaned)) {
    return false;
  }

  // Reject all identical digits (0000000000, 1111111111, ..., 9999999999)
  if (/^(\d)\1{9}$/.test(cleaned)) {
    return false;
  }

  const digits = cleaned.split("").map(Number);
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

export function toPersianDigits(str: string): string {
  const p = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
  return (str ?? "").replace(/\d/g, (d) => p[parseInt(d, 10)]);
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
  const cleaned = (legalId ?? "").replace(/\s+/g, "");
  if (!/^\d{11}$/.test(cleaned)) {
    return false;
  }

  if (/^(\d)\1{10}$/.test(cleaned)) {
    return false;
  }

  const digits = cleaned.split("").map(Number);
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
 */
export function validatePostalCodeFormat(postalCode: string): boolean {
  const cleaned = (postalCode ?? "").replace(/\s+/g, "");
  if (!/^\d{10}$/.test(cleaned)) {
    return false;
  }

  if (cleaned[0] === "0" || cleaned[0] === "2") {
    return false;
  }

  if (cleaned[4] === "0" || cleaned[4] === "2") {
    return false;
  }

  if (/(\d)\1{4}/.test(cleaned)) {
    return false;
  }

  return true;
}

/**
 * Extracts Jalali year from date.
 */
export function getJalaliYear(date: Date | string): number {
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) {
    return 1404;
  }
  const parts = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", {
    timeZone: "Asia/Tehran",
    year: "numeric",
  }).formatToParts(d);
  const yearPart = parts.find((p) => p.type === "year");
  return yearPart ? parseInt(yearPart.value, 10) : 1404;
}

/**
 * Validates that VAT rate corresponds to the statutory rate for the fiscal year.
 * For 1404 and 1405, standard rate is 10% (0.10), or 0% (0.0) for exempt/export goods.
 */
export function validateVatRateForYear(
  invoiceDate: Date | string,
  vatRate: number,
): { valid: boolean; expected: number; isExempt: boolean } {
  const jalaliYear = getJalaliYear(invoiceDate);
  const rate = Math.round(Number(vatRate) * 100) / 100;

  if (rate === 0) {
    return { valid: true, expected: 0, isExempt: true };
  }

  if (jalaliYear === 1404 || jalaliYear === 1405) {
    const valid = Math.abs(rate - 0.1) < 1e-4;
    return { valid, expected: 0.1, isExempt: false };
  }

  return { valid: rate >= 0 && rate <= 1, expected: 0.1, isExempt: false };
}

/**
 * Validates 13-digit Moadian item code (sstid).
 */
export function validateItemTaxCode(sstid: string): boolean {
  const cleaned = (sstid ?? "").replace(/\s+/g, "");
  return /^\d{13}$/.test(cleaned);
}

/**
 * Performs full pre-flight validation on an invoice before submission to Moadian.
 * Returns field-level Persian error messages.
 */
export function runMoadianPreFlightValidation(
  invoice: InvoiceResponseDto,
  options?: {
    sellerPostalCode?: string | null;
    buyerPostalCode?: string | null;
    defaultSstid?: string | null;
  },
): MoadianPreFlightResult {
  const errors: MoadianPreFlightError[] = [];

  // 1. Seller national ID / economic code validation
  const sellerId = invoice.sellerInfo?.nationalId?.replace(/\s+/g, "") ?? "";
  const sellerEco = invoice.sellerInfo?.economicCode?.replace(/\s+/g, "") ?? "";
  if (!sellerId && !sellerEco) {
    errors.push({
      field: "sellerInfo.nationalId",
      message: "شناسه ملی یا کد اقتصادی فروشنده الزامی است.",
      code: "SELLER_ID_MISSING",
    });
  } else {
    if (sellerId.length === 10 && !validateNationalIdChecksum(sellerId)) {
      errors.push({
        field: "sellerInfo.nationalId",
        message: "کد ملی فروشنده دارای رقم کنترلی معتبر نیست.",
        code: "SELLER_NATIONAL_ID_CHECKSUM_INVALID",
      });
    } else if (sellerId.length === 11 && !validateLegalEntityIdChecksum(sellerId)) {
      errors.push({
        field: "sellerInfo.nationalId",
        message: "شناسه ملی شخص حقوقی فروشنده نامعتبر است.",
        code: "SELLER_LEGAL_ID_CHECKSUM_INVALID",
      });
    }
  }

  // 2. Buyer national ID checksum validation (if buyer info provided)
  const buyerId = invoice.buyerInfo?.nationalId?.replace(/\s+/g, "") ?? "";
  if (buyerId) {
    if (buyerId.length === 10) {
      if (!validateNationalIdChecksum(buyerId)) {
        errors.push({
          field: "buyerInfo.nationalId",
          message: "کد ملی خریدار دارای رقم کنترلی معتبر نیست.",
          code: "BUYER_NATIONAL_ID_CHECKSUM_INVALID",
        });
      }
    } else if (buyerId.length === 11) {
      if (!validateLegalEntityIdChecksum(buyerId)) {
        errors.push({
          field: "buyerInfo.nationalId",
          message: "شناسه ملی شخص حقوقی خریدار نامعتبر است.",
          code: "BUYER_LEGAL_ID_CHECKSUM_INVALID",
        });
      }
    } else if (buyerId.length !== 12) {
      errors.push({
        field: "buyerInfo.nationalId",
        message: "شناسه خریدار باید کد ملی ۱۰ رقمی، شناسه حقوقی ۱۱ رقمی یا کد فراگیر ۱۲ رقمی باشد.",
        code: "BUYER_ID_LENGTH_INVALID",
      });
    }
  }

  // 3. Postal code 10-digit format validation
  const sellerPostal = (
    options?.sellerPostalCode ??
    ((invoice.sellerInfo as unknown as Record<string, unknown>)?.postalCode as string | undefined)
  )?.replace(/\s+/g, "");
  if (sellerPostal && !validatePostalCodeFormat(sellerPostal)) {
    errors.push({
      field: "sellerInfo.postalCode",
      message: "کد پستی فروشنده باید ۱۰ رقمی استاندارد و معتبر باشد.",
      code: "SELLER_POSTAL_CODE_INVALID",
    });
  }

  const buyerPostal = (
    options?.buyerPostalCode ??
    ((invoice.buyerInfo as unknown as Record<string, unknown>)?.postalCode as string | undefined)
  )?.replace(/\s+/g, "");
  if (buyerPostal && !validatePostalCodeFormat(buyerPostal)) {
    errors.push({
      field: "buyerInfo.postalCode",
      message: "کد پستی خریدار باید ۱۰ رقمی استاندارد و معتبر باشد.",
      code: "BUYER_POSTAL_CODE_INVALID",
    });
  }

  // 4. Line items validation (tax code, VAT rate, math totals)
  const items = invoice.items ?? [];
  if (items.length === 0) {
    errors.push({
      field: "items",
      message: "صورتحساب فاقد سطر اقلام است.",
      code: "ITEMS_EMPTY",
    });
  }

  const issuedDate = invoice.issuedAt ?? invoice.createdAt ?? new Date();
  const jalaliYear = getJalaliYear(issuedDate);

  let calculatedTotalAmount = 0;
  let calculatedTotalDiscount = 0;
  let calculatedTotalTax = 0;

  items.forEach((item, index) => {
    const fieldPrefix = `items[${index}]`;

    // Item tax code (SSTID)
    const itemRecord = item as unknown as Record<string, unknown>;
    const sstid =
      (itemRecord.taxCode as string | undefined) ??
      (itemRecord.sstid as string | undefined) ??
      options?.defaultSstid;
    if (!sstid || !validateItemTaxCode(sstid)) {
      errors.push({
        field: `${fieldPrefix}.sstid`,
        message: `سطر ${index + 1}: شناسه کالا/خدمت (sstid) باید کد ۱۳ رقمی معتبر باشد.`,
        code: "ITEM_SSTID_INVALID",
      });
    }

    // Tax rate for fiscal year (10% for 1404-1405)
    const vatRate = Number(item.vatRate ?? 0);
    const vatCheck = validateVatRateForYear(issuedDate, vatRate);
    if (!vatCheck.valid) {
      errors.push({
        field: `${fieldPrefix}.vatRate`,
        message: `سطر ${index + 1}: نرخ مالیات بر ارزش افزوده برای سال مالی ${toPersianDigits(jalaliYear.toString())} باید ۱۰٪ (یا ۰٪ برای اقلام معاف) باشد؛ مقدار فعلی ${toPersianDigits(Math.round(vatRate * 100).toString())}٪ است.`,
        code: "ITEM_VAT_RATE_MISMATCH_FISCAL_YEAR",
      });
    }

    // Line math consistency
    const qty = Number(item.quantity ?? 0);
    const unitPrice = Number(item.unitPrice ?? 0);
    const discount = Number(item.discount ?? 0);
    const expectedGross = Math.round(qty * unitPrice);
    const expectedNet = Math.max(0, expectedGross - discount);
    const expectedTax = Math.round(expectedNet * vatRate);

    calculatedTotalAmount += expectedGross;
    calculatedTotalDiscount += discount;
    calculatedTotalTax += Number(item.tax ?? expectedTax);

    if (item.tax !== undefined && Math.abs(Number(item.tax) - expectedTax) > 1) {
      errors.push({
        field: `${fieldPrefix}.tax`,
        message: `سطر ${index + 1}: مبلغ مالیات (${item.tax}) با حاصل‌ضرب نرخ در خالص سطر (${expectedTax}) همخوانی ندارد.`,
        code: "ITEM_TAX_MATH_MISMATCH",
      });
    }

    if (item.total !== undefined) {
      const expectedLineTotal = expectedNet + expectedTax;
      if (Math.abs(Number(item.total) - expectedLineTotal) > 1) {
        errors.push({
          field: `${fieldPrefix}.total`,
          message: `سطر ${index + 1}: جمع سطر (${item.total}) با مجموع خالص و مالیات (${expectedLineTotal}) برابر نیست.`,
          code: "ITEM_TOTAL_MATH_MISMATCH",
        });
      }
    }
  });

  // 5. Header totals consistency
  if (invoice.totalAmount !== undefined && Math.abs(Number(invoice.totalAmount) - calculatedTotalAmount) > 1) {
    errors.push({
      field: "totalAmount",
      message: `مجموع ناخالص صورتحساب (${invoice.totalAmount}) با مجموع سطرهای اقلام (${calculatedTotalAmount}) مطابقت ندارد.`,
      code: "HEADER_TOTAL_AMOUNT_MISMATCH",
    });
  }

  if (invoice.totalTax !== undefined && Math.abs(Number(invoice.totalTax) - calculatedTotalTax) > 1) {
    errors.push({
      field: "totalTax",
      message: `مجموع مالیات صورتحساب (${invoice.totalTax}) با مجموع مالیات سطرها (${calculatedTotalTax}) مطابقت ندارد.`,
      code: "HEADER_TOTAL_TAX_MISMATCH",
    });
  }

  const expectedFinalPayable = calculatedTotalAmount - calculatedTotalDiscount + calculatedTotalTax;
  if (invoice.finalPayable !== undefined && Math.abs(Number(invoice.finalPayable) - expectedFinalPayable) > 1) {
    errors.push({
      field: "finalPayable",
      message: `مبلغ نهایی قابل پرداخت (${invoice.finalPayable}) با مجموع خالص و مالیات اقلام (${expectedFinalPayable}) برابر نیست.`,
      code: "HEADER_FINAL_PAYABLE_MISMATCH",
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
