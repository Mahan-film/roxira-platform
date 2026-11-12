import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import type { InvoiceItem } from '../../invoicing/entities/invoice.entity';
import {
  MOADIAN_DEFAULT_MAX_POLLS,
  MOADIAN_DEFAULT_POLL_DELAY_MS,
  MOADIAN_ENV,
  MOADIAN_JOB_ATTEMPTS,
  MOADIAN_JOB_BACKOFF_MS,
  MOADIAN_QUEUE,
  MOADIAN_TX_JOB,
} from '../constants/moadian.constants';
import { MoadianSubmissionEntity } from '../entities/moadian-submission.entity';
import { MoadianInquiryStatus, MoadianInvoiceSubject, MoadianSubmissionStatus } from '../enums/moadian.enum';
import { FiscalMemoryProfileRepository } from '../repositories/fiscal-memory-profile.repository';
import { OutboxBuildInput, TaxTransmissionRepository } from '../repositories/tax-transmission.repository';
import { isFullReturn, TaxChainBlockedError } from '../utils/tax-reference-chain';
import { MoadianApiError } from './moadian-api.client';
import { TaxTransmissionAdapterFactory } from '../transmission/tax-transmission-adapter.factory';
import { TransmissionContext } from '../transmission/tax-transmission.adapter';

export interface TransmissionJobData {
  tenantId: string;
  submissionId: string;
}

/** `poll`: accepted, waiting for a final status. `retry`: state is UNKNOWN, a later job inquires first. */
export type TransmissionOutcome = 'done' | 'poll' | 'retry';

export interface EnqueueTransmissionRequest {
  invoiceId: string;
  profileId: string;
  ins: MoadianInvoiceSubject;
  /** Main invoice of the chain; required unless `ins` is MAIN. */
  rootInvoiceId?: string;
  /** For ins = RETURN: if the returned lines cover 100% of the original, it is sent as a cancellation. */
  returnLines?: { original: InvoiceItem[]; returned: InvoiceItem[] };
  /** Builds the unsigned packet + taxid; `ins` here is the effective subject after conversion. */
  build: (input: OutboxBuildInput) => { taxId: string; packet: Record<string, unknown> };
}

/**
 * Send path built on the transactional outbox (docs/tax/TAX_TRANSMISSION_DESIGN.md).
 *
 * Rules: uid/taxid are fixed when the row is created and never change; a timeout or 5xx makes the
 * state UNKNOWN (never FAILED); inquiry-by-uid always runs before anything is sent again, and the
 * SAME uid/taxid is resent only when the inquiry says NOT_FOUND.
 */
@Injectable()
export class TaxTransmissionService {
  private readonly logger = new Logger(TaxTransmissionService.name);

  constructor(
    private readonly repository: TaxTransmissionRepository,
    private readonly profiles: FiscalMemoryProfileRepository,
    private readonly adapters: TaxTransmissionAdapterFactory,
    private readonly config: ConfigService,
    @InjectQueue(MOADIAN_QUEUE) private readonly queue: Queue<TransmissionJobData>,
  ) {}

  private isEnabled(): boolean {
    return String(this.config.get<string>(MOADIAN_ENV.ENABLED) ?? 'false').toLowerCase() === 'true';
  }

  private numberSetting(name: string, fallback: number): number {
    const raw = Number(this.config.get<string>(name));
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  }

  /** The subject actually sent: a return of 100% of the items becomes a cancellation. */
  effectiveSubject(req: Pick<EnqueueTransmissionRequest, 'ins' | 'returnLines'>): MoadianInvoiceSubject {
    if (
      req.ins === MoadianInvoiceSubject.RETURN &&
      req.returnLines &&
      isFullReturn(req.returnLines.original, req.returnLines.returned)
    ) {
      return MoadianInvoiceSubject.CANCELLATION;
    }
    return req.ins;
  }

