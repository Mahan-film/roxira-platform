import { Currency } from '../currency/enums/currency.enum';
import { InvoiceResponseDto } from '../invoicing/dto/invoice-response.dto';
import { InvoiceJurisdiction } from '../invoicing/enums/invoice-jurisdiction.enum';
import { InvoiceStatus } from '../invoicing/enums/invoice-status.enum';
import {
  validateNationalIdChecksum,
  validateLegalEntityIdChecksum,
  validatePostalCodeFormat,
  validateVatRateForYear,
  validateItemTaxCode,
  runMoadianPreFlightValidation,
  toMinorUnits,
  getJalaliYear,
} from './utils/moadian-preflight.validator';

describe('Moadian Pre-Flight Validation (T71)', () => {
  describe('Iranian National ID Checksum (کد ملی ۱۰ رقمی)', () => {
    it('accepts textbook valid 10-digit Iranian national IDs', () => {
      // 0012345679: S = 112, 112 % 11 = 2, 11 - 2 = 9
      expect(validateNationalIdChecksum('0012345679')).toBe(true);
      // 0081014163
      expect(validateNationalIdChecksum('0081014163')).toBe(true);
      // 7731689956
      expect(validateNationalIdChecksum('7731689956')).toBe(true);
    });

    it('rejects national ID with invalid check digit', () => {
      expect(validateNationalIdChecksum('0012345678')).toBe(false);
      expect(validateNationalIdChecksum('1234567890')).toBe(false);
    });

    it('rejects identical digits (e.g. 1111111111, 0000000000)', () => {
      expect(validateNationalIdChecksum('0000000000')).toBe(false);
      expect(validateNationalIdChecksum('1111111111')).toBe(false);
      expect(validateNationalIdChecksum('2222222222')).toBe(false);
    });

    it('rejects strings not exactly 10 digits', () => {
      expect(validateNationalIdChecksum('12345')).toBe(false);
      expect(validateNationalIdChecksum('12345678901')).toBe(false);
      expect(validateNationalIdChecksum('001234567A')).toBe(false);
    });
  });

  describe('Legal Entity ID (شناسه ملی ۱۱ رقمی)', () => {
    it('accepts valid 11-digit legal entity ID', () => {
      // Known valid legal entity IDs (Variant A modulo-11):
      expect(validateLegalEntityIdChecksum('10380284790')).toBe(true);
      expect(validateLegalEntityIdChecksum('10100412352')).toBe(true);
    });

    it('rejects identical 11 digits', () => {
      expect(validateLegalEntityIdChecksum('11111111111')).toBe(false);
      expect(validateLegalEntityIdChecksum('00000000000')).toBe(false);
    });

    it('rejects length not 11', () => {
      expect(validateLegalEntityIdChecksum('1010101010')).toBe(false);
      expect(validateLegalEntityIdChecksum('101010101012')).toBe(false);
    });
  });

  describe('Postal Code Format (کد پستی ۱۰ رقمی)', () => {
    it('accepts standard 10-digit postal codes', () => {
      expect(validatePostalCodeFormat('1985913111')).toBe(true);
      expect(validatePostalCodeFormat('1456789123')).toBe(true);
      expect(validatePostalCodeFormat('3148569874')).toBe(true);
    });

    it('rejects postal codes starting with 0 or 2', () => {
      expect(validatePostalCodeFormat('0123456789')).toBe(false);
      expect(validatePostalCodeFormat('2123456789')).toBe(false);
    });

    it('rejects postal codes with 5th digit 0 or 2', () => {
      expect(validatePostalCodeFormat('1985013111')).toBe(false);
      expect(validatePostalCodeFormat('1985213111')).toBe(false);
    });

    it('rejects postal codes with 5 repeating characters', () => {
      expect(validatePostalCodeFormat('1111167890')).toBe(false);
    });

    it('rejects lengths other than 10 digits', () => {
      expect(validatePostalCodeFormat('12345')).toBe(false);
      expect(validatePostalCodeFormat('12345678901')).toBe(false);
    });
  });

  describe('VAT Rate Matching Expected Statutory Rate', () => {
    it('extracts Jalali year correctly', () => {
      // 2025-11-10 is in Jalali year 1404
      expect(getJalaliYear('2025-11-10T00:00:00Z')).toBe(1404);
      // 2026-11-10 is in Jalali year 1405
      expect(getJalaliYear('2026-11-10T00:00:00Z')).toBe(1405);
    });

    it('accepts rate equal to provided expectedVatRate (0.10)', () => {
      const res1404 = validateVatRateForYear(0.1, 0.1);
      expect(res1404.valid).toBe(true);
      expect(res1404.expected).toBe(0.1);

      const res1405 = validateVatRateForYear(0.1, 0.1);
      expect(res1405.valid).toBe(true);
      expect(res1405.expected).toBe(0.1);
    });

    it('accepts 0% for exempt items in 1404 and 1405', () => {
      const res = validateVatRateForYear(0, 0.1);
      expect(res.valid).toBe(true);
      expect(res.isExempt).toBe(true);
    });

    it('rejects mismatch when expectedRate is specified', () => {
      const res = validateVatRateForYear(0.09, 0.1);
      expect(res.valid).toBe(false);
      expect(res.expected).toBe(0.1);
    });

    it('accepts explicit line rate when expectedRate is omitted', () => {
      const res = validateVatRateForYear(0.09);
      expect(res.valid).toBe(true);
      expect(res.expected).toBe(0.09);

      const invalidNegative = validateVatRateForYear(-0.05);
      expect(invalidNegative.valid).toBe(false);

      const invalidTooHigh = validateVatRateForYear(1.5);
      expect(invalidTooHigh.valid).toBe(false);
    });
  });

  describe('Item Tax Codes (SSTID)', () => {
    it('accepts valid 13-digit numeric codes', () => {
      expect(validateItemTaxCode('2330001234567')).toBe(true);
      expect(validateItemTaxCode('1234567890123')).toBe(true);
    });

    it('rejects codes with wrong length or non-numeric characters', () => {
      expect(validateItemTaxCode('123456789012')).toBe(false); // 12 digits
      expect(validateItemTaxCode('12345678901234')).toBe(false); // 14 digits
      expect(validateItemTaxCode('233000123456A')).toBe(false);
    });
  });

  describe('Full Pre-Flight Invoice Validation', () => {
    const validInvoice: InvoiceResponseDto = {
      id: 'inv-valid',
      taxInvoiceNumber: 'TI-001',
      direction: 'SALE' as never,
      status: InvoiceStatus.ISSUED,
      jurisdiction: InvoiceJurisdiction.IR,
      currency: Currency.IRR,
      fxRate: 1,
      totalAmount: 20000000,
      totalDiscount: 1000000,
      totalTax: 1900000,
      finalPayable: 20900000,
      issuedAt: new Date('2026-11-10T12:00:00.000Z'), // 1405
      sellerInfo: {
        name: 'شرکت پترو فروش',
        economicCode: '10380284790',
        nationalId: '10380284790',
        postalCode: '1985913111',
      },
      buyerInfo: {
        name: 'مشتری معتبر',
        nationalId: '0012345679', // valid checksum
        postalCode: '1456789123',
      },
      items: [
        {
          taxCode: '2330001234567', // valid 13 digits
          description: 'کالای تست الف',
          quantity: 2,
          unitPrice: 10000000,
          discount: 1000000,
          vatRate: 0.1, // 10%
          tax: 1900000,
          total: 20900000,
        },
      ],
    } as unknown as InvoiceResponseDto;

    it('passes for a fully valid invoice', () => {
      const result = runMoadianPreFlightValidation(validInvoice);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns Persian error when buyer national ID checksum fails', () => {
      const invalid = {
        ...validInvoice,
        buyerInfo: { ...validInvoice.buyerInfo, nationalId: '0012345678' }, // invalid check digit
      };
      const result = runMoadianPreFlightValidation(invalid as unknown as InvoiceResponseDto, {
        expectedVatRate: 0.1,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'buyerInfo.nationalId')).toBe(true);
      expect(result.errors.find((e) => e.field === 'buyerInfo.nationalId')?.message).toContain(
        'کد ملی خریدار دارای رقم کنترلی معتبر نیست',
      );
    });

    it('returns Persian error when postal code is invalid format', () => {
      const invalid = {
        ...validInvoice,
        buyerInfo: { ...validInvoice.buyerInfo, postalCode: '0123456789' }, // starts with 0
      };
      const result = runMoadianPreFlightValidation(invalid as unknown as InvoiceResponseDto, {
        expectedVatRate: 0.1,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'buyerInfo.postalCode')).toBe(true);
      expect(result.errors.find((e) => e.field === 'buyerInfo.postalCode')?.message).toContain(
        'کد پستی',
      );
    });

    it('returns Persian error when VAT rate is not 10% for fiscal year 1405', () => {
      const invalid = {
        ...validInvoice,
        items: [
          {
            ...validInvoice.items![0],
            vatRate: 0.09, // 9% instead of statutory 10%
            tax: 1710000,
            total: 20710000,
          },
        ],
        totalTax: 1710000,
        finalPayable: 20710000,
      };
      const result = runMoadianPreFlightValidation(invalid as unknown as InvoiceResponseDto, {
        expectedVatRate: 0.1,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'items[0].vatRate')).toBe(true);
      expect(result.errors.find((e) => e.field === 'items[0].vatRate')?.message).toContain(
        'نرخ مالیات بر ارزش افزوده برای سال مالی ۱۴۰۵ باید ۱۰٪',
      );
    });

    it('returns Persian error when item tax code (SSTID) is invalid', () => {
      const invalid = {
        ...validInvoice,
        items: [
          {
            ...validInvoice.items![0],
            taxCode: '12345', // invalid length
          },
        ],
      };
      const result = runMoadianPreFlightValidation(invalid as unknown as InvoiceResponseDto, {
        expectedVatRate: 0.1,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'items[0].sstid')).toBe(true);
      expect(result.errors.find((e) => e.field === 'items[0].sstid')?.message).toContain(
        'شناسه کالا/خدمت (sstid) باید کد ۱۳ رقمی معتبر باشد',
      );
    });

    it('returns Persian error when totals do not match item sums', () => {
      const invalid = {
        ...validInvoice,
        totalTax: 999999, // does not match line tax 1,900,000
      };
      const result = runMoadianPreFlightValidation(invalid as unknown as InvoiceResponseDto, {
        expectedVatRate: 0.1,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'totalTax')).toBe(true);
      expect(result.errors.find((e) => e.field === 'totalTax')?.message).toContain(
        'مجموع مالیات صورتحساب',
      );
    });

    it('accepts Persian digits in national IDs, postal codes, and SSTIDs', () => {
      const persianInvoice = {
        ...validInvoice,
        sellerInfo: {
          ...validInvoice.sellerInfo,
          nationalId: '۱۰۳۸۰۲۸۴۷۹۰',
          postalCode: '۱۹۸۵۹۱۳۱۱۱',
        },
        buyerInfo: {
          ...validInvoice.buyerInfo,
          nationalId: '۰۰۱۲۳۴۵۶۷۹',
          postalCode: '۱۴۵۶۷۸۹۱۲۳',
        },
        items: [
          {
            ...validInvoice.items![0],
            taxCode: '۲۳۳۰۰۰۱۲۳۴۵۶۷',
          },
        ],
      };
      const result = runMoadianPreFlightValidation(persianInvoice as unknown as InvoiceResponseDto);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects seller ID with invalid length (neither 10 nor 11 digits)', () => {
      const invalid = {
        ...validInvoice,
        sellerInfo: { ...validInvoice.sellerInfo, nationalId: '123456789' }, // 9 digits
      };
      const result = runMoadianPreFlightValidation(invalid as unknown as InvoiceResponseDto, {
        expectedVatRate: 0.1,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'SELLER_ID_LENGTH_INVALID')).toBe(true);
    });

    it('rejects non-numeric seller economic code', () => {
      const invalid = {
        ...validInvoice,
        sellerInfo: { ...validInvoice.sellerInfo, economicCode: '10380ABCDEF' },
      };
      const result = runMoadianPreFlightValidation(invalid as unknown as InvoiceResponseDto, {
        expectedVatRate: 0.1,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'SELLER_ECONOMIC_CODE_INVALID')).toBe(true);
    });

    it('accepts 12-digit buyer foreign passport code and rejects bad length', () => {
      const validForeign = {
        ...validInvoice,
        buyerInfo: { ...validInvoice.buyerInfo, nationalId: '123456789012' },
      };
      const resForeign = runMoadianPreFlightValidation(validForeign as unknown as InvoiceResponseDto);
      expect(resForeign.errors.filter((e) => e.field === 'buyerInfo.nationalId')).toHaveLength(0);

      const invalidLength = {
        ...validInvoice,
        buyerInfo: { ...validInvoice.buyerInfo, nationalId: '1234567890123' }, // 13 digits
      };
      const resLen = runMoadianPreFlightValidation(invalidLength as unknown as InvoiceResponseDto);
      expect(resLen.errors.some((e) => e.code === 'BUYER_ID_LENGTH_INVALID')).toBe(true);
    });

    it('validates multi-currency math for IRT (scale 1)', () => {
      const irtInvoice = {
        ...validInvoice,
        currency: Currency.IRT,
        totalAmount: 2000000,
        totalDiscount: 100000,
        totalTax: 190000,
        finalPayable: 2090000,
        items: [
          {
            taxCode: '2330001234567',
            description: 'کالا به تومان',
            quantity: 2,
            unitPrice: 1000000,
            discount: 100000,
            vatRate: 0.1,
            tax: 190000,
            total: 2090000,
          },
        ],
      };
      const result = runMoadianPreFlightValidation(irtInvoice as unknown as InvoiceResponseDto);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('falls back to options.defaultSstid when item has no taxCode', () => {
      const noItemCodeInvoice = {
        ...validInvoice,
        items: [
          {
            description: 'بدون کد کالا',
            quantity: 1,
            unitPrice: 20000000,
            discount: 1000000,
            vatRate: 0.1,
            tax: 1900000,
            total: 20900000,
          },
        ],
      };
      // Without defaultSstid -> fails
      const resWithout = runMoadianPreFlightValidation(noItemCodeInvoice as unknown as InvoiceResponseDto);
      expect(resWithout.valid).toBe(false);
      expect(resWithout.errors.some((e) => e.code === 'ITEM_SSTID_INVALID')).toBe(true);

      // With defaultSstid -> passes
      const resWith = runMoadianPreFlightValidation(noItemCodeInvoice as unknown as InvoiceResponseDto, {
        defaultSstid: '2330001234567',
      });
      expect(resWith.valid).toBe(true);
    });

    it('validates with options.expectedVatRate', () => {
      const customRateInvoice = {
        ...validInvoice,
        totalTax: 1140000,
        finalPayable: 20140000,
        items: [
          {
            taxCode: '2330001234567',
            description: 'کالا با نرخ ۶٪',
            quantity: 2,
            unitPrice: 10000000,
            discount: 1000000,
            vatRate: 0.06,
            tax: 1140000,
            total: 20140000,
          },
        ],
      };
      // When statutory expectedVatRate is 10%, 6% fails
      const resFail = runMoadianPreFlightValidation(customRateInvoice as unknown as InvoiceResponseDto, {
        expectedVatRate: 0.1,
      });
      expect(resFail.valid).toBe(false);

      // With expectedVatRate: 0.06, passes
      const resPass = runMoadianPreFlightValidation(customRateInvoice as unknown as InvoiceResponseDto, {
        expectedVatRate: 0.06,
      });
      expect(resPass.valid).toBe(true);
    });

    it('detects header total discount mismatch', () => {
      const discountMismatchInvoice = {
        ...validInvoice,
        totalDiscount: 500000, // Should be 1000000 based on items
      };
      const res = runMoadianPreFlightValidation(discountMismatchInvoice as unknown as InvoiceResponseDto);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.code === 'HEADER_TOTAL_DISCOUNT_MISMATCH')).toBe(true);
    });

    it('validates scale-2 currency amounts with exact Number.EPSILON rounding', () => {
      const eurInvoice = {
        id: 'eur-inv-1',
        currency: 'EUR',
        issuedAt: new Date('2026-10-01T12:00:00Z'),
        sellerInfo: { nationalId: '10380284790', postalCode: '1985913111' },
        buyerInfo: { nationalId: '0012345679', postalCode: '1456789123' },
        totalAmount: 100.55,
        totalDiscount: 10.05,
        totalTax: 18.1,
        finalPayable: 108.6,
        items: [
          {
            taxCode: '2330001234567',
            description: 'Item in EUR',
            quantity: 1,
            unitPrice: 100.55,
            discount: 10.05,
            vatRate: 0.2,
            tax: 18.1,
            total: 108.6,
          },
        ],
      };
      const res = runMoadianPreFlightValidation(eurInvoice as unknown as InvoiceResponseDto, {
        expectedVatRate: 0.2,
      });
      expect(res.valid).toBe(true);
    });

    it('rejects invalid or missing invoice date', () => {
      const invalidDateInvoice = {
        ...validInvoice,
        issuedAt: new Date('invalid-date'),
      };
      const res = runMoadianPreFlightValidation(invalidDateInvoice as unknown as InvoiceResponseDto);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.code === 'INVOICE_DATE_INVALID')).toBe(true);
    });
  });

  describe('Server Pre-Flight Integration & VatRateResolver', () => {
    it('validateVatRateForYear respects expectedRate across any year', () => {
      // 1402 with 9% statutory rate
      const res1402 = validateVatRateForYear(0.09, 0.09);
      expect(res1402.valid).toBe(true);
      expect(res1402.expected).toBe(0.09);

      // 1403 with 10% statutory rate
      const res1403 = validateVatRateForYear(0.10, 0.10);
      expect(res1403.valid).toBe(true);

      // Mismatch against resolved rate
      const resMismatch = validateVatRateForYear(0.09, 0.10);
      expect(resMismatch.valid).toBe(false);
    });

    it('validateItemTaxCode normalises Persian digits and whitespace', () => {
      expect(validateItemTaxCode('۲۳۳۰۰۰۱۲۳۴۵۶۷')).toBe(true);
      expect(validateItemTaxCode('  2330001234567  ')).toBe(true);
      expect(validateItemTaxCode('123456789012')).toBe(false); // 12 digits
      expect(validateItemTaxCode('12345678901234')).toBe(false); // 14 digits
    });
  });
});

