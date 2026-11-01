import 'reflect-metadata';
import { ChequesRepository } from './repositories/cheques.repository';
import { ChequeStatus } from './enums/cheque.enum';

const TENANT = '11111111-1111-4111-8111-111111111111';

function scopeDouble() {
  const cheques = { findOne: jest.fn(async (_o: unknown) => null), find: jest.fn(async (_o: unknown) => []),
    save: jest.fn(async (rows: unknown) => rows), create: jest.fn((row: unknown) => row) };
  const events = { find: jest.fn(async (_o: unknown) => []), save: jest.fn(async (rows: unknown) => rows),
    create: jest.fn((row: unknown) => row) };
  const manager = { getRepository: (e: { name: string }) => (e.name === 'ChequeEntity' ? cheques : events) };
  const run = jest.fn(async (_t: string, fn: (m: unknown) => Promise<unknown>) => fn(manager));
  return { cheques, events, run, scope: { run } };
}

describe('ChequesRepository tenant scoping', () => {
  const { cheques, events, run, scope } = scopeDouble();
  const repository = new ChequesRepository(scope as never);
  beforeEach(() => jest.clearAllMocks());

  it('runs every read in a TenantScope and scopes it by tenant_id', async () => {
    await repository.findById(TENANT, 1);
    await repository.findBySayadNumber(TENANT, '1234567890123456');
    await repository.list(TENANT, { direction: undefined, dueFrom: '2026-01-01', dueTo: '2026-02-01' });
    await repository.listOpenDueBy(TENANT, [ChequeStatus.REGISTERED], '2026-02-01');
    await repository.listEvents(TENANT, 1);

    expect(run).toHaveBeenCalledTimes(5);
    for (const call of run.mock.calls) expect(call[0]).toBe(TENANT);
    const wheres = [...cheques.findOne.mock.calls, ...cheques.find.mock.calls, ...events.find.mock.calls].map(
      ([o]) => (o as { where: Record<string, unknown> }).where,
    );
    expect(wheres).toHaveLength(5);
    for (const where of wheres) expect(where.tenantId).toBe(TENANT);
  });

  it('stamps tenant_id on writes inside a scope and scopes status updates', async () => {
    await repository.create(TENANT, { direction: 'received' } as never);
    await repository.addEvent(TENANT, { chequeId: 1 } as never);
    expect(run).toHaveBeenCalledTimes(2);
    expect(cheques.create.mock.calls[0][0]).toMatchObject({ tenantId: TENANT, status: 'registered' });
    expect(events.create.mock.calls[0][0]).toMatchObject({ tenantId: TENANT });

    const update = jest.fn(async () => ({ affected: 1 }));
    const manager = { getRepository: () => ({ update }) };
    await repository.updateStatus(TENANT, 7, { status: ChequeStatus.CLEARED }, manager as never);
    expect(update).toHaveBeenCalledWith({ id: 7, tenantId: TENANT }, { status: ChequeStatus.CLEARED });
  });

  it('reuses the caller transaction instead of opening a second scope', async () => {
    run.mockClear();
    const save = jest.fn(async (r: unknown) => r);
    const manager = { getRepository: () => ({ save, create: (r: unknown) => r }) };
    await repository.addEvent(TENANT, { chequeId: 1 } as never, manager as never);
    expect(run).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
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
