import { TaxEngineService } from './tax-engine.service';
import { InMemoryWhtCertificateSequenceStore, percentToBps } from './tax-engine.test-helpers';
import { TaxRateRule } from './tax-engine.types';

const SRC = 'test fixture';
const std = (over: Partial<TaxRateRule> & Pick<TaxRateRule, 'code' | 'rateBps' | 'effectiveFrom'>): TaxRateRule => ({
  country: 'DE',
  treatment: 'STANDARD',
  source: SRC,
  ...over,
});

describe('TaxEngineService (T180)', () => {
  function makeEngine(withStore = true) {
    const engine = new TaxEngineService(withStore ? new InMemoryWhtCertificateSequenceStore() : undefined);
    engine.registerTaxRules([
      std({ code: 'DE_STD', rateBps: percentToBps(19), effectiveFrom: '2020-01-01', effectiveTo: '2026-06-30', inputBox: 'DE_66', outputBox: 'DE_81' }),
      std({ code: 'DE_STD', rateBps: percentToBps(20), effectiveFrom: '2026-07-01', effectiveTo: null, inputBox: 'DE_66', outputBox: 'DE_81' }),
      std({ code: 'DE_RC_EU', rateBps: 1900, effectiveFrom: '2020-01-01', effectiveTo: '2026-06-30', reverseCharge: true, inputBox: 'DE_67', outputBox: 'DE_46' }),
      std({ code: 'NR_RC_15', rateBps: 1500, effectiveFrom: '2020-01-01', effectiveTo: null, reverseCharge: true, inputBox: 'RC_IN', outputBox: 'RC_OUT' }),
      std({ code: 'DE_ZERO', rateBps: 0, treatment: 'ZERO_RATE', effectiveFrom: '2020-01-01', outputBox: 'DE_ZERO' }),
      std({ code: 'DE_EXEMPT', rateBps: 0, treatment: 'EXEMPT', effectiveFrom: '2020-01-01', outputBox: 'DE_EXEMPT' }),
    ]);
    engine.registerWithholdingRules([
      { code: 'WHT_PAY_5', rateBps: 500, timing: 'PAYMENT', certificatePrefix: 'WHT' },
      { code: 'WHT_INV_10', rateBps: 1000, timing: 'INVOICE', certificatePrefix: 'WHTI' },
    ]);
    return engine;
  }
  const base = { country: 'DE', netMinor: 100_000n };

  it('percentToBps converts fixture percent to bps through one helper', () => {
    expect(percentToBps(19)).toBe(1900);
    expect(percentToBps(9.5)).toBe(950);
    expect(() => percentToBps(19.001)).toThrow('basis points');
  });

  it('rate changes exactly on the boundary day: day before vs the day itself', async () => {
    const engine = makeEngine();
    const before = await engine.calculate({ ...base, taxCode: 'DE_STD', taxPointDate: '2026-06-30' });
    const onDay = await engine.calculate({ ...base, taxCode: 'DE_STD', taxPointDate: '2026-07-01' });
    expect(before.rateBps).toBe(1900);
    expect(onDay.rateBps).toBe(2000);
  });

  it('open-ended interval keeps applying in the far future', async () => {
    const res = await makeEngine().calculate({ ...base, taxCode: 'DE_STD', taxPointDate: '2099-12-31' });
    expect(res.rateBps).toBe(2000);
  });

  it('throws when no rate exists (unknown code, before first rule, ended rule)', async () => {
    const engine = makeEngine();
    await expect(engine.calculate({ ...base, taxCode: 'NOPE', taxPointDate: '2026-01-01' })).rejects.toThrow('No tax rate rule');
    await expect(engine.calculate({ ...base, taxCode: 'DE_STD', taxPointDate: '2019-12-31' })).rejects.toThrow('No tax rate rule');
    await expect(engine.calculate({ ...base, taxCode: 'DE_RC_EU', taxPointDate: '2026-07-01', documentKind: 'BILL' })).rejects.toThrow('No tax rate rule');
  });

  it('rules never match another country (no wildcard country)', async () => {
    const engine = makeEngine();
    await expect(engine.calculate({ ...base, country: 'IR', taxCode: 'DE_STD', taxPointDate: '2026-01-01' })).rejects.toThrow('No tax rate rule');
    expect(() => engine.registerTaxRules([{ ...std({ code: 'X', rateBps: 100, effectiveFrom: '2020-01-01' }), country: '' }])).toThrow('requires a country');
  });

  it('rejects overlapping rules for the same country and code, accepts other countries', () => {
    const engine = makeEngine();
    expect(() => engine.registerTaxRules([std({ code: 'DE_STD', rateBps: 2100, effectiveFrom: '2026-06-30', effectiveTo: '2026-07-05' })])).toThrow('Overlapping tax rule');
    expect(() => engine.registerTaxRules([std({ code: 'DE_STD', rateBps: 700, effectiveFrom: '2026-06-30', country: 'AT' })])).not.toThrow();
  });

  it('registration requires a source and a consistent treatment', () => {
    const engine = makeEngine();
    expect(() => engine.registerTaxRules([std({ code: 'S', rateBps: 100, effectiveFrom: '2020-01-01', source: ' ' })])).toThrow('requires a source');
    expect(() => engine.registerTaxRules([std({ code: 'E', rateBps: 100, treatment: 'EXEMPT', effectiveFrom: '2020-01-01' })])).toThrow('requires rateBps 0');
  });

  it('credit note uses the original invoice date and requires it', async () => {
    const engine = makeEngine();
    const cn = (original: string | null) =>
      engine.calculate({ ...base, taxCode: 'DE_STD', taxPointDate: '2026-07-10', documentKind: 'CREDIT_NOTE', originalInvoiceTaxPointDate: original });
    expect((await cn('2026-06-30')).rateBps).toBe(1900);
    expect((await cn('2026-06-30')).taxMinor).toBe(19_000n);
    expect((await cn('2026-07-01')).rateBps).toBe(2000);
    await expect(cn(null)).rejects.toThrow('originalInvoiceTaxPointDate');
    const noDate = engine.calculate({ ...base, taxCode: 'DE_STD', taxPointDate: '2026-07-10', documentKind: 'CREDIT_NOTE' });
    await expect(noDate).rejects.toThrow('originalInvoiceTaxPointDate');
  });

  it('rounds half-up once on the document total in minor units (no per-line rounding)', async () => {
    const engine = makeEngine();
    // DE_STD is 19% here: 50 * 1900 / 10000 = 9.5 -> 10 (half rounds up)
    const half = await engine.calculate({ country: 'DE', taxCode: 'DE_STD', netMinor: 50n, taxPointDate: '2026-01-01' });
    expect(half.taxMinor).toBe(10n);
    const below = await engine.calculate({ country: 'DE', taxCode: 'DE_STD', netMinor: 7n, taxPointDate: '2026-01-01' });
    expect(below.taxMinor).toBe(1n); // 1.33 -> 1
    // Two 50-minor lines taxed separately would give 10 + 10 = 20; the document total 100 gives 19.
    const total = await engine.calculate({ country: 'DE', taxCode: 'DE_STD', netMinor: 100n, taxPointDate: '2026-01-01' });
    expect(total.taxMinor).toBe(19n);
  });

  it('exempt, zero-rate and standard are distinct treatments; reverse charge is decided by the rule', async () => {
    const engine = makeEngine();
    const zero = await engine.calculate({ ...base, taxCode: 'DE_ZERO', taxPointDate: '2026-01-01' });
    const exempt = await engine.calculate({ ...base, taxCode: 'DE_EXEMPT', taxPointDate: '2026-01-01' });
    expect([zero.treatment, exempt.treatment]).toEqual(['ZERO_RATE', 'EXEMPT']);
    expect([zero.taxMinor, exempt.taxMinor]).toEqual([0n, 0n]);
    await expect(engine.calculate({ ...base, taxCode: 'DE_EXEMPT', taxPointDate: '2026-01-01', reverseCharge: true })).rejects.toThrow('rule decides');
    expect(() => engine.registerTaxRules([std({ code: 'RCX', rateBps: 0, treatment: 'EXEMPT', reverseCharge: true, effectiveFrom: '2020-01-01' })])).toThrow('STANDARD');
  });

  it('posts balanced reverse-charge lines (net VAT = 0) mapped to return boxes and separate deductibleDate', async () => {
    const engine = makeEngine();
    const res = await engine.calculate({
      ...base,
      taxCode: 'DE_RC_EU',
      taxPointDate: '2026-06-20',
      postingDate: '2026-06-25',
      deductibleDate: '2026-07-05',
      documentKind: 'BILL',
    });
    expect(res.reverseCharge).toBe(true);
    expect(res.netTaxImpactMinor).toBe(0n);
    expect(res.returnBoxes).toEqual({ inputBox: 'DE_67', outputBox: 'DE_46', inputMinor: 19_000n, outputMinor: 19_000n });
    const totalDr = res.journalLines.reduce((s, l) => s + l.debitMinor, 0n);
    const totalCr = res.journalLines.reduce((s, l) => s + l.creditMinor, 0n);
    expect(totalDr).toBe(totalCr);
    expect(res.journalLines.find((l) => l.taxBox === 'DE_67')?.deductibleDate).toBe('2026-07-05');
  });

  it('sales reverse charge: invoice and credit note post net only with opposite signs', async () => {
    const engine = makeEngine();
    const run = (documentKind: 'INVOICE' | 'CREDIT_NOTE') =>
      engine.calculate({ ...base, taxCode: 'NR_RC_15', taxPointDate: '2026-06-20', documentKind, originalInvoiceTaxPointDate: '2026-06-20' });
    const inv = await run('INVOICE');
    const cn = await run('CREDIT_NOTE');
    expect(inv.taxMinor).toBe(0n);
    expect(inv.journalLines.find((l) => l.accountCode === '2010')).toMatchObject({ debitMinor: 100_000n, creditMinor: 0n });
    expect(inv.journalLines.find((l) => l.accountCode === '5010')).toMatchObject({ debitMinor: 0n, creditMinor: 100_000n });
    expect(cn.journalLines.find((l) => l.accountCode === '2010')).toMatchObject({ debitMinor: 0n, creditMinor: 100_000n });
    expect(cn.journalLines.find((l) => l.accountCode === '5010')).toMatchObject({ debitMinor: 100_000n, creditMinor: 0n });
  });

  it('withholds at PAYMENT time vs INVOICE time with sequential certificates per year', async () => {
    const engine = makeEngine();
    const atBill = await engine.calculate({ ...base, taxCode: 'NR_RC_15', taxPointDate: '2026-06-20', documentKind: 'BILL', withholdingCode: 'WHT_PAY_5', withholdingEvent: 'BILL' });
    expect(atBill.withholding.applied).toBe(false);
    expect(atBill.withholding.certificateNumber).toBeNull();
    expect(atBill.taxMinor).toBe(15_000n);

    const pay = (netMinor: bigint, postingDate: string) =>
      engine.calculate({ country: 'DE', netMinor, taxCode: 'NR_RC_15', taxPointDate: '2026-06-20', postingDate, documentKind: 'BILL', withholdingCode: 'WHT_PAY_5', withholdingEvent: 'PAYMENT' });
    expect((await pay(100_000n, '2026-07-01')).withholding).toEqual({
      applied: true,
      timing: 'PAYMENT',
      withheldMinor: 5_000n,
      netPayableMinor: 95_000n,
      certificateNumber: 'WHT-2026-0001',
    });
    expect((await pay(200_000n, '2026-07-02')).withholding.certificateNumber).toBe('WHT-2026-0002');

    const invWht = await engine.calculate({ ...base, taxCode: 'DE_STD', taxPointDate: '2026-06-20', documentKind: 'INVOICE', withholdingCode: 'WHT_INV_10' });
    expect(invWht.withholding.withheldMinor).toBe(10_000n);
    expect(invWht.withholding.certificateNumber).toBe('WHTI-2026-0001');
    expect(invWht.journalLines.find((l) => l.accountCode === '1420')?.debitMinor).toBe(10_000n);
    expect(invWht.journalLines.reduce((s, l) => s + l.debitMinor, 0n)).toBe(invWht.journalLines.reduce((s, l) => s + l.creditMinor, 0n));

    const billWht = await engine.calculate({ ...base, taxCode: 'DE_STD', taxPointDate: '2026-06-20', documentKind: 'BILL', withholdingCode: 'WHT_INV_10', certificateNumber: 'WHTI-2026-9001' });
    expect(billWht.withholding.certificateNumber).toBe('WHTI-2026-9001');
    expect(billWht.journalLines.find((l) => l.accountCode === '2010')?.creditMinor).toBe(109_000n);
    expect(billWht.journalLines.reduce((s, l) => s + l.debitMinor, 0n)).toBe(billWht.journalLines.reduce((s, l) => s + l.creditMinor, 0n));

    // Credit note with WHT reverses the invoice withholding line
    const cnWht = await engine.calculate({
      ...base,
      taxCode: 'DE_STD',
      taxPointDate: '2026-06-20',
      documentKind: 'CREDIT_NOTE',
      originalInvoiceTaxPointDate: '2026-06-20',
      withholdingCode: 'WHT_INV_10',
      certificateNumber: 'WHTI-2026-9002',
    });
    expect(cnWht.withholding.withheldMinor).toBe(10_000n);
    expect(cnWht.journalLines.find((l) => l.accountCode === '1420')?.creditMinor).toBe(10_000n);
    expect(cnWht.journalLines.reduce((s, l) => s + l.debitMinor, 0n)).toBe(cnWht.journalLines.reduce((s, l) => s + l.creditMinor, 0n));

    // Customer receipt payment (docKind: INVOICE): debits bank net and whtReceivable, credits AR
    const receiptPay = await engine.calculate({
      country: 'DE',
      netMinor: 100_000n,
      taxCode: 'NR_RC_15',
      taxPointDate: '2026-06-20',
      postingDate: '2026-07-03',
      documentKind: 'INVOICE',
      withholdingCode: 'WHT_PAY_5',
      withholdingEvent: 'PAYMENT',
    });
    expect(receiptPay.withholding.withheldMinor).toBe(5_000n);
    expect(receiptPay.journalLines.find((l) => l.accountCode === '1010')?.debitMinor).toBe(95_000n); // Bank
    expect(receiptPay.journalLines.find((l) => l.accountCode === '1420')?.debitMinor).toBe(5_000n); // WHT Receivable
    expect(receiptPay.journalLines.find((l) => l.accountCode === '2010')?.creditMinor).toBe(100_000n); // AR
    expect(receiptPay.journalLines.reduce((s, l) => s + l.debitMinor, 0n)).toBe(receiptPay.journalLines.reduce((s, l) => s + l.creditMinor, 0n));
  });

  it('WHT certificate store is mandatory: no in-memory fallback', async () => {
    const engine = makeEngine(false);
    await expect(
      engine.calculate({ ...base, taxCode: 'DE_STD', taxPointDate: '2026-06-20', withholdingCode: 'WHT_INV_10' }),
    ).rejects.toThrow('sequence store is not configured');
    // A pre-allocated number needs no store; VAT without withholding still works.
    await expect(engine.calculate({ ...base, taxCode: 'DE_STD', taxPointDate: '2026-06-20' })).resolves.toBeDefined();
  });

  it('default-pack rules load from the config file (9% to the boundary day, 10% after, exempt)', async () => {
    const engine = new TaxEngineService();
    const calc = (taxCode: string, taxPointDate: string) =>
      engine.calculate({ country: 'IR', taxCode, netMinor: 1_000_000n, taxPointDate });
    expect((await calc('IR_VAT_9', '2024-03-19')).taxMinor).toBe(90_000n);
    expect((await calc('IR_VAT_10', '2024-03-20')).taxMinor).toBe(100_000n);
    await expect(calc('IR_VAT_10', '2024-03-19')).rejects.toThrow('No tax rate rule');
    expect((await calc('IR_EXEMPT', '2026-04-01')).treatment).toBe('EXEMPT');
  });
});
