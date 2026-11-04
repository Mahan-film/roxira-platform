import * as fc from 'fast-check';
import { ALL_DOC_TYPES, POSTING_ROLE_KEYS } from '../constants/posting-roles';
import { buildProposal, netByAccount, reverseProposal } from './posting-engine';
import { PostingRuleError } from './posting-error';
import { POSTING_TEMPLATES, PostingTemplate } from './posting-templates';

const money = fc.bigInt({ min: 0n, max: 9_000_000_000_000_000n });
// Every role resolves to an account so that only balance is under test.
const mapping = Object.fromEntries(POSTING_ROLE_KEYS.map((r, i) => [r, String(1000 + i)]));

/**
 * Amounts for a template that make it balance: random values for the free amounts, then the
 * remaining ones solved from the template's own debit/credit equation (largest-remainder style).
 */
function balancedAmounts(template: PostingTemplate, seed: bigint[]): Record<string, bigint> | null {
  const amounts: Record<string, bigint> = {};
  template.amounts.forEach((name, i) => (amounts[name] = seed[i % seed.length]));
  const side = (s: 'debit' | 'credit') => template.lines.filter((l) => l.side === s);
  const sum = (lines: typeof template.lines) => lines.reduce((acc, l) => acc + amounts[l.amount], 0n);
  // Adjust the last credit-only amount name to close the gap when it is not shared with a debit.
  const debitNames = new Set(side('debit').map((l) => l.amount));
  const closer = [...side('credit')].reverse().find((l) => !debitNames.has(l.amount) && side('credit').filter((x) => x.amount === l.amount).length === 1);
  if (closer) {
    const others = sum(side('credit').filter((l) => l.amount !== closer.amount));
    const gap = sum(side('debit')) - others;
    if (gap < 0n) return null;
    amounts[closer.amount] = gap;
  } else if (sum(side('debit')) !== sum(side('credit'))) {
    return null;
  }
  return amounts;
}

describe('posting engine properties', () => {
  it.each(POSTING_TEMPLATES.map((t) => [t.docType, t] as const))('%s: any balanced amounts give a balanced voucher; its reversal nets to zero', (_docType, template) => {
    fc.assert(
      fc.property(fc.array(money, { minLength: 1, maxLength: 8 }), (seed) => {
        const amounts = balancedAmounts(template, seed);
        fc.pre(amounts !== null);
        let proposal;
        try {
          proposal = buildProposal({ docType: template.docType, amounts: amounts!, mapping });
        } catch (e) {
          // the only allowed refusal for balanced input is a voucher with nothing to post
          expect(e).toBeInstanceOf(PostingRuleError);
          expect((e as PostingRuleError).code).toBe('EMPTY_VOUCHER');
          return;
        }
        const debit = proposal.lines.reduce((s, l) => s + l.debit, 0n);
        const credit = proposal.lines.reduce((s, l) => s + l.credit, 0n);
        expect(debit).toBe(credit);
        expect(debit).toBe(proposal.total);
        expect(proposal.lines.every((l) => (l.debit === 0n) !== (l.credit === 0n))).toBe(true);
        const net = netByAccount(proposal, reverseProposal(proposal));
        expect([...net.values()].every((v) => v === 0n)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('never produces an unbalanced voucher: perturbed amounts are refused with UNBALANCED', () => {
    const template = POSTING_TEMPLATES.find((t) => t.docType === 'payroll.run')!;
    fc.assert(
      fc.property(fc.array(money, { minLength: 1, maxLength: 8 }), fc.bigInt({ min: 1n, max: 1000n }), (seed, delta) => {
        const amounts = balancedAmounts(template, seed);
        fc.pre(amounts !== null);
        const bad = { ...amounts!, net: amounts!.net + delta };
        try {
          buildProposal({ docType: template.docType, amounts: bad, mapping });
          throw new Error('unbalanced voucher was accepted');
        } catch (e) {
          expect(e).toBeInstanceOf(PostingRuleError);
          expect((e as PostingRuleError).code).toBe('UNBALANCED');
        }
      }),
      { numRuns: 200 },
    );
  });

  it('exposes the tenant-wide marker', () => {
    expect(ALL_DOC_TYPES).toBe('*');
  });
});
