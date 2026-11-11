import { isBankSms, parseBankSms } from './bank-sms.parser';
import { SYNTHETIC_BANK_SMS_FIXTURES } from './__fixtures__/synthetic-bank-sms.fixtures';
import { BankCode } from '../../banking/enums/banking.enum';
import { TreasuryDocKind } from '../enums/treasury.enum';

describe('Bank SMS Parser (T92)', () => {
  it('has 16 synthetic fixtures covering 8 banks in both directions', () => {
    expect(SYNTHETIC_BANK_SMS_FIXTURES).toHaveLength(16);

    const banks = [
      BankCode.MELLI,
      BankCode.MELLAT,
      BankCode.SADERAT,
      BankCode.TEJARAT,
      BankCode.SAMAN,
      BankCode.PASARGAD,
      BankCode.PARSIAN,
      BankCode.SEPAH,
    ];

    for (const bank of banks) {
      const deposits = SYNTHETIC_BANK_SMS_FIXTURES.filter(
        (f) => f.bank === bank && f.direction === 'deposit',
      );
      const withdrawals = SYNTHETIC_BANK_SMS_FIXTURES.filter(
        (f) => f.bank === bank && f.direction === 'withdraw',
      );
      expect(deposits).toHaveLength(1);
      expect(withdrawals).toHaveLength(1);
    }
  });

  describe('isBankSms detector', () => {
    it('returns true for all synthetic bank SMS fixtures', () => {
      for (const fixture of SYNTHETIC_BANK_SMS_FIXTURES) {
        expect(isBankSms(fixture.text)).toBe(true);
      }
    });

    it('returns false for unrelated text or non-bank messages', () => {
      expect(isBankSms('')).toBe(false);
      expect(isBankSms('سلام چطوری؟')).toBe(false);
      expect(isBankSms('کد ورود شما به سامانه: 123456')).toBe(false);
      expect(isBankSms('واریز پاداش به حساب شما انجام شد')).toBe(false); // No recognized bank
    });
  });

  describe('parseBankSms extraction per bank fixture', () => {
    for (const fixture of SYNTHETIC_BANK_SMS_FIXTURES) {
      const dirTitle = fixture.direction === 'deposit' ? 'واریز (دریافت)' : 'برداشت (پرداخت)';
      it(`accurately parses ${fixture.bankNameFa} ${dirTitle}`, () => {
        const parsed = parseBankSms(fixture.text);

        expect(parsed.bank).toBe(fixture.bank);
        expect(parsed.bankNameFa).toBe(fixture.bankNameFa);
        expect(parsed.direction).toBe(fixture.expected.direction);
        expect(parsed.docKind).toBe(
          fixture.direction === 'deposit' ? TreasuryDocKind.RECEIPT : TreasuryDocKind.PAYMENT,
        );

        // Exact money amount check
        expect(parsed.amountDecimal).toBe(fixture.expected.amountRials);

        // Balance check if fixture specifies
        if (fixture.expected.balanceRials) {
          expect(parsed.balanceDecimal).toBe(fixture.expected.balanceRials);
        }

        // Tail account or card check
        if (fixture.expected.cardOrAccountTail) {
          const tail = parsed.cardTail ?? parsed.accountTail;
          expect(tail).toBe(fixture.expected.cardOrAccountTail);
        }

        // Date-time check: must have converted Jalali 1403/08/22 to Gregorian 2024-11-12
        expect(parsed.dateTime).toBeDefined();
        expect(parsed.dateTime).toContain('2024-11-12');
      });
    }
  });

  describe('Edge cases and error handling', () => {
    it('falls back to generic parser when bank name is missing or unknown', () => {
      const text = 'واریز: 1,000,000 ریال به حساب ...1234';
      const parsed = parseBankSms(text);
      expect(parsed.bank).toBeNull();
      expect(parsed.bankNameFa).toBe('سایر / عمومی');
      expect(parsed.direction).toBe('deposit');
      expect(parsed.amountDecimal).toBe('1000000.00');
    });

    it('throws error when direction (واریز/برداشت) is missing', () => {
      const text = 'بانک ملی ایران\nمانده حساب: 10,000,000 ریال';
      expect(() => parseBankSms(text)).toThrow('نوع تراکنش (واریز یا برداشت) در متن پیامک یافت نشد.');
    });

    it('throws error when amount is missing', () => {
      const text = 'بانک ملت\nواریز به حساب ...1234 انجام شد';
      expect(() => parseBankSms(text)).toThrow('مبلغ تراکنش در متن پیامک یافت نشد.');
    });

    it('correctly handles generic fallback when bank name is not recognised', () => {
      const text = `واريز: 5,000,000 ريال
کارت: ...9876
1403/09/01 14:30
پیگیری: 7654321`;
      const parsed = parseBankSms(text);
      expect(parsed.bank).toBeNull();
      expect(parsed.bankNameFa).toBe('سایر / عمومی');
      expect(parsed.direction).toBe('deposit');
      expect(parsed.amountDecimal).toBe('5000000.00');
      expect(parsed.cardTail).toBe('9876');
      expect(parsed.reference).toBe('7654321');
    });

    it('correctly handles Toman multiplier (x10)', () => {
      const text = `بانک سامان
واریز: ۱۰۰,۰۰۰ تومان
حساب: ...۱۲۳۴
۱۴۰۳/۰۸/۲۲ ۱۰:۰۰`;
      const parsed = parseBankSms(text);
      expect(parsed.amountDecimal).toBe('1000000.00'); // 100,000 Toman = 1,000,000 Rials
    });
  });
});
