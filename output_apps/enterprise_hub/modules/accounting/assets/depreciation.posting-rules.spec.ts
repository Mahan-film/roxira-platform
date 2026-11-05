import { legacyDepreciationLines, LegacyDepreciationItem } from '../__fixtures__/legacy-depreciation-posting';
import { buildProposal, toJournalLines } from '../../posting_rules/domain/posting-engine';

/** Old vs new: the engine template with the asset's own accounts as overrides gives the old lines. */
const engineLines = (items: LegacyDepreciationItem[]) =>
  items.flatMap((i) =>
    toJournalLines(
      buildProposal({
        docType: 'asset.depreciation',
        amounts: { charge: i.charge },
        overrides: { depreciation_expense: i.expenseAccountCode, accumulated_depreciation: i.accumulatedAccountCode },
      }),
    ).map((l) => ({ accountCode: l.accountCode, debit: l.debit, credit: l.credit })),
  );

describe('asset.depreciation: engine vs frozen legacy lines', () => {
  const cases: Array<[string, LegacyDepreciationItem[]]> = [
    ['one asset', [{ expenseAccountCode: '5060', accumulatedAccountCode: '1120', charge: 10000n }]],
    [
      'several assets with own accounts',
      [
        { expenseAccountCode: '5060', accumulatedAccountCode: '1120', charge: 100n },
        { expenseAccountCode: '5061', accumulatedAccountCode: '1121', charge: 25050n },
        { expenseAccountCode: '5060', accumulatedAccountCode: '1120', charge: 1n },
      ],
    ],
    ['a very large charge', [{ expenseAccountCode: '5060', accumulatedAccountCode: '1120', charge: 500000000000n }]],
  ];
  it.each(cases)('%s', (_name, items) => {
    expect(engineLines(items)).toEqual(legacyDepreciationLines(items));
  });

  it('refuses a zero charge (the service never posts one)', () => {
    expect(() => buildProposal({ docType: 'asset.depreciation', amounts: { charge: 0n } })).toThrow();
  });
});
