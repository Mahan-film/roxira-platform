/**
 * T179: Tri-currency (transaction, book, reporting) journal construction,
 * per-document rounding residual balancing, closing unrealised FX revaluation
 * with next-day reversal, and direct third-currency FX settlement without a
 * clearing account.
 *
 * All arithmetic uses exact BigInt minor units and 6-decimal scaled rates
 * (RATE_SCALE = 1_000_000n). Zero floating-point math on money.
 */
import { getCurrencyExponent } from '../country_packs/currency-exponents';
import { roundMinorHalfUp } from './money';

export const FX_RATE_SCALE = 1_000_000n;

export interface TriCurrencyLine {
  accountCode: string;
  description?: string;
  txCurrency: string;
  txDebit: bigint;
  txCredit: bigint;
  bookCurrency: string;
  bookDebit: bigint;
  bookCredit: bigint;
  reportingCurrency: string;
  reportingDebit: bigint;
  reportingCredit: bigint;
  txToBookRateScaled6: bigint;
  bookToReportingRateScaled6: bigint;
  isRounding: boolean;
}

export interface TriCurrencyEntry {
  entryNumber: string;
  date: string;
  description: string;
  bookCurrency: string;
  reportingCurrency: string;
  lines: TriCurrencyLine[];
}

export interface TriCurrencyInvoiceInput {
  entryNumber: string;
  date: string;
  txCurrency: string;
  bookCurrency: string;
  reportingCurrency: string;
  /** 1 unit of txCurrency in bookCurrency, scaled by 10^6. */
  txToBookRateScaled6: bigint;
  /** 1 unit of bookCurrency in reportingCurrency, scaled by 10^6. */
  bookToReportingRateScaled6: bigint;
  receivableAccountCode: string;
  roundingResidualAccountCode: string;
  revenueLines: Array<{
    accountCode: string;
    txAmountMinor: bigint;
    description?: string;
  }>;
}

export interface ClosingRevaluationInput {
  entryNumber: string;
  closingDate: string;
  reversalDate: string;
  txCurrency: string;
  bookCurrency: string;
  reportingCurrency: string;
  openTxAmountMinor: bigint;
  bookedBookAmountMinor: bigint;
  closingTxToBookRateScaled6: bigint;
  closingBookToReportingRateScaled6: bigint;
  receivableAccountCode: string;
  unrealisedFxGainAccountCode: string;
  unrealisedFxLossAccountCode: string;
}

export interface CrossCurrencySettlementInput {
  entryNumber: string;
  date: string;
  /** Invoice / receivable currency (e.g. GBP). */
  invoiceCurrency: string;
  /** Open receivable in invoice currency (e.g. GBP 1,000.00). */
  openTxAmountMinor: bigint;
  /** Booked receivable in book currency (e.g. EUR 1,182.50). */
  bookedBookAmountMinor: bigint;
  /** Booked receivable in reporting currency (e.g. USD 1,283.01). */
  bookedReportingAmountMinor: bigint;
  /** Bank account currency — may be a third currency (e.g. USD). */
  bankCurrency: string;
  /** Cash received in bank currency (e.g. USD 1,300.00). */
  bankAmountMinor: bigint;
  /** 1 unit of bankCurrency in bookCurrency, scaled by 10^6 (e.g. 1 USD = 0.915000 EUR). */
  bankToBookRateScaled6: bigint;
  /** 1 unit of bankCurrency in reportingCurrency, scaled by 10^6 (1_000_000n if bankCurrency === reportingCurrency). */
  bankToReportingRateScaled6: bigint;
  /** Contractual rate 1 invoiceCurrency = X bankCurrency, scaled by 10^6 (e.g. 1 GBP = 1.300000 USD). */
  contractualInvoiceToBankRateScaled6: bigint;
  bookCurrency: string;
  reportingCurrency: string;
  bankAccountCode: string;
  receivableAccountCode: string;
  realisedFxGainAccountCode: string;
  realisedFxLossAccountCode: string;
}

export interface CrossCurrencySettlementResult {
  entry: TriCurrencyEntry;
  usesClearingAccount: false;
  remainingReceivableTxMinor: bigint;
  realisedFxBookMinor: bigint;
  realisedFxReportingMinor: bigint;
}

function assertKnownCurrencies(...codes: string[]): void {
  for (const code of codes) {
    getCurrencyExponent(code);
  }
}

/**
 * Exact BigInt conversion: amount (minor units) * rate (6-decimal scaled),
 * rounded half-up to the target minor unit.
 */
