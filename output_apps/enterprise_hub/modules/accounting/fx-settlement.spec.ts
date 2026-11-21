import * as fs from 'fs';
import * as path from 'path';
import {
  buildClosingRevaluationEntries,
  buildCrossCurrencySettlement,
  buildTriCurrencyInvoiceEntry,
  FX_RATE_SCALE,
} from './fx-settlement';
import { Currency } from '../currency/enums/currency.enum';

describe('T179 reporting currency and FX settlement', () => {
  it('supports GBP in the Currency enum', () => {
    expect(Currency.GBP).toBe('GBP');
  });

  it('rejects unknown currency codes (fail-closed)', () => {
    expect(() =>
      buildTriCurrencyInvoiceEntry({
        entryNumber: 'INV-BAD',
        date: '2026-10-15',
        txCurrency: 'XXX',
        bookCurrency: 'EUR',
        reportingCurrency: 'USD',
        txToBookRateScaled6: 1_000_000n,
        bookToReportingRateScaled6: 1_000_000n,
        receivableAccountCode: '1100',
        roundingResidualAccountCode: '6990',
        revenueLines: [{ accountCode: '4000', txAmountMinor: 10000n }],
      }),
    ).toThrow(/Unsupported ISO 4217 currency/i);
  });

  it('posts realised FX loss in both book and reporting currency when bank receipt is lower', () => {
    const result = buildCrossCurrencySettlement({
      entryNumber: 'SET-LOSS',
      date: '2026-11-05',
      invoiceCurrency: 'GBP',
      openTxAmountMinor: 100000n,
      bookedBookAmountMinor: 118250n,
      bookedReportingAmountMinor: 128301n,
      bankCurrency: 'USD',
      bankAmountMinor: 125000n,
      bankToBookRateScaled6: 915_000n, // 1,143.75 EUR
      bankToReportingRateScaled6: FX_RATE_SCALE,
      contractualInvoiceToBankRateScaled6: 1_250_000n,
      bookCurrency: 'EUR',
      reportingCurrency: 'USD',
      bankAccountCode: '1010',
      receivableAccountCode: '1100',
      realisedFxGainAccountCode: '7110',
      realisedFxLossAccountCode: '7210',
    });
    expect(result.usesClearingAccount).toBe(false);
    expect(result.remainingReceivableTxMinor).toBe(0n);
    expect(result.realisedFxBookMinor).toBe(-3875n);
    expect(result.realisedFxReportingMinor).toBe(-3301n);
    const lossLine = result.entry.lines.find((l) => l.accountCode === '7210');
    expect(lossLine?.bookDebit).toBe(3875n);
    expect(lossLine?.reportingDebit).toBe(3301n);
  });

  it('posts unrealised FX loss and auto-reversal on closing revaluation', () => {
    const reval = buildClosingRevaluationEntries({
      entryNumber: 'REVAL-LOSS',
      closingDate: '2026-10-31',
      reversalDate: '2026-11-01',
      txCurrency: 'GBP',
      bookCurrency: 'EUR',
      reportingCurrency: 'USD',
      openTxAmountMinor: 100000n,
      bookedBookAmountMinor: 118250n,
      closingTxToBookRateScaled6: 1_150_000n,
      closingBookToReportingRateScaled6: 1_085_000n,
      receivableAccountCode: '1100',
      unrealisedFxGainAccountCode: '7100',
      unrealisedFxLossAccountCode: '7200',
    });
    expect(reval.unrealisedGainBookMinor).toBe(-3250n);
    const lossLine = reval.revaluationEntry.lines.find((l) => l.accountCode === '7200');
    expect(lossLine?.bookDebit).toBe(3250n);
    const revLossLine = reval.reversalEntry.lines.find((l) => l.accountCode === '7200');
    expect(revLossLine?.bookCredit).toBe(3250n);
  });

  it('migration 1789900014100 adds all four reporting currency columns with lock_timeout', () => {
    const migPath = path.resolve(
      __dirname,
      '../../migrations/1789900014100-AddReportingCurrencyColumnsToJournalLines.ts',
    );
    const sql = fs.readFileSync(migPath, 'utf8');
    expect(sql).toContain("SET LOCAL lock_timeout = '3s'");
    expect(sql).toContain('reporting_currency_code');
    expect(sql).toContain('reporting_fx_rate');
    expect(sql).toContain('reporting_debit');
    expect(sql).toContain('reporting_credit');
  });
});
