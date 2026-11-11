/**
 * Hand-computed figures for the Accountant Day E2E Go-Live Gate (Task T91).
 *
 * All monetary amounts are integer Rials (minor units in Iranian accounting).
 * Proves mathematically that the whole accountant day journal entries, sales/purchase invoices,
 * receipts, cheques, and closing sequence balance to zero and reconcile across:
 *   - Trial balance (Total Debits == Total Credits)
 *   - Income Statement (Revenue - COGS - Operating Expenses = Net Profit/Loss)
 *   - Balance Sheet (Total Assets == Total Liabilities + Total Equity)
 */

export interface AccountBalance {
  code: string;
  name: string;
  nature: 'DEBIT' | 'CREDIT';
  amount: bigint;
}

export const ACCOUNTANT_DAY_OPENING = {
  cash: 200_000_000n, // 1010
  bank: 500_000_000n, // 1020
  inventory: 300_000_000n, // 1150
  capital: 1_000_000_000n, // 3010
  total: 1_000_000_000n,
} as const;

export const ACCOUNTANT_DAY_KEYBOARD_VOUCHERS = [
  {
    entryNumber: 'JV-01',
    description: 'افزایش نقدی سرمایه توسط شرکاء',
    debitCode: '1010', // صندوق
    creditCode: '3010', // سرمایه
    amount: 50_000_000n,
  },
  {
    entryNumber: 'JV-02',
    description: 'پرداخت اجاره دفتر مرکزی از حساب بانکی',
    debitCode: '5020', // هزینه اجاره
    creditCode: '1020', // بانک
    amount: 30_000_000n,
  },
  {
    entryNumber: 'JV-03',
    description: 'پرداخت قبوض برق و گاز از صندوق',
    debitCode: '5030', // هزینه آب و برق
    creditCode: '1010', // صندوق
    amount: 5_000_000n,
  },
  {
    entryNumber: 'JV-04',
    description: 'هزینه تبلیغات و بازاریابی دیجیتال از حساب بانکی',
    debitCode: '5040', // هزینه تبلیغات
    creditCode: '1020', // بانک
    amount: 15_000_000n,
  },
  {
    entryNumber: 'JV-05',
    description: 'خرید ملزومات و نوشت‌افزار اداری از صندوق',
    debitCode: '5050', // هزینه ملزومات اداری
    creditCode: '1010', // صندوق
    amount: 10_000_000n,
  },
] as const;

export const ACCOUNTANT_DAY_SALES_INVOICE = {
  customerCode: 'CUST-DAY-01',
  customerName: 'شرکت پیشگامان البرز',
  quantity: 10,
  unitPrice: 10_000_000n,
  revenue: 100_000_000n, // 4010
  vatRate: 10,
  vatOutput: 10_000_000n, // 2020
  totalReceivable: 110_000_000n, // 1030
  unitCost: 5_000_000n,
  cogs: 50_000_000n, // 5010
  inventoryDecrease: 50_000_000n, // 1150
} as const;

export const ACCOUNTANT_DAY_RECEIPT = {
  amount: 60_000_000n,
  debitCode: '1020', // بانک
  creditCode: '1030', // حساب‌های دریافتنی تجاری
} as const;

export const ACCOUNTANT_DAY_PURCHASE_INVOICE = {
  supplierCode: 'SUPP-DAY-01',
  supplierName: 'بازرگانی تجارت نوین',
  quantity: 5,
  unitPrice: 6_000_000n,
  inventoryIncrease: 30_000_000n, // 1150
  vatRate: 10,
  vatInput: 3_000_000n, // 1040
  totalPayable: 33_000_000n, // 2010
} as const;

export const ACCOUNTANT_DAY_CHEQUE = {
  chequeNumber: 'CHK-DAY-9901',
  partyCode: 'CUST-DAY-01',
  amount: 50_000_000n,
  dueDate: '2026-06-15',
  // On receipt: Dr 1110 (اسناد دریافتنی) 50,000,000 / Cr 1030 (حساب دریافتنی) 50,000,000
  // On clearance: Dr 1020 (بانک) 50,000,000 / Cr 1110 (اسناد دریافتنی) 50,000,000
} as const;

