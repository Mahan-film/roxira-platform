import { TaxEngineService } from './tax-engine.service';

describe('TaxEngineService (T180)', () => {
  function makeEngine() {
    const engine = new TaxEngineService();
    engine.registerTaxRules([
      { code: 'DE_STD', rateBps: 1900, effectiveFrom: '2020-01-01', effectiveTo: '2026-06-30', inputBox: 'DE_66', outputBox: 'DE_81' },
      { code: 'DE_STD', rateBps: 2000, effectiveFrom: '2026-07-01', effectiveTo: null, inputBox: 'DE_66', outputBox: 'DE_81' },
      { code: 'DE_RC_EU', rateBps: 1900, effectiveFrom: '2020-01-01', effectiveTo: '2026-06-30', reverseCharge: true, inputBox: 'DE_67', outputBox: 'DE_46' },
      { code: 'NR_RC_15', rateBps: 1500, effectiveFrom: '2020-01-01', effectiveTo: null, reverseCharge: true, inputBox: 'RC_IN', outputBox: 'RC_OUT' },
    ]);
    engine.registerWithholdingRules([
      { code: 'WHT_PAY_5', rateBps: 500, timing: 'PAYMENT', certificatePrefix: 'WHT' },
      { code: 'WHT_INV_10', rateBps: 1000, timing: 'INVOICE', certificatePrefix: 'WHTI' },
    ]);
    return engine;
  }

  it('resolves effective-dated rates and credit notes inherit original invoice tax point', () => {
    const engine = makeEngine();
    const creditNote = engine.calculate({
      country: 'DE',
      taxCode: 'DE_STD',
      netMinor: 100_000n,
      taxPointDate: '2026-07-10',
      documentKind: 'CREDIT_NOTE',
      originalInvoiceTaxPointDate: '2026-06-20',
    });
    expect(creditNote.rateBps).toBe(1900);
    expect(creditNote.taxMinor).toBe(19_000n);

    const newInvoice = engine.calculate({
      country: 'DE',
      taxCode: 'DE_STD',
      netMinor: 100_000n,
      taxPointDate: '2026-07-10',
      documentKind: 'INVOICE',
    });
    expect(newInvoice.rateBps).toBe(2000);
    expect(newInvoice.taxMinor).toBe(20_000n);
  });

  it('posts balanced reverse-charge lines (net VAT = 0) mapped to return boxes and separate deductibleDate', () => {
    const engine = makeEngine();
    const res = engine.calculate({
      country: 'DE',
      taxCode: 'DE_RC_EU',
      netMinor: 100_000n,
      taxPointDate: '2026-06-20',
      postingDate: '2026-06-25',
      deductibleDate: '2026-07-05',
      documentKind: 'BILL',
    });
    expect(res.reverseCharge).toBe(true);
    expect(res.netTaxImpactMinor).toBe(0n);
    expect(res.postingDate).toBe('2026-06-25');
    expect(res.deductibleDate).toBe('2026-07-05');
    expect(res.returnBoxes).toEqual({
      inputBox: 'DE_67',
      outputBox: 'DE_46',
      inputMinor: 19_000n,
      outputMinor: 19_000n,
    });
    const totalDr = res.journalLines.reduce((s, l) => s + l.debitMinor, 0n);
    const totalCr = res.journalLines.reduce((s, l) => s + l.creditMinor, 0n);
    expect(totalDr).toBe(totalCr);
    expect(res.journalLines.find((l) => l.taxBox === 'DE_67')?.deductibleDate).toBe('2026-07-05');
  });

  it('withholds at PAYMENT time vs INVOICE time with sequential certificates per year', () => {
    const engine = makeEngine();
    const atBill = engine.calculate({
      country: 'DE',
      taxCode: 'NR_RC_15',
      netMinor: 100_000n,
      taxPointDate: '2026-06-20',
      documentKind: 'BILL',
      withholdingCode: 'WHT_PAY_5',
      withholdingEvent: 'BILL',
    });
    expect(atBill.withholding.applied).toBe(false);
    expect(atBill.withholding.withheldMinor).toBe(0n);
    expect(atBill.withholding.certificateNumber).toBeNull();
    expect(atBill.taxMinor).toBe(15_000n);

    const pay1 = engine.calculate({
      country: 'DE',
      taxCode: 'NR_RC_15',
      netMinor: 100_000n,
      taxPointDate: '2026-06-20',
      postingDate: '2026-07-01',
      documentKind: 'BILL',
      withholdingCode: 'WHT_PAY_5',
      withholdingEvent: 'PAYMENT',
    });
    expect(pay1.withholding).toEqual({
      applied: true,
      timing: 'PAYMENT',
      withheldMinor: 5_000n,
      netPayableMinor: 95_000n,
      certificateNumber: 'WHT-2026-0001',
    });

    const pay2 = engine.calculate({
      country: 'DE',
      taxCode: 'NR_RC_15',
      netMinor: 200_000n,
      taxPointDate: '2026-06-20',
      postingDate: '2026-07-02',
      documentKind: 'BILL',
      withholdingCode: 'WHT_PAY_5',
      withholdingEvent: 'PAYMENT',
    });
    expect(pay2.withholding.certificateNumber).toBe('WHT-2026-0002');

    const invWht = engine.calculate({
      country: 'DE',
      taxCode: 'DE_STD',
      netMinor: 100_000n,
      taxPointDate: '2026-06-20',
      documentKind: 'INVOICE',
      withholdingCode: 'WHT_INV_10',
      withholdingEvent: 'BILL',
    });
    expect(invWht.withholding.applied).toBe(true);
    expect(invWht.withholding.withheldMinor).toBe(10_000n);
    expect(invWht.withholding.certificateNumber).toBe('WHTI-2026-0001');
  });

  it('preserves Iran VAT codes (9% before 1403, 10% from 1403, exempt 0%)', () => {
    const engine = makeEngine();
    const ir9 = engine.calculate({
      country: 'IR',
      taxCode: 'IR_VAT_9',
      netMinor: 1_000_000n,
      taxPointDate: '2024-03-19',
    });
    expect(ir9.rateBps).toBe(900);
    expect(ir9.taxMinor).toBe(90_000n);

    const ir10 = engine.calculate({
      country: 'IR',
      taxCode: 'IR_VAT_10',
      netMinor: 1_000_000n,
      taxPointDate: '2026-04-01',
    });
    expect(ir10.rateBps).toBe(1000);
    expect(ir10.taxMinor).toBe(100_000n);

    const irExempt = engine.calculate({
      country: 'IR',
      taxCode: 'IR_EXEMPT',
      netMinor: 1_000_000n,
      taxPointDate: '2026-04-01',
    });
    expect(irExempt.rateBps).toBe(0);
    expect(irExempt.taxMinor).toBe(0n);
  });
});