export function convertWithRate6(amountMinor: bigint, rateScaled6: bigint): bigint {
  if (rateScaled6 <= 0n) {
    throw new Error('FX rate must be positive');
  }
  return roundMinorHalfUp(amountMinor * rateScaled6, FX_RATE_SCALE);
}

/**
 * Verifies that a tri-currency journal entry balances in BOTH book currency
 * and reporting currency.
 */
export function assertTriCurrencyBalanced(entry: TriCurrencyEntry): void {
  let bookDebit = 0n;
  let bookCredit = 0n;
  let repDebit = 0n;
  let repCredit = 0n;

  for (const line of entry.lines) {
    bookDebit += line.bookDebit;
    bookCredit += line.bookCredit;
    repDebit += line.reportingDebit;
    repCredit += line.reportingCredit;
  }

  if (bookDebit !== bookCredit) {
    throw new Error(
      `Entry ${entry.entryNumber} is unbalanced in book currency ${entry.bookCurrency}: debit=${bookDebit} credit=${bookCredit}`,
    );
  }
  if (repDebit !== repCredit) {
    throw new Error(
      `Entry ${entry.entryNumber} is unbalanced in reporting currency ${entry.reportingCurrency}: debit=${repDebit} credit=${repCredit}`,
    );
  }
}

/**
 * Builds a tri-currency sales invoice journal entry.
 *
 * Each revenue line is converted individually from transaction currency to
 * book currency and reporting currency; the receivable header is converted
 * from the total transaction amount. Any per-document rounding residual
 * between the header and sum of lines is posted to `roundingResidualAccountCode`
 * with `isRounding: true` so the entry balances in both book and reporting
 * currencies.
 */
export function buildTriCurrencyInvoiceEntry(
  input: TriCurrencyInvoiceInput,
): TriCurrencyEntry {
  assertKnownCurrencies(input.txCurrency, input.bookCurrency, input.reportingCurrency);
  if (input.revenueLines.length === 0) {
    throw new Error('Invoice must have at least one revenue line');
  }

  let totalTx = 0n;
  let sumLineBook = 0n;
  let sumLineReporting = 0n;

  const creditLines: TriCurrencyLine[] = input.revenueLines.map((rl) => {
    totalTx += rl.txAmountMinor;
    const bookAmt = convertWithRate6(rl.txAmountMinor, input.txToBookRateScaled6);
    const repAmt = convertWithRate6(bookAmt, input.bookToReportingRateScaled6);
    sumLineBook += bookAmt;
    sumLineReporting += repAmt;
    return {
      accountCode: rl.accountCode,
      description: rl.description,
      txCurrency: input.txCurrency,
      txDebit: 0n,
      txCredit: rl.txAmountMinor,
      bookCurrency: input.bookCurrency,
      bookDebit: 0n,
      bookCredit: bookAmt,
      reportingCurrency: input.reportingCurrency,
      reportingDebit: 0n,
      reportingCredit: repAmt,
      txToBookRateScaled6: input.txToBookRateScaled6,
      bookToReportingRateScaled6: input.bookToReportingRateScaled6,
      isRounding: false,
    };
  });

  const headerBook = convertWithRate6(totalTx, input.txToBookRateScaled6);
  const headerReporting = convertWithRate6(headerBook, input.bookToReportingRateScaled6);

  const lines: TriCurrencyLine[] = [
    {
      accountCode: input.receivableAccountCode,
      description: `AR ${input.entryNumber}`,
      txCurrency: input.txCurrency,
      txDebit: totalTx,
      txCredit: 0n,
      bookCurrency: input.bookCurrency,
      bookDebit: headerBook,
      bookCredit: 0n,
      reportingCurrency: input.reportingCurrency,
      reportingDebit: headerReporting,
      reportingCredit: 0n,
      txToBookRateScaled6: input.txToBookRateScaled6,
      bookToReportingRateScaled6: input.bookToReportingRateScaled6,
      isRounding: false,
    },
    ...creditLines,
  ];

  const bookDiff = sumLineBook - headerBook;
  const repDiff = sumLineReporting - headerReporting;

  if (bookDiff !== 0n || repDiff !== 0n) {
    lines.push({
      accountCode: input.roundingResidualAccountCode,
      description: `FX rounding residual ${input.entryNumber}`,
      txCurrency: input.txCurrency,
      txDebit: 0n,
      txCredit: 0n,
      bookCurrency: input.bookCurrency,
      bookDebit: bookDiff > 0n ? bookDiff : 0n,
      bookCredit: bookDiff < 0n ? -bookDiff : 0n,
      reportingCurrency: input.reportingCurrency,
      reportingDebit: repDiff > 0n ? repDiff : 0n,
      reportingCredit: repDiff < 0n ? -repDiff : 0n,
      txToBookRateScaled6: input.txToBookRateScaled6,
      bookToReportingRateScaled6: input.bookToReportingRateScaled6,
      isRounding: true,
    });
  }

  const entry: TriCurrencyEntry = {
    entryNumber: input.entryNumber,
    date: input.date,
    description: `Tri-currency invoice ${input.entryNumber}`,
    bookCurrency: input.bookCurrency,
    reportingCurrency: input.reportingCurrency,
    lines,
  };
  assertTriCurrencyBalanced(entry);
  return entry;
}

