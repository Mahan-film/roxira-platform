import 'reflect-metadata';
import { ConflictException } from '@nestjs/common';
import { ContractSide, ContractStatus, StatementStatus } from '../enums/contracting.enum';
import { StatementService } from '../services/statement.service';

const T = '11111111-1111-4111-8111-111111111111';
const row = (over: Record<string, unknown> = {}) => ({
  id: 5, contractId: 1, number: 1, statementDate: '2026-11-01', cumulativeAmount: '300000000.00', previousAmount: '0.00', periodAmount: '300000000.00',
  retentionAmount: '0.00', insuranceAmount: '0.00', advanceRecoveryAmount: '0.00', status: StatementStatus.DRAFT,
  journalEntryId: null, journalEntryNumber: null, approvedAt: null, postedAt: null, ...over,
});

function build(opts: { contract?: Record<string, unknown>; last?: any; found?: any; retentionRate?: string | null } = {}) {
  const inserted: any[] = [];
  const repository: any = {
    runInTransaction: (_t: string, work: (m: unknown) => unknown) => work({}),
    lockContract: jest.fn(async () => undefined),
    findLast: jest.fn(async () => opts.last ?? null),
    findById: jest.fn(async () => opts.found ?? null),
    insert: jest.fn(async (_t: string, input: any) => { inserted.push(input); return row(input); }),
    markPosted: jest.fn(async (_t: string, id: number, e: any) => row({ id, status: StatementStatus.POSTED, ...e })),
  };
  const contracts: any = {
    findById: jest.fn(async () => ({ id: 1, code: 'K1', side: ContractSide.CONTRACTOR, partyCode: 'C1', status: ContractStatus.ACTIVE, amount: '1000000000.00', ...opts.contract })),
  };
  const term = (key: string, rate: string | null) => ({ key, rate, unclear: rate === null, verified: false, version: 1, effectiveFrom: '2026-03-21', source: 's', tenantOverride: false });
  const statutory: any = {
    contractTermsOn: jest.fn(async () => ({
      retention: term('contract_retention_rate', opts.retentionRate === undefined ? '0.1' : opts.retentionRate),
      insuranceByType: {}, unemploymentAddon: term('contract_unemployment_addon_fraction', null),
    })),
  };
  repository.approveWith = jest.fn(async (_t: string, id: number, d: any) => row({ id, status: StatementStatus.APPROVED, ...d }));
  repository.recoveredBefore = jest.fn(async () => 0n);
  const movements: any = { sum: jest.fn(async () => 0n) };
  const postingRules: any = { post: jest.fn(async () => ({ entryId: 9, entryNumber: 'progress_statement-5', replayed: false })) };
  return { service: new StatementService(repository, contracts, postingRules, statutory, movements), inserted, postingRules, repository };
}

describe('StatementService.create', () => {
  it('refuses a contract that is not active', async () => {
    await expect(build({ contract: { status: ContractStatus.DRAFT } }).service.create(T, 1, { statementDate: '2026-11-01', cumulativeAmount: '1' })).rejects.toBeInstanceOf(ConflictException);
  });
  it('refuses when the previous statement is still a draft', async () => {
    await expect(build({ last: row() }).service.create(T, 1, { statementDate: '2026-11-02', cumulativeAmount: '500000000' })).rejects.toThrow('تأیید نشده');
  });
  it('numbers the second statement 2 with period 700,000,000 - 300,000,000 = 400,000,000', async () => {
    const { service, inserted } = build({ last: row({ status: StatementStatus.APPROVED }) });
    await service.create(T, 1, { statementDate: '2026-12-01', cumulativeAmount: '700000000' });
    expect(inserted[0]).toMatchObject({ number: 2, cumulativeAmount: '700000000.00', previousAmount: '300000000.00', periodAmount: '400000000.00' });
  });
  it('refuses a cumulative not above the previous, above the contract, or a date going back', async () => {
    const last = row({ status: StatementStatus.APPROVED });
    await expect(build({ last }).service.create(T, 1, { statementDate: '2026-12-01', cumulativeAmount: '300000000' })).rejects.toThrow('بیشتر باشد');
    await expect(build({ last }).service.create(T, 1, { statementDate: '2026-12-01', cumulativeAmount: '1000000001' })).rejects.toThrow('از مبلغ قرارداد');
    await expect(build({ last }).service.create(T, 1, { statementDate: '2026-10-01', cumulativeAmount: '500000000' })).rejects.toThrow('عقب‌تر');
  });
});

describe('StatementService.post', () => {
  it('refuses an unapproved statement', async () => {
    const { service, postingRules } = build({ found: row() });
    await expect(service.post(T, 5)).rejects.toThrow('تأیید');
    expect(postingRules.post).not.toHaveBeenCalled();
  });
  it('posts an approved contractor statement with gross = net = 300,000,000, then replays without a second voucher', async () => {
    const { service, postingRules } = build({ found: row({ status: StatementStatus.APPROVED }) });
    const first = await service.post(T, 5);
    expect(first).toMatchObject({ status: 'posted', journalEntryId: 9, replayed: false });
    expect(postingRules.post.mock.calls[0][1]).toMatchObject({
      docType: 'contract.statement.contractor', sourceType: 'progress_statement', sourceId: '5', partyCode: 'C1',
      amounts: { gross: 30000000000n, retention: 0n, insurance: 0n, advance: 0n, net: 30000000000n },
    });
    const again = build({ found: row({ status: StatementStatus.POSTED, journalEntryId: 9 }) });
    expect((await again.service.post(T, 5)).replayed).toBe(true);
    expect(again.postingRules.post).not.toHaveBeenCalled();
  });
  it('uses the employer template for an employer contract', async () => {
    const { service, postingRules } = build({ found: row({ status: StatementStatus.APPROVED }), contract: { side: ContractSide.EMPLOYER } });
    await service.post(T, 5);
    expect(postingRules.post.mock.calls[0][1].docType).toBe('contract.statement.employer');
  });
});

describe('StatementService.approve', () => {
  it('stores retention 10% of 300,000,000 = 30,000,000 and no insurance for a contract without insurance type', async () => {
    const { service, repository } = build({ found: row() });
    const out = await service.approve(T, 5);
    expect(repository.approveWith.mock.calls[0][2]).toMatchObject({ retentionAmount: '30000000.00', insuranceAmount: '0.00', advanceRecoveryAmount: '0.00' });
    expect(out.status).toBe('approved');
  });
  it('refuses when the retention figure is unclear, naming it, and approves nothing', async () => {
    const { service, repository } = build({ found: row(), retentionRate: null });
    await expect(service.approve(T, 5)).rejects.toThrow('سپرده حسن انجام کار');
    expect(repository.approveWith).not.toHaveBeenCalled();
  });
  it('refuses a statement that is not a draft', async () => {
    await expect(build({ found: row({ status: StatementStatus.APPROVED }) }).service.approve(T, 5)).rejects.toBeInstanceOf(ConflictException);
  });
});
