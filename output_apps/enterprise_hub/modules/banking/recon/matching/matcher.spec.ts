import { BankItem, BookItem, findSubset, matchStatement } from './matcher';

let seq = 0;
const bank = (over: Partial<BankItem> = {}): BankItem => ({
  id: ++seq,
  date: '2024-09-22',
  amount: 5_000_000_00n,
  direction: 'in',
  reference: null,
  chequeNo: null,
  sayadId: null,
  description: '',
  ...over,
});
const book = (over: Partial<BookItem> = {}): BookItem => ({
  id: ++seq + 1000,
  date: '2024-09-22',
  amount: 5_000_000_00n,
  direction: 'in',
  entryNumber: 'JV-1',
  text: '',
  ...over,
});

describe('statement to ledger matching', () => {
  beforeEach(() => {
    seq = 0;
  });

  it('exact: same amount, direction and date is matched with high confidence', () => {
    const b = bank();
    const k = book();
    const result = matchStatement([b], [k]);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]).toMatchObject({ stage: 'exact', bankIds: [b.id], bookIds: [k.id] });
    expect(result.matched[0].confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.unmatchedBank).toEqual([]);
  });

  it('direction matters: a deposit never matches a payment of the same amount', () => {
    const result = matchStatement([bank()], [book({ direction: 'out' })]);
    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedBank).toHaveLength(1);
    expect(result.unmatchedBook).toHaveLength(1);
  });

  it('amount must be exact to the minor unit (no tolerance)', () => {
    const result = matchStatement([bank()], [book({ amount: 5_000_000_01n })]);
    expect(result.matched).toHaveLength(0);
  });

  it('date tolerance: 1 day is matched, 3 days is only suggested, 4 days is unmatched', () => {
    const one = matchStatement([bank()], [book({ date: '2024-09-23' })]);
    expect(one.matched[0].stage).toBe('date_tolerance');
    const three = matchStatement([bank()], [book({ date: '2024-09-25' })]);
    expect(three.matched).toHaveLength(0);
    expect(three.suggested).toHaveLength(1);
    expect(three.suggested[0].confidence).toBeLessThan(0.9);
    const four = matchStatement([bank()], [book({ date: '2024-09-26' })]);
    expect(four.suggested).toHaveLength(0);
    expect(four.unmatchedBank).toHaveLength(1);
  });

  it('the window is configurable per tenant', () => {
    const result = matchStatement([bank()], [book({ date: '2024-09-28' })], { windowDays: 7, autoMinConfidence: 0.5 });
    expect(result.matched).toHaveLength(1);
  });

  it('reference number in the voucher beats an equally good date candidate', () => {
    const b = bank({ reference: '700100123' });
    const right = book({ text: 'دریافت پیگیری 700100123', date: '2024-09-23' });
    const wrong = book({ date: '2024-09-22' });
    const result = matchStatement([b], [wrong, right]);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]).toMatchObject({ stage: 'reference', bookIds: [right.id] });
  });

  it('cheque number and Sayad id match even weeks later', () => {
    const cheque = bank({ direction: 'out', chequeNo: '123456', date: '2024-10-20' });
    const chequeBook = book({ direction: 'out', text: 'چک شماره 123456 به بتا', date: '2024-09-22' });
    const r1 = matchStatement([cheque], [chequeBook]);
    expect(r1.matched[0].stage).toBe('cheque');
    const sayad = bank({ direction: 'out', sayadId: '1403123456789012', date: '2024-10-20' });
    const sayadBook = book({ direction: 'out', text: 'صیاد 1403123456789012', date: '2024-09-22' });
    const r2 = matchStatement([sayad], [sayadBook]);
    expect(r2.matched[0].confidence).toBeGreaterThan(0.98);
  });

  it('short or generic references are not trusted', () => {
    const result = matchStatement([bank({ reference: '12' })], [book({ text: 'x 12', date: '2024-09-25' })]);
    expect(result.matched).toHaveLength(0);
  });

  it('two identical candidates are ambiguous: suggested, nothing claimed', () => {
    const result = matchStatement([bank()], [book(), book()]);
    expect(result.matched).toHaveLength(0);
    expect(result.suggested).toHaveLength(1);
    expect(result.suggested[0].reasons.join(' ')).toContain('یکی را انتخاب');
  });

  it('two identical bank lines and one voucher: neither is auto-matched', () => {
    const result = matchStatement([bank(), bank()], [book()]);
    expect(result.matched).toHaveLength(0);
    expect(result.suggested.length).toBeGreaterThanOrEqual(1);
  });

  it('two identical bank lines and two vouchers pair up one-to-one', () => {
    const result = matchStatement([bank({ date: '2024-09-22' }), bank({ date: '2024-09-24' })], [
      book({ date: '2024-09-22' }),
      book({ date: '2024-09-24' }),
    ]);
    expect(result.matched).toHaveLength(2);
  });

  it('many-to-one: one bank deposit equals several vouchers (suggested only)', () => {
    const b = bank({ amount: 9_000_000_00n });
    const parts = [3_000_000_00n, 2_000_000_00n, 4_000_000_00n].map((amount) => book({ amount }));
    const result = matchStatement([b], parts);
    expect(result.matched).toHaveLength(0);
    expect(result.suggested).toHaveLength(1);
    expect(result.suggested[0]).toMatchObject({ stage: 'many_to_one', bankIds: [b.id] });
    expect(result.suggested[0].bookIds.sort()).toEqual(parts.map((p) => p.id).sort());
  });

  it('one-to-many: several bank lines equal one voucher (suggested only)', () => {
    const k = book({ amount: 10_000_000_00n, direction: 'out' });
    const lines = [6_000_000_00n, 4_000_000_00n].map((amount) => bank({ amount, direction: 'out' }));
    const result = matchStatement(lines, [k]);
    expect(result.suggested).toHaveLength(1);
    expect(result.suggested[0].stage).toBe('one_to_many');
    expect(result.suggested[0].bankIds).toHaveLength(2);
  });

  it('a group that does not add up exactly is not suggested', () => {
    const result = matchStatement([bank({ amount: 9_000_000_00n })], [
      book({ amount: 3_000_000_00n }),
      book({ amount: 2_000_000_00n }),
    ]);
    expect(result.suggested).toHaveLength(0);
    expect(result.unmatchedBank).toHaveLength(1);
  });

  it('group search is bounded: a large pool is capped and still returns quickly', () => {
    const pool = Array.from({ length: 200 }, (_, i) => bank({ amount: BigInt(i + 1) * 1_00n, id: 5000 + i }));
    const started = Date.now();
    matchStatement([bank({ amount: 999_999_99n })], pool.map((p) => book({ amount: p.amount })));
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('findSubset prefers the smallest exact group and returns [] when none fits', () => {
    expect(findSubset([5n, 3n, 2n, 7n], 10n, 3)).toEqual([1, 3]);
    expect(findSubset([5n, 3n, 2n], 100n, 3)).toEqual([]);
  });

  it('every item ends in exactly one group (matched, suggested or unmatched)', () => {
    const banks = [bank(), bank({ amount: 7n }), bank({ amount: 9_000_000_00n })];
    const books = [book(), book({ amount: 11n }), book({ amount: 4_000_000_00n }), book({ amount: 5_000_000_00n })];
    const r = matchStatement(banks, books);
    const seenBank = [...r.matched, ...r.suggested].flatMap((g) => g.bankIds).concat(r.unmatchedBank);
    expect(new Set(seenBank).size).toBe(seenBank.length);
    expect(seenBank.sort()).toEqual(banks.map((x) => x.id).sort());
  });
});
