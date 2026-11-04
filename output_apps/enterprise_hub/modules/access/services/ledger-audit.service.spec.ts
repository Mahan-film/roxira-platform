import { LedgerAuditService } from './ledger-audit.service';

const make = () => {
  const record = jest.fn(async (_entry: unknown, _manager?: unknown) => undefined);
  return { record, service: new LedgerAuditService({ record } as never) };
};

describe('LedgerAuditService', () => {
  it('records a post with totals and a stable digest, no secrets', async () => {
    const { record, service } = make();
    const lines = [
      { accountId: 1, debitMinor: 500n, creditMinor: 0n },
      { accountId: 2, debitMinor: 0n, creditMinor: 500n },
    ];
    await service.record({ kind: 'posted', tenantId: 't', entryId: 9, entryNumber: 'N-1', entryDate: '2026-04-01', lines });
    await service.record({ kind: 'posted', tenantId: 't', entryId: 9, entryNumber: 'N-1', entryDate: '2026-04-01', lines });
    const [a, b] = record.mock.calls.map((c) => c[0] as { action: string; resourceType: string; resourceId: string; metadata: Record<string, unknown> });
    expect(a).toMatchObject({ action: 'ledger.entry.posted', resourceType: 'journal_entry', resourceId: '9' });
    expect(a.metadata).toMatchObject({ entryNumber: 'N-1', lineCount: 2, totalMinor: '500' });
    expect(a.metadata.linesDigest).toBe(b.metadata.linesDigest);
  });

  it('records reversals and passes the caller transaction through', async () => {
    const { record, service } = make();
    const manager = {} as never;
    await service.record({ kind: 'reversed', tenantId: 't', entryId: 10, entryNumber: 'N-1-REV', entryDate: '2026-04-02', lines: [], reversesEntryId: 9 }, manager);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ledger.entry.reversed' }), manager);
  });

  it('records period lock and unlock; only a uuid actor becomes actorUserId', async () => {
    const { record, service } = make();
    const uuid = '44444444-4444-4444-8444-444444444444';
    await service.record({ kind: 'period.locked', tenantId: 't', actor: uuid, lockId: 3, periodStart: '2026-01-01', periodEnd: '2026-01-31', reason: 'x' });
    await service.record({ kind: 'period.unlocked', tenantId: 't', actor: 'ali', lockId: 3, periodStart: '2026-01-01', periodEnd: '2026-01-31', reason: 'y' });
    const [l, u] = record.mock.calls.map((c) => c[0] as { action: string; actorUserId: string | null; metadata: Record<string, unknown> });
    expect(l).toMatchObject({ action: 'ledger.period.locked', actorUserId: uuid });
    expect(u).toMatchObject({ action: 'ledger.period.unlocked', actorUserId: null });
    expect(u.metadata.actor).toBe('ali');
  });
});
