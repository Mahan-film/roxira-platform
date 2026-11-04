import { ConflictException, NotFoundException } from '@nestjs/common';
import { AccountLevel, AccountType } from '../../accounting/enums/accounting.enum';
import { PostingRuleError } from '../domain/posting-error';
import { PostingRulesService, PostingRequest } from './posting-rules.service';

const T = '11111111-1111-4111-8111-111111111111';
const account = (code: string, accountType: AccountType, level = AccountLevel.MOEIN) => ({ code, name: `n${code}`, accountType, level });

function setup(accounts = [account('1012', AccountType.ASSET), account('1020', AccountType.ASSET), account('5010', AccountType.EXPENSE), account('10', AccountType.ASSET, AccountLevel.KOL)]) {
  const sources = new Map<string, { entryId: number | null; entryNumber: string | null; reversalEntryId: number | null }>();
  const maps: Array<{ docType: string; role: string; accountCode: string }> = [];
  const repo = {
    runInTransaction: jest.fn(async (_t: string, work: (m: unknown) => unknown) => work({})),
    listMappings: jest.fn(async (_t: string, types: string[]) => maps.filter((m) => types.includes(m.docType))),
    listAllMappings: jest.fn(async () => maps),
    findSource: jest.fn(async (_t: string, st: string, sid: string, dt: string) => sources.get(`${st}/${sid}/${dt}`) ?? null),
    claimSource: jest.fn(async (_t: string, st: string, sid: string, dt: string) => {
      if (sources.has(`${st}/${sid}/${dt}`)) return false;
      sources.set(`${st}/${sid}/${dt}`, { entryId: null, entryNumber: null, reversalEntryId: null });
      return true;
    }),
    attachEntry: jest.fn(async (_t: string, st: string, sid: string, dt: string, entryId: number, entryNumber: string) => {
      Object.assign(sources.get(`${st}/${sid}/${dt}`)!, { entryId, entryNumber });
    }),
    attachReversal: jest.fn(async (_t: string, st: string, sid: string, dt: string, id: number) => {
      sources.get(`${st}/${sid}/${dt}`)!.reversalEntryId = id;
    }),
    upsertMapping: jest.fn(),
    deleteMapping: jest.fn(),
  };
  let nextId = 100;
  const accounting = {
    listAccounts: jest.fn(async () => accounts),
    createJournalEntry: jest.fn(async (_t: string, dto: { entryNumber: string; lines?: Array<{ accountCode: string }> }) => ({ id: nextId++, entryNumber: dto.entryNumber })),
    reverseJournalEntry: jest.fn(async (_t: string, id: number) => ({ id: id + 1000, entryNumber: `REV-${id}` })),
  };
  const service = new PostingRulesService(repo as never, accounting as never);
  return { service, repo, accounting, maps, sources };
}

const request = (over: Partial<PostingRequest> = {}): PostingRequest => ({
  docType: 'bank.receipt',
  sourceType: 'bank_txn',
  sourceId: '9',
  date: '2026-11-04T00:00:00.000Z',
  amounts: { amount: 5_000n },
  description: 'test',
  overrides: { bank: '1012', counter: '1020' },
  ...over,
});