/**
 * Computes period-end unrealised FX revaluation and its auto-reversal entry
 * on the first day of the next period.
 */
export function buildClosingRevaluationEntries(input: ClosingRevaluationInput): {
  unrealisedGainBookMinor: bigint;
  revaluationEntry: TriCurrencyEntry;
  reversalEntry: TriCurrencyEntry;
} {
  assertKnownCurrencies(input.txCurrency, input.bookCurrency, input.reportingCurrency);

  const revaluedBook = convertWithRate6(
    input.openTxAmountMinor,
    input.closingTxToBookRateScaled6,
  );
  const diffBook = revaluedBook - input.bookedBookAmountMinor;
  const diffReporting = convertWithRate6(
    diffBook >= 0n ? diffBook : -diffBook,
    input.closingBookToReportingRateScaled6,
  );

  const isGain = diffBook >= 0n;
  const absBook = isGain ? diffBook : -diffBook;
  const fxAccount = isGain
    ? input.unrealisedFxGainAccountCode
    : input.unrealisedFxLossAccountCode;

  const revaluationEntry: TriCurrencyEntry = {
    entryNumber: input.entryNumber,
    date: input.closingDate,
    description: `Closing FX revaluation ${input.entryNumber}`,
    bookCurrency: input.bookCurrency,
    reportingCurrency: input.reportingCurrency,
    lines: [
      {
        accountCode: input.receivableAccountCode,
        description: 'Unrealised FX revaluation on receivable',
        txCurrency: input.txCurrency,
        txDebit: 0n,
        txCredit: 0n,
        bookCurrency: input.bookCurrency,
        bookDebit: isGain ? absBook : 0n,
        bookCredit: isGain ? 0n : absBook,
        reportingCurrency: input.reportingCurrency,
        reportingDebit: isGain ? diffReporting : 0n,
        reportingCredit: isGain ? 0n : diffReporting,
        txToBookRateScaled6: input.closingTxToBookRateScaled6,
        bookToReportingRateScaled6: input.closingBookToReportingRateScaled6,
        isRounding: false,
      },
      {
        accountCode: fxAccount,
        description: isGain ? 'Unrealised FX gain' : 'Unrealised FX loss',
        txCurrency: input.txCurrency,
        txDebit: 0n,
        txCredit: 0n,
        bookCurrency: input.bookCurrency,
        bookDebit: isGain ? 0n : absBook,
        bookCredit: isGain ? absBook : 0n,
        reportingCurrency: input.reportingCurrency,
        reportingDebit: isGain ? 0n : diffReporting,
        reportingCredit: isGain ? diffReporting : 0n,
        txToBookRateScaled6: input.closingTxToBookRateScaled6,
        bookToReportingRateScaled6: input.closingBookToReportingRateScaled6,
        isRounding: false,
      },
    ],
  };

  const reversalEntry: TriCurrencyEntry = {
    entryNumber: `${input.entryNumber}-REV`,
    date: input.reversalDate,
    description: `Auto-reversal of closing FX revaluation ${input.entryNumber}`,
    bookCurrency: input.bookCurrency,
    reportingCurrency: input.reportingCurrency,
    lines: revaluationEntry.lines.map((l) => ({
      ...l,
      bookDebit: l.bookCredit,
      bookCredit: l.bookDebit,
      reportingDebit: l.reportingCredit,
      reportingCredit: l.reportingDebit,
    })),
  };

  assertTriCurrencyBalanced(revaluationEntry);
  assertTriCurrencyBalanced(reversalEntry);

  return {
    unrealisedGainBookMinor: diffBook,
    revaluationEntry,
    reversalEntry,
  };
}

/**
 * Settles a foreign-currency receivable directly from a bank account in a
 * third currency WITHOUT a clearing account.
 *
 * Realised FX gain/loss is posted in BOTH book currency and reporting currency,
 * and the foreign-currency receivable closes to 0.00 in transaction currency.
 */
