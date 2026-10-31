import { writeFileSync } from 'fs';
import { join } from 'path';
import {
  buildHistory,
  classify,
  ClassifierContext,
  CONFIDENT,
  DEFAULT_CLASSIFIER_SETTINGS,
  extractCounterparty,
  personTypeOf,
  TenantRule,
} from './classifier';
import { EVAL_CASES, PERSON_CASES } from './classification-eval.data';
import { maskForLlm } from './mask';
import { applyAnswer, classificationQuestion, matchQuestion } from '../questions';

const ctx = (over: Partial<ClassifierContext> = {}): ClassifierContext => ({
  settings: DEFAULT_CLASSIFIER_SETTINGS,
  rules: [],
  history: new Map(),
  ownAccounts: [],
  ...over,
});

const item = (description: string, direction: 'in' | 'out' = 'out', amountRial = 1_000_000n, id = 1) => ({
  id,
  direction,
  amountRial,
  description,
});

describe('fee rules with tenant-editable thresholds', () => {
  it('a small bank fee is classified and eligible for auto-post', () => {
    const result = classify(item('کارمزد پایا', 'out', 350_000n), ctx());
    expect(result).toMatchObject({ category: 'bank_fee', source: 'fee_rule', autoPostEligible: true });
    expect(result.confidence).toBeGreaterThanOrEqual(CONFIDENT);
  });

  it('SMS fees have their own threshold', () => {
    expect(classify(item('هزینه پیامک', 'out', 15_000n), ctx()).category).toBe('sms_fee');
    const strict = ctx({ settings: { feeMaxRial: 5_000_000n, smsFeeMaxRial: 10_000n } });
    const over = classify(item('هزینه پیامک', 'out', 15_000n), strict);
    expect(over.autoPostEligible).toBe(false);
    expect(over.confidence).toBeLessThan(CONFIDENT);
  });

  it('raising the threshold turns a questioned fee into a confident one', () => {
    const big = item('کارمزد انتقال', 'out', 8_000_000n);
    expect(classify(big, ctx()).confidence).toBeLessThan(CONFIDENT);
    const raised = ctx({ settings: { feeMaxRial: 10_000_000n, smsFeeMaxRial: 500_000n } });
    expect(classify(big, raised)).toMatchObject({ category: 'bank_fee', autoPostEligible: true });
  });

  it('a deposit that mentions a fee (refund) is not a fee rule hit', () => {
    expect(classify(item('بازگشت کارمزد', 'in', 12_000n), ctx()).autoPostEligible).toBe(false);
  });
});

describe('counterparties, person type and tenant knowledge', () => {
  it('extracts the counterparty name and the person type', () => {
    expect(extractCounterparty('پایا به آقای مهدی کریمی بابت خرید')?.name).toBe('مهدی کریمی');
    expect(personTypeOf('شرکت آلفا')).toBe('legal');
    expect(personTypeOf('مهدی کریمی')).toBe('real');
    expect(personTypeOf(null)).toBe('unknown');
  });

  it('person type accuracy on the labelled counterparties', () => {
    const wrong = PERSON_CASES.filter(
      (p) => classify(item(p.description), ctx()).personType !== p.person,
    );
    expect(wrong).toEqual([]);
  });

  it('own-account transfer is detected by account number or IBAN, from other accounts only', () => {
    const own = ctx({
      ownAccounts: [{ accountNumber: '0102345678001', iban: null, names: [] }],
    });
    const result = classify(item('انتقال به حساب 0102345678001 ملت'), own);
    expect(result).toMatchObject({ category: 'own_transfer', source: 'own_account' });
    expect(classify(item('انتقال به حساب 9999999999'), own).category).not.toBe('own_transfer');
  });

  it('tenant history only counts when consistent and repeated', () => {
    const history = buildHistory([
      { counterpartyKey: 'شرکت آلفا', category: 'sale' },
      { counterpartyKey: 'شرکت آلفا', category: 'sale' },
      { counterpartyKey: 'شرکت آلفا', category: 'sale' },
      { counterpartyKey: 'شرکت دلتا', category: 'sale' },
      { counterpartyKey: 'شرکت دلتا', category: 'purchase' },
    ]);
    const known = classify(item('پایا از شرکت آلفا', 'in'), ctx({ history }));
    expect(known).toMatchObject({ category: 'sale', source: 'history' });
    const mixed = classify(item('پایا از شرکت دلتا', 'in'), ctx({ history }));
    expect(mixed.source).not.toBe('history');
  });

  it('a tenant rule beats built-in keywords', () => {
    const rule: TenantRule = {
      id: 1,
      kind: 'counterparty',
      pattern: 'شرکت آلفا',
      category: 'partner_current',
      personType: 'legal',
      counterAccountCode: '3030',
    };
    const result = classify(item('پایا از شرکت آلفا بابت فروش', 'in'), ctx({ rules: [rule] }));
    expect(result).toMatchObject({ category: 'partner_current', source: 'tenant_rule', counterAccountCode: '3030' });
  });

  it('rules of one tenant context never leak into another', () => {
    const rule: TenantRule = { id: 1, kind: 'keyword', pattern: 'ویژه', category: 'sale', personType: null, counterAccountCode: null };
    expect(classify(item('پرداخت ویژه', 'in'), ctx({ rules: [rule] })).category).toBe('sale');
    expect(classify(item('پرداخت ویژه', 'in'), ctx()).category).toBe('unknown');
  });
});