describe('Moadian server error hints (0301 / 0202 / 0012)', () => {
  const base = {
    currency: Currency.IRR,
    issuedAt: new Date('2026-11-10T12:00:00.000Z'),
    sellerInfo: { name: 's', nationalId: '10380284790', economicCode: '10380284790' },
    buyerInfo: { name: 'b' },
    items: [],
  } as unknown as InvoiceResponseDto;
  const now = new Date('2026-11-10T12:00:00.000Z');

  it('0202: flags an issue date more than 2 minutes in the future, accepts 1 minute', () => {
    const future = { ...base, issuedAt: new Date(now.getTime() + 3 * 60_000) } as InvoiceResponseDto;
    expect(runMoadianPreFlightValidation(future, { now }).errors.map((e) => e.code)).toContain('ISSUE_DATE_IN_FUTURE');
    const near = { ...base, issuedAt: new Date(now.getTime() + 60_000) } as InvoiceResponseDto;
    expect(runMoadianPreFlightValidation(near, { now }).errors.map((e) => e.code)).not.toContain('ISSUE_DATE_IN_FUTURE');
  });

  it('0301: memory id must be 6 chars and prefix the taxid', () => {
    const codes = (o: object) => runMoadianPreFlightValidation(base, { now, ...o }).errors.map((e) => e.code);
    expect(codes({ memoryId: 'AB12' })).toContain('MEMORY_ID_INVALID');
    expect(codes({ memoryId: 'ABC123', taxId: 'XYZ999000000' })).toContain('TAXID_MEMORY_ID_MISMATCH');
    const ok = codes({ memoryId: 'ABC123', taxId: 'ABC123000000' });
    expect(ok).not.toContain('MEMORY_ID_INVALID');
    expect(ok).not.toContain('TAXID_MEMORY_ID_MISMATCH');
  });

  it('0012: type-1 invoice without any buyer identification is flagged', () => {
    const errs = runMoadianPreFlightValidation(base, { now, invoiceType: 1 }).errors;
    expect(errs.find((e) => e.code === 'BUYER_ID_REQUIRED_TYPE1')?.message).toContain('0012');
    expect(runMoadianPreFlightValidation(base, { now, invoiceType: 2 }).errors.map((e) => e.code)).not.toContain('BUYER_ID_REQUIRED_TYPE1');
  });
});

