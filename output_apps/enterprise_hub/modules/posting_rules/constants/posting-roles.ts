import { AccountType } from '../../accounting/enums/accounting.enum';

/**
 * Standard semantic roles a business transaction moves money between.
 * The chart of accounts maps each role to a concrete account code in the tenant's ledger.
 */
export const POSTING_ROLES = {
  receivable: { label: 'حساب‌های دریافتنی تجاری', types: [AccountType.ASSET] },
  revenue: { label: 'درآمد فروش', types: [AccountType.REVENUE] },
  vat_output: { label: 'مالیات بر ارزش افزوده فروش', types: [AccountType.LIABILITY] },
  vat_input: { label: 'مالیات بر ارزش افزوده خرید', types: [AccountType.ASSET] },
  payable: { label: 'حساب‌های پرداختنی تجاری', types: [AccountType.LIABILITY] },
  cogs: { label: 'بهای تمام‌شده کالای فروش‌رفته', types: [AccountType.EXPENSE] },
  inventory: { label: 'موجودی کالا', types: [AccountType.ASSET] },
  cash: { label: 'صندوق', types: [AccountType.ASSET] },
  bank: { label: 'بانک', types: [AccountType.ASSET] },
  petty_cash: { label: 'تنخواه‌گردان', types: [AccountType.ASSET] },
  pos_clearing: { label: 'حساب واسط پوز', types: [AccountType.ASSET] },
  cheques_receivable: { label: 'اسناد دریافتنی (نزد صندوق)', types: [AccountType.ASSET] },
  cheques_in_collection: { label: 'اسناد در جریان وصول', types: [AccountType.ASSET] },
  cheques_payable: { label: 'اسناد پرداختنی', types: [AccountType.LIABILITY] },
  payroll_expense: { label: 'هزینه حقوق و دستمزد', types: [AccountType.EXPENSE] },
  employer_insurance_expense: { label: 'هزینه بیمه سهم کارفرما', types: [AccountType.EXPENSE] },
  payroll_payable: { label: 'حقوق پرداختنی', types: [AccountType.LIABILITY] },
  wage_tax_payable: { label: 'مالیات حقوق پرداختنی', types: [AccountType.LIABILITY] },
  insurance_payable: { label: 'بیمه پرداختنی تأمین اجتماعی', types: [AccountType.LIABILITY] },
  other_deductions_payable: { label: 'سایر کسورات حقوق پرداختنی', types: [AccountType.LIABILITY] },
  depreciation_expense: { label: 'هزینه استهلاک', types: [AccountType.EXPENSE] },
  accumulated_depreciation: { label: 'استهلاک انباشته', types: [AccountType.ASSET] },
  income_tax_expense: { label: 'هزینه مالیات بر درآمد', types: [AccountType.EXPENSE] },
  income_tax_payable: { label: 'ذخیره مالیات عملکرد', types: [AccountType.LIABILITY] },
  opening_equity: { label: 'سرمایه / تراز افتتاحیه', types: [AccountType.EQUITY] },
  stock_adjustment: { label: 'کسری و اضافی انبار', types: [AccountType.EXPENSE, AccountType.REVENUE] },
  counter: { label: 'طرف حساب پرداختنی/دریافتنی', types: [AccountType.ASSET, AccountType.LIABILITY, AccountType.EXPENSE, AccountType.REVENUE] },
  settlement_bank: { label: 'بانک واریز/برداشت', types: [AccountType.ASSET] },
  fixed_asset: { label: 'دارایی ثابت', types: [AccountType.ASSET] },
  asset_disposal_gain: { label: 'سود حاصل از فروش دارایی', types: [AccountType.REVENUE] },
  asset_disposal_loss: { label: 'زیان حاصل از فروش دارایی', types: [AccountType.EXPENSE] },
  bank_fee: { label: 'کارمزد خدمات بانکی', types: [AccountType.EXPENSE] },
  monetary_asset: { label: 'حساب پولی / دارایی یا بدهی ارزی', types: [AccountType.ASSET, AccountType.LIABILITY] },
  fx_gain: { label: 'سود تسعیر ارز', types: [AccountType.REVENUE] },
  fx_loss: { label: 'زیان تسعیر ارز', types: [AccountType.EXPENSE] },
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
  fixed_asset: '1110',
  asset_disposal_gain: '4050',
  asset_disposal_loss: '5070',
  bank_fee: '5210',
  pos_clearing: '1015',
  monetary_asset: '1012',
  fx_gain: '4120',
  fx_loss: '5210',
};
