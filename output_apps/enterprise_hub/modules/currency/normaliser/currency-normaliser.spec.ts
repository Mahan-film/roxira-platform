import {
  NormalisedCurrency,
  normalizeCurrency,
  TOMAN_TO_RIAL_FACTOR,
  toRial,
} from './currency-normaliser';

describe('normalizeCurrency', () => {
  it.each([
    ['ریال', NormalisedCurrency.IRR],
    ['IRR', NormalisedCurrency.IRR],
    ['Rial', NormalisedCurrency.IRR],
    ['RLS', NormalisedCurrency.IRR],
    ['تومان', NormalisedCurrency.IRT],
    ['IRT', NormalisedCurrency.IRT],
    ['Toman', NormalisedCurrency.IRT],
    ['TMN', NormalisedCurrency.IRT],
    ['دلار', NormalisedCurrency.USD],
    ['USD', NormalisedCurrency.USD],
    ['$', NormalisedCurrency.USD],
    ['یورو', NormalisedCurrency.EUR],
    ['EUR', NormalisedCurrency.EUR],
    ['€', NormalisedCurrency.EUR],
    ['لیر', NormalisedCurrency.TRY],
    ['TRY', NormalisedCurrency.TRY],
    ['₺', NormalisedCurrency.TRY],
    ['درهم', NormalisedCurrency.AED],
    ['AED', NormalisedCurrency.AED],
    ['یوان', NormalisedCurrency.CNY],
    ['CNY', NormalisedCurrency.CNY],
    ['RMB', NormalisedCurrency.CNY],
    ['ریال عمان', NormalisedCurrency.OMR],
    ['OMR', NormalisedCurrency.OMR],
    ['MULTI', NormalisedCurrency.MULTI],
    ['چندارزی', NormalisedCurrency.MULTI],
    ['  usd  ', NormalisedCurrency.USD],
    ['تومان\u200c', NormalisedCurrency.IRT],
  ])('maps %s to %s', (raw, expected) => {
    expect(normalizeCurrency(raw)).toBe(expected);
  });

  it('returns null for unknown codes', () => {
    expect(normalizeCurrency('XYZ')).toBeNull();
    expect(normalizeCurrency('پول ناشناخته')).toBeNull();
    expect(normalizeCurrency('')).toBeNull();
    expect(normalizeCurrency(null)).toBeNull();
    expect(normalizeCurrency(undefined)).toBeNull();
  });
});

describe('toRial', () => {
  it('keeps rial unchanged', () => {
    expect(toRial(1_000, 'IRR')).toBe(1_000);
    expect(toRial(1_000, 'ریال')).toBe(1_000);
  });

  it('multiplies toman by 10', () => {
    expect(toRial(2_500_000, 'تومان')).toBe(25_000_000);
    expect(toRial(100, NormalisedCurrency.IRT)).toBe(
      100 * TOMAN_TO_RIAL_FACTOR,
    );
  });

  it('converts foreign currency with the given rate', () => {
    expect(toRial(100, 'USD', 900_000)).toBe(90_000_000);
    expect(toRial(10, 'EUR', 1_000_000)).toBe(10_000_000);
  });

  it('requires a rate for foreign currencies', () => {
    expect(() => toRial(100, 'USD')).toThrow();
    expect(() => toRial(100, 'USD', 0)).toThrow();
  });

  it('returns null for unknown currencies', () => {
    expect(toRial(100, 'XYZ', 900_000)).toBeNull();
    expect(toRial(100, null)).toBeNull();
  });

  it('returns null for the account-level MULTI currency', () => {
    expect(toRial(100, 'MULTI', 900_000)).toBeNull();
  });
});
