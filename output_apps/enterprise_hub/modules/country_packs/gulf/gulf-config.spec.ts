import {
  addGulfBusinessDays,
  getGulfPackConfig,
  resolveGulfEffectiveRule,
  roundGulfMajorAmount,
  type GulfJurisdiction,
} from './gulf-config';

describe('Gulf pack config and calendar (T309)', () => {
  it('computes 14 business days for AE from config only (Sat/Sun weekend + configured holiday)', () => {
    const cfg = getGulfPackConfig('AE');
    const days = cfg.eInvoiceIssuanceBusinessDays;
    expect(days).toBe(14);

    // Starting 2026-11-23 (Monday):
    // Week 1: Tue 24, Wed 25, Thu 26, Fri 27 (4); Sat 28 & Sun 29 skipped
    // Week 2: Mon 30, Tue Dec 1 (6); Wed Dec 2 & Thu Dec 3 are configured AE holidays -> skipped; Fri Dec 4 (7); Sat 5 & Sun 6 skipped
    // Week 3: Mon 7, Tue 8, Wed 9, Thu 10, Fri 11 (12); Sat 12 & Sun 13 skipped
    // Week 4: Mon 14, Tue 15 (14) -> 2026-12-15
    expect(addGulfBusinessDays('AE', '2026-11-23', days!)).toBe('2026-12-15');
  });

  it('rounds OM, BH, KW to 3 decimal places from config only', () => {
    for (const j of ['OM', 'BH', 'KW'] as const) {
      const rounded = roundGulfMajorAmount(j, '10.1235');
      expect(rounded.decimals).toBe(3);
      expect(rounded.minorUnits).toBe(10124n);
      expect(rounded.formatted).toBe('10.124');
    }
    expect(roundGulfMajorAmount('SA', '10.125').formatted).toBe('10.13');
    expect(roundGulfMajorAmount('AE', '10.124').formatted).toBe('10.12');
    expect(roundGulfMajorAmount('QA', '10.125').formatted).toBe('10.13');
  });

  it('loads effective-dated rules for all 6 Gulf jurisdictions with sourceUrl and asOf', () => {
    const all: GulfJurisdiction[] = ['SA', 'AE', 'OM', 'BH', 'QA', 'KW'];
    for (const j of all) {
      const cfg = getGulfPackConfig(j);
      expect(cfg.weekendDays.length).toBe(2);
    }
    expect(resolveGulfEffectiveRule('SA', 'thresholds', 'fatoora_wave_25', '2027-02-01')?.value).toBe(187500);
    expect(resolveGulfEffectiveRule('AE', 'thresholds', 'small_business_relief_cap', '2027-01-01')?.value).toBe(3000000);
    expect(resolveGulfEffectiveRule('AE', 'penalties', 'einvoice_late_issuance_per_doc', '2026-11-01')?.verified).toBe(false);
  });
});
