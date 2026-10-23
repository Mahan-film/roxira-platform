import 'reflect-metadata';
import { In, IsNull } from 'typeorm';
import { MatchMethod } from './enums/banking.enum';
import { BankingRepository } from './repositories/banking.repository';

const TENANT = '11111111-1111-4111-8111-111111111111';

/** TypeORM repository double that records every `where` the repository sends. */
function typeormDouble() {
  return {
    find: jest.fn(async (_options: unknown) => []),
    findOne: jest.fn(async (_options: unknown) => null),
    delete: jest.fn(async (_where: unknown) => ({ affected: 0 })),
    update: jest.fn(async (_where: unknown, _patch: unknown) => ({ affected: 1 })),
    save: jest.fn(async (rows: unknown) => rows),
    create: jest.fn((row: unknown) => row),
  };
}

describe('BankingRepository tenant scoping', () => {
  const accounts = typeormDouble();
  const lines = typeormDouble();
  const repository = new BankingRepository(accounts as never, lines as never, {} as never);

  beforeEach(() => jest.clearAllMocks());

  it('scopes every read by tenant_id', async () => {
    await repository.listAccounts(TENANT);
    await repository.findAccount(TENANT, 1);
    await repository.findAccountByNumber(TENANT, '123');
    await repository.findLines(TENANT, 1, { fromDate: '2024-10-01' });
    await repository.findLine(TENANT, 5);
    await repository.findLinesByIds(TENANT, [5]);
    await repository.findExistingDedupeKeys(TENANT, ['k']);
    await repository.findMatchedPairs(TENANT);

    const wheres = [...accounts.find.mock.calls, ...accounts.findOne.mock.calls, ...lines.find.mock.calls, ...lines.findOne.mock.calls].map(
      ([options]) => (options as { where: Record<string, unknown> }).where,
    );
    expect(wheres).toHaveLength(8);
    for (const where of wheres) {
      expect(where.tenantId).toBe(TENANT);
    }
  });

  it('stamps tenant_id on inserts and scopes writes', async () => {
    await repository.createAccount(TENANT, {
      name: 'x',
      bankCode: 'other' as never,
      accountNumber: '1',
      iban: null,
      ledgerAccountId: 1,
      currency: 'IRR',
      openingBalance: 0,
    });
    expect(accounts.create).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }));

    await repository.deleteLines(TENANT, [1, 2]);
    expect(lines.delete).toHaveBeenCalledWith({ tenantId: TENANT, id: In([1, 2]) });

    await repository.setMatch(TENANT, 3, 40, MatchMethod.MANUAL);
    expect(lines.update).toHaveBeenCalledWith(
      { id: 3, tenantId: TENANT, matchedJournalLineId: IsNull() },
      expect.objectContaining({ matchedJournalLineId: 40, matchMethod: MatchMethod.MANUAL }),
    );

    await repository.clearMatch(TENANT, 3);
    expect(lines.update).toHaveBeenLastCalledWith(
      { id: 3, tenantId: TENANT },
      { matchedJournalLineId: null, matchMethod: null, matchedAt: null },
    );
  });
});