  async enqueue(
    tenantId: string,
    req: EnqueueTransmissionRequest,
  ): Promise<{ submission: MoadianSubmissionEntity; created: boolean; ins: MoadianInvoiceSubject }> {
    const profile = await this.profiles.findById(tenantId, req.profileId);
    if (!profile) throw new NotFoundException('Fiscal memory profile not found.');
    if (!profile.active) throw new BadRequestException('Fiscal memory profile is not active.');
    const ins = this.effectiveSubject(req);
    if (ins !== MoadianInvoiceSubject.MAIN && !req.rootInvoiceId) {
      throw new BadRequestException('rootInvoiceId is required for amendment, cancellation or return.');
    }

    let result: { submission: MoadianSubmissionEntity; created: boolean };
    try {
      result = await this.repository.enqueue(
        tenantId,
        { invoiceId: req.invoiceId, ins, rootInvoiceId: req.rootInvoiceId, profileId: profile.id, build: req.build },
        randomUUID,
      );
    } catch (error) {
      if (error instanceof TaxChainBlockedError) throw new ConflictException(error.message);
      throw error;
    }
    if (result.created) {
      await this.queue.add(
        MOADIAN_TX_JOB,
        { tenantId, submissionId: result.submission.id },
        {
          jobId: `moadian-tx-${result.submission.id}`,
          attempts: MOADIAN_JOB_ATTEMPTS,
          backoff: { type: 'exponential', delay: MOADIAN_JOB_BACKOFF_MS },
          removeOnComplete: 1000,
          removeOnFail: 1000,
        },
      );
    }
    return { ...result, ins };
  }

