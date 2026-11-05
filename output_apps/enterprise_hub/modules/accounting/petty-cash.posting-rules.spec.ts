import { legacyMovementLines } from './__fixtures__/legacy-petty-cash-posting';
import { buildProposal, toJournalLines } from '../posting_rules/domain/posting-engine';

const engineLines = (
  kind: 'CHARGE' | 'RETURN',
  fundCode: string,
  counterCode: string,
  amount: bigint,
) =>
  toJournalLines(
    buildProposal({
      docType: kind === 'CHARGE' ? 'pettycash.fund_charge' : 'pettycash.fund_return',
      amounts: { amount },
      overrides: { petty_cash: fundCode, counter: counterCode },
    }),
  ).map((l) => ({ accountCode: l.accountCode, debit: l.debit, credit: l.credit }));

describe('petty-cash movement: engine vs frozen legacy lines', () => {
  const cases: Array<[ 'CHARGE' | 'RETURN', string, string, bigint ]> = [
    ['CHARGE', '101301', '1010', 5000000n],
    ['RETURN', '101301', '1010', 250000050n],
    ['CHARGE', '101301', '1010', 500000000000n],
  ];

  it.each(cases)('%s fund %s counter %s amount %s', (kind, fund, counter, amount) => {
    expect(engineLines(kind, fund, counter, amount)).toEqual(
      legacyMovementLines(kind, fund, counter, amount),
    );
  });

  it('asserts literal lines for CHARGE 1n minor unit', () => {
    const lines = engineLines('CHARGE', '101301', '1010', 1n);
    expect(lines).toEqual([
      { accountCode: '101301', debit: '0.01', credit: '0.00' },
      { accountCode: '1010', debit: '0.00', credit: '0.01' },
    ]);
  });

  it('has empty description on every line (toJournalLines omits description)', () => {
    const proposal = buildProposal({
      docType: 'pettycash.fund_charge',
      amounts: { amount: 1000n },
      overrides: { petty_cash: '101301', counter: '1010' },
    });
    for (const line of proposal.lines) {
      expect(line.description).toBe('');
    }
  });

  it('mapping does NOT beat overrides', () => {
    const proposal = buildProposal({
      docType: 'pettycash.fund_charge',
      amounts: { amount: 1000n },
      mapping: { petty_cash: '9999' },
      overrides: { petty_cash: '101301', counter: '1010' },
    });
    const lines = toJournalLines(proposal);
    expect(lines[0].accountCode).toBe('101301');
  });
});
