/**
 * Hand-computed figures for the Accountant Day E2E go-live gate (T91, issue #784).
 *
 * All amounts are integer Rials (bigint). Account codes are the codes of the `iran-trading` chart template
 * (output_apps/enterprise_hub/modules/accounting/constants/iran-chart-template.ts), copied by hand:
 *   1010 cash and bank (the cheque module's default bank account), 1011 cash box, 1012 banks,
 *   1020 trade receivables, 1030 inventory, 1045 VAT input, 1110 notes in hand (cheque module),
 *   2010 trade payables, 2020 VAT payable, 3010 capital, 4020 goods sales, 5020 rent,
 *   5030 general and administrative, 5050 selling and marketing, 5110 cost of goods sold.
 *
 * The vouchers below are the single source for what the spec posts. `EXPECTED_BALANCES` is written by hand and
 * the offline self-check proves it equals the sum of the voucher lines, so a wrong constant or a wrong voucher
 * fails before any server is involved. The server-side check (spec steps 09 and 10) then compares the real
 * ledger with the same constants.
 *
 * Sign convention: debit is positive, credit is negative (the `balance` field of `accounting/accounts`).
 */

export interface VoucherLine {
  code: string;
  debit: bigint;
  credit: bigint;
  partyCode?: string;
}

export interface Voucher {
  entryNumber: string;
  description: string;
  /** Gregorian date (yyyy-mm-dd) inside fiscal year 1405 (2026-03-21 .. 2027-03-20). */
  date: string;
  lines: readonly VoucherLine[];
}

export const FISCAL_YEAR_1405 = { name: '1405', startDate: '2026-03-21', endDate: '2027-03-20' } as const;
export const FISCAL_YEAR_1406 = { name: '1406', startDate: '2027-03-21', endDate: '2028-03-20' } as const;

/** Opening voucher, posted through the API: cash box 200M + bank 500M + inventory 300M = capital 1,000M. */
export const OPENING_VOUCHER: Voucher = {
  entryNumber: 'OP-01',
  description: 'سند افتتاحیه سال مالی ۱۴۰۵',
  date: '2026-03-21',
  lines: [
    { code: '1011', debit: 200_000_000n, credit: 0n },
    { code: '1012', debit: 500_000_000n, credit: 0n },
    { code: '1030', debit: 300_000_000n, credit: 0n },
    { code: '3010', debit: 0n, credit: 1_000_000_000n },
  ],
};

/** The date typed into the voucher form by the keyboard step: 1405/01/26 = 2026-04-15. */
export const KEYBOARD_VOUCHER_JALALI = '14050126';
export const KEYBOARD_VOUCHER_JALALI_SHOWN = '۱۴۰۵/۰۱/۲۶';
export const KEYBOARD_VOUCHER_DATE = '2026-04-15';

/** Five two-line vouchers entered through the voucher grid with the keyboard only (spec step 04). */
export const KEYBOARD_VOUCHERS = [
  {
    entryNumber: 'JV-01',
    description: 'افزایش نقدی سرمایه توسط شرکاء',
    debitCode: '1011',
    creditCode: '3010',
    amount: 50_000_000n,
  },
  {
    entryNumber: 'JV-02',
    description: 'پرداخت اجاره دفتر مرکزی از حساب بانکی',
    debitCode: '5020',
    creditCode: '1012',
    amount: 30_000_000n,
  },
  {
    entryNumber: 'JV-03',
    description: 'پرداخت قبوض برق و گاز از صندوق',
    debitCode: '5030',
    creditCode: '1011',
    amount: 5_000_000n,
  },
  {
    entryNumber: 'JV-04',
    description: 'هزینه تبلیغات و بازاریابی دیجیتال از حساب بانکی',
    debitCode: '5050',
    creditCode: '1012',
    amount: 15_000_000n,
  },
  {
    entryNumber: 'JV-05',
    description: 'خرید ملزومات و نوشت‌افزار اداری از صندوق',
    debitCode: '5030',
    creditCode: '1011',
    amount: 10_000_000n,
  },
] as const;

export const CUSTOMER = { code: 'CUST-DAY-01', name: 'شرکت پیشگامان البرز' } as const;
export const SUPPLIER = { code: 'SUPP-DAY-01', name: 'بازرگانی تجارت نوین' } as const;

/**
 * Sales: 10 units x 10M = revenue 100M, VAT 10% = 10M, receivable 110M; cost 10 x 5M = 50M leaves inventory.
 * Posted as one voucher (the invoicing module is not driven by this gate, see the PR body).
 */
export const SALES_VOUCHER: Voucher = {
  entryNumber: 'INV-S-01',
  description: `فاکتور فروش شماره ۰۱ به ${CUSTOMER.name}`,
  date: '2026-05-01',
  lines: [
    { code: '1020', debit: 110_000_000n, credit: 0n, partyCode: CUSTOMER.code },
    { code: '4020', debit: 0n, credit: 100_000_000n },
    { code: '2020', debit: 0n, credit: 10_000_000n },
    { code: '5110', debit: 50_000_000n, credit: 0n },
    { code: '1030', debit: 0n, credit: 50_000_000n },
  ],
};

