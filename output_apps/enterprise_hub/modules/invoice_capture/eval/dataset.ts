import { jalaliToGregorian } from '../../data_import/normaliser/normalise';

/** Ground truth of one synthetic invoice (money = exact IRR decimal strings). */
export interface EvalTruth {
  kind: 'purchase' | 'sales';
  sellerName: string;
  sellerTaxId: string;
  buyerName: string;
  invoiceNumber: string;
  date: string;
  currency: string;
  itemTotals: string[];
  subtotal: string;
  tax: string;
  total: string;
  paid: boolean;
}

export interface EvalCase {
  id: string;
  variant: string;
  /** What OCR / a PDF text layer would hand the model (no real OCR engine is simulated beyond noise). */
  text: string;
  truth: EvalTruth;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FA = '۰۱۲۳۴۵۶۷۸۹';
const AR = '٠١٢٣٤٥٦٧٨٩';
const toDigits = (s: string, set: string): string => s.replace(/\d/g, (d) => set[Number(d)]);

const SELLERS = [
  'شرکت پخش البرز', 'فروشگاه زنجیره‌ای افق کوروش', 'مجتمع صنعتی کاوه پلاستیک', 'شرکت نرم‌افزاری داده‌پردازان پارس',
  'بازرگانی نیک‌اندیشان', 'تعاونی مصرف کارکنان صنعت', 'شرکت لوازم اداری آرمان', 'کارخانه نساجی زرین‌بافت',
  'شرکت حمل و نقل سریع‌السیر', 'آژانس تبلیغاتی رنگین‌کمان', 'شرکت ساختمانی بنیاد سازه', 'داروخانه دکتر رضایی',
];
const BUYERS = ['شرکت آریا تجارت شرق', 'مؤسسه فرهنگی سپهر', 'شرکت فنی مهندسی پایا', 'فروشگاه ستاره شمال', 'گروه صنعتی ایمان'];
const ITEMS: Array<[string, number]> = [
  ['کاغذ A4 بسته ۵۰۰ برگی', 185_000], ['جوهر چاپگر اچ‌پی', 1_450_000], ['خدمات مشاوره ماهانه', 12_000_000],
  ['اجاره دفتر کار', 45_000_000], ['حمل بار داخل شهری', 3_200_000], ['میز اداری مدل ۲۲۰', 8_900_000],
  ['طراحی لوگو و هویت بصری', 18_500_000], ['نگهداری و پشتیبانی سامانه', 9_750_000], ['ورق گالوانیزه ۲ میل', 62_000_000],
  ['چاپ بروشور رنگی', 6_400_000], ['بسته‌بندی صنعتی', 2_150_000], ['کابل شبکه CAT6', 740_000],
];

/** A valid 10-digit Iranian national code (checksum satisfied). */
function nationalCode(rand: () => number): string {
  for (;;) {
    const d = Array.from({ length: 9 }, () => Math.floor(rand() * 10));
    const s = d.reduce((acc, x, i) => acc + x * (10 - i), 0) % 11;
    const check = s < 2 ? s : 11 - s;
    const id = [...d, check].join('');
    if (!/^(\d)\1+$/.test(id)) {
      return id;
    }
  }
}

function legalId(rand: () => number): string {
  const coef = [29, 27, 23, 19, 17, 29, 27, 23, 19, 17];
  const d = Array.from({ length: 10 }, () => Math.floor(rand() * 10));
  const k = d[9] + 2;
  let r = coef.reduce((acc, c, i) => acc + (d[i] + k) * c, 0) % 11;
  if (r === 10) {
    r = 0;
  }
  return [...d, r].join('');
}

const group = (n: number, sep: string): string => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, sep);

const VARIANTS = [
  'clean_fa_digits', 'latin_digits', 'arabic_digits', 'toman', 'no_vat', 'multi_item',
  'ocr_noise', 'missing_tax_id', 'foreign_usd', 'paid_cash', 'sales', 'compact_date',
] as const;

/** Letters an OCR engine commonly confuses in Persian print (Arabic yeh/kaf, dropped ZWNJ, spacing). */
function ocrNoise(text: string, rand: () => number): string {
  return text
    .replace(/ی/g, () => (rand() < 0.6 ? 'ي' : 'ی'))
    .replace(/ک/g, () => (rand() < 0.6 ? 'ك' : 'ک'))
    .replace(/‌/g, () => (rand() < 0.5 ? '' : ' '))
    .replace(/ {1}/g, () => (rand() < 0.1 ? '  ' : ' '))
    .replace(/:/g, () => (rand() < 0.2 ? ' :' : ':'));
}