describe('questions and reusable rules', () => {
  it('asks one short question with suggested choices and evidence for an unknown item', () => {
    const it1 = item('انتقال وجه', 'out', 3_000_000n);
    const q = classificationQuestion(
      { ...it1, date: '2024-09-22' },
      classify(it1, ctx()),
    )!;
    expect(q.kind).toBe('classify');
    expect(q.text.length).toBeLessThan(120);
    expect(q.choices.length).toBeLessThanOrEqual(6);
    expect(q.choices[q.choices.length - 1].id).toBe('skip');
    expect(q.evidence.join(' ')).toContain('انتقال وجه');
    expect(q.acceptsAttachment).toBe(true);
  });

  it('does not ask when the classifier is confident', () => {
    const it1 = item('کارمزد پایا', 'out', 350_000n);
    expect(classificationQuestion({ ...it1, date: '2024-09-22' }, classify(it1, ctx()))).toBeNull();
  });

  it('an answer about a known counterparty becomes a reusable rule that then classifies silently', () => {
    const it1 = item('پایا به آقای مهدی کریمی', 'out', 6_000_000n);
    const first = classify(it1, ctx());
    const q = classificationQuestion({ ...it1, date: '2024-09-22' }, first)!;
    const outcome = applyAnswer(q, 'purchase', first, { counterAccountCode: '5010' })!;
    expect(outcome.rule).toMatchObject({ kind: 'counterparty', pattern: 'مهدی کریمی', category: 'purchase' });
    const rule: TenantRule = { id: 1, ...outcome.rule!, personType: outcome.rule!.personType };
    const second = classify(item('پایا به مهدی کریمی بابت چیز دیگر', 'out', 9_000_000n, 2), ctx({ rules: [rule] }));
    expect(second).toMatchObject({ category: 'purchase', source: 'tenant_rule', counterAccountCode: '5010' });
  });

  it('no rule is invented without a counterparty or an explicit keyword; "skip" is not an answer', () => {
    const it1 = item('برداشت نقدی', 'out');
    const first = classify(it1, ctx());
    const q = classificationQuestion({ ...it1, date: '2024-09-22' }, first)!;
    expect(applyAnswer(q, 'tax', first)!.rule).toBeNull();
    expect(applyAnswer(q, 'tax', first, { keyword: 'برداشت نقدی ATM' })!.rule?.kind).toBe('keyword');
    expect(applyAnswer(q, 'skip', first)).toBeNull();
    expect(applyAnswer(q, 'nonsense', first)).toBeNull();
  });

  it('match confirmation question carries the evidence', () => {
    const q = matchQuestion(
      { id: 'g1', stage: 'many_to_one', bankIds: [1], bookIds: [2, 3], confidence: 0.7, reasons: ['مجموع ۲ سند'] },
      { id: 1, direction: 'in', amountRial: 9_000_000n, date: '2024-09-22', description: 'x' },
    );
    expect(q.choices.map((c) => c.id)).toEqual(['yes', 'no']);
    expect(q.evidence.join(' ')).toContain('70');
  });
});

