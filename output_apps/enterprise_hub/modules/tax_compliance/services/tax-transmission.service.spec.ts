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
import { MoadianApiError } from './moadian-api.client';
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
    claimForSend: jest.fn(async (_t: string, _id: string, expectedAttemptCount: number) => {
      const allowedStatus = row.status === St.QUEUED || row.status === St.UNKNOWN;
      if (
        !allowedStatus ||
        row.attemptCount !== expectedAttemptCount ||
        row.sentAt != null ||
        row.referenceNumber != null
      ) {
        return null;
      }
      row.attemptCount += 1;
      return { ...row };
    }),
    confirm: jest.fn(
      async (
        _t: string,
        _sub: MoadianSubmissionEntity,
        warnings: MoadianSubmissionEntity['warnings'],
        pollCount: number,
        referenceNumber: string | null = null,
      ) => {
        row.status = St.SUCCESS;
        row.warnings = warnings;
        row.pollCount = pollCount;
        if (row.referenceNumber == null && referenceNumber != null) {
          row.referenceNumber = referenceNumber;
        }
        if (row.sentAt == null) row.sentAt = new Date();
      },
    ),
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
    expect(repo.row.referenceNumber).toBe(`REF-${repo.row.uid.slice(0, 8)}`);
    expect(repo.row.sentAt).toBeInstanceOf(Date);
  });

  it('429 and network errors on send move row to UNKNOWN (never FAILED)', async () => {
    for (const err of [
      new MoadianApiError('HTTP 429', 429, true),
      new MoadianApiError('Moadian request failed: ECONNRESET', null, true),
    ]) {
      const { service, fake, repo } = setup();
      jest.spyOn(fake, 'submitBatch').mockResolvedValueOnce([
        { uid: repo.row.uid, referenceNumber: null, error: err },
      ]);
      await expect(service.process(data)).rejects.toThrow(err.message);
      expect(repo.row.status).toBe(St.UNKNOWN);
      expect(repo.row.status).not.toBe(St.FAILED);
    }
  });

  it('401, 403, 404 operational errors on send stay retryable (UNKNOWN), while 400 is terminal FAILED', async () => {
    for (const code of [401, 403, 404]) {
      const { service, fake, repo } = setup();
      jest.spyOn(fake, 'submitBatch').mockResolvedValueOnce([
        { uid: repo.row.uid, referenceNumber: null, error: new MoadianApiError(`HTTP ${code}`, code, false) },
      ]);
      await expect(service.process(data)).rejects.toThrow(`HTTP ${code}`);
      expect(repo.row.status).toBe(St.UNKNOWN);
      expect(repo.row.errors).toEqual([{ code: String(code), message: `HTTP ${code}` }]);
    }
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

  it('a retryable MoadianApiError during inquiry keeps UNKNOWN as UNKNOWN and never downgrades SENT', async () => {
    const unknownSetup = setup(makeSubmission({ status: St.UNKNOWN }));
    jest
      .spyOn(unknownSetup.fake, 'inquireByUid')
      .mockRejectedValueOnce(new MoadianApiError('HTTP 503', 503, true));
    await expect(unknownSetup.service.process(data)).rejects.toThrow('HTTP 503');
    expect(unknownSetup.repo.row.status).toBe(St.UNKNOWN);

    const sentSetup = setup(makeSubmission({ status: St.SENT, referenceNumber: 'R1', sentAt: new Date() }));
    jest
      .spyOn(sentSetup.fake, 'inquireByUid')
      .mockRejectedValueOnce(new MoadianApiError('timeout', null, true))
      .mockRejectedValueOnce(new MoadianApiError('HTTP 429', 429, true));
    await expect(sentSetup.service.process(data)).rejects.toThrow('timeout');
    expect(sentSetup.repo.row.status).toBe(St.SENT);
    await expect(sentSetup.service.process(data)).rejects.toThrow('HTTP 429');
    expect(sentSetup.repo.row.status).toBe(St.SENT);
    // Even if a later inquiry says NOT_FOUND, an already-SENT row is never resent.
    sentSetup.fake.server.clear();
    await expect(sentSetup.service.process(data)).resolves.toBe('poll');
    expect(sentSetup.fake.submitted).toHaveLength(0);
    expect(sentSetup.repo.row.status).toBe(St.SENT);
  });

  it('an inquiry returning TIMEOUT status preserves SENT, increments pollCount, and schedules poll', async () => {
    const { service, fake, repo } = setup(
      makeSubmission({ status: St.SENT, referenceNumber: 'R1', sentAt: new Date(), pollCount: 0 }),
    );
    jest.spyOn(fake, 'inquireByUid').mockResolvedValueOnce([
      { uid: 'u1', status: Inq.TIMEOUT, referenceNumber: null, errors: [], warnings: [] },
    ]);
    const outcome = await service.process(data);
    expect(outcome).toBe('poll');
    expect(repo.row.status).toBe(St.SENT);
    expect(repo.row.pollCount).toBe(1);
    expect(repo.row.lastPolledAt).toBeDefined();
  });

  it('non-MoadianApiError preserves status and records CLIENT error', async () => {
    const { service, fake, repo } = setup(makeSubmission({ status: St.UNKNOWN }));
    jest.spyOn(fake, 'inquireByUid').mockRejectedValue(new Error('x'));
    await expect(service.process(data)).rejects.toThrow('x');
    expect(repo.row.status).toBe(St.UNKNOWN);
    expect(repo.row.errors).toEqual([{ code: 'CLIENT', message: 'x' }]);
  });

  it('atomic claim: two concurrent workers on the same row result in only one submitBatch call', async () => {
    const { service, fake, repo } = setup(makeSubmission({ status: St.QUEUED, attemptCount: 0 }));
    const [r1, r2] = await Promise.all([service.process(data), service.process(data)]);
    expect([r1, r2].sort()).toEqual(['done', 'poll']);
    expect(fake.submitted).toHaveLength(1);
    expect(repo.row.attemptCount).toBe(1);
  });

  it('adapters.forMode() failure is caught inside try and records CLIENT error', async () => {
    const { service, repo, profiles } = setup();
    (profiles.findById as jest.Mock).mockResolvedValueOnce({
      ...profile,
      mode: 'unknown_mode' as TaxTransmissionMode,
    });
    await expect(service.process(data)).rejects.toThrow(/No tax transmission adapter/);
    expect(repo.row.errors).toEqual([
      expect.objectContaining({ code: 'CLIENT', message: expect.stringContaining('No tax transmission adapter') }),
    ]);
  });

  it('final retryable attempt schedules a follow-up poll so the row does not strand', async () => {
    const { service, fake, repo, queue } = setup();
    fake.script = [{ kind: 'timeout' }];
    await expect(service.process(data, true)).resolves.toBe('retry');
    expect(repo.row.status).toBe(St.UNKNOWN);
    expect(queue.add).toHaveBeenCalledWith(MOADIAN_TX_JOB, data, expect.any(Object));
  });

  it('does nothing for final states', async () => {
    const { service, fake } = setup(makeSubmission({ status: St.SUCCESS }));
    await expect(service.process(data)).resolves.toBe('done');
    expect(fake.submitted).toHaveLength(0);
    expect(fake.inquired).toHaveLength(0);
  });

  it('poll exhaustion records POLL_LIMIT error on SENT row and returns done without flipping to FAILED', async () => {
    const { service, fake, repo } = setup(
      makeSubmission({ status: St.SENT, referenceNumber: 'REF-1', pollCount: 29 }),
    );
    fake.server.set(makeSubmission().uid, Inq.PENDING);
    // submission.pollCount is 29, causing reconcile pollCount to become 30 >= maxPolls (default 30)
    const outcome = await service.process(data);
    expect(outcome).toBe('done');
    expect(repo.row.status).toBe(St.SENT);
    expect(repo.row.errors).toEqual([
      { code: 'POLL_LIMIT', message: 'No final status after 30 inquiries.' },
    ]);
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
