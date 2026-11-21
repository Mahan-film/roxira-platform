import {
  ISO_4217_CURRENCY_EXPONENTS,
  UnsupportedCurrencyError,
  getCurrencyExponent,
  isSupportedCurrency,
} from '../country_packs';
import {
  MoneyFormatError,
  formatCurrencyMinor,
  parseCurrencyMinor,
  roundAndParseCurrencyMinor,
  roundToCurrencyExponent,
} from './money';
import { WidenLedgerMoneyColumns1789900013100 } from '../../migrations/1789900013100-WidenLedgerMoneyColumns';
import { WidenInvoiceMoneyColumns1789900013200 } from '../../migrations/1789900013200-WidenInvoiceMoneyColumns';
import { WidenTreasuryMoneyColumns1789900013300 } from '../../migrations/1789900013300-WidenTreasuryMoneyColumns';
import { WidenInventoryMoneyColumns1789900013400 } from '../../migrations/1789900013400-WidenInventoryMoneyColumns';

describe('T169 Currency precision (core)', () => {
  describe('ISO 4217 currency exponents in country_packs', () => {
    it('maps 0-, 2-, and 3-decimal currencies accurately', () => {
      expect(getCurrencyExponent('IRR')).toBe(0);
      expect(getCurrencyExponent('JPY')).toBe(0);
      expect(getCurrencyExponent('USD')).toBe(2);
      expect(getCurrencyExponent('EUR')).toBe(2);
      expect(getCurrencyExponent('AED')).toBe(2);
      expect(getCurrencyExponent('SAR')).toBe(2);
      expect(getCurrencyExponent('OMR')).toBe(3);
      expect(getCurrencyExponent('KWD')).toBe(3);
      expect(getCurrencyExponent('BHD')).toBe(3);
      expect(getCurrencyExponent('JOD')).toBe(3);
      expect(getCurrencyExponent('IQD')).toBe(3);
      expect(getCurrencyExponent('LYD')).toBe(3);
      expect(getCurrencyExponent('TND')).toBe(3);
    });

    it('normalises whitespace and case', () => {
      expect(getCurrencyExponent(' omr ')).toBe(3);
      expect(getCurrencyExponent('irr')).toBe(0);
      expect(isSupportedCurrency('kwd')).toBe(true);
    });

    it('fails closed on unknown currency codes', () => {
      expect(isSupportedCurrency('XXX')).toBe(false);
      expect(() => getCurrencyExponent('ZZZ')).toThrow(UnsupportedCurrencyError);
    });

    it('exports an immutable lookup table', () => {
      expect(Object.isFrozen(ISO_4217_CURRENCY_EXPONENTS)).toBe(true);
    });
  });

  describe('Rounding helper and minor-unit arithmetic', () => {
    it('preserves 3-decimal OMR and KWD amounts to the exact fils', () => {
      expect(roundToCurrencyExponent('1.234', 'OMR')).toBe('1.234');
      expect(parseCurrencyMinor('1.234', 'OMR')).toBe(1234n);
      expect(formatCurrencyMinor(1234n, 'OMR')).toBe('1.234');

      expect(roundToCurrencyExponent('0.125', 'KWD')).toBe('0.125');
      expect(parseCurrencyMinor('0.125', 'KWD')).toBe(125n);
      expect(formatCurrencyMinor(125n, 'KWD')).toBe('0.125');
    });

    it('rounds half-away-from-zero to the currency exponent', () => {
      expect(roundToCurrencyExponent('1.2345', 'OMR')).toBe('1.235');
      expect(roundToCurrencyExponent('1.2344', 'OMR')).toBe('1.234');
      expect(roundToCurrencyExponent('-1.2345', 'OMR')).toBe('-1.235');
      expect(roundToCurrencyExponent('10.005', 'USD')).toBe('10.01');
      expect(roundToCurrencyExponent('-0.0001', 'OMR')).toBe('0.000');
    });

    it('ensures IRR amounts have no fraction', () => {
      expect(roundToCurrencyExponent('50000', 'IRR')).toBe('50000');
      expect(roundToCurrencyExponent('50000.00', 'IRR')).toBe('50000');
      expect(roundToCurrencyExponent('50000.4', 'IRR')).toBe('50000');
      expect(roundToCurrencyExponent('50000.5', 'IRR')).toBe('50001');
      expect(formatCurrencyMinor(50000n, 'IRR')).toBe('50000');
      expect(roundToCurrencyExponent('50000.4', 'IRR')).not.toContain('.');
      expect(() => parseCurrencyMinor('100.5', 'IRR')).toThrow(MoneyFormatError);
    });

    it('keeps existing 2-decimal USD/EUR values unchanged', () => {
      expect(roundToCurrencyExponent('1234.56', 'USD')).toBe('1234.56');
      expect(parseCurrencyMinor('1234.56', 'USD')).toBe(123456n);
      expect(formatCurrencyMinor(123456n, 'USD')).toBe('1234.56');
    });

    it('rejects excess precision in parseCurrencyMinor instead of silently rounding', () => {
      expect(() => parseCurrencyMinor('1.2345', 'OMR')).toThrow(MoneyFormatError);
      expect(() => parseCurrencyMinor('1.234', 'USD')).toThrow(MoneyFormatError);
    });
  });

  describe('Trial balance to the fils for 3-decimal entries', () => {
    it('balances 1.234 OMR and 0.125 KWD entries to the exact fils', () => {
      const omrLines = [
        { account: '1010', debit: roundAndParseCurrencyMinor('1.234', 'OMR'), credit: roundAndParseCurrencyMinor('0', 'OMR') },
        { account: '4010', debit: roundAndParseCurrencyMinor('0', 'OMR'), credit: roundAndParseCurrencyMinor('1.234', 'OMR') },
      ];
      const omrDebit = omrLines.reduce((acc, l) => acc + l.debit.minor, 0n);
      const omrCredit = omrLines.reduce((acc, l) => acc + l.credit.minor, 0n);
      expect(omrDebit).toBe(1234n);
      expect(omrCredit).toBe(1234n);
      expect(omrDebit - omrCredit).toBe(0n);
      expect(formatCurrencyMinor(omrDebit - omrCredit, 'OMR')).toBe('0.000');

      const kwdLines = [
        { account: '1010', debit: roundAndParseCurrencyMinor('0.125', 'KWD'), credit: roundAndParseCurrencyMinor('0', 'KWD') },
        { account: '4010', debit: roundAndParseCurrencyMinor('0', 'KWD'), credit: roundAndParseCurrencyMinor('0.125', 'KWD') },
      ];
      const kwdDebit = kwdLines.reduce((acc, l) => acc + l.debit.minor, 0n);
      const kwdCredit = kwdLines.reduce((acc, l) => acc + l.credit.minor, 0n);
      expect(kwdDebit).toBe(125n);
      expect(kwdCredit).toBe(125n);
      expect(kwdDebit - kwdCredit).toBe(0n);
      expect(formatCurrencyMinor(kwdDebit - kwdCredit, 'KWD')).toBe('0.000');
    });
  });

  describe('Expand-style migrations with lock_timeout (one module per migration)', () => {
    it.each([
      ['ledger', new WidenLedgerMoneyColumns1789900013100(), 'fin_journal_entry_lines'],
      ['invoice', new WidenInvoiceMoneyColumns1789900013200(), 'invoices'],
      ['treasury', new WidenTreasuryMoneyColumns1789900013300(), 'fin_treasury_documents'],
      ['inventory', new WidenInventoryMoneyColumns1789900013400(), 'erp_stock_document_lines'],
    ])('%s migration sets lock_timeout and widens to numeric(20,4)', async (_label, migration, expectedTable) => {
      const queries: string[] = [];
      const mockRunner = {
        query: jest.fn(async (sql: string) => {
          queries.push(sql);
        }),
      } as unknown as Parameters<typeof migration.up>[0];

      await migration.up(mockRunner);

      expect(queries[0]).toContain("SET LOCAL lock_timeout = '5s'");
      expect(queries.some((q) => q.includes(expectedTable) && q.includes('numeric(20,4)'))).toBe(true);
    });
  });
});
