import { buildProposal } from './posting-engine';

const MAP = {
  receivable: '1201', revenue: '4101', retention_receivable: '1250', contract_insurance_expense: '5250', advance_received: '2250',
  purchases: '5201', payable: '2101', retention_payable: '2260', insurance_payable: '2030', advance_paid: '1260',
};
const lines = (p: ReturnType<typeof buildProposal>) => p.lines.map((l) => [l.accountCode, l.debit, l.credit]);

describe('contract statement templates', () => {
  it('contractor side: gross 400,000,000, retention 40,000,000, insurance 28,000,000, advance recovery 20,000,000', () => {
    // net = 400,000,000 - 40,000,000 - 28,000,000 - 20,000,000 = 312,000,000
    const p = buildProposal({
      docType: 'contract.statement.contractor', mapping: MAP, partyCode: 'C1',
      amounts: { gross: 400_000_000n, retention: 40_000_000n, insurance: 28_000_000n, advance: 20_000_000n, net: 312_000_000n },
    });
    expect(lines(p)).toEqual([
      ['1201', 312_000_000n, 0n], ['1250', 40_000_000n, 0n], ['5250', 28_000_000n, 0n], ['2250', 20_000_000n, 0n], ['4101', 0n, 400_000_000n],
    ]);
    expect(p.lines[0].partyCode).toBe('C1');
  });

  it('employer side drops zero lines: no advance recovery', () => {
    const p = buildProposal({
      docType: 'contract.statement.employer', mapping: MAP, partyCode: 'S1',
      amounts: { gross: 400_000_000n, retention: 40_000_000n, insurance: 28_000_000n, advance: 0n, net: 332_000_000n },
    });
    expect(lines(p)).toEqual([
      ['5201', 400_000_000n, 0n], ['2101', 0n, 332_000_000n], ['2260', 0n, 40_000_000n], ['2030', 0n, 28_000_000n],
    ]);
  });

  it('refuses a voucher that does not balance and a role nobody mapped', () => {
    expect(() => buildProposal({ docType: 'contract.statement.employer', mapping: MAP, amounts: { gross: 100n, retention: 0n, insurance: 0n, advance: 0n, net: 90n } })).toThrow();
    expect(() => buildProposal({ docType: 'contract.statement.employer', mapping: { purchases: '5201', payable: '2101' }, amounts: { gross: 100n, retention: 10n, insurance: 0n, advance: 0n, net: 90n } })).toThrow();
  });

  it('advance and retention release post one balanced pair each, on the right side of the party', () => {
    // 100,000,000 advance: contractor books the employer as debtor, employer books the contractor as creditor
    expect(lines(buildProposal({ docType: 'contract.advance.contractor', mapping: MAP, partyCode: 'C1', amounts: { amount: 100_000_000n } }))).toEqual([['1201', 100_000_000n, 0n], ['2250', 0n, 100_000_000n]]);
    expect(lines(buildProposal({ docType: 'contract.advance.employer', mapping: MAP, partyCode: 'S1', amounts: { amount: 100_000_000n } }))).toEqual([['1260', 100_000_000n, 0n], ['2101', 0n, 100_000_000n]]);
    expect(lines(buildProposal({ docType: 'contract.retention_release.contractor', mapping: MAP, partyCode: 'C1', amounts: { amount: 40_000_000n } }))).toEqual([['1201', 40_000_000n, 0n], ['1250', 0n, 40_000_000n]]);
    expect(lines(buildProposal({ docType: 'contract.retention_release.employer', mapping: MAP, partyCode: 'S1', amounts: { amount: 40_000_000n } }))).toEqual([['2260', 40_000_000n, 0n], ['2101', 0n, 40_000_000n]]);
  });
});
