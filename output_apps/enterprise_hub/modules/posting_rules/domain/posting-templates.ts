import { PostingRole } from '../constants/posting-roles';

export type PostingSide = 'debit' | 'credit';

export interface TemplateLine {
  role: PostingRole;
  side: PostingSide;
  /** Name of the amount (in the document's amounts) this line posts. */
  amount: string;
  description: string;
  /** The voucher line carries the document's party code (customer, supplier, drawer...). */
  party?: boolean;
}

export interface PostingTemplate {
  docType: string;
  title: string;
  /** Names of the amounts the document must provide (all required, integer minor units >= 0). */
  amounts: readonly string[];
  lines: readonly TemplateLine[];
  /** Role defaults that replace the global ones for this template (what the module posted before). */
  defaults?: Readonly<Partial<Record<PostingRole, string>>>;
}

const dr = (role: PostingRole, amount: string, description: string, party = false): TemplateLine => ({ role, side: 'debit', amount, description, party });
const cr = (role: PostingRole, amount: string, description: string, party = false): TemplateLine => ({ role, side: 'credit', amount, description, party });

/**
 * One template per document type. Adopting modules pass amounts; the engine maps roles to the
 * tenant's accounts, drops zero lines and refuses a voucher that does not balance.
 * New adopting modules add their template here (and a spec comparing it with their old output).
 */
