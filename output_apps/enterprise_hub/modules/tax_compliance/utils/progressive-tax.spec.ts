import { applyRate, bracketTax, Bracket } from './progressive-tax';

describe('bracketTax', () => {
  const brackets: Bracket[] = [
    { upTo: 1000000, rate: '0.05' },
    { upTo: 2000000, rate: '0.10' },
    { upTo: null, rate: '0.15' },
  ];

  it('should calculate tax for amount below first bracket', () => {
    const income = 500000n * 100n; // 500,000 rials in minor units
    const tax = bracketTax(income, brackets);
    expect(tax).toBe(25000n * 100n); // 25,000 rials in minor units
  });

  it('should calculate tax for amount exactly at first bracket boundary', () => {
    const income = 1000000n * 100n; // 1,000,000 rials in minor units
    const tax = bracketTax(income, brackets);
    expect(tax).toBe(50000n * 100n); // 50,000 rials in minor units
  });

  it('should calculate tax for amount below second bracket boundary', () => {
    const income = 1500000n * 100n; // 1,500,000 rials in minor units
    const tax = bracketTax(income, brackets);
    expect(tax).toBe(100000n * 100n); // 100,000 rials in minor units
  });

  it('should calculate tax for amount exactly at second bracket boundary', () => {
    const income = 2000000n * 100n; // 2,000,000 rials in minor units
    const tax = bracketTax(income, brackets);
    expect(tax).toBe(150000n * 100n); // 150,000 rials in minor units
  });

  it('should calculate tax for amount above second bracket', () => {
    const income = 3000000n * 100n; // 3,000,000 rials in minor units
    const tax = bracketTax(income, brackets);
    expect(tax).toBe(300000n * 100n); // 300,000 rials in minor units
  });

  it('should calculate tax for zero amount', () => {
    const income = 0n;
    const tax = bracketTax(income, brackets);
    expect(tax).toBe(0n);
  });

  it('should equal the sum of the per-bracket slices for an amount spanning all brackets', () => {
    const income = 3000000n * 100n; // 3,000,000 rials in minor units
    const slice1 = 1000000n * 100n; // first band: 1,000,000 rials
    const slice2 = 1000000n * 100n; // second band: 1,000,000 rials
    const slice3 = 1000000n * 100n; // third band: remaining 1,000,000 rials
    const expected =
      applyRate(slice1, '0.05') + applyRate(slice2, '0.10') + applyRate(slice3, '0.15');
    expect(bracketTax(income, brackets)).toBe(expected);
  });
});
