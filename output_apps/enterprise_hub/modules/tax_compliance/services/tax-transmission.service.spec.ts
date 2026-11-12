import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import type { InvoiceItem } from '../../invoicing/entities/invoice.entity';
import { MOADIAN_TX_JOB } from '../constants/moadian.constants';
import { FiscalMemoryProfileEntity } from '../entities/fiscal-memory-profile.entity';
import { MoadianSubmissionEntity } from '../entities/moadian-submission.entity';
import { MoadianInquiryStatus as Inq, MoadianInvoiceSubject as S, MoadianSubmissionStatus as St } from '../enums/moadian.enum';
import { TaxTransmissionEnvironment, TaxTransmissionMode } from '../enums/tax-transmission.enum';
import { FiscalMemoryProfileRepository } from '../repositories/fiscal-memory-profile.repository';
import { TaxTransmissionRepository } from '../repositories/tax-transmission.repository';
import { FakeTspAdapter } from '../testing/fake-tsp.adapter';
import { DirectAdapter } from '../transmission/direct.adapter';
import { TaxTransmissionAdapterFactory } from '../transmission/tax-transmission-adapter.factory';
import { TaxChainBlockedError } from '../utils/tax-reference-chain';
import { TaxTransmissionService } from './tax-transmission.service';

const T = '11111111-1111-4111-8111-111111111111';
const profile = {
  id: 'p1',
  tenantId: T,
  memoryId: 'ABC123',
  mode: TaxTransmissionMode.TSP_TAXPAYER_KEY,
  environment: TaxTransmissionEnvironment.SANDBOX,
  tspProvider: 'fake',
  active: true,
} as FiscalMemoryProfileEntity;

function makeSubmission(over: Partial<MoadianSubmissionEntity> = {}): MoadianSubmissionEntity {
  return {
    id: 's1',
    tenantId: T,
    invoiceId: 'inv1',
    ins: 1,
    rootInvoiceId: 'inv1',
    profileId: 'p1',
    uid: '9f1c0000-0000-4000-8000-000000000001',
    taxId: 'TAX-ORIGINAL-000000000',
    serial: '1',
    status: St.QUEUED,
    attemptCount: 0,
    pollCount: 0,
    packet: { header: { taxid: 'TAX-ORIGINAL-000000000' } },
    errors: [],
    warnings: [],
    referenceNumber: null,
    ...over,
  } as MoadianSubmissionEntity;
}

/** Row store that mimics the persistence rules the service relies on (uid/taxid are never patched). */
function makeRepo(initial: MoadianSubmissionEntity) {
  const row = { ...initial };
  const repo = {
    row,
    findById: jest.fn(async () => ({ ...row })),
    update: jest.fn(async (_t: string, _id: string, patch: Partial<MoadianSubmissionEntity>) => {
      Object.assign(row, patch);
      return { ...row };
    }),
    markAttempt: jest.fn(async () => {
      row.attemptCount += 1;
    }),
    confirm: jest.fn(async () => {
      row.status = St.SUCCESS;
    }),
    enqueue: jest.fn(),
  };
  return repo;
}

function setup(initial = makeSubmission()) {
  const repo = makeRepo(initial);
  const fake = new FakeTspAdapter();
  const direct = { modes: [TaxTransmissionMode.DIRECT] } as unknown as DirectAdapter;
  const profiles = { findById: jest.fn(async () => profile) } as unknown as FiscalMemoryProfileRepository;
  const queue = { add: jest.fn(async () => undefined) };
  const config = { get: (k: string) => (k === 'MOADIAN_ENABLED' ? 'true' : undefined) } as unknown as ConfigService;
  const service = new TaxTransmissionService(
    repo as unknown as TaxTransmissionRepository,
    profiles,
    new TaxTransmissionAdapterFactory(direct, [fake]),
    config,
    queue as unknown as Queue,
  );
  return { service, repo, fake, queue, profiles };
}
const data = { tenantId: T, submissionId: 's1' };

