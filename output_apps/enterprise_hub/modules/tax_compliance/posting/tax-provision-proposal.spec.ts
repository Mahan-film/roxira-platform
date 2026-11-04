import { MoneyFormatError } from '../../accounting/money';
import { DEFAULT_ROLE_ACCOUNTS } from '../../posting_rules/constants/posting-roles';
import { buildProposal } from '../../posting_rules/domain/posting-engine';
import { PostingRuleError } from '../../posting_rules/domain/posting-error';
import type { CorporateTaxPreview } from '../services/corporate-tax.service';
import { TAX_PROVISION_DOC_TYPE, toTaxProvisionBuildInput } from './tax-provision-proposal';

const preview = (over: Partial<CorporateTaxPreview> = {}): CorporateTaxPreview => ({
  status: 'preview',
  fiscalYear: 1405,
  currency: 'IRR',
  worksheet: [],
  taxableIncome: '1000000.00',
  taxByRate: '250000.00',
  floorTax: '100000.00',
  provision: '250000.00',
  floorApplied: false,
  effectiveRate: '0.250000',
  voucher: {
    posted: false,
    lines: [
      { accountCode: '5220', debit: '250000.00', credit: '0.00', description: 'هزینه مالیات بر درآمد' },
      { accountCode: '2021', debit: '0.00', credit: '250000.00', description: 'مالیات بر درآمد پرداختنی' },
    ],
  },
  parameters: [],
  notes: [],
  ...over,
});

const sum = (lines: Array<{ debit: bigint; credit: bigint }>, side: 'debit' | 'credit') =>
  lines.reduce((s, l) => s + l[side], 0n);

describe('toTaxProvisionBuildInput', () => {
  it('maps the preview to the tax.provision doc type', () => {
    expect(toTaxProvisionBuildInput(preview()).docType).toBe(TAX_PROVISION_DOC_TYPE);
    expect(TAX_PROVISION_DOC_TYPE).toBe('tax.provision');
  });

  it('parses the provision into exact bigint minor units (rials, no floating point)', () => {
    expect(toTaxProvisionBuildInput(preview({ provision: '250000.00' })).amounts.provision).toBe(25_000_000n);
    expect(toTaxProvisionBuildInput(preview({ provision: '123.45' })).amounts.provision).toBe(12_345n);
    expect(toTaxProvisionBuildInput(preview({ provision: '0.01' })).amounts.provision).toBe(1n);
  });

  it('passes the preview account codes as overrides for the two tax roles', () => {
    expect(toTaxProvisionBuildInput(preview()).overrides).toEqual({
      income_tax_expense: '5220',
      income_tax_payable: '2021',
    });
  });

  it('builds a balanced voucher: debits equal credits', () => {
    const proposal = buildProposal(toTaxProvisionBuildInput(preview()));
    expect(proposal.lines).toHaveLength(2);
    expect(sum(proposal.lines, 'debit')).toBe(25_000_000n);
    expect(sum(proposal.lines, 'credit')).toBe(25_000_000n);
    expect(sum(proposal.lines, 'debit')).toBe(sum(proposal.lines, 'credit'));
    expect(proposal.total).toBe(25_000_000n);
  });

  it('omits overrides when the preview carries no account codes and falls back to the role defaults', () => {
    const input = toTaxProvisionBuildInput(
      preview({
        voucher: {
          posted: false,
          lines: [
            { accountCode: null, debit: '250000.00', credit: '0.00', description: 'هزینه مالیات بر درآمد' },
            { accountCode: null, debit: '0.00', credit: '250000.00', description: 'مالیات بر درآمد پرداختنی' },
          ],
        },
      }),
    );
    expect(input.overrides).toBeUndefined();
    const proposal = buildProposal(input);
    expect(proposal.lines.map((l) => l.accountCode)).toEqual([
      DEFAULT_ROLE_ACCOUNTS.income_tax_expense,
      DEFAULT_ROLE_ACCOUNTS.income_tax_payable,
    ]);
  });

  it('a zero provision maps to a zero amount and yields no posting lines', () => {
    const input = toTaxProvisionBuildInput(preview({ provision: '0.00', voucher: { posted: false, lines: [] } }));
    expect(input.amounts.provision).toBe(0n);
    expect(input.overrides).toBeUndefined();
    expect(() => buildProposal(input)).toThrow(PostingRuleError);
    try {
      buildProposal(input);
      fail('should throw');
    } catch (error) {
      expect((error as PostingRuleError).code).toBe('EMPTY_VOUCHER');
    }
  });

  it('refuses an invalid provision string instead of guessing', () => {
    expect(() => toTaxProvisionBuildInput(preview({ provision: '12.345' }))).toThrow(MoneyFormatError);
    expect(() => toTaxProvisionBuildInput(preview({ provision: 'not-a-number' }))).toThrow(MoneyFormatError);
  });

  it('a negative provision is kept exact and the engine refuses it', () => {
    const input = toTaxProvisionBuildInput(preview({ provision: '-1.00' }));
    expect(input.amounts.provision).toBe(-100n);
    try {
      buildProposal(input);
      fail('should throw');
    } catch (error) {
      expect((error as PostingRuleError).code).toBe('NEGATIVE_AMOUNT');
    }
  });
});
