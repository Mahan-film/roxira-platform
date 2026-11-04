import 'reflect-metadata';
import { TreasuryDocKind } from './enums/treasury.enum';
import { TreasuryRepository } from './repositories/treasury.repository';

const T = '11111111-1111-4111-8111-111111111111';

function doubles() {
  const find = jest.fn(async (_o: unknown) => []);
  const findOne = jest.fn(async (_o: unknown) => null);
  const query = jest.fn(async (_sql: string, _p?: unknown[]) => [{ n: 1 }] as unknown[]);
  const qb: any = { where: jest.fn(() => qb), andWhere: jest.fn(() => qb), orderBy: jest.fn(() => qb), addOrderBy: jest.fn(() => qb), limit: jest.fn(() => qb), getMany: jest.fn(async () => []) };
  const manager: any = { query, getRepository: () => ({ find, findOne, createQueryBuilder: () => qb, update: jest.fn(), save: jest.fn(async (x: unknown) => x), create: (x: unknown) => x }) };
  const run = jest.fn(async (_t: string, fn: (m: unknown) => Promise<unknown>) => fn(manager));
  const within = jest.fn(async (_t: string, m: unknown, fn: (m: unknown) => Promise<unknown>) => (m ? fn(m) : run(_t, fn)));
  return { find, findOne, query, qb, manager, run, scope: { run, within } };
}

describe('TreasuryRepository tenant scoping', () => {
  it('runs reads in a TenantScope and filters by tenant_id', async () => {
    const d = doubles();
    const repo = new TreasuryRepository(d.scope as never);
    await repo.findDocument(T, 1);
    await repo.listLines(T, 1);
    await repo.listAllocationsOfDocument(T, 1);
    await repo.listDocuments(T, { kind: TreasuryDocKind.RECEIPT });
    await repo.getTolerance(T);
    expect(d.run).toHaveBeenCalledTimes(5);
    for (const call of d.run.mock.calls) expect(call[0]).toBe(T);
    for (const [o] of [...d.findOne.mock.calls, ...d.find.mock.calls]) expect((o as any).where.tenantId).toBe(T);
    expect(d.qb.where).toHaveBeenCalledWith('d.tenant_id = :tenantId', { tenantId: T });
  });

  it('raw SQL always binds the tenant as the first parameter and filters on it', async () => {
    const d = doubles();
    const repo = new TreasuryRepository(d.scope as never);
    await repo.listAllocations(T, { partyCode: 'C1', asOf: '2026-11-04' });
    await repo.allocatedByTarget(T, ['x'], d.manager);
    await repo.nextNumber(T, TreasuryDocKind.PAYMENT, d.manager);
    await repo.setTolerance(T, '5.00');
    for (const [sql, params] of d.query.mock.calls) {
      expect((params as unknown[])[0]).toBe(T);
      expect(sql).toMatch(/tenant_id/);
    }
  });

  it('takes sorted advisory locks per invoice, once each', async () => {
    const d = doubles();
    await new TreasuryRepository(d.scope as never).lockTargets(T, ['b', 'a', 'b'], d.manager);
    expect(d.query.mock.calls.map((c) => (c[1] as string[])[0])).toEqual([`treasury:${T}:a`, `treasury:${T}:b`]);
  });

  it('skips the aggregate query when no invoice is asked for', async () => {
    const d = doubles();
    expect((await new TreasuryRepository(d.scope as never).allocatedByTarget(T, [], d.manager)).size).toBe(0);
    expect(d.query).not.toHaveBeenCalled();
  });
});
