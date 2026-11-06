import type { PostingTemplate, TemplateLine } from './posting-templates';

/**
 * Contracting vouchers (T3, #227). Amounts are integer minor units; a zero line is dropped by the
 * engine, so a statement with no retention or no advance recovery posts only the lines it needs.
 * No account code is fixed here: `retention_payable`, `advance_received`, `advance_paid` and
 * `contract_insurance_expense` have no global default, so the tenant maps them before the first post.
 *
 * Progress statement (gross = this period's work, net = gross - retention - insurance - advance recovery):
 *  - contractor side (we bill an employer): receivable(net, party) + retention held by the employer + insurance
 *    the employer pays to the Social Security Org. on our behalf + advance received that is being recovered,
 *    against revenue(gross).
 *  - employer side (we owe a contractor): cost(gross) against payable(net, party), retention kept, insurance
 *    owed to the Social Security Org. and the advance paid that is being recovered.
 */
const dr = (role: TemplateLine['role'], amount: string, description: string, party = false): TemplateLine => ({ role, side: 'debit', amount, description, party });
const cr = (role: TemplateLine['role'], amount: string, description: string, party = false): TemplateLine => ({ role, side: 'credit', amount, description, party });

const t = (docType: string, title: string, amounts: string[], lines: TemplateLine[]): PostingTemplate => ({ docType, title, amounts, lines });

export const CONTRACT_TEMPLATES: readonly PostingTemplate[] = [
  t('contract.statement.contractor', 'صورت وضعیت پیمانکار (فروش به کارفرما)', ['gross', 'retention', 'insurance', 'advance', 'net'], [
    dr('receivable', 'net', 'طلب از کارفرما', true),
    dr('retention_receivable', 'retention', 'سپرده حسن انجام کار نزد کارفرما'),
    dr('contract_insurance_expense', 'insurance', 'کسور بیمه صورت وضعیت'),
    dr('advance_received', 'advance', 'استهلاک پیش‌دریافت'),
    cr('revenue', 'gross', 'درآمد صورت وضعیت'),
  ]),
  t('contract.statement.employer', 'صورت وضعیت کارفرما (خرید از پیمانکار)', ['gross', 'retention', 'insurance', 'advance', 'net'], [
    dr('purchases', 'gross', 'هزینه پروژه طبق صورت وضعیت'),
    cr('payable', 'net', 'بدهی به پیمانکار', true),
    cr('retention_payable', 'retention', 'سپرده حسن انجام کار نگهداری‌شده'),
    cr('insurance_payable', 'insurance', 'کسور بیمه پیمانکار'),
    cr('advance_paid', 'advance', 'استهلاک پیش‌پرداخت'),
  ]),
];