/** 36 deterministic synthetic Persian invoices: 12 variants x 3 seeds. */
export function buildDataset(): EvalCase[] {
  const cases: EvalCase[] = [];
  VARIANTS.forEach((variant, vi) => {
    for (let k = 0; k < 3; k += 1) {
      const rand = mulberry32(1000 * (vi + 1) + k);
      const pick = <T,>(list: T[]): T => list[Math.floor(rand() * list.length)];
      const sales = variant === 'sales';
      const ourName = pick(BUYERS);
      const otherName = pick(SELLERS);
      const sellerName = sales ? ourName : otherName;
      const buyerName = sales ? otherName : ourName;
      const taxId = variant === 'missing_tax_id' ? '' : rand() < 0.5 ? nationalCode(rand) : legalId(rand);

      const count = variant === 'multi_item' ? 5 + Math.floor(rand() * 4) : 1 + Math.floor(rand() * 3);
      const rows = Array.from({ length: count }, () => {
        const [desc, unit0] = pick(ITEMS);
        const unit = variant === 'foreign_usd' ? Math.max(1, Math.round(unit0 / 1_000_000)) : unit0;
        const qty = 1 + Math.floor(rand() * 9);
        return { desc, qty, unit, total: qty * unit };
      });
      const subtotal = rows.reduce((s, r) => s + r.total, 0);
      const tax = variant === 'no_vat' ? 0 : Math.round(subtotal * 0.1);
      const total = subtotal + tax;

      const jy = 1404 + Math.floor(rand() * 2);
      const jm = 1 + Math.floor(rand() * 12);
      const jd = 1 + Math.floor(rand() * 28);
      const g = jalaliToGregorian(jy, jm, jd);
      const date = `${g.gy}-${String(g.gm).padStart(2, '0')}-${String(g.gd).padStart(2, '0')}`;
      const jdate = `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
      const number = String(1000 + Math.floor(rand() * 8999));

      const toman = variant === 'toman';
      const usd = variant === 'foreign_usd';
      const div = toman ? 10 : 1;
      const paid = variant === 'paid_cash';

      // The truth is what the ledger needs: IRR (toman x10). USD invoices are scored on the printed
      // USD amounts (the exchange rate is a human step).
      const amount = (n: number): number => n / div;
      const fmt = (n: number): string => {
        const v = amount(n);
        if (variant === 'latin_digits' || usd) {
          return group(v, ',');
        }
        return toDigits(group(v, '٬'), variant === 'arabic_digits' ? AR : FA);
      };
      const latin = variant === 'latin_digits' || usd;
      const num = (s: string): string => (latin ? s : toDigits(s, variant === 'arabic_digits' ? AR : FA));
      const unitLabel = usd ? 'USD' : toman ? 'تومان' : 'ریال';
      const dateText = variant === 'compact_date' ? num(jdate.replace(/\//g, '-')) : num(jdate);

      const lines = [
        sales ? 'فاکتور فروش' : 'صورتحساب فروش کالا و خدمات',
        `شماره: ${num(number)}`,
        `تاریخ: ${dateText}`,
        `فروشنده: ${sellerName}`,
        taxId ? `شناسه ملی: ${num(taxId)}   کد اقتصادی: ${num('411' + taxId.slice(0, 9))}` : 'شناسه ملی:',
        `خریدار: ${buyerName}`,
        'ردیف | شرح کالا یا خدمات | تعداد | مبلغ واحد | مبلغ کل',
        ...rows.map((r, i) => `${num(String(i + 1))} | ${r.desc} | ${num(String(r.qty))} | ${fmt(r.unit)} | ${fmt(r.total)}`),
        `جمع کل قبل از مالیات: ${fmt(subtotal)} ${unitLabel}`,
        variant === 'no_vat' ? 'مالیات بر ارزش افزوده: ۰ (معاف)' : `مالیات بر ارزش افزوده (${num('10')}٪): ${fmt(tax)} ${unitLabel}`,
        `مبلغ قابل پرداخت: ${fmt(total)} ${unitLabel}`,
        paid ? 'نحوه پرداخت: نقدی - پرداخت شد' : 'نحوه پرداخت: نسیه',
      ];
      let text = lines.join('\n');
      if (variant === 'ocr_noise') {
        text = ocrNoise(text, rand);
      }

      const money = (n: number): string => `${n}.00`;
      cases.push({
        id: `inv-${String(cases.length + 1).padStart(2, '0')}`,
        variant,
        text,
        truth: {
          kind: sales ? 'sales' : 'purchase',
          sellerName,
          sellerTaxId: taxId,
          buyerName,
          invoiceNumber: number,
          date,
          currency: usd ? 'USD' : 'IRR',
          itemTotals: rows.map((r) => money(r.total)).sort(),
          subtotal: money(subtotal),
          tax: money(tax),
          total: money(total),
          paid,
        },
      });
    }
  });
  return cases;
}