describe('PostingRulesService', () => {
  it('posts a balanced voucher once; a second call replays the first', async () => {
    const { service, accounting } = setup();
    const first = await service.post(T, request());
    const second = await service.post(T, request());
    expect(first).toMatchObject({ entryId: 100, entryNumber: 'bank_txn-9', replayed: false });
    expect(second).toMatchObject({ entryId: 100, replayed: true });
    expect(accounting.createJournalEntry).toHaveBeenCalledTimes(1);
    expect(accounting.createJournalEntry.mock.calls[0][1].lines).toEqual([
      expect.objectContaining({ accountCode: '1012', debit: '50.00', credit: '0.00' }),
      expect.objectContaining({ accountCode: '1020', debit: '0.00', credit: '50.00' }),
    ]);
  });

  it('one source can post two different document types', async () => {
    const { service, accounting } = setup();
    await service.post(T, request());
    const second = await service.post(T, request({ docType: 'bank.payment' }));
    expect(second.replayed).toBe(false);
    expect(accounting.createJournalEntry).toHaveBeenCalledTimes(2);
  });

  it('refuses to post when the source is claimed but not yet posted, and an over-long number', async () => {
    const { service, accounting, sources } = setup();
    sources.set('bank_txn/9/bank.receipt', { entryId: null, entryNumber: null, reversalEntryId: null });
    await expect(service.post(T, request())).rejects.toBeInstanceOf(ConflictException);
    await expect(service.post(T, request({ sourceId: '10', entryNumber: 'X'.repeat(65) }))).rejects.toThrow(/۶۴ نویسه/);
    expect(accounting.createJournalEntry).not.toHaveBeenCalled();
  });

  it('refuses an unmapped role and writes nothing', async () => {
    const { service, accounting, sources } = setup();
    await expect(service.post(T, request({ overrides: { bank: '1012' } }))).rejects.toThrow(/حسابی تعیین نشده/);
    expect(accounting.createJournalEntry).not.toHaveBeenCalled();
    expect(sources.size).toBe(0);
  });

  it('refuses an account missing from the tenant chart and a header account', async () => {
    const { service } = setup();
    await expect(service.post(T, request({ overrides: { bank: '9999', counter: '1020' } }))).rejects.toThrow(/وجود ندارد/);
    await expect(service.post(T, request({ overrides: { bank: '10', counter: '1020' } }))).rejects.toThrow(/گروه یا کل/);
  });

  it('the document type mapping wins over the tenant-wide one', async () => {
    const { service, maps, accounting } = setup();
    maps.push({ docType: '*', role: 'bank', accountCode: '1020' }, { docType: 'bank.receipt', role: 'bank', accountCode: '1012' });
    await service.post(T, request({ overrides: { counter: '5010' } }));
    expect(accounting.createJournalEntry.mock.calls[0][1].lines![0].accountCode).toBe('1012');
  });

  it('reverses through the source and refuses a second reversal', async () => {
    const { service, accounting } = setup();
    await service.post(T, request());
    const reversal = await service.reverse(T, 'bank.receipt', 'bank_txn', '9', { reason: 'x' });
    expect(accounting.reverseJournalEntry).toHaveBeenCalledWith(T, 100, { reason: 'x' });
    expect(reversal.entryId).toBe(1100);
    await expect(service.reverse(T, 'bank.receipt', 'bank_txn', '9')).rejects.toBeInstanceOf(ConflictException);
    await expect(service.reverse(T, 'bank.receipt', 'bank_txn', 'none')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('setMapping validates posting level and role/type fit', async () => {
    const { service, repo } = setup();
    await service.setMapping(T, 'bank.receipt', 'bank', '1012');
    expect(repo.upsertMapping).toHaveBeenCalledWith(T, 'bank.receipt', 'bank', '1012');
    await expect(service.setMapping(T, 'bank.receipt', 'bank', '10')).rejects.toThrow(/گروه یا کل/);
    await expect(service.setMapping(T, 'bank.receipt', 'bank', '5010')).rejects.toThrow(/سازگار نیست/);
    await expect(service.setMapping(T, 'bank.receipt', 'bank', '7777')).rejects.toBeInstanceOf(PostingRuleError);
    await expect(service.setMapping(T, 'nope', 'bank', '1012')).rejects.toBeInstanceOf(PostingRuleError);
    await expect(service.setMapping(T, '*', 'ghost', '1012')).rejects.toThrow(/شناخته/);
  });

  it('describe() reports source and validity per role', async () => {
    const { service, maps } = setup();
    maps.push({ docType: 'asset.depreciation', role: 'depreciation_expense', accountCode: '5010' });
    const d = (await service.describe(T)).find((t) => t.docType === 'asset.depreciation')!;
    expect(d.roles.find((r) => r.role === 'depreciation_expense')).toMatchObject({ accountCode: '5010', source: 'document', valid: true });
    expect(d.roles.find((r) => r.role === 'accumulated_depreciation')).toMatchObject({ accountCode: '1120', source: 'default', valid: false });
  });
});
