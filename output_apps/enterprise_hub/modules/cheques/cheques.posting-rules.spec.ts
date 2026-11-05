import { ChequeDirection, ChequeStatus } from './enums/cheque.enum';
import {
  creationPosting as legacyCreation,
  findRule as legacyFindRule,
  partialPaymentPosting as legacyPartial,
} from './__fixtures__/legacy-cheque-lifecycle';
import { creationPosting, findRule, linesFor, partialPaymentPosting } from './lifecycle/cheque-lifecycle';
import { buildProposal } from '../posting_rules/domain/posting-engine';

/**
 * Old vs new: the posting rules engine must give the same vouchers as the hardcoded cheque table
 * it replaced (frozen in __fixtures__/legacy-cheque-lifecycle.ts) for every move and amount.
 */
const AMOUNTS = [1n, 100n, 5_000_000_000n, 999_999_999_999_999_999n];
const STATUSES = Object.values(ChequeStatus);

describe('cheque postings: legacy table vs posting rules engine', () => {
  it('every transition posts exactly the same lines (accounts, sides, amounts, order)', () => {
    let compared = 0;
    for (const direction of Object.values(ChequeDirection)) {
      for (const from of STATUSES) {
        for (const to of STATUSES) {
          const old = legacyFindRule(direction, from, to);
          const now = findRule(direction, from, to);
          expect(now === null).toBe(old === null);
          if (!old || !now) continue;
          expect(now.description).toBe(old.description);
          expect(now.docType === null).toBe(old.lines === null);
          if (!old.lines || !now.docType) continue;
          for (const amount of AMOUNTS) {
            expect(linesFor(now.docType, amount)).toEqual(old.lines(amount));
            compared++;
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(40);
  });

  it('creation and partial-payment postings are identical', () => {
    for (const direction of Object.values(ChequeDirection)) {
      for (const amount of AMOUNTS) {
        const a = legacyCreation(direction, amount);
        const b = creationPosting(direction, amount);
        expect({ description: b.description, lines: b.lines }).toEqual(a);
        for (const from of STATUSES) {
          const oldPartial = legacyPartial(direction, from, amount);
          const newPartial = partialPaymentPosting(direction, from, amount);
          expect(newPartial === null).toBe(oldPartial === null);
          if (oldPartial && newPartial) expect({ description: newPartial.description, lines: newPartial.lines }).toEqual(oldPartial);
        }
      }
    }
  });

  it('the party code rides only the receivable/payable line, and nothing when absent', () => {
    const partyRoles = (docType: string, partyCode?: string) =>
      buildProposal({ docType, amounts: { amount: 100n }, partyCode })
        .lines.filter((l) => l.partyCode !== undefined)
        .map((l) => l.role);
    // drawer/third party lands on the receivable line of a received cheque and the payable line otherwise
    for (const docType of [
      'cheque.received.create',
      'cheque.received.redeposit',
      'cheque.received.bounce',
      'cheque.received.bounce_direct',
      'cheque.received.return',
    ]) {
      expect(partyRoles(docType, 'P-1')).toEqual(['receivable']);
    }
    for (const docType of ['cheque.received.spend', 'cheque.issued.create', 'cheque.issued.return']) {
      expect(partyRoles(docType, 'P-1')).toEqual(['payable']);
    }
    // clearance/deposit moves never carried a party in the legacy voucher
    for (const docType of ['cheque.received.deposit', 'cheque.received.clear', 'cheque.received.clear_direct', 'cheque.issued.clear']) {
      expect(partyRoles(docType, 'P-1')).toEqual([]);
    }
    // no party code in, no party code out
    for (const docType of ['cheque.received.create', 'cheque.received.spend', 'cheque.issued.create']) {
      expect(partyRoles(docType, undefined)).toEqual([]);
    }
  });
});