export const POSTING_TEMPLATES: readonly PostingTemplate[] = [
  {
    docType: 'invoice.sale',
    title: 'فاکتور فروش',
    amounts: ['total', 'net', 'vat'],
    lines: [
      dr('receivable', 'total', 'بستانکاری از مشتری', true),
      cr('revenue', 'net', 'درآمد فروش'),
      cr('vat_output', 'vat', 'مالیات بر ارزش افزوده فروش'),
    ],
  },
  {
    docType: 'invoice.sale_cogs',
    title: 'بهای تمام‌شده فروش',
    amounts: ['cost'],
    lines: [dr('cogs', 'cost', 'بهای تمام‌شده کالای فروش‌رفته'), cr('inventory', 'cost', 'خروج از موجودی کالا')],
  },
  {
    docType: 'invoice.purchase',
    title: 'فاکتور خرید',
    amounts: ['total', 'net', 'vat'],
    lines: [
      dr('inventory', 'net', 'ورود به موجودی کالا'),
      dr('vat_input', 'vat', 'مالیات بر ارزش افزوده خرید'),
      cr('payable', 'total', 'بدهکاری به تأمین‌کننده', true),
    ],
  },
  {
    docType: 'payroll.run',
    title: 'سند حقوق و دستمزد ماهانه',
    amounts: ['gross', 'employerCost', 'insurance', 'incomeTax', 'otherDeductions', 'net'],
    lines: [
      dr('payroll_expense', 'gross', 'هزینه حقوق و دستمزد (ناخالص)'),
      dr('employer_insurance_expense', 'employerCost', 'بیمه سهم کارفرما و بیمه بیکاری'),
      cr('insurance_payable', 'insurance', 'حق بیمه پرداختنی (سهم کارگر و کارفرما)'),
      cr('wage_tax_payable', 'incomeTax', 'مالیات حقوق پرداختنی'),
      cr('other_deductions_payable', 'otherDeductions', 'سایر کسورات حقوق'),
      cr('payroll_payable', 'net', 'خالص حقوق پرداختنی به کارکنان'),
    ],
  },
  {
    docType: 'payroll.payslip',
    title: 'سند فیش حقوقی',
    amounts: ['gross', 'deductions', 'net'],
    lines: [
      dr('payroll_expense', 'gross', 'هزینه حقوق و دستمزد'),
      cr('payroll_payable', 'deductions', 'کسورات بیمه و مالیات پرداختنی'),
      cr('bank', 'net', 'خالص پرداختی حقوق'),
    ],
    defaults: { payroll_expense: '5010', payroll_payable: '2010', bank: '1010' },
  },
  {
    docType: 'tax.provision',
    title: 'ذخیره مالیات بر درآمد',
    amounts: ['provision'],
    lines: [dr('income_tax_expense', 'provision', 'هزینه مالیات بر درآمد'), cr('income_tax_payable', 'provision', 'مالیات بر درآمد پرداختنی')],
  },
  {
    docType: 'asset.depreciation',
    title: 'استهلاک دارایی ثابت',
    amounts: ['charge'],
    lines: [dr('depreciation_expense', 'charge', 'هزینه استهلاک'), cr('accumulated_depreciation', 'charge', 'استهلاک انباشته')],
  },
  {
    docType: 'stock.opening',
    title: 'موجودی اول دوره',
    amounts: ['amount'],
    lines: [dr('inventory', 'amount', 'موجودی کالا'), cr('opening_equity', 'amount', 'مابه‌ازای ثبت موجودی')],
  },
  {
    docType: 'stock.adjustment_gain',
    title: 'اضافه انبار',
    amounts: ['amount'],
    lines: [dr('inventory', 'amount', 'موجودی کالا'), cr('stock_adjustment', 'amount', 'اضافه انبار')],
  },
  {
    docType: 'stock.adjustment_loss',
    title: 'کسری انبار',
    amounts: ['amount'],
    lines: [dr('stock_adjustment', 'amount', 'کسری انبار'), cr('inventory', 'amount', 'موجودی کالا')],
  },
  {
    docType: 'bank.receipt',
    title: 'دریافت وجه به حساب بانکی',
    amounts: ['amount'],
    lines: [dr('bank', 'amount', 'دریافت وجه'), cr('counter', 'amount', 'حساب مقابل', true)],
  },
  {
    docType: 'bank.payment',
    title: 'پرداخت وجه از حساب بانکی',
    amounts: ['amount'],
    lines: [dr('counter', 'amount', 'حساب مقابل', true), cr('bank', 'amount', 'پرداخت وجه')],
  },
  {
    docType: 'pettycash.charge',
    title: 'شارژ تنخواه',
    amounts: ['amount'],
    lines: [dr('petty_cash', 'amount', 'شارژ تنخواه'), cr('counter', 'amount', 'حساب مقابل')],
  },
  {
    docType: 'pettycash.expense',
    title: 'هزینه تنخواه',
    amounts: ['amount'],
    lines: [dr('counter', 'amount', 'هزینه تنخواه'), cr('petty_cash', 'amount', 'تنخواه')],
  },
  {
    docType: 'cheque.received.create',
    title: 'دریافت چک',
    amounts: ['amount'],
    lines: [dr('cheques_receivable', 'amount', 'اسناد دریافتنی', true), cr('receivable', 'amount', 'حساب دریافتنی', true)],
  },
  {
    docType: 'cheque.received.deposit',
    title: 'واگذاری چک به بانک برای وصول',
    amounts: ['amount'],
    lines: [dr('cheques_in_collection', 'amount', 'در جریان وصول'), cr('cheques_receivable', 'amount', 'اسناد دریافتنی')],
  },
  {
    docType: 'cheque.received.clear',
    title: 'وصول چک',
    amounts: ['amount'],
    lines: [dr('bank', 'amount', 'وصول چک'), cr('cheques_in_collection', 'amount', 'در جریان وصول')],
  },
  {
    docType: 'cheque.issued.create',
    title: 'صدور چک',
    amounts: ['amount'],
    lines: [dr('payable', 'amount', 'حساب پرداختنی', true), cr('cheques_payable', 'amount', 'اسناد پرداختنی')],
  },
  {
    docType: 'cheque.issued.clear',
    title: 'پاس شدن چک پرداختنی',
    amounts: ['amount'],
    lines: [dr('cheques_payable', 'amount', 'اسناد پرداختنی'), cr('bank', 'amount', 'پرداخت از بانک')],
  },
];

const BY_TYPE = new Map(POSTING_TEMPLATES.map((t) => [t.docType, t]));

export function findTemplate(docType: string): PostingTemplate | undefined {
  return BY_TYPE.get(docType);
}
