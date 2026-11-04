import { choosePattern, MoadianPatternSelectionError } from './moadian-pattern-select';
import { MoadianInvoicePattern as P } from '../enums/moadian.enum';

describe('choosePattern', () => {
  // Pattern 1 (sale): no field signals another pattern.
  it('selects pattern 1 (sale) when nothing signals another pattern', () => {
    expect(choosePattern(undefined, {})).toBe(P.SALE);
  });

  // Pattern 2 (sale currency): currency item fields.
  it('selects pattern 2 (sale currency) from an item field', () => {
    expect(choosePattern(undefined, { items: [{ cpr: 'IRR' }] })).toBe(P.SALE_CURRENCY);
  });

  // Pattern 3 (gold): gold item fields.
  it('selects pattern 3 (gold) from an item field', () => {
    expect(choosePattern(undefined, { items: [{ consfee: 'x' }] })).toBe(P.GOLD);
  });

  // Pattern 4 (contract): no signal field, so it must be chosen explicitly.
  it('selects pattern 4 (contract) when chosen explicitly', () => {
    expect(choosePattern(4, {})).toBe(P.CONTRACT);
  });

  // Pattern 5 (utility bills): billid header field.
  it('selects pattern 5 (utility bills) from a header field', () => {
    expect(choosePattern(undefined, { header: { billid: '123' } })).toBe(P.UTILITY_BILLS);
  });

  // Pattern 6 (airline ticket): ft/tinc header fields.
  it('selects pattern 6 (airline ticket) from a header field', () => {
    expect(choosePattern(undefined, { header: { ft: 'x' } })).toBe(P.AIRLINE_TICKET);
  });

  // Pattern 7 (export): export header fields.
  it('selects pattern 7 (export) from a header field', () => {
    expect(choosePattern(undefined, { header: { cdcn: 'x' } })).toBe(P.EXPORT);
  });

  it('selects pattern 7 (export) from an export item field', () => {
    expect(choosePattern(undefined, { items: [{ nw: 1 }] })).toBe(P.EXPORT);
  });

  it('keeps an explicit pattern that agrees with the data', () => {
    expect(choosePattern(6, { header: { ft: 'x' } })).toBe(P.AIRLINE_TICKET);
  });

  it('throws when the explicit pattern disagrees with a signal', () => {
    expect(() => choosePattern(6, { header: { cdcn: 'x' } })).toThrow(
      MoadianPatternSelectionError,
    );
  });

  it('throws when fields signal more than one pattern', () => {
    expect(() =>
      choosePattern(undefined, { header: { ft: 'x' }, items: [{ cpr: 'x' }] }),
    ).toThrow(MoadianPatternSelectionError);
  });

  it('throws when the explicit pattern is out of range', () => {
    expect(() => choosePattern(8, {})).toThrow(MoadianPatternSelectionError);
  });
});
