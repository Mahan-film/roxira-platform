import { PostingRole } from '../constants/posting-roles';
import { CHEQUE_TEMPLATES } from './cheque-templates';
import { CONTRACT_TEMPLATES } from './contract-templates';

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
 * Invoicing vouchers (#378). One invoice document posts one voucher whose lines can fall on either
 * side (a return, a cancel and a corrective flip the sign), and the engine refuses negative amounts.
 * So every row is a pair of amounts, `<key>Dr` and `<key>Cr` (one of them 0, the zero line is dropped):
 * all debit rows first, then all credit rows, each in row order. That is exactly the order the old
 * posting service produced ("debits first, then credits, stable"). Descriptions are the old ones, except
 * the party rows of the issue and cancel vouchers: a template line text is static and cannot carry the
 * invoice number, so those rows have no text and the ledger reports fall back to the voucher description
 * («صدور صورتحساب <number>» / «ابطال صورتحساب <number>»), which does carry it.
 * Defaults are the codes invoicing created before the engine (1201/4101/2301/2101/1401/5101/5201/1301/1010/1015).
 */
const INVOICE_LEGACY: Readonly<Partial<Record<PostingRole, string>>> = {
  receivable: '1201',
  revenue: '4101',
  vat_output: '2301',
  payable: '2101',
  vat_input: '1401',
  cogs: '5101',
  purchases: '5201',
  inventory: '1301',
  cash: '1010',
  pos_clearing: '1015',
};

type InvoiceRow = readonly [key: string, role: PostingRole, description: string, party?: boolean];

function invoiceTemplate(docType: string, title: string, rows: readonly InvoiceRow[]): PostingTemplate {
  return {
    docType,
    title,
    amounts: rows.flatMap(([key]) => [`${key}Dr`, `${key}Cr`]),
    lines: [
      ...rows.map(([key, role, text, party]) => dr(role, `${key}Dr`, text, party)),
      ...rows.map(([key, role, text, party]) => cr(role, `${key}Cr`, text, party)),
    ],
    defaults: INVOICE_LEGACY,
  };
}

const SALE_ROWS: readonly InvoiceRow[] = [
  ['receivable', 'receivable', '', true],
  ['sales', 'revenue', 'درآمد فروش'],
  ['vat', 'vat_output', 'مالیات بر ارزش افزوده پرداختنی'],
  ['stock', 'inventory', 'تغییر موجودی کالا'],
  ['cogs', 'cogs', 'بهای تمام‌شده کالای فروش‌رفته'],
];
const PURCHASE_ROWS: readonly InvoiceRow[] = [
  ['stock', 'inventory', 'ورود کالا به انبار'],
  ['purchases', 'purchases', 'خرید کالا و خدمات'],
  ['vat', 'vat_input', 'مالیات بر ارزش افزوده خرید'],
  ['payable', 'payable', '', true],
];

/** Settlement rows: cash/bank and POS clearing (card) in the order of the first payment, then the party. */
function settleRows(sale: boolean, cardFirst: boolean): readonly InvoiceRow[] {
  const cash: InvoiceRow = ['cash', 'cash', sale ? 'دریافت نقدی/بانکی بابت صورتحساب' : 'پرداخت نقدی/بانکی بابت صورتحساب'];
  const card: InvoiceRow = ['card', 'pos_clearing', sale ? 'دریافت از طریق پوز' : 'پرداخت نقدی/بانکی بابت صورتحساب'];
  const party: InvoiceRow = sale
    ? ['party', 'receivable', 'تسویه حساب‌های دریافتنی', true]
    : ['party', 'payable', 'تسویه حساب‌های پرداختنی', true];
  return [...(cardFirst ? [card, cash] : [cash, card]), party];
}

export const INVOICE_TEMPLATES: readonly PostingTemplate[] = [
  invoiceTemplate('invoice.sale.issue', 'صدور فاکتور فروش', SALE_ROWS),
  invoiceTemplate('invoice.sale.cancel', 'ابطال فاکتور فروش', SALE_ROWS),
  invoiceTemplate('invoice.purchase.issue', 'صدور فاکتور خرید', PURCHASE_ROWS),
  invoiceTemplate('invoice.purchase.cancel', 'ابطال فاکتور خرید', PURCHASE_ROWS),
  invoiceTemplate('invoice.sale.settle', 'تسویه فاکتور فروش و فروش پوز', settleRows(true, false)),
  invoiceTemplate('invoice.sale.settle_card_first', 'تسویه فاکتور فروش (پوز اول)', settleRows(true, true)),
  invoiceTemplate('invoice.purchase.settle', 'تسویه فاکتور خرید', settleRows(false, false)),
  invoiceTemplate('invoice.purchase.settle_card_first', 'تسویه فاکتور خرید (پوز اول)', settleRows(false, true)),
];

/**
 * One template per document type. Adopting modules pass amounts; the engine maps roles to the
 * tenant's accounts, drops zero lines and refuses a voucher that does not balance.
 * New adopting modules add their template here (and a spec comparing it with their old output).
 */
export const POSTING_TEMPLATES: readonly PostingTemplate[] = [
  ...CHEQUE_TEMPLATES,
  ...CONTRACT_TEMPLATES,
  ...INVOICE_TEMPLATES,
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
    // Codes the HR module hardcoded before adopting the engine (see hr/constants/hr.constants.ts).
    defaults: {
      payroll_expense: '5010',
      employer_insurance_expense: '5040',
      insurance_payable: '2030',
      wage_tax_payable: '2040',
      other_deductions_payable: '2060',
      payroll_payable: '2050',
    },
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
  // #561: sale of one fixed asset. The engine drops zero lines, so exactly one of gain/loss
  // (or neither when proceeds equal the book value) reaches the voucher. Balance:
  // accumulated + proceeds + loss = cost + gain, with loss = cost - accumulated - proceeds
  // and gain = proceeds - (cost - accumulated).
  {
    docType: 'fixed_asset.disposal',
    title: 'فروش دارایی ثابت',
    amounts: ['cost', 'accumulated', 'proceeds', 'gain', 'loss'],
    lines: [
      dr('accumulated_depreciation', 'accumulated', 'استهلاک انباشته دارایی فروش‌رفته'),
      dr('counter', 'proceeds', 'عواید فروش دارایی'),
      cr('fixed_asset', 'cost', 'بهای تمام‌شده دارایی فروش‌رفته'),
      cr('asset_disposal_gain', 'gain', 'سود فروش دارایی'),
      dr('asset_disposal_loss', 'loss', 'زیان فروش دارایی'),
    ],
  },
  {
    docType: 'purchase.receipt',
    title: 'رسید کالا (بدون صورتحساب)',
    amounts: ['amount'],
    lines: [dr('inventory', 'amount', 'موجودی کالا'), cr('grni', 'amount', 'کالای دریافتی صورتحساب‌نشده', true)],
    defaults: { grni: '2013' },
  },
  {
    docType: 'purchase.invoice',
    title: 'صورتحساب خرید با تطبیق سه‌طرفه',
    amounts: ['grni', 'variance_debit', 'variance_credit', 'vat', 'payable'],
    lines: [
      dr('grni', 'grni', 'کالای دریافتی صورتحساب‌نشده'),
      dr('price_variance', 'variance_debit', 'تفاوت بهای خرید'),
      cr('price_variance', 'variance_credit', 'تفاوت بهای خرید'),
      dr('vat_input', 'vat', 'مالیات بر ارزش افزوده خرید'),
      cr('payable', 'payable', 'بدهکاری به تأمین‌کننده', true),
    ],
    defaults: { grni: '2013', price_variance: '5120' },
  },
  {
    docType: 'purchase.landed_cost',
    title: 'هزینه سربار خرید (حمل، گمرک، بیمه)',
    amounts: ['inventory', 'cogs', 'payable'],
    lines: [
      dr('inventory', 'inventory', 'سربار خرید سهم موجودی کالا'),
      dr('cogs', 'cogs', 'سربار خرید کالای فروش‌رفته'),
      cr('payable', 'payable', 'بدهکاری به تأمین‌کننده', true),
    ],
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
    docType: 'pettycash.fund_charge',
    title: 'شارژ تنخواه (حرکت صندوق)',
    amounts: ['amount'],
    lines: [dr('petty_cash', 'amount', ''), cr('counter', 'amount', '')],
  },
  {
    docType: 'pettycash.fund_return',
    title: 'برگشت وجه تنخواه (حرکت صندوق)',
    amounts: ['amount'],
    lines: [dr('counter', 'amount', ''), cr('petty_cash', 'amount', '')],
  },
];

const BY_TYPE = new Map(POSTING_TEMPLATES.map((t) => [t.docType, t]));

export function findTemplate(docType: string): PostingTemplate | undefined {
  return BY_TYPE.get(docType);
}