describe('TaxTransmissionService send path', () => {
  it('first send keeps the stored uid/taxid and schedules a poll', async () => {
    const { service, fake, repo, queue } = setup();
    await expect(service.process(data)).resolves.toBe('poll');
    expect(fake.inquired).toHaveLength(0);
    expect(fake.submitted).toEqual([
      expect.objectContaining({ uid: repo.row.uid, taxId: 'TAX-ORIGINAL-000000000' }),
    ]);
    expect(repo.row.status).toBe(St.SENT);
    expect(queue.add).toHaveBeenCalledWith(MOADIAN_TX_JOB, data, expect.any(Object));
  });

  it('timeout -> UNKNOWN (not FAILED) -> inquiry SUCCESS -> no resend', async () => {
    const { service, fake, repo } = setup();
    fake.script = [{ kind: 'timeout', stored: Inq.SUCCESS }]; // response lost, server has it
    await expect(service.process(data)).rejects.toThrow('timeout');
    expect(repo.row.status).toBe(St.UNKNOWN);
    expect(repo.row.status).not.toBe(St.FAILED);

    await expect(service.process(data)).resolves.toBe('done');
    expect(fake.inquired).toEqual([[repo.row.uid]]);
    expect(fake.submitted).toHaveLength(1); // never sent a second time
    expect(repo.confirm).toHaveBeenCalledTimes(1);
    expect(repo.row.status).toBe(St.SUCCESS);
  });

  it('5xx -> UNKNOWN; NOT_FOUND on inquiry -> resend with the SAME uid and taxid', async () => {
    const { service, fake, repo } = setup();
    const uid = repo.row.uid;
    fake.script = [{ kind: 'http500' }, { kind: 'ok' }];
    await expect(service.process(data)).rejects.toThrow('HTTP 500');
    expect(repo.row.status).toBe(St.UNKNOWN);
    fake.server.clear(); // the authority never saw it

    await expect(service.process(data)).resolves.toBe('poll');
    expect(fake.inquired).toHaveLength(1); // inquiry ran before the resend
    expect(fake.submitted).toHaveLength(2);
    expect(fake.submitted[1]).toMatchObject({ uid, taxId: 'TAX-ORIGINAL-000000000' });
    expect(repo.row.uid).toBe(uid);
    expect(repo.row.taxId).toBe('TAX-ORIGINAL-000000000');
  });

  it('the outbox never patches uid or taxid', async () => {
    const { service, fake, repo } = setup();
    fake.script = [{ kind: 'timeout' }];
    await expect(service.process(data)).rejects.toThrow();
    for (const call of repo.update.mock.calls) {
      expect(call[2]).not.toHaveProperty('uid');
      expect(call[2]).not.toHaveProperty('taxId');
    }
  });

  it('a crashed attempt (QUEUED with attemptCount > 0) inquires before sending', async () => {
    const { service, fake } = setup(makeSubmission({ attemptCount: 1 }));
    fake.server.set(makeSubmission().uid, Inq.PENDING);
    await expect(service.process(data)).resolves.toBe('poll');
    expect(fake.inquired).toHaveLength(1);
    expect(fake.submitted).toHaveLength(0);
  });

  it('a definite 4xx on send is FAILED', async () => {
    const { service, fake, repo } = setup();
    fake.script = [{ kind: 'reject' }];
    await expect(service.process(data)).resolves.toBe('done');
    expect(repo.row.status).toBe(St.FAILED);
    expect(repo.row.errors).toEqual([{ code: '4001', message: 'bad packet' }]);
  });

  it('SENT + PENDING keeps polling and never resends; SENT + NOT_FOUND is not a resend either', async () => {
    const { service, fake, queue } = setup(makeSubmission({ status: St.SENT, referenceNumber: 'R1' }));
    fake.server.set(makeSubmission().uid, Inq.PENDING);
    await expect(service.process(data)).resolves.toBe('poll');
    fake.server.clear();
    await expect(service.process(data)).resolves.toBe('poll');
    expect(fake.submitted).toHaveLength(0);
    expect(queue.add).toHaveBeenCalledTimes(2);
  });

  it('inquiry SUCCESS on a SENT row confirms it', async () => {
    const { service, fake, repo } = setup(makeSubmission({ status: St.SENT }));
    fake.server.set(makeSubmission().uid, Inq.SUCCESS);
    await expect(service.process(data)).resolves.toBe('done');
    expect(repo.confirm).toHaveBeenCalled();
  });

  it('an inquiry error leaves the row UNKNOWN, never FAILED', async () => {
    const { service, fake, repo } = setup(makeSubmission({ status: St.UNKNOWN }));
    jest.spyOn(fake, 'inquireByUid').mockRejectedValue(Object.assign(new Error('x'), {}));
    await expect(service.process(data)).rejects.toThrow('x');
    expect(repo.row.status).toBe(St.UNKNOWN);
  });

  it('does nothing for final states', async () => {
    const { service, fake } = setup(makeSubmission({ status: St.SUCCESS }));
    await expect(service.process(data)).resolves.toBe('done');
    expect(fake.submitted).toHaveLength(0);
    expect(fake.inquired).toHaveLength(0);
  });
});

