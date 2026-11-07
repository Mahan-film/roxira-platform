import { RecurringVoucherService } from './recurring-voucher.service';

/** One broken template or reversal is reported and must not stop the others. */
describe('RecurringVoucherService.runDue isolation', () => {
  const template = (id: number) => ({
    id,
    nextRunDate: '2026-01-01',
    endDate: '2026-01-01',
    frequency: 'MONTHLY',
    autoReverse: false,
    description: 'x',
    lines: [],
  });

  function build(overrides: { dueReversals?: unknown[]; reverse?: jest.Mock } = {}) {
    const repo = {
      findActiveDue: jest.fn().mockResolvedValue([template(1), template(2)]),
      findDueReversals: jest.fn().mockResolvedValue(overrides.dueReversals ?? []),
      setNextRunDate: jest.fn().mockResolvedValue(undefined),
      setRunReversalEntry: jest.fn().mockResolvedValue(undefined),
      insertRunIfAbsent: jest.fn().mockResolvedValue(10),
      attachRunEntry: jest.fn().mockResolvedValue(undefined),
      transaction: jest.fn((_tenant: string, work: (m: unknown) => unknown) => work({})),
    };
    const accounting = {
      createJournalEntry: jest
        .fn()
        .mockRejectedValueOnce(new Error('inactive account'))
        .mockResolvedValue({ id: 99 }),
      reverseJournalEntry: overrides.reverse ?? jest.fn(),
    };
    return { service: new RecurringVoucherService(repo as never, accounting as never), repo };
  }

  it('reports a broken template, leaves its date unadvanced, and still runs the next one', async () => {
    const { service, repo } = build();
    const result = await service.runDue('t', '2026-01-01');
    expect(result.created).toBe(1);
    expect(result.skipped.map((s) => s.id)).toEqual([1]);
    expect(repo.setNextRunDate).toHaveBeenCalledTimes(1);
    expect(repo.setNextRunDate.mock.calls[0][1]).toBe(2);
  });

  it('reports a failed reversal and still runs the next one', async () => {
    const reverse = jest
      .fn()
      .mockRejectedValueOnce(new Error('already reversed'))
      .mockResolvedValue({ id: 7 });
    const run = (id: number) => ({ id, recurringId: id, journalEntryId: id, reversalDate: '2026-02-01' });
    const { service } = build({ dueReversals: [run(1), run(2)], reverse });
    const result = await service.runDue('t', '2026-01-01');
    expect(result.reversed).toBe(1);
    expect(result.skipped.some((s) => s.id === 1 && s.date === '2026-02-01')).toBe(true);
  });
});
