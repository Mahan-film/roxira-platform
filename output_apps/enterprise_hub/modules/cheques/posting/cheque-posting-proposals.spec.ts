import { buildProposal } from '../../posting_rules/domain/posting-engine';
import { PostingRuleError } from '../../posting_rules/domain/posting-error';
import { ChequeDirection, ChequeStatus } from '../enums/cheque.enum';
import { creationPosting, findRule } from '../lifecycle/cheque-lifecycle';
import { ChequeStatusChange, chequePostingDocType, chequePostingProposal } from './cheque-posting-proposals';

const R = ChequeDirection.RECEIVED;
const I = ChequeDirection.ISSUED;
const S = ChequeStatus;
const AMOUNT = 123_456_789n; // 1_234_567.89 rials in minor units

type Triple = [string, bigint, bigint];

/** The voucher the cheque service posts today for a move, as [accountCode, debit, credit] triples. */
function serviceLines(change: ChequeStatusChange): Triple[] {
  const lines =
    change.from === null
      ? creationPosting(change.direction, change.amount).lines
      : findRule(change.direction, change.from, change.to)!.lines!(change.amount);
  return lines.map((l) => [l.accountCode, l.debit, l.credit] as Triple);
}

/** The engine voucher built from the mapper input, as [accountCode, debit, credit] triples. */
function mappedLines(change: ChequeStatusChange): Triple[] {
  return buildProposal(chequePostingProposal(change)).lines.map((l) => [l.accountCode, l.debit, l.credit] as Triple);
}

describe('cheque posting proposals', () => {
  it('received create: Dr notes-in-hand / Cr receivable', () => {
    const change: ChequeStatusChange = { direction: R, from: null, to: S.REGISTERED, amount: AMOUNT };
    expect(mappedLines(change)).toEqual(serviceLines(change));
    expect(mappedLines(change)).toEqual([
      ['1110', AMOUNT, 0n],
      ['1020', 0n, AMOUNT],
    ]);
  });

  it('received deposit: Dr in-collection / Cr notes-in-hand', () => {
    const change: ChequeStatusChange = { direction: R, from: S.REGISTERED, to: S.DEPOSITED, amount: AMOUNT };
    expect(mappedLines(change)).toEqual(serviceLines(change));
    expect(mappedLines(change)).toEqual([
      ['1120', AMOUNT, 0n],
      ['1110', 0n, AMOUNT],
    ]);
  });

  it('received clear: Dr bank / Cr in-collection', () => {
    const change: ChequeStatusChange = { direction: R, from: S.DEPOSITED, to: S.CLEARED, amount: AMOUNT };
    expect(mappedLines(change)).toEqual(serviceLines(change));
    expect(mappedLines(change)).toEqual([
      ['1010', AMOUNT, 0n],
      ['1120', 0n, AMOUNT],
    ]);
  });

  it('issued create: Dr payable / Cr notes-payable, party only on the payable line', () => {
    const change: ChequeStatusChange = { direction: I, from: null, to: S.REGISTERED, amount: AMOUNT, partyCode: 'S-9' };
    const proposal = buildProposal(chequePostingProposal(change));
    expect(proposal.lines.map((l) => [l.accountCode, l.debit, l.credit])).toEqual(serviceLines(change));
    expect(proposal.lines.map((l) => [l.accountCode, l.debit, l.credit])).toEqual([
      ['2010', AMOUNT, 0n],
      ['2110', 0n, AMOUNT],
    ]);
    expect(proposal.lines.find((l) => l.accountCode === '2010')!.partyCode).toBe('S-9');
    expect(proposal.lines.find((l) => l.accountCode === '2110')!.partyCode).toBeUndefined();
  });

  it('issued clear: Dr notes-payable / Cr bank, from registered, delivered or bounced', () => {
    for (const from of [S.REGISTERED, S.DELIVERED, S.BOUNCED]) {
      const change: ChequeStatusChange = { direction: I, from, to: S.CLEARED, amount: AMOUNT };
      expect(mappedLines(change)).toEqual(serviceLines(change));
      expect(mappedLines(change)).toEqual([
        ['2110', AMOUNT, 0n],
        ['1010', 0n, AMOUNT],
      ]);
    }
  });

  it('every mapped voucher balances and keeps the bigint amount, beyond float precision', () => {
    const big = 10_000_000_000_000_000n;
    const changes: ChequeStatusChange[] = [
      { direction: R, from: null, to: S.REGISTERED, amount: big },
      { direction: R, from: S.REGISTERED, to: S.DEPOSITED, amount: big },
      { direction: R, from: S.DEPOSITED, to: S.CLEARED, amount: big },
      { direction: I, from: null, to: S.REGISTERED, amount: big },
      { direction: I, from: S.REGISTERED, to: S.CLEARED, amount: big },
    ];
    for (const change of changes) {
      const proposal = buildProposal(chequePostingProposal(change));
      const debit = proposal.lines.reduce((sum, l) => sum + l.debit, 0n);
      const credit = proposal.lines.reduce((sum, l) => sum + l.credit, 0n);
      expect(debit).toBe(credit);
      expect(debit).toBe(big);
      expect(proposal.total).toBe(big);
    }
  });

  it('refuses a status change with no automatic voucher (invalid input)', () => {
    // status-only move: no ledger effect, so no voucher to build
    expect(chequePostingDocType(I, S.REGISTERED, S.DELIVERED)).toBeNull();
    // terminal state cannot move anywhere
    expect(chequePostingDocType(R, S.CLEARED, S.DEPOSITED)).toBeNull();
    try {
      chequePostingProposal({ direction: R, from: S.CLEARED, to: S.DEPOSITED, amount: AMOUNT });
      fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PostingRuleError);
      expect((e as PostingRuleError).code).toBe('UNKNOWN_DOC_TYPE');
    }
    expect(() => chequePostingProposal({ direction: I, from: S.REGISTERED, to: S.DELIVERED, amount: AMOUNT })).toThrow(PostingRuleError);
  });

  it('lets an explicit override win over the legacy role mapping', () => {
    const change: ChequeStatusChange = { direction: R, from: S.DEPOSITED, to: S.CLEARED, amount: AMOUNT, overrides: { bank: '1099' } };
    expect(mappedLines(change)).toEqual([
      ['1099', AMOUNT, 0n],
      ['1120', 0n, AMOUNT],
    ]);
  });
});