describe('LLM masking', () => {
  it('masks names, IBANs, card, phone, national id and long numbers', () => {
    const masked = maskForLlm(
      'پایا به آقای مهدی کریمی IR062960000000100324200001 کارت 6037991234567890 تلفن 09121234567 کدملی 0012345678 پیگیری 7001000123',
    );
    expect(masked).not.toMatch(/کریمی|مهدی|IR06|6037991234567890|09121234567|0012345678|7001000123/i);
    expect(masked).toContain('[NAME]');
    expect(masked).toContain('[IBAN]');
  });

  it('masks tenant-supplied names even when the pattern does not find them', () => {
    expect(maskForLlm('تسویه با پدرام نوری', ['پدرام نوری'])).toBe('تسویه با [NAME]');
  });
});

describe('classification accuracy on the labelled set', () => {
  const results = EVAL_CASES.map((testCase) => {
    const out = classify(
      { id: 1, direction: testCase.direction, amountRial: testCase.amountRial, description: testCase.description },
      ctx(),
    );
    const decided = out.confidence >= CONFIDENT && out.category !== 'unknown';
    const predicted = decided ? out.category : 'unknown';
    return { testCase, predicted, decided };
  });

  it('meets the accuracy floor and never makes a confident wrong call', () => {
    const total = results.length;
    const correct = results.filter((r) => r.predicted === r.testCase.category).length;
    const confident = results.filter((r) => r.decided);
    const confidentWrong = confident.filter((r) => r.predicted !== r.testCase.category);
    const mustAsk = results.filter((r) => r.testCase.category === 'unknown');
    const askedCorrectly = mustAsk.filter((r) => !r.decided).length;
    const perCategory = new Map<string, { n: number; ok: number }>();
    for (const r of results) {
      const entry = perCategory.get(r.testCase.category) ?? { n: 0, ok: 0 };
      entry.n += 1;
      entry.ok += r.predicted === r.testCase.category ? 1 : 0;
      perCategory.set(r.testCase.category, entry);
    }
    if (process.env.EVAL_WRITE) {
      const lines = [
        '# Bank statement classification: evaluation',
        '',
        `Generated by \`npx jest modules/banking/recon/classify --testNamePattern accuracy\` with \`EVAL_WRITE=1\`.`,
        '',
        '**Read this first:** the labelled set is synthetic (written by the implementer from typical',
        'internet-bank phrasing). It measures whether the rules behave as designed, not accuracy on',
        'real customer statements. Replace `classification-eval.data.ts` with owner-labelled real',
        'statements (masked) and re-run before relying on these numbers.',
        '',
        '| Metric | Value |',
        '| --- | --- |',
        `| Items | ${total} |`,
        `| Correct (a "must ask" item counts as correct when it was asked) | ${correct}/${total} (${((100 * correct) / total).toFixed(1)}%) |`,
        `| Decided automatically (confidence >= ${CONFIDENT}) | ${confident.length}/${total} |`,
        `| Decided automatically and wrong | ${confidentWrong.length} |`,
        `| Items that must go to a person | ${mustAsk.length}, asked: ${askedCorrectly} |`,
        '',
        '| Category | Items | Correct |',
        '| --- | --- | --- |',
        ...[...perCategory.entries()].map(([k, v]) => `| ${k} | ${v.n} | ${v.ok} |`),
        '',
        'Known limits: only built-in keywords, thresholds, own accounts, tenant rules and history are',
        'used (no model). Sale vs purchase without a keyword is always asked. Person type is a name',
        'heuristic (legal keywords vs 2-4 word names).',
        '',
      ];
      writeFileSync(join(__dirname, '../../../../../../docs/eval/bank-classification-eval.md'), lines.join('\n'));
    }
    expect(confidentWrong.map((r) => r.testCase.description)).toEqual([]);
    expect(correct / total).toBeGreaterThanOrEqual(0.9);
    expect(askedCorrectly).toBe(mustAsk.length);
  });
});
