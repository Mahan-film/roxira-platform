import { parseExtraction } from '../domain/extraction-schema';
import { baselineExtract } from './baseline-extractor';
import { buildDataset } from './dataset';
import { EVAL_FIELDS, scoreCase, summarise } from './score';

describe('invoice capture evaluation set', () => {
  const cases = buildDataset();

  it('has at least 30 deterministic synthetic invoices over distinct variants', () => {
    expect(cases.length).toBeGreaterThanOrEqual(30);
    expect(new Set(cases.map((c) => c.variant)).size).toBeGreaterThanOrEqual(10);
    expect(buildDataset().map((c) => c.text)).toEqual(cases.map((c) => c.text));
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });

  it('ground truth is arithmetically consistent', () => {
    for (const c of cases) {
      const sum = c.truth.itemTotals.reduce((s, t) => s + BigInt(t.replace('.', '')), 0n);
      expect(sum).toBe(BigInt(c.truth.subtotal.replace('.', '')));
      expect(BigInt(c.truth.subtotal.replace('.', '')) + BigInt(c.truth.tax.replace('.', ''))).toBe(BigInt(c.truth.total.replace('.', '')));
    }
  });

  it('the scorer gives full credit to the truth and none to a wrong draft', () => {
    const c = cases[0];
    const perfect = parseExtraction(baselineExtract(c), c.text).draft;
    expect(EVAL_FIELDS.every((f) => scoreCase(perfect, c.truth)[f])).toBe(true);
    const wrong = { ...perfect, total: '1.00', date: '2000-01-01' };
    const r = scoreCase(wrong, c.truth);
    expect(r.total).toBe(false);
    expect(r.date).toBe(false);
    expect(Object.values(scoreCase(null, c.truth)).some(Boolean)).toBe(false);
  });

  it('the offline baseline floor handles clean Persian/Arabic/Latin digits, toman and USD end to end', () => {
    const results = cases.map((c) => scoreCase(parseExtraction(baselineExtract(c), c.text).draft, c.truth));
    const clean = cases.map((c, i) => ({ c, r: results[i] })).filter(({ c }) => c.variant !== 'ocr_noise');
    expect(clean.every(({ r }) => EVAL_FIELDS.every((f) => r[f]))).toBe(true);
    expect(summarise(results).allCriticalCorrect).toBeGreaterThan(0.9);
  });
});
