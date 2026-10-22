import {
  fixPersianChars,
  normaliseText,
  parseJalaliDate,
  parseMoneyRials,
  toAsciiDigits,
} from './normalise';

describe('toAsciiDigits', () => {
  it('converts Persian digits', () => {
    expect(toAsciiDigits('۱۲۳۴۵۶۷۸۹۰')).toBe('1234567890');
  });

  it('converts Arabic-Indic digits', () => {
    expect(toAsciiDigits('١٢٣')).toBe('123');
  });
});

describe('fixPersianChars', () => {
  it('maps Arabic yeh/kaf to Persian', () => {
    expect(fixPersianChars('علي')).toBe('علی');
    expect(fixPersianChars('كتاب')).toBe('کتاب');
  });

  it('normalises text with ZWNJ and extra spaces', () => {
    expect(normaliseText('نام\u200cو  نام')).toBe('نام و نام');
  });
});

describe('parseMoneyRials', () => {
  it('parses Persian rials with thousand separators', () => {
    expect(parseMoneyRials('۱۲٬۵۰۰٬۰۰۰ ریال')).toBe(12500000);
  });

  it('converts toman to rials (x10)', () => {
    expect(parseMoneyRials('۲٬۵۰۰٬۰۰۰ تومان')).toBe(25000000);
  });

  it('parses plain ASCII amounts', () => {
    expect(parseMoneyRials('12,500,000')).toBe(12500000);
  });

  it('returns null for empty values', () => {
    expect(parseMoneyRials('')).toBeNull();
  });
});

describe('parseJalaliDate', () => {
  it('converts 1403/07/15 to 2024-10-06', () => {
    expect(parseJalaliDate('1403/07/15')).toBe('2024-10-06');
  });

  it('converts Persian-digit dates with one-digit month', () => {
    expect(parseJalaliDate('۱۴۰۳-۷-۱۵')).toBe('2024-10-06');
  });

  it('converts Nowruz 1403/01/01 to 2024-03-20', () => {
    expect(parseJalaliDate('1403/01/01')).toBe('2024-03-20');
  });

  it('converts Nowruz 1400/01/01 to 2021-03-21', () => {
    expect(parseJalaliDate('1400/01/01')).toBe('2021-03-21');
  });

  it('passes through ISO Gregorian dates', () => {
    expect(parseJalaliDate('2024-10-06')).toBe('2024-10-06');
    expect(parseJalaliDate('2024-10-06T10:00:00.000Z')).toBe('2024-10-06');
  });

  it('rejects invalid input', () => {
    expect(parseJalaliDate('not-a-date')).toBeNull();
    expect(parseJalaliDate('1403/13/01')).toBeNull();
    expect(parseJalaliDate('1403/12/31')).toBeNull();
  });
});
