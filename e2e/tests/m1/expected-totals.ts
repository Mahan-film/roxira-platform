/**
 * Expected totals for the M1 gate (e2e/tests/m1-shop-month.spec.ts), in IRR minor units (rial) as bigint.
 *
 * README_TOTALS mirrors the table in e2e/fixtures/sample-company/README.md, lines 10-19 (cited per field).
 * The fixture self-check in the spec parses that table and fails if this constant drifts from it, and
 * recomputes every value from the CSV files. Regenerating the fixture (generate.js) means updating both.
 *
 * All data is synthetic (fictional company «سپهر البرز نمونه»); never put real figures here.
 */
export interface SampleCompanyTotals {
  /** README line 10: sum of debits of the opening journal (14 lines). */
  openingDebit: bigint;
  /** README line 11: sum of credits of the opening journal; equals openingDebit. */
  openingCredit: bigint;
  /** README line 12: opening balance of trade receivables, account 1201. */
  receivablesOpening: bigint;
  /** README line 13: 1201 after the unpaid sales invoices, duplicate rows counted once. */
  receivablesClosingUnique: bigint;
  /** README line 14: 1201 if the 2 duplicate invoice rows were imported twice (must NOT be the result). */
  receivablesClosingRaw: bigint;
  /** README line 15: opening balance of trade payables, account 2101. */
  payablesOpening: bigint;
  /** README line 16: 2101 after the unpaid purchase invoices, duplicate rows counted once. */
  payablesClosingUnique: bigint;
  /** README line 17: 2101 if the duplicate invoice rows were imported twice (must NOT be the result). */
  payablesClosingRaw: bigint;
  /** README line 18: stock value, account 1301 = sum of quantity x unitCost over the 300 items. */
  stockValue: bigint;
  /** README line 19: closing balance of the bank statement, account 1101. */
  bankClosingBalance: bigint;
}

export const README_TOTALS: SampleCompanyTotals = {
  openingDebit: 259_026_700_000n,
  openingCredit: 259_026_700_000n,
  receivablesOpening: 1_840_000_000n,
  receivablesClosingUnique: 9_453_512_500n,
  receivablesClosingRaw: 9_494_487_500n,
  payablesOpening: 1_120_000_000n,
  payablesClosingUnique: 5_420_780_000n,
  payablesClosingRaw: 5_447_400_000n,
  stockValue: 252_026_700_000n,
  bankClosingBalance: 2_485_000_000n,
};

/** README field name for each key, used by the self-check that parses README.md. */
export const README_ROW_LABELS: Record<keyof SampleCompanyTotals, string> = {
  openingDebit: 'Debit (',
  openingCredit: 'Credit (',
  receivablesOpening: 'Receivables — Opening',
  receivablesClosingUnique: 'Receivables — Closing Unique',
  receivablesClosingRaw: 'Receivables — Closing Raw',
  payablesOpening: 'Payables — Opening',
  payablesClosingUnique: 'Payables — Closing Unique',
  payablesClosingRaw: 'Payables — Closing Raw',
  stockValue: 'Stock Value',
  bankClosingBalance: 'Bank Closing Balance',
};

/**
 * The month's hand-entered documents on top of the imported files. Amounts come from fixture rows
 * (ITM-1001: unit cost 14,900,000, sale price 18,625,000; the fixture's 10% VAT, as in generate.js) so
 * the expected closing figures stay derivable. Each delta is the effect on one ledger balance.
 */
export const M1_MONTH_OPERATIONS = {
  /** POS walk-in sale, no customer: 1 x ITM-1001, paid in cash (petty cash 1102, not the bank). */
  posWalkInSale: {
    itemCode: 'ITM-1001',
    quantity: 1,
    unitPrice: 18_625_000n,
    vat: 1_862_500n,
    total: 20_487_500n,
    receivablesDelta: 0n,
    stockDelta: -14_900_000n,
    bankDelta: 0n,
  },
  /** Sales return: CUST-001 returns 1 of the 2 units of unpaid invoice INV-S-1403-0001 (credit to 1201). */
  salesReturn: {
    invoiceNumber: 'INV-S-1403-0001',
    partyCode: 'CUST-001',
    itemCode: 'ITM-1001',
    quantity: 1,
    total: 20_487_500n,
    receivablesDelta: -20_487_500n,
    stockDelta: 14_900_000n,
    bankDelta: 0n,
  },
  /** Cheque received from CUST-002 settling unpaid INV-S-1403-0002, kept in hand (1110), not deposited. */
  chequeReceived: {
    invoiceNumber: 'INV-S-1403-0002',
    partyCode: 'CUST-002',
    amount: 36_712_500n,
    receivablesDelta: -36_712_500n,
    stockDelta: 0n,
    bankDelta: 0n,
  },
} as const;

export interface M1ClosingTotals {
  receivables: bigint;
  payables: bigint;
  stockValue: bigint;
  bankBalance: bigint;
}

function sumDelta(key: 'receivablesDelta' | 'stockDelta' | 'bankDelta'): bigint {
  return Object.values(M1_MONTH_OPERATIONS).reduce((acc, op) => acc + op[key], 0n);
}

/**
 * What the ledger must show at the end of the month: the README closing figures (duplicates counted once)
 * plus the hand-entered documents above. The bank balance must equal the statement after reconciliation.
 */
export const M1_EXPECTED_CLOSING: M1ClosingTotals = {
  receivables: README_TOTALS.receivablesClosingUnique + sumDelta('receivablesDelta'),
  payables: README_TOTALS.payablesClosingUnique,
  stockValue: README_TOTALS.stockValue + sumDelta('stockDelta'),
  bankBalance: README_TOTALS.bankClosingBalance + sumDelta('bankDelta'),
};