  private schedulePoll(data: TransmissionJobData, pollCount: number): Promise<unknown> {
    return this.queue.add(MOADIAN_TX_JOB, data, {
      jobId: `moadian-tx-${data.submissionId}-poll-${pollCount}`,
      delay: this.numberSetting(MOADIAN_ENV.POLL_DELAY_MS, MOADIAN_DEFAULT_POLL_DELAY_MS),
      attempts: MOADIAN_JOB_ATTEMPTS,
      backoff: { type: 'exponential', delay: MOADIAN_JOB_BACKOFF_MS },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
  }

  /** Worker entry (MoadianProcessor, job `moadian.tx`). */
  async process(data: TransmissionJobData, isFinalAttempt = false): Promise<TransmissionOutcome> {
    if (!this.isEnabled()) {
      this.logger.warn('Tax transmission skipped: MOADIAN_ENABLED is not true.');
      return 'done';
    }
    const { tenantId, submissionId } = data;
    const submission = await this.repository.findById(tenantId, submissionId);
    if (!submission) return 'done';
    const terminal = [
      MoadianSubmissionStatus.SUCCESS,
      MoadianSubmissionStatus.FAILED,
      MoadianSubmissionStatus.ERROR,
    ];
    if (terminal.includes(submission.status)) return 'done';

    const profile = submission.profileId ? await this.profiles.findById(tenantId, submission.profileId) : null;
    if (!profile) {
      await this.repository.update(tenantId, submissionId, {
        errors: [{ code: 'NO_PROFILE', message: 'Fiscal memory profile is missing.' }],
      });
      return 'done';
    }
    const ctx: TransmissionContext = { tenantId, profile };
    const adapter = this.adapters.forMode(profile.mode);

    let phase: 'inquiry' | 'send' = 'inquiry';
    try {
      // Never send blind once an attempt may have reached the server (UNKNOWN, a crashed attempt, SENT).
      const mayHaveArrived =
        submission.status !== MoadianSubmissionStatus.QUEUED || (submission.attemptCount ?? 0) > 0;
      if (mayHaveArrived) {
        const outcome = await this.reconcile(ctx, adapter, submission, data);
        if (outcome !== 'resend') return outcome;
      }
      phase = 'send';
      return await this.send(ctx, adapter, submission, data);
    } catch (error) {
      return this.handleTransportError(tenantId, submission, error, isFinalAttempt, phase);
    }
  }

  /** Inquire by uid and apply the answer. `resend` only when the authority has never seen the uid. */
  private async reconcile(
    ctx: TransmissionContext,
    adapter: ReturnType<TaxTransmissionAdapterFactory['forMode']>,
    submission: MoadianSubmissionEntity,
    data: TransmissionJobData,
  ): Promise<TransmissionOutcome | 'resend'> {
    const { tenantId } = ctx;
    const rows = await adapter.inquireByUid(ctx, [submission.uid]);
    const row = rows.find((r) => r.uid === submission.uid) ?? null;
    const status = row?.status ?? MoadianInquiryStatus.NOT_FOUND;
    const pollCount = (submission.pollCount ?? 0) + 1;

    if (status === MoadianInquiryStatus.SUCCESS) {
      await this.repository.confirm(tenantId, submission, row?.warnings ?? [], pollCount);
      return 'done';
    }
    if (status === MoadianInquiryStatus.FAILED) {
      await this.repository.update(tenantId, submission.id, {
        status: MoadianSubmissionStatus.FAILED,
        errors: row?.errors ?? [],
        warnings: row?.warnings ?? [],
        pollCount,
        lastPolledAt: new Date(),
      });
      return 'done';
    }
    if (status === MoadianInquiryStatus.PENDING || submission.status === MoadianSubmissionStatus.SENT) {
      // Known to the authority, or already accepted by us: keep polling, never resend.
      const maxPolls = this.numberSetting(MOADIAN_ENV.MAX_POLLS, MOADIAN_DEFAULT_MAX_POLLS);
      await this.repository.update(tenantId, submission.id, {
        status: MoadianSubmissionStatus.SENT,
        referenceNumber: row?.referenceNumber ?? submission.referenceNumber,
        pollCount,
        lastPolledAt: new Date(),
        ...(pollCount >= maxPolls
          ? { errors: [{ code: 'POLL_LIMIT', message: `No final status after ${pollCount} inquiries.` }] }
          : {}),
      });
      if (pollCount >= maxPolls) return 'done';
      await this.schedulePoll(data, pollCount);
      return 'poll';
    }
    if (status === MoadianInquiryStatus.NOT_FOUND) return 'resend';
    // TIMEOUT or any status we do not know: stay UNKNOWN and ask again later.
    await this.repository.update(tenantId, submission.id, { status: MoadianSubmissionStatus.UNKNOWN });
    return 'retry';
  }

  /** Sends the stored packet with the stored uid/taxid. */
  private async send(
    ctx: TransmissionContext,
    adapter: ReturnType<TaxTransmissionAdapterFactory['forMode']>,
    submission: MoadianSubmissionEntity,
    data: TransmissionJobData,
  ): Promise<TransmissionOutcome> {
    const { tenantId } = ctx;
    await this.repository.markAttempt(tenantId, submission.id);
    const [result] = await adapter.submitBatch(ctx, [
      { uid: submission.uid, taxId: submission.taxId, packet: submission.packet },
    ]);
    if (result?.error) throw result.error;
    await this.repository.update(tenantId, submission.id, {
      status: MoadianSubmissionStatus.SENT,
      referenceNumber: result?.referenceNumber ?? null,
      sentAt: new Date(),
      errors: [],
    });
    await this.schedulePoll(data, 0);
    return 'poll';
  }

  private async handleTransportError(
    tenantId: string,
    submission: MoadianSubmissionEntity,
    error: unknown,
    isFinalAttempt: boolean,
    phase: 'inquiry' | 'send',
  ): Promise<TransmissionOutcome> {
    const api = error instanceof MoadianApiError ? error : null;
    if (phase === 'send' && api && !api.retryable && api.httpStatus !== null) {
      // A definite 4xx answer to the packet itself: the authority looked at it and refused it.
      // (A 4xx on an inquiry says nothing about the packet and falls through below.)
      await this.repository.update(tenantId, submission.id, {
        status: MoadianSubmissionStatus.FAILED,
        errors: api.errors.length ? api.errors : [{ code: String(api.httpStatus), message: api.message }],
      });
      return 'done';
    }
    if (api && api.retryable) {
      // Timeout / 5xx / 429 / network: we do not know whether it arrived. UNKNOWN, never FAILED.
      await this.repository.update(tenantId, submission.id, {
        status: MoadianSubmissionStatus.UNKNOWN,
        errors: [{ code: 'TRANSPORT', message: api.message }],
      });
      if (isFinalAttempt) return 'retry';
      throw error;
    }
    // Configuration or unexpected error before anything was proven sent: keep the state, surface it.
    await this.repository.update(tenantId, submission.id, {
      errors: [{ code: 'CLIENT', message: (error as Error).message }],
    });
    throw error;
  }
}
