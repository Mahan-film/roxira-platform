import { AccountType } from '../../accounting/enums/accounting.enum';

/**
 * Posting roles: what an account does in a voucher, independent of its code. A tenant maps each
 * role to an account of its own chart (per document type, or for all types with doc type "*").
 */
export const POSTING_ROLES = {
  receivable: { label: 'حساب‌های دریافتنی', types: [AccountType.ASSET] },
  revenue: { label: 'درآمد فروش', types: [AccountType.REVENUE] },
  vat_output: { label: 'مالیات بر ارزش افزوده فروش (پرداختنی)', types: [AccountType.LIABILITY] },
  vat_input: { label: 'مالیات بر ارزش افزوده خرید (دریافتنی)', types: [AccountType.ASSET] },
  payable: { label: 'حساب‌های پرداختنی', types: [AccountType.LIABILITY] },
  purchases: { label: 'خرید', types: [AccountType.EXPENSE] },
  cogs: { label: 'بهای تمام‌شده کالای فروش‌رفته', types: [AccountType.EXPENSE] },
  inventory: { label: 'موجودی کالا', types: [AccountType.ASSET] },
  grni: { label: 'کالای دریافتی صورتحساب‌نشده', types: [AccountType.LIABILITY] },
  stock_adjustment: { label: 'اضافه و کسری انبار', types: [AccountType.EXPENSE, AccountType.EQUITY] },
  opening_equity: { label: 'مابه‌ازای موجودی اول دوره', types: [AccountType.EQUITY] },
  cash: { label: 'صندوق', types: [AccountType.ASSET] },
  bank: { label: 'بانک', types: [AccountType.ASSET] },
  pos_clearing: { label: 'تسویه کارت‌خوان', types: [AccountType.ASSET] },
  petty_cash: { label: 'تنخواه', types: [AccountType.ASSET] },
  counter: { label: 'حساب مقابل', types: [AccountType.ASSET, AccountType.LIABILITY, AccountType.EQUITY, AccountType.REVENUE, AccountType.EXPENSE] },
  cheques_receivable: { label: 'اسناد دریافتنی (چک نزد صندوق)', types: [AccountType.ASSET] },
  cheques_in_collection: { label: 'اسناد دریافتنی در جریان وصول', types: [AccountType.ASSET] },
  cheques_payable: { label: 'اسناد پرداختنی (چک صادرشده)', types: [AccountType.LIABILITY] },
  payroll_expense: { label: 'هزینه حقوق و دستمزد', types: [AccountType.EXPENSE] },
  employer_insurance_expense: { label: 'هزینه بیمه سهم کارفرما', types: [AccountType.EXPENSE] },
  payroll_payable: { label: 'حقوق پرداختنی', types: [AccountType.LIABILITY] },
  wage_tax_payable: { label: 'مالیات حقوق پرداختنی', types: [AccountType.LIABILITY] },
  insurance_payable: { label: 'حق بیمه پرداختنی', types: [AccountType.LIABILITY] },
  other_deductions_payable: { label: 'سایر کسورات حقوق', types: [AccountType.LIABILITY] },
  depreciation_expense: { label: 'هزینه استهلاک', types: [AccountType.EXPENSE] },
  accumulated_depreciation: { label: 'استهلاک انباشته', types: [AccountType.ASSET] },
  income_tax_expense: { label: 'هزینه مالیات بر درآمد', types: [AccountType.EXPENSE] },
  income_tax_payable: { label: 'مالیات بر درآمد پرداختنی', types: [AccountType.LIABILITY] },
  retention_receivable: { label: 'سپرده حسن انجام کار دریافتنی', types: [AccountType.ASSET] },
  retention_payable: { label: 'سپرده حسن انجام کار پرداختنی', types: [AccountType.LIABILITY] },
  advance_received: { label: 'پیش‌دریافت قرارداد', types: [AccountType.LIABILITY] },
  advance_paid: { label: 'پیش‌پرداخت قرارداد', types: [AccountType.ASSET] },
  contract_insurance_expense: { label: 'هزینه بیمه کسرشده از صورت وضعیت', types: [AccountType.EXPENSE] },
} as const;

export type PostingRole = keyof typeof POSTING_ROLES;

export const POSTING_ROLE_KEYS = Object.keys(POSTING_ROLES) as PostingRole[];

export function isPostingRole(value: string): value is PostingRole {
  return Object.prototype.hasOwnProperty.call(POSTING_ROLES, value);
}

/** Doc type used for a tenant-wide mapping that every document type falls back to. */
export const ALL_DOC_TYPES = '*';

/**
 * Default account per role: codes of `iran-chart-template.ts` (iran-trading). A template may
 * override a role with its own `defaults` to keep what its module posted before the engine.
 * Roles without a default must be mapped by the tenant before a voucher using them can post.
 */
export const DEFAULT_ROLE_ACCOUNTS: Readonly<Partial<Record<PostingRole, string>>> = {
  receivable: '1020',
  revenue: '4010',
  vat_output: '2020',
  vat_input: '1045',
  payable: '2010',
  cogs: '5110',
  inventory: '1030',
  cash: '1011',
  bank: '1012',
  petty_cash: '1013',
  cheques_receivable: '1021',
  cheques_in_collection: '1021',
  cheques_payable: '2011',
  payroll_expense: '5010',
  employer_insurance_expense: '5040',
  payroll_payable: '2050',
  wage_tax_payable: '2040',
  insurance_payable: '2030',
  other_deductions_payable: '2060',
  depreciation_expense: '5060',
  accumulated_depreciation: '1120',
  income_tax_expense: '5220',
  income_tax_payable: '2021',
  opening_equity: '3030',
  stock_adjustment: '5030',
};
