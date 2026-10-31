import { toAsciiDigits, fixPersianChars } from '../../data_import/normaliser/normalise';
import { EvalCase } from './dataset';

/**
 * Deterministic regex "extractor" over the synthetic invoice TEXT. It is NOT a model: it exists to
 * (a) check the scorer and the parse/validate pipeline offline, and (b) give a floor that any model
 * has to beat. It returns the same JSON shape the model is asked for.
 */
export function baselineExtract(testCase: EvalCase): string {
  const text = fixPersianChars(testCase.text);
  const ascii = toAsciiDigits(text);
  const grab = (re: RegExp, source = text): string => (re.exec(source)?.[1] ?? '').trim();

  const sellerName = grab(/فروشنده\s*:\s*(.+)/);
  const buyerName = grab(/خریدار\s*:\s*(.+)/);
  const taxId = grab(/شناسه ملی\s*:\s*(\d+)/, ascii);
  const number = grab(/شماره\s*:\s*(\d+)/, ascii);
  const date = grab(/تاریخ\s*:\s*([\d/-]+)/, ascii);
  const currency = /تومان/.test(text) ? 'تومان' : /USD/.test(text) ? 'USD' : 'ریال';

  const items = ascii
    .split('\n')
    .filter((l) => /^\d+ \|/.test(l))
    .map((l) => l.split('|').map((c) => c.trim()))
    .map((c) => ({ description: c[1], quantity: c[2], unit_price: c[3], total: c[4] }));
  const money = (label: RegExp): string | null => {
    const m = label.exec(ascii);
    return m ? m[1] : null;
  };
  const subtotal = money(/جمع کل قبل از مالیات\s*:\s*([\d,٬.]+)/);
  const tax = money(/مالیات بر ارزش افزوده[^:]*:\s*([\d,٬.]+)/) ?? '0';
  const total = money(/مبلغ قابل پرداخت\s*:\s*([\d,٬.]+)/);

  return JSON.stringify({
    kind: /فاکتور فروش$/m.test(text) ? 'sales' : 'purchase',
    seller: { name: sellerName, tax_id: taxId },
    buyer: { name: buyerName, tax_id: '' },
    invoice_number: number,
    date,
    currency,
    items,
    subtotal,
    tax,
    total,
    paid: /پرداخت شد/.test(text),
    confidence: { seller: 0.9, buyer: 0.9, tax_id: 0.9, invoice_number: 0.9, date: 0.9, items: 0.9, tax: 0.9, total: 0.9 },
  });
}
