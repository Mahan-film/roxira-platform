import { MoadianInvoicePattern, MoadianInvoiceType } from '../enums/moadian.enum';
import { statusOf, HEADER_RULES, BODY_RULES } from './moadian-pattern-rules';

describe('moadian-pattern-rules', () => {
  describe('statusOf', () => {
    it('returns M for mandatory header field in pattern 1', () => {
      expect(statusOf(HEADER_RULES, 'taxid', MoadianInvoiceType.WITH_BUYER, MoadianInvoicePattern.SALE)).toBe('M');
    });

    it('returns O for optional header field in pattern 1', () => {
      expect(statusOf(HEADER_RULES, 'inno', MoadianInvoiceType.WITH_BUYER, MoadianInvoicePattern.SALE)).toBe('O');
    });

    it('returns C for conditionally mandatory header field in pattern 1', () => {
      expect(statusOf(HEADER_RULES, 'indati2m', MoadianInvoiceType.WITH_BUYER, MoadianInvoicePattern.SALE)).toBe('C');
    });

    it('returns I for ignored header field in pattern 1', () => {
      expect(statusOf(HEADER_RULES, 'ft', MoadianInvoiceType.WITH_BUYER, MoadianInvoicePattern.SALE)).toBe('I');
    });

    it('returns M for mandatory body field in pattern 1', () => {
      expect(statusOf(BODY_RULES, 'sstid', MoadianInvoiceType.WITH_BUYER, MoadianInvoicePattern.SALE)).toBe('M');
    });

    it('returns O for optional body field in pattern 1', () => {
      expect(statusOf(BODY_RULES, 'sstt', MoadianInvoiceType.WITH_BUYER, MoadianInvoicePattern.SALE)).toBe('O');
    });
  });
});
