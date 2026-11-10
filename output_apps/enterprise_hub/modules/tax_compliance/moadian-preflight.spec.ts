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

  describe('VAT Rate Matching Fiscal Year (10% for 1404-1405)', () => {
    it('extracts Jalali year correctly', () => {
      // 2025-11-10 is in Jalali year 1404
      expect(getJalaliYear('2025-11-10T00:00:00Z')).toBe(1404);
      // 2026-11-10 is in Jalali year 1405
      expect(getJalaliYear('2026-11-10T00:00:00Z')).toBe(1405);
    });

    it('accepts 10% (0.10) for year 1404 and 1405', () => {
      const res1404 = validateVatRateForYear('2025-10-01', 0.1);
      expect(res1404.valid).toBe(true);
      expect(res1404.expected).toBe(0.1);

      const res1405 = validateVatRateForYear('2026-10-01', 0.1);
      expect(res1405.valid).toBe(true);
      expect(res1405.expected).toBe(0.1);
    });

    it('accepts 0% for exempt items in 1404 and 1405', () => {
      const res = validateVatRateForYear('2026-10-01', 0);
      expect(res.valid).toBe(true);
      expect(res.isExempt).toBe(true);
    });

    it('rejects outdated 9% rate for fiscal years 1404 and 1405', () => {
      const res = validateVatRateForYear('2026-10-01', 0.09);
      expect(res.valid).toBe(false);
      expect(res.expected).toBe(0.1);
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
      const result = runMoadianPreFlightValidation(invalid as unknown as InvoiceResponseDto);
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
      const result = runMoadianPreFlightValidation(invalid as unknown as InvoiceResponseDto);
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
      const result = runMoadianPreFlightValidation(invalid as unknown as InvoiceResponseDto);
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
      const result = runMoadianPreFlightValidation(invalid as unknown as InvoiceResponseDto);
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
      const result = runMoadianPreFlightValidation(invalid as unknown as InvoiceResponseDto);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'totalTax')).toBe(true);
      expect(result.errors.find((e) => e.field === 'totalTax')?.message).toContain(
        'مجموع مالیات صورتحساب',
      );
    });
  });
});