export function buildCrossCurrencySettlement(
  input: CrossCurrencySettlementInput,
): CrossCurrencySettlementResult {
  assertKnownCurrencies(
    input.invoiceCurrency,
    input.bankCurrency,
    input.bookCurrency,
    input.reportingCurrency,
  );

  // Verify contractual settlement closes the invoice receivable in full.
  const expectedBankMinor = convertWithRate6(
    input.openTxAmountMinor,
    input.contractualInvoiceToBankRateScaled6,
  );
  const settledTxMinor =
    input.bankAmountMinor === expectedBankMinor
      ? input.openTxAmountMinor
      : roundMinorHalfUp(
          input.bankAmountMinor * FX_RATE_SCALE,
          input.contractualInvoiceToBankRateScaled6,
        );
  const remainingReceivableTxMinor = input.openTxAmountMinor - settledTxMinor;

  const bankBookMinor = convertWithRate6(
    input.bankAmountMinor,
    input.bankToBookRateScaled6,
  );
  const bankReportingMinor = convertWithRate6(
    input.bankAmountMinor,
    input.bankToReportingRateScaled6,
  );

  const realisedFxBookMinor = bankBookMinor - input.bookedBookAmountMinor;
  const realisedFxReportingMinor =
    bankReportingMinor - input.bookedReportingAmountMinor;

  const lines: TriCurrencyLine[] = [
    {
      accountCode: input.bankAccountCode,
      description: `Settlement receipt (${input.bankCurrency})`,
      txCurrency: input.bankCurrency,
      txDebit: input.bankAmountMinor,
      txCredit: 0n,
      bookCurrency: input.bookCurrency,
      bookDebit: bankBookMinor,
      bookCredit: 0n,
      reportingCurrency: input.reportingCurrency,
      reportingDebit: bankReportingMinor,
      reportingCredit: 0n,
      txToBookRateScaled6: input.bankToBookRateScaled6,
      bookToReportingRateScaled6: input.bankToReportingRateScaled6,
      isRounding: false,
    },
    {
      accountCode: input.receivableAccountCode,
      description: `Close AR (${input.invoiceCurrency})`,
      txCurrency: input.invoiceCurrency,
      txDebit: 0n,
      txCredit: settledTxMinor,
      bookCurrency: input.bookCurrency,
      bookDebit: 0n,
      bookCredit: input.bookedBookAmountMinor,
      reportingCurrency: input.reportingCurrency,
      reportingDebit: 0n,
      reportingCredit: input.bookedReportingAmountMinor,
      txToBookRateScaled6: input.bankToBookRateScaled6,
      bookToReportingRateScaled6: input.bankToReportingRateScaled6,
      isRounding: false,
    },
  ];

  if (realisedFxBookMinor !== 0n || realisedFxReportingMinor !== 0n) {
    const isBookGain = realisedFxBookMinor >= 0n;
    const fxAccount = isBookGain
      ? input.realisedFxGainAccountCode
      : input.realisedFxLossAccountCode;
    lines.push({
      accountCode: fxAccount,
      description: isBookGain
        ? 'Realised FX gain on cross-currency settlement'
        : 'Realised FX loss on cross-currency settlement',
      txCurrency: input.bookCurrency,
      txDebit: 0n,
      txCredit: 0n,
      bookCurrency: input.bookCurrency,
      bookDebit: realisedFxBookMinor < 0n ? -realisedFxBookMinor : 0n,
      bookCredit: realisedFxBookMinor > 0n ? realisedFxBookMinor : 0n,
      reportingCurrency: input.reportingCurrency,
      reportingDebit:
        realisedFxReportingMinor < 0n ? -realisedFxReportingMinor : 0n,
      reportingCredit:
        realisedFxReportingMinor > 0n ? realisedFxReportingMinor : 0n,
      txToBookRateScaled6: input.bankToBookRateScaled6,
      bookToReportingRateScaled6: input.bankToReportingRateScaled6,
      isRounding: false,
    });
  }

  const entry: TriCurrencyEntry = {
    entryNumber: input.entryNumber,
    date: input.date,
    description: `Cross-currency settlement ${input.entryNumber}`,
    bookCurrency: input.bookCurrency,
    reportingCurrency: input.reportingCurrency,
    lines,
  };
  assertTriCurrencyBalanced(entry);

  return {
    entry,
    usesClearingAccount: false,
    remainingReceivableTxMinor,
    realisedFxBookMinor,
    realisedFxReportingMinor,
  };
}
