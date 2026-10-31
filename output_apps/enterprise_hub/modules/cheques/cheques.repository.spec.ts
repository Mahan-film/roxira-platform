import 'reflect-metadata';
import { ChequesRepository } from './repositories/cheques.repository';
import { ChequeStatus } from './enums/cheque.enum';

const TENANT = '11111111-1111-4111-8111-111111111111';

function typeormDouble() {
  return {
    find: jest.fn(async (_o: unknown) => []),
    findOne: jest.fn(async (_o: unknown) => null),
    update: jest.fn(async (_w: unknown, _p: unknown) => ({ affected: 1 })),
    save: jest.fn(async (rows: unknown) => rows),
    create: jest.fn((row: unknown) => row),
  };
}

describe('ChequesRepository tenant scoping', () => {
  const cheques = typeormDouble();
  const events = typeormDouble();
  const repository = new ChequesRepository(cheques as never, events as never, {} as never);
  beforeEach(() => jest.clearAllMocks());

  it('scopes every read by tenant_id', async () => {
    await repository.findById(TENANT, 1);
    await repository.findBySayadNumber(TENANT, '1234567890123456');
    await repository.list(TENANT, { direction: undefined, dueFrom: '2026-01-01', dueTo: '2026-02-01' });
    await repository.listOpenDueBy(TENANT, [ChequeStatus.REGISTERED], '2026-02-01');
    await repository.listEvents(TENANT, 1);

    const wheres = [...cheques.findOne.mock.calls, ...cheques.find.mock.calls, ...events.find.mock.calls].map(
      ([o]) => (o as { where: Record<string, unknown> }).where,
    );
    expect(wheres).toHaveLength(5);
    for (const where of wheres) expect(where.tenantId).toBe(TENANT);
  });

  it('stamps tenant_id on writes and scopes status updates', async () => {
    await repository.create(TENANT, { direction: 'received' } as never);
    await repository.addEvent(TENANT, { chequeId: 1 } as never);
    expect(cheques.create.mock.calls[0][0]).toMatchObject({ tenantId: TENANT, status: 'registered' });
    expect(events.create.mock.calls[0][0]).toMatchObject({ tenantId: TENANT });

    const update = jest.fn(async () => ({ affected: 1 }));
    const manager = { getRepository: () => ({ update }) };
    await repository.updateStatus(TENANT, 7, { status: ChequeStatus.CLEARED }, manager as never);
    expect(update).toHaveBeenCalledWith({ id: 7, tenantId: TENANT }, { status: ChequeStatus.CLEARED });
  });

  it('locks the row and scopes by tenant for in-transaction reads', async () => {
    const findOne = jest.fn(async () => null);
    const manager = { getRepository: () => ({ findOne }) };
    await repository.findByIdForUpdate(TENANT, 3, manager as never);
    expect(findOne).toHaveBeenCalledWith({
      where: { id: 3, tenantId: TENANT },
      lock: { mode: 'pessimistic_write' },
    });
  });
});
