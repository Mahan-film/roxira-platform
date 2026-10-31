import { CHEQUE_ACCOUNTS } from './constants/cheque.constants';
import { ChequeDirection, ChequeStatus } from './enums/cheque.enum';
import { allowedTargets, creationPosting, findRule } from './lifecycle/cheque-lifecycle';

const ALL = Object.values(ChequeStatus);
const KNOWN_CODES = new Set<string>(Object.values(CHEQUE_ACCOUNTS));

describe('cheque lifecycle table', () => {
  it('every posting is balanced, one-sided per line and uses known accounts', () => {
    for (const direction of Object.values(ChequeDirection)) {
      for (const from of ALL) {
        for (const to of ALL) {
          const rule = findRule(direction, from, to);
          if (!rule?.lines) continue;
          const lines = rule.lines(999_999_999_999_999_999n); // 9999999999999999.99, beyond float precision
          const debit = lines.reduce((s, l) => s + l.debit, 0n);
          const credit = lines.reduce((s, l) => s + l.credit, 0n);
          expect(debit).toBe(credit);
          expect(debit).toBe(999_999_999_999_999_999n);
          for (const line of lines) {
            expect(KNOWN_CODES.has(line.accountCode)).toBe(true);
            expect(line.debit === 0n || line.credit === 0n).toBe(true);
          }
        }
      }
    }
  });

  it('creation postings: received -> notes in hand / receivables; issued -> payables / notes payable', () => {
    expect(creationPosting(ChequeDirection.RECEIVED, 100n).lines).toEqual([
      { accountCode: '1110', debit: 100n, credit: 0n },
      { accountCode: '1020', debit: 0n, credit: 100n },
    ]);
    expect(creationPosting(ChequeDirection.ISSUED, 100n).lines).toEqual([
      { accountCode: '2010', debit: 100n, credit: 0n },
      { accountCode: '2110', debit: 0n, credit: 100n },
    ]);
  });

  it('received cheque happy path posts the expected accounts', () => {
    const post = (to: ChequeStatus, from: ChequeStatus) =>
      findRule(ChequeDirection.RECEIVED, from, to)!.lines!(10n).map((l) => `${l.debit > 0n ? 'Dr' : 'Cr'}${l.accountCode}`);
    expect(post(ChequeStatus.DEPOSITED, ChequeStatus.REGISTERED)).toEqual(['Dr1120', 'Cr1110']);
    expect(post(ChequeStatus.CLEARED, ChequeStatus.DEPOSITED)).toEqual(['Dr1010', 'Cr1120']);
    expect(post(ChequeStatus.BOUNCED, ChequeStatus.DEPOSITED)).toEqual(['Dr1020', 'Cr1120']);
    expect(post(ChequeStatus.SPENT, ChequeStatus.REGISTERED)).toEqual(['Dr2010', 'Cr1110']);
    expect(post(ChequeStatus.RETURNED, ChequeStatus.REGISTERED)).toEqual(['Dr1020', 'Cr1110']);
    // counter presentation: straight from the safe, no deposit step
    expect(post(ChequeStatus.CLEARED, ChequeStatus.REGISTERED)).toEqual(['Dr1010', 'Cr1110']);
    expect(post(ChequeStatus.BOUNCED, ChequeStatus.REGISTERED)).toEqual(['Dr1020', 'Cr1110']);
  });

  it('a bounced issued cheque and a returned bounced received cheque change status only', () => {
    expect(findRule(ChequeDirection.ISSUED, ChequeStatus.REGISTERED, ChequeStatus.BOUNCED)!.lines).toBeNull();
    expect(findRule(ChequeDirection.RECEIVED, ChequeStatus.BOUNCED, ChequeStatus.RETURNED)!.lines).toBeNull();
  });

  it('terminal states have no exits and issued cheques cannot be deposited or spent', () => {
    for (const direction of Object.values(ChequeDirection)) {
      for (const terminal of [ChequeStatus.CLEARED, ChequeStatus.RETURNED, ChequeStatus.SPENT]) {
        expect(allowedTargets(direction, terminal)).toEqual([]);
      }
    }
    expect(findRule(ChequeDirection.ISSUED, ChequeStatus.REGISTERED, ChequeStatus.DEPOSITED)).toBeNull();
    expect(findRule(ChequeDirection.ISSUED, ChequeStatus.REGISTERED, ChequeStatus.SPENT)).toBeNull();
    expect(findRule(ChequeDirection.RECEIVED, ChequeStatus.DEPOSITED, ChequeStatus.SPENT)).toBeNull();
  });
});
