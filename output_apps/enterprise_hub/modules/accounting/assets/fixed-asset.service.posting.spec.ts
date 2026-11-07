import { fakePostingRules } from '../../hr/__fixtures__/fake-posting-rules';
import { BadRequestException } from '@nestjs/common';
import { FixedAssetEntity } from '../entities/fixed-asset.entity';
import { FixedAssetService } from '../services/fixed-asset.service';

/** runMonth through the real posting rules service: one voucher per asset, replay-safe. */
const T = 't1';
const mk = (id: number, code: string, expense: string, accumulated: string): FixedAssetEntity =>
  ({
    id, tenantId: T, code, acquisitionDate: '2026-04-10', cost: '1200.00', salvageValue: '0.00',
    accumulatedDepreciation: '0.00', method: 'STRAIGHT_LINE', lifeMonths: 12, annualRate: null,
    monthsDepreciated: 0, nextPeriodIndex: 1405 * 12 + 0, status: 'ACTIVE',
    expenseAccountCode: expense, accumulatedAccountCode: accumulated,
  }) as unknown as FixedAssetEntity;

const setup = () => {
  const assets = [mk(1, 'A', '5060', '1120'), mk(2, 'B', '5061', '1121')];
  const entries: Array<{ entryNumber: string; date: string; lines: Array<{ accountCode: string; debit?: string; credit?: string }> }> = [];
  const accounting = {
    listAccounts: async () => ['5060', '5061', '1120', '1121'].map((code) => ({ code, level: 'DETAIL' })),
    createJournalEntry: async (_t: string, dto: (typeof entries)[number]) => {
      entries.push(dto);
      return { id: entries.length, entryNumber: dto.entryNumber };
    },
  };
  const repo = {
    scoped: async (_t: string, work: (m: unknown) => unknown) => work({}),
    lockActive: async () => assets,
    entriesInPeriod: async () => entries.length,
    applyCharge: async (_t: string, a: FixedAssetEntity, line: { amount: string }) => {
      a.accumulatedDepreciation = (Number(a.accumulatedDepreciation) + Number(line.amount)).toFixed(2);
      a.monthsDepreciated += 1;
      a.nextPeriodIndex += 1;
    },
  };
  const posting = fakePostingRules(accounting as never);
  const service = new FixedAssetService(repo as never, {} as never, posting, { get: async () => 'refuse' } as never);
  return { service, posting, entries };
};

describe('FixedAssetService.runMonth on the posting rules engine', () => {
  it('posts one voucher per asset with the asset own accounts and amounts', async () => {
    const { service, entries } = setup();
    const run = await service.runMonth(T, { year: 1405, month: 1 });
    expect(run.entryNumbers).toEqual(['DEP-140501-1', 'DEP-140501-2']);
    expect(run.entryNumber).toBe('DEP-140501-1');
    expect(run.totalCharged).toBe('200.00');
    expect(entries.map((e) => e.lines)).toEqual([
      [{ accountCode: '5060', debit: '100.00', credit: '0.00', description: 'هزینه استهلاک' }, { accountCode: '1120', debit: '0.00', credit: '100.00', description: 'استهلاک انباشته' }],
      [{ accountCode: '5061', debit: '100.00', credit: '0.00', description: 'هزینه استهلاک' }, { accountCode: '1121', debit: '0.00', credit: '100.00', description: 'استهلاک انباشته' }],
    ]);
    expect(entries[0].date).toBe('2026-04-20');
  });

  it('a month already posted creates no second voucher, and the engine replays the first', async () => {
    const { service, posting, entries } = setup();
    await service.runMonth(T, { year: 1405, month: 1 });
    const again = await service.runMonth(T, { year: 1405, month: 1 });
    expect(again.entryNumbers).toEqual([]);
    expect(again.skipped.map((s) => s.reason)).toEqual(['ALREADY_DONE', 'ALREADY_DONE']);
    expect(entries).toHaveLength(2);
    const replay = await posting.post(T, {
      docType: 'asset.depreciation', sourceType: 'asset_depreciation', sourceId: '1:140501', date: '2026-04-20',
      amounts: { charge: 10000n }, description: 'x',
      overrides: { depreciation_expense: '5060', accumulated_depreciation: '1120' },
    });
    expect(replay).toMatchObject({ replayed: true, entryNumber: 'DEP-140501-1' });
    expect(entries).toHaveLength(2);
  });
});

/** dispose() reads the disposal-before-depreciation policy (#585): refuse keeps today's guard, allow skips it. */
function setupDispose(mode: 'refuse' | 'allow') {
  const asset = {
    id: 1, tenantId: T, code: 'A', name: 'A', cost: '1200.00', salvageValue: '0.00',
    accumulatedDepreciation: '0.00', method: 'STRAIGHT_LINE', lifeMonths: 12, annualRate: null,
    monthsDepreciated: 0, nextPeriodIndex: 0, status: 'ACTIVE',
    expenseAccountCode: '5060', accumulatedAccountCode: '1120', assetAccountCode: '1113',
  } as unknown as FixedAssetEntity;
  const posted: string[] = [];
  const repo = {
    scoped: async (_t: string, work: (m: unknown) => unknown) => work({}),
    lockById: async () => ({ ...asset }),
    lastPostedDepreciationDate: async () => '2026-03-20',
    postedAccumulated: async () => 0n,
    markDisposed: async () => undefined,
  };
  const ledger = { assertDateOpen: async () => undefined };
  const posting = {
    post: async (_t: string, request: { sourceId: string }) => {
      posted.push(request.sourceId);
      return { entryId: 1, entryNumber: 'FA-1' };
    },
    accountForRole: async () => '1011',
  };
  const policy = { get: async () => mode };
  const service = new FixedAssetService(repo as never, ledger as never, posting as never, policy as never);
  return { service, posted };
}

describe('FixedAssetService.dispose policy (#585)', () => {
  it('refuses a disposal before the last posted depreciation under the refuse policy', async () => {
    const { service } = setupDispose('refuse');
    await expect(
      service.dispose(T, 1, { date: '2026-02-10', proceeds: '0.00', settlementAccountCode: '1011' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('proceeds and posts under the allow policy', async () => {
    const { service, posted } = setupDispose('allow');
    const result = await service.dispose(T, 1, {
      date: '2026-02-10',
      proceeds: '0.00',
      settlementAccountCode: '1011',
    } as never);
    expect(result.status).toBe('DISPOSED');
    expect(posted).toEqual(['1']);
  });
});
