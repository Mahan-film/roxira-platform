import { isoDate, tehranIsoDate } from './jalali-period';

describe('tehranIsoDate — the Iran calendar day of an instant (#125)', () => {
  it('is the next day once Tehran has passed midnight while UTC has not', () => {
    const instant = new Date('2026-09-22T21:00:00Z'); // 00:30 Tehran
    expect(isoDate(instant)).toBe('2026-09-22');
    expect(tehranIsoDate(instant)).toBe('2026-09-23');
  });

  it('is the same day before Tehran midnight', () => {
    expect(tehranIsoDate(new Date('2026-09-22T20:29:59Z'))).toBe('2026-09-22');
    expect(tehranIsoDate(new Date('2026-09-22T20:30:00Z'))).toBe('2026-09-23');
  });

  it('crosses the Gregorian year boundary in Tehran time', () => {
    expect(tehranIsoDate(new Date('2026-12-31T21:00:00Z'))).toBe('2027-01-01');
  });
});
