import { POLICY_REGISTRY, getPolicyDefinition, policyDefault, validatePolicyValue } from './policy.registry';

const ARABIC_SCRIPT = /[\u0600-\u06FF]/;

describe('policy registry (#585)', () => {
  it('gives every definition a valid group, a Persian label and a default its own validator accepts', () => {
    for (const definition of POLICY_REGISTRY) {
      expect(['A', 'B', 'C']).toContain(definition.group);
      expect(definition.labelFa.trim().length).toBeGreaterThan(0);
      expect(ARABIC_SCRIPT.test(definition.labelFa)).toBe(true);
      expect(definition.descriptionFa.trim().length).toBeGreaterThan(0);
      expect(validatePolicyValue(definition.key, definition.default)).toEqual({ ok: true });
    }
  });

  it('has exactly 3 fixed (A), 4 protected (B) and 8 management (C) keys', () => {
    const count = (group: string) => POLICY_REGISTRY.filter((d) => d.group === group).length;
    expect(count('A')).toBe(3);
    expect(count('B')).toBe(4);
    expect(count('C')).toBe(8);
    expect(POLICY_REGISTRY).toHaveLength(15);
  });

  it('exposes definitions and defaults by key', () => {
    expect(getPolicyDefinition('purchase.three_way.qty_excess_tolerance_bp')?.group).toBe('C');
    expect(getPolicyDefinition('moadian.inbox_age_alert.mode')?.group).toBe('B');
    expect(getPolicyDefinition('moadian.article_6_cap.mode')?.group).toBe('B');
    expect(getPolicyDefinition('does.not.exist')).toBeUndefined();
    expect(policyDefault('purchase.invoice_review.reviewer_rule')).toBe('always_differs');
    expect(policyDefault('moadian.inbox_age_alert.mode')).toBe('warn');
    expect(policyDefault('moadian.article_6_cap.mode')).toBe('warn');
    expect(policyDefault('moadian.inbox_age_alert.warn_days')).toBe(20);
    expect(policyDefault('moadian.inbox_age_alert.critical_days')).toBe(27);
    expect(policyDefault('moadian.article_6_cap.warning_percent')).toBe(80);
  });

  it('validates the moadian policy ranges and enums', () => {
    expect(validatePolicyValue('moadian.inbox_age_alert.mode', 'warn')).toEqual({ ok: true });
    expect(validatePolicyValue('moadian.inbox_age_alert.mode', 'invalid').ok).toBe(false);
    expect(validatePolicyValue('moadian.inbox_age_alert.warn_days', 20)).toEqual({ ok: true });
    expect(validatePolicyValue('moadian.inbox_age_alert.warn_days', 0).ok).toBe(false);
    expect(validatePolicyValue('moadian.inbox_age_alert.warn_days', 30).ok).toBe(false);
    expect(validatePolicyValue('moadian.article_6_cap.warning_percent', 80)).toEqual({ ok: true });
    expect(validatePolicyValue('moadian.article_6_cap.warning_percent', 49).ok).toBe(false);
    expect(validatePolicyValue('moadian.article_6_cap.warning_percent', 96).ok).toBe(false);
  });

  it('validates the quantity tolerance as a strict whole number in range', () => {
    const key = 'purchase.three_way.qty_excess_tolerance_bp';
    expect(validatePolicyValue(key, 1000)).toEqual({ ok: true });
    expect(validatePolicyValue(key, 1001).ok).toBe(false);
    expect(validatePolicyValue(key, -1).ok).toBe(false);
    expect(validatePolicyValue(key, 5.5).ok).toBe(false);
    expect(validatePolicyValue(key, '5').ok).toBe(false);
  });

  it('rejects an unknown enum value and a false fixed flag', () => {
    expect(validatePolicyValue('purchase.invoice_review.reviewer_rule', 'sometimes').ok).toBe(false);
    expect(validatePolicyValue('purchase.invoice_review.reviewer_rule', 'always_differs')).toEqual({ ok: true });
    expect(validatePolicyValue('ledger.posted_voucher_immutable', false).ok).toBe(false);
    expect(validatePolicyValue('ledger.posted_voucher_immutable', true)).toEqual({ ok: true });
  });
});
