import {
  listDeRetentionRules,
  resolveDeRetentionRule,
} from './retention-clocks';

describe('DE retention clocks (effective-dated config)', () => {
  it('resolves 10 years for ledgers and statements', () => {
    const rule = resolveDeRetentionRule('ledgers_and_statements', '2026-11-24');
    expect(rule.years).toBe(10);
    expect(rule.sourceUrl).toMatch(/^https:\/\//);
  });

  it('resolves 8 years for accounting vouchers on/after 2025-01-01 (BEG IV) and 10 years before', () => {
    expect(resolveDeRetentionRule('accounting_vouchers', '2024-12-31').years).toBe(10);
    expect(resolveDeRetentionRule('accounting_vouchers', '2025-01-01').years).toBe(8);
    expect(resolveDeRetentionRule('accounting_vouchers', '2026-11-24').years).toBe(8);
  });

  it('resolves 6 years for commercial correspondence', () => {
    expect(resolveDeRetentionRule('commercial_correspondence', '2026-11-24').years).toBe(6);
  });

  it('marks every entry with sourceUrl, effectiveFrom, and verified flag', () => {
    for (const rule of listDeRetentionRules()) {
      expect(rule.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(rule.sourceUrl).toMatch(/^https:\/\//);
      expect(typeof rule.verified).toBe('boolean');
    }
  });
});
