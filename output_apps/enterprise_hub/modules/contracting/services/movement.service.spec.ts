import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { ContractSide, ContractStatus } from '../enums/contracting.enum';
import { MovementService } from './movement.service';

const T = '11111111-1111-4111-8111-111111111111';
const term = (rate: string | null) => ({ key: 'contract_advance_payment_max_rate', rate, unclear: rate === null, verified: false, version: 1, effectiveFrom: '', source: 's', tenantOverride: rate !== null });

function build(opts: { cap?: string | null; held?: bigint; released?: bigint; advanced?: bigint; existing?: any } = {}) {
  const inserted: any[] = [];
  const movements: any = {
    runInTransaction: (_t: string, work: (m: unknown) => unknown) => work({ query: async () => [] }),
    findByKey: jest.fn(async () => opts.existing ?? null),
    sum: jest.fn(async (_t: string, _c: number, kind: string) => (kind === 'advance' ? opts.advanced ?? 0n : opts.released ?? 0n)),
    retentionHeld: jest.fn(async () => opts.held ?? 0n),
    insert: jest.fn(async (_t: string, input: any) => { inserted.push(input); return { id: 3, ...input }; }),
    attachJournal: jest.fn(async () => undefined),
  };
  const contracts: any = { findById: jest.fn(async () => ({ id: 1, code: 'K1', side: ContractSide.EMPLOYER, partyCode: 'S1', status: ContractStatus.ACTIVE, amount: '1000000000.00', advanceAmount: '100000000.00' })) };
  const postingRules: any = { post: jest.fn(async () => ({ entryId: 9, entryNumber: 'E-9', replayed: false })) };
  const statutory: any = { contractTermsOn: jest.fn(async () => ({ advancePaymentMax: term(opts.cap === undefined ? '0.2' : opts.cap) })) };
  return { service: new MovementService(movements, contracts, postingRules, statutory), inserted, postingRules };
}
const req = (amount: string, requestKey?: string) => ({ date: '2026-11-01', amount, requestKey });

describe('MovementService.advance', () => {
  it('posts 100,000,000 when the cap is 20% of 1,000,000,000 (200,000,000) and the agreed advance is 100,000,000', async () => {
    const { service, postingRules } = build();
    const out = await service.advance(T, 1, req('100000000'));
    expect(out).toMatchObject({ kind: 'advance', journalEntryId: 9, replayed: false });
    expect(postingRules.post.mock.calls[0][1]).toMatchObject({ docType: 'contract.advance.employer', amounts: { amount: 10000000000n } });
  });
  it('refuses when the cap figure is unclear, naming it, and writes nothing', async () => {
    const { service, inserted, postingRules } = build({ cap: null });
    await expect(service.advance(T, 1, req('1000'))).rejects.toThrow('سقف پیش‌پرداخت قرارداد');
    expect(inserted).toEqual([]);
    expect(postingRules.post).not.toHaveBeenCalled();
  });
  it('refuses above the agreed advance, and above a 5% cap (50,000,000) even within the agreement', async () => {
    await expect(build().service.advance(T, 1, req('150000000'))).rejects.toThrow('مبلغ توافق‌شده');
    await expect(build({ cap: '0.05' }).service.advance(T, 1, req('60000000'))).rejects.toThrow('سقف قانونی');
    await expect(build({ advanced: 60_000_000_00n }).service.advance(T, 1, req('50000000'))).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('MovementService.releaseRetention', () => {
  it('releases up to the held 40,000,000 and refuses 40,000,001', async () => {
    const held = 4_000_000_000n;
    const ok = build({ held });
    expect(await ok.service.releaseRetention(T, 1, req('40000000'))).toMatchObject({ kind: 'retention_release', amount: 40000000 });
    expect(ok.postingRules.post.mock.calls[0][1].docType).toBe('contract.retention_release.employer');
    await expect(build({ held }).service.releaseRetention(T, 1, req('40000000.01'))).rejects.toThrow('بیشتر');
    await expect(build({ held, released: 1_000_000_000n }).service.releaseRetention(T, 1, req('30000000.01'))).rejects.toThrow('بیشتر');
  });
  it('a repeated requestKey returns the first result and posts nothing', async () => {
    const { service, postingRules } = build({ held: 4_000_000_000n, existing: { id: 3, contractId: 1, kind: 'retention_release', movementDate: '2026-11-01', amount: '40000000.00', journalEntryId: 9, journalEntryNumber: 'E-9', termsSnapshot: [] } });
    expect(await service.releaseRetention(T, 1, req('40000000', 'k1'))).toMatchObject({ id: 3, replayed: true });
    expect(postingRules.post).not.toHaveBeenCalled();
  });
});