describe('TaxTransmissionService.enqueue', () => {
  const item = (quantity: number, originalLine?: number): InvoiceItem =>
    ({ description: 'x', quantity, unitPrice: 1, discount: 0, vatRate: 0.1, tax: 0, total: 0, originalLine }) as InvoiceItem;
  const build = jest.fn(() => ({ taxId: 'T', packet: {} }));

  it('a 100% return is enqueued as a cancellation (ins=3)', async () => {
    const { service, repo, queue } = setup();
    repo.enqueue.mockResolvedValue({ submission: makeSubmission({ id: 's9' }), created: true });
    const res = await service.enqueue(T, {
      invoiceId: 'ret1',
      profileId: 'p1',
      ins: S.RETURN,
      rootInvoiceId: 'inv1',
      returnLines: { original: [item(2), item(1)], returned: [item(2, 0), item(1, 1)] },
      build,
    });
    expect(res.ins).toBe(S.CANCELLATION);
    expect(repo.enqueue.mock.calls[0][1]).toMatchObject({ ins: S.CANCELLATION, invoiceId: 'ret1' });
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('a partial return stays a return (ins=4)', async () => {
    const { service, repo } = setup();
    repo.enqueue.mockResolvedValue({ submission: makeSubmission({ id: 's9' }), created: true });
    const res = await service.enqueue(T, {
      invoiceId: 'ret1',
      profileId: 'p1',
      ins: S.RETURN,
      rootInvoiceId: 'inv1',
      returnLines: { original: [item(2), item(1)], returned: [item(1, 0)] },
      build,
    });
    expect(res.ins).toBe(S.RETURN);
  });

  it('is idempotent: an existing row is returned and no job is added', async () => {
    const { service, repo, queue } = setup();
    repo.enqueue.mockResolvedValue({ submission: makeSubmission(), created: false });
    const res = await service.enqueue(T, { invoiceId: 'inv1', profileId: 'p1', ins: S.MAIN, build });
    expect(res.created).toBe(false);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('a blocked chain (pending reference) is a 409 and queues nothing', async () => {
    const { service, repo, queue } = setup();
    repo.enqueue.mockRejectedValue(new TaxChainBlockedError('REFERENCE_NOT_FINAL', 'pending'));
    await expect(
      service.enqueue(T, { invoiceId: 'a2', profileId: 'p1', ins: S.CORRECTIVE, rootInvoiceId: 'inv1', build }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('refuses an inactive or unknown profile', async () => {
    const { service, profiles } = setup();
    (profiles.findById as jest.Mock).mockResolvedValueOnce({ ...profile, active: false });
    await expect(service.enqueue(T, { invoiceId: 'i', profileId: 'p1', ins: S.MAIN, build })).rejects.toThrow(/not active/);
    (profiles.findById as jest.Mock).mockResolvedValueOnce(null);
    await expect(service.enqueue(T, { invoiceId: 'i', profileId: 'zz', ins: S.MAIN, build })).rejects.toThrow(/not found/);
  });
});