/** Final account balances at the end of the accountant's day (before period close). */
export const ACCOUNTANT_DAY_EXPECTED_BALANCES = {
  '1010': 235_000_000n, // صندوق: 200M + 50M - 5M - 10M
  '1020': 565_000_000n, // بانک: 500M - 30M - 15M + 60M + 50M
  '1030': 0n,           // حساب‌های دریافتنی: 110M - 60M - 50M = 0
  '1040': 3_000_000n,   // مالیات بر ارزش افزوده خرید: 3M
  '1110': 0n,           // اسناد دریافتنی نزد صندوق: 50M - 50M = 0
  '1150': 280_000_000n, // موجودی کالا: 300M - 50M + 30M = 280M
  '2010': 33_000_000n,  // حساب‌های پرداختنی تجاری: 33M
  '2020': 10_000_000n,  // مالیات بر ارزش افزوده فروش: 10M
  '3010': 1_050_000_000n, // سرمایه: 1000M + 50M = 1050M
  '4010': 100_000_000n, // فروش کالا: 100M
  '5010': 50_000_000n,  // بهای تمام‌شده کالای فروش‌رفته: 50M
  '5020': 30_000_000n,  // هزینه اجاره: 30M
  '5030': 5_000_000n,   // هزینه آب و برق: 5M
  '5040': 15_000_000n,  // هزینه تبلیغات: 15M
  '5050': 10_000_000n,  // هزینه ملزومات اداری: 10M
} as const;

export const ACCOUNTANT_DAY_TRIAL_BALANCE = {
  totalDebit: 1_193_000_000n,
  totalCredit: 1_193_000_000n,
  balanced: true,
} as const;

export const ACCOUNTANT_DAY_INCOME_STATEMENT = {
  revenue: 100_000_000n,
  cogs: 50_000_000n,
  grossProfit: 50_000_000n,
  operatingExpenses: 60_000_000n,
  operatingProfit: -10_000_000n,
  netProfit: -10_000_000n, // زیان خالص ۱۰ میلیون ریال
} as const;

export const ACCOUNTANT_DAY_BALANCE_SHEET = {
  totalAssets: 1_083_000_000n,       // 235M (نقد) + 565M (بانک) + 3M (مالیات خرید) + 280M (موجودی)
  totalLiabilities: 43_000_000n,     // 33M (بستانکاران) + 10M (مالیات فروش)
  totalEquity: 1_040_000_000n,       // 1,050M (سرمایه) - 10M (زیان انباشته)
  liabilitiesPlusEquity: 1_083_000_000n, // 43M + 1,040M = 1,083M
} as const;

/** Compute Trial Balance debits and credits from operational rows. */
export function computeAccountantDayTotals() {
  const debits =
    ACCOUNTANT_DAY_EXPECTED_BALANCES['1010'] +
    ACCOUNTANT_DAY_EXPECTED_BALANCES['1020'] +
    ACCOUNTANT_DAY_EXPECTED_BALANCES['1040'] +
    ACCOUNTANT_DAY_EXPECTED_BALANCES['1150'] +
    ACCOUNTANT_DAY_EXPECTED_BALANCES['5010'] +
    ACCOUNTANT_DAY_EXPECTED_BALANCES['5020'] +
    ACCOUNTANT_DAY_EXPECTED_BALANCES['5030'] +
    ACCOUNTANT_DAY_EXPECTED_BALANCES['5040'] +
    ACCOUNTANT_DAY_EXPECTED_BALANCES['5050'];

  const credits =
    ACCOUNTANT_DAY_EXPECTED_BALANCES['2010'] +
    ACCOUNTANT_DAY_EXPECTED_BALANCES['2020'] +
    ACCOUNTANT_DAY_EXPECTED_BALANCES['3010'] +
    ACCOUNTANT_DAY_EXPECTED_BALANCES['4010'];

  return { debits, credits };
}
