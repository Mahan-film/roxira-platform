import { Category, PersonType } from './classifier';

/**
 * Hand-labelled synthetic descriptions (written from the phrasing seen in Iranian internet-bank
 * exports). They measure the rules, not real-world accuracy: replace with owner-labelled real
 * statements before trusting the numbers (see docs/eval/bank-classification-eval.md).
 * `unknown` means "a person must decide": the right behaviour is to ask.
 */
export interface EvalCase {
  description: string;
  direction: 'in' | 'out';
  amountRial: bigint;
  category: Category;
  person?: PersonType;
}

const c = (
  description: string,
  direction: 'in' | 'out',
  amountRial: number,
  category: Category,
  person?: PersonType,
): EvalCase => ({ description, direction, amountRial: BigInt(amountRial), category, person });

export const EVAL_CASES: EvalCase[] = [
  // fees
  c('کارمزد پایا', 'out', 350_000, 'bank_fee'),
  c('کارمزد انتقال وجه ساتنا', 'out', 1_200_000, 'bank_fee'),
  c('کارمزد کارت', 'out', 500_000, 'bank_fee'),
  c('کارمزد خدمات بانکی', 'out', 80_000, 'bank_fee'),
  c('کارمزد برداشت', 'out', 12_000, 'bank_fee'),
  c('هزینه پیامک', 'out', 15_000, 'sms_fee'),
  c('کارمزد سرویس پیامک بانک', 'out', 36_000, 'sms_fee'),
  c('هزینه SMS ماهانه', 'out', 24_000, 'sms_fee'),
  c('حق الزحمه بانک', 'out', 90_000, 'bank_fee'),
  c('کارمزد پایا', 'out', 90_000_000, 'unknown'), // above the threshold: must ask
  // payroll
  c('پرداخت حقوق مهر ماه', 'out', 30_000_000, 'payroll'),
  c('دستمزد کارگران', 'out', 22_000_000, 'payroll'),
  c('پاداش پایان سال', 'out', 12_000_000, 'payroll'),
  c('عیدی کارکنان', 'out', 18_000_000, 'payroll'),
  c('اضافه کار شهریور', 'out', 4_000_000, 'payroll'),
  // loans
  c('کسر قسط وام', 'out', 8_000_000, 'loan'),
  c('اقساط تسهیلات', 'out', 15_000_000, 'loan'),
  c('پرداخت قسط وام مسکن', 'out', 6_000_000, 'loan'),
  c('واریز تسهیلات بانکی', 'in', 500_000_000, 'loan'),
  c('واریز وام سرمایه در گردش', 'in', 300_000_000, 'loan'),
  // tax
  c('پرداخت مالیات بر ارزش افزوده سازمان امور مالیاتی', 'out', 5_000_000, 'tax', 'legal'),
  c('پرداخت مالیات عملکرد', 'out', 40_000_000, 'tax'),
  c('عوارض ارزش افزوده فصل تابستان', 'out', 3_000_000, 'tax'),
  c('پرداخت مالیات علی الحساب', 'out', 9_000_000, 'tax'),
  // partner current account
  c('واریز از آقای علی رضایی جاری شریک', 'in', 20_000_000, 'partner_current', 'real'),
  c('برداشت شریک آقای حسین محمدی', 'out', 10_000_000, 'partner_current'),
  c('واریز سهامدار بابت سرمایه جاری شرکا', 'in', 50_000_000, 'partner_current'),
  c('علی الحساب شریک', 'out', 7_000_000, 'partner_current'),
  // sales
  c('واریز پایا از شرکت آلفا بابت فاکتور فروش 1201', 'in', 50_000_000, 'sale', 'legal'),
  c('دریافت از مشتری بابت فروش کالا', 'in', 12_000_000, 'sale'),
  c('تسویه فاکتور 4410 فروش', 'in', 33_000_000, 'sale'),
  c('پایا از شرکت گاما بابت فاکتور فروش', 'in', 18_000_000, 'sale', 'legal'),
  c('واریز بابت فروش خدمات', 'in', 9_000_000, 'sale'),
  // purchases
  c('انتقال پایا به شرکت بتا بابت فاکتور خرید 77', 'out', 12_000_000, 'purchase', 'legal'),
  c('پرداخت به تامین کننده مواد اولیه', 'out', 70_000_000, 'purchase'),
  c('بابت خرید تجهیزات اداری', 'out', 14_000_000, 'purchase'),
  c('پرداخت فاکتور خرید 903', 'out', 26_000_000, 'purchase'),
  // direction sanity: keyword with the wrong direction must ask
  c('بابت فروش', 'out', 5_000_000, 'unknown'),
  c('پرداخت حقوق', 'in', 5_000_000, 'unknown'),
  // genuinely ambiguous: must ask
  c('انتقال وجه', 'out', 3_000_000, 'unknown'),
  c('واریز متفرقه', 'in', 2_500_000, 'unknown'),
  c('پایا به آقای مهدی کریمی', 'out', 6_000_000, 'unknown', 'real'),
  c('کارت به کارت', 'out', 1_000_000, 'unknown'),
  c('برداشت نقدی', 'out', 4_000_000, 'unknown'),
  c('تعدیل', 'in', 1_000, 'unknown'),
];

/** Counterparties for the person-type check. */
export const PERSON_CASES: Array<{ description: string; person: PersonType }> = [
  { description: 'پایا از شرکت آلفا بابت فروش', person: 'legal' },
  { description: 'پایا از موسسه پژوهشی نوین بابت قرارداد', person: 'legal' },
  { description: 'پایا به سازمان تامین اجتماعی', person: 'legal' },
  { description: 'واریز از بانک ملت بابت تسهیلات', person: 'legal' },
  { description: 'پایا به آقای مهدی کریمی بابت خرید', person: 'real' },
  { description: 'واریز از خانم سارا احمدی بابت فروش', person: 'real' },
  { description: 'پایا از علی رضایی بابت فاکتور', person: 'real' },
  { description: 'برداشت نقدی', person: 'unknown' },
];