describe('toMinorUnits (exact decimal parsing, no float)', () => {
  it('parses decimals exactly', () => {
    expect(toMinorUnits('0.1', 2)).toBe(10n);
    expect(toMinorUnits('29', 0)).toBe(29n);
    expect(toMinorUnits(29, 2)).toBe(2900n);
    expect(toMinorUnits('1234.5', 2)).toBe(123450n);
    expect(toMinorUnits(0.1, 2)).toBe(10n);
    expect(toMinorUnits(1e-7, 8)).toBe(10n);
    expect(toMinorUnits('۱۲.۵', 1)).toBe(125n);
    expect(toMinorUnits(null, 2)).toBe(0n);
    expect(toMinorUnits('', 2)).toBe(0n);
  });

  it('rounds half up at the scale, with no float error', () => {
    expect(toMinorUnits('1234.5678', 2)).toBe(123457n);
    expect(toMinorUnits('1234.5649', 2)).toBe(123456n);
    expect(toMinorUnits('1.005', 2)).toBe(101n); // float math gives 100
    expect(toMinorUnits('9007199254740993.5', 0)).toBe(9007199254740994n); // above 2^53
  });

  it('rejects non-numeric input', () => {
    for (const bad of ['abc', '1,5', '1e5', '--1', '1.2.3', ' ', '12abc', NaN, Infinity]) {
      expect(() => toMinorUnits(bad as never, 2)).toThrow();
    }
  });

  it('reports AMOUNT_INVALID instead of guessing', () => {
    const invoice = {
      currency: Currency.IRR,
      issuedAt: new Date('2026-11-10T12:00:00.000Z'),
      sellerInfo: { name: 's', nationalId: '10380284790' },
      buyerInfo: { name: 'b' },
      totalAmount: 'abc',
      items: [{ description: 'x', quantity: 1, unitPrice: '12x', discount: 0, vatRate: 0.1, taxCode: '2330001234567' }],
    } as unknown as InvoiceResponseDto;
    const errors = runMoadianPreFlightValidation(invoice, { expectedVatRate: 0.1 }).errors;
    expect(errors.filter((e) => e.code === 'AMOUNT_INVALID').map((e) => e.field).sort()).toEqual([
      'items[0].unitPrice',
      'totalAmount',
    ]);
    expect(errors.some((e) => /MATH_MISMATCH|HEADER_/.test(e.code))).toBe(false);
  });

  it('reports AMOUNT_INVALID on corrupt non-numeric vatRate without throwing RangeError', () => {
    const invoice = {
      currency: Currency.IRR,
      issuedAt: new Date('2026-11-10T12:00:00.000Z'),
      sellerInfo: { name: 's', nationalId: '10380284790' },
      buyerInfo: { name: 'b' },
      totalAmount: 1000,
      items: [{ description: 'x', quantity: 1, unitPrice: 1000, discount: 0, vatRate: 'bad-rate', taxCode: '2330001234567' }],
    } as unknown as InvoiceResponseDto;
    const errors = runMoadianPreFlightValidation(invoice, { expectedVatRate: 0.1 }).errors;
    expect(errors.filter((e) => e.code === 'AMOUNT_INVALID').map((e) => e.field)).toContain('items[0].vatRate');
  });
});