/** Bank receipt of 60M against the 110M receivable. */
export const RECEIPT_VOUCHER: Voucher = {
  entryNumber: 'REC-01',
  description: `دریافت وجه به حساب بانک از ${CUSTOMER.name}`,
  date: '2026-05-10',
  lines: [
    { code: '1012', debit: 60_000_000n, credit: 0n },
    { code: '1020', debit: 0n, credit: 60_000_000n, partyCode: CUSTOMER.code },
  ],
};

/** Purchase: 5 units x 6M = inventory 30M, VAT input 10% = 3M, payable 33M. */
export const PURCHASE_VOUCHER: Voucher = {
  entryNumber: 'INV-P-01',
  description: `فاکتور خرید شماره ۰۱ از ${SUPPLIER.name}`,
  date: '2026-05-20',
  lines: [
    { code: '1030', debit: 30_000_000n, credit: 0n },
    { code: '1045', debit: 3_000_000n, credit: 0n },
    { code: '2010', debit: 0n, credit: 33_000_000n, partyCode: SUPPLIER.code },
  ],
};

/**
 * A received cheque for the remaining 50M of the receivable, driven through the cheques module (the module posts
 * its own vouchers, with the default posting rules):
 *   create  (registered): Dr 1110 / Cr 1020 50M
 *   clear   (registered -> cleared, presented at the bank directly): Dr 1010 / Cr 1110 50M
 */
export const CHEQUE = {
  chequeNumber: '9901',
  amount: 50_000_000n,
  issueDate: '2026-05-25',
  dueDate: '2026-06-15',
  clearDate: '2026-06-15',
  bankName: 'بانک ملت',
} as const;

export const CHEQUE_POSTED_LINES: readonly VoucherLine[] = [
  { code: '1110', debit: CHEQUE.amount, credit: 0n },
  { code: '1020', debit: 0n, credit: CHEQUE.amount },
  { code: '1010', debit: CHEQUE.amount, credit: 0n },
  { code: '1110', debit: 0n, credit: CHEQUE.amount },
];

/** Every journal line of the day, in posting order (the five keyboard vouchers have two lines each). */
export function allDayLines(): VoucherLine[] {
  const keyboard = KEYBOARD_VOUCHERS.flatMap((v) => [
    { code: v.debitCode, debit: v.amount, credit: 0n },
    { code: v.creditCode, debit: 0n, credit: v.amount },
  ]);
  return [
    ...OPENING_VOUCHER.lines,
    ...keyboard,
    ...SALES_VOUCHER.lines,
    ...RECEIPT_VOUCHER.lines,
    ...PURCHASE_VOUCHER.lines,
    ...CHEQUE_POSTED_LINES,
  ];
}

/** Final account balances before the year is closed, debit-positive, written by hand. */
export const EXPECTED_BALANCES: Readonly<Record<string, bigint>> = {
  '1010': 50_000_000n, // cheque cleared into the bank: 50M
  '1011': 235_000_000n, // cash box: 200M + 50M - 5M - 10M
  '1012': 515_000_000n, // banks: 500M - 30M - 15M + 60M
  '1020': 0n, // receivable: 110M - 60M (receipt) - 50M (cheque)
  '1030': 280_000_000n, // inventory: 300M - 50M + 30M
  '1045': 3_000_000n, // VAT input
  '1110': 0n, // notes in hand: +50M - 50M
  '2010': -33_000_000n, // trade payables
  '2020': -10_000_000n, // VAT payable
  '3010': -1_050_000_000n, // capital: 1,000M + 50M
  '4020': -100_000_000n, // goods sales
  '5020': 30_000_000n, // rent
  '5030': 15_000_000n, // utilities 5M + office supplies 10M
  '5050': 15_000_000n, // advertising
  '5110': 50_000_000n, // cost of goods sold
};

export const TRIAL_BALANCE = {
  totalDebit: 1_193_000_000n, // 50+235+515+0+280+3+0 +30+15+15+50 = 1,193M
  totalCredit: 1_193_000_000n, // 33+10+1,050+100 = 1,193M
} as const;

export const INCOME_STATEMENT = {
  revenue: 100_000_000n,
  costOfSales: 50_000_000n,
  grossProfit: 50_000_000n,
  operatingExpenses: 60_000_000n, // rent 30M + G&A 15M + marketing 15M
  netProfit: -10_000_000n, // a loss of 10M Rials
} as const;

export const BALANCE_SHEET = {
  // 50 + 235 + 515 + 0 + 280 + 3 = 1,083M
  totalAssets: 1_083_000_000n,
  // payables 33M + VAT payable 10M
  totalLiabilities: 43_000_000n,
  // capital 1,050M minus the current-year loss 10M
  totalEquity: 1_040_000_000n,
} as const;

/** Sum of the voucher lines per account, debit-positive. Used only by the offline self-check. */
export function balancesFromVouchers(): Record<string, bigint> {
  const out: Record<string, bigint> = {};
  for (const line of allDayLines()) {
    out[line.code] = (out[line.code] ?? 0n) + line.debit - line.credit;
  }
  return out;
}

/** Total debits and credits of the closing balances (positive balances are debits, negative are credits). */
export function trialBalanceTotals(balances: Readonly<Record<string, bigint>>): { debit: bigint; credit: bigint } {
  let debit = 0n;
  let credit = 0n;
  for (const value of Object.values(balances)) {
    if (value > 0n) debit += value;
    else credit -= value;
  }
  return { debit, credit };
}
