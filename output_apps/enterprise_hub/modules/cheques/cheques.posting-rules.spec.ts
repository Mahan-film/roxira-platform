import { ChequeDirection, ChequeStatus } from './enums/cheque.enum';
import {
  creationPosting as legacyCreation,
  findRule as legacyFindRule,
  partialPaymentPosting as legacyPartial,
} from './__fixtures__/legacy-cheque-lifecycle';
import { creationPosting, findRule, linesFor, partialPaymentPosting } from './lifecycle/cheque-lifecycle';

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
});
