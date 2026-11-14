import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { MoadianCredentialEntity } from '../entities/moadian-credential.entity';
import { MoadianSubmissionEntity } from '../entities/moadian-submission.entity';
import { MoadianInvoiceSubject, MoadianSubmissionStatus } from '../enums/moadian.enum';
import { resolveChainReference } from '../utils/tax-reference-chain';

export interface OutboxBuildInput {
  serial: number;
  ins: MoadianInvoiceSubject;
  /** irtaxid: latest confirmed taxid of the chain; null for a main invoice. */
  referenceTaxId: string | null;
}

export interface OutboxEnqueueInput {
  invoiceId: string;
  ins: MoadianInvoiceSubject;
  /** Main invoice of the chain; required unless `ins` is MAIN. */
  rootInvoiceId?: string;
  profileId: string;
  /** Builds the unsigned packet and its taxid from the reserved serial. */
  build: (input: OutboxBuildInput) => { taxId: string; packet: Record<string, unknown> };
}

const MUTABLE_FIELDS = [
  'status',
  'referenceNumber',
  'errors',
  'warnings',
  'pollCount',
  'sentAt',
  'lastPolledAt',
] as const;

const uniqueViolation = (error: unknown): boolean =>
  ((error as { code?: string }).code ?? (error as { driverError?: { code?: string } }).driverError?.code) ===
  '23505';

/**
 * Transactional outbox over `moadian_submissions`. The row (uid, taxid, serial, packet, QUEUED) is
 * created in ONE transaction that also reserves the serial and, for a chain member, locks the root
 * row and checks the reference chain. uid and taxid are never regenerated afterwards.
 */
@Injectable()
export class TaxTransmissionRepository {
  constructor(private readonly scope: TenantScope) {}

  async enqueue(
    tenantId: string,
    input: OutboxEnqueueInput,
    newUid: () => string,
  ): Promise<{ submission: MoadianSubmissionEntity; created: boolean }> {
    try {
      return await this.scope.run(tenantId, (m) => this.enqueueIn(m, tenantId, input, newUid));
    } catch (error) {
      if (!uniqueViolation(error)) throw error;
      // A concurrent enqueue of the same (tenant, invoice, ins) won: return its row.
      const existing = await this.findByInvoice(tenantId, input.invoiceId, input.ins);
      if (existing) return { submission: existing, created: false };
      throw error;
    }
  }

  private async enqueueIn(
    m: EntityManager,
    tenantId: string,
    input: OutboxEnqueueInput,
    newUid: () => string,
  ): Promise<{ submission: MoadianSubmissionEntity; created: boolean }> {
    const subs = m.getRepository(MoadianSubmissionEntity);
    const existing = await subs.findOne({ where: { tenantId, invoiceId: input.invoiceId, ins: input.ins } });
    if (existing) return { submission: existing, created: false };

    const isMain = input.ins === MoadianInvoiceSubject.MAIN;
    const rootInvoiceId = isMain ? input.invoiceId : input.rootInvoiceId;
    if (!rootInvoiceId) throw new Error('rootInvoiceId is required for amendment, cancellation or return');

    let referenceTaxId: string | null = null;
    if (!isMain) {
      // Lock the root so two concurrent amendments of one invoice cannot both read the same reference.
      const root = await subs.findOne({
        where: { tenantId, invoiceId: rootInvoiceId, ins: MoadianInvoiceSubject.MAIN },
        lock: { mode: 'pessimistic_write' },
      });
      const chain = await subs.find({ where: [{ tenantId, invoiceId: rootInvoiceId }, { tenantId, rootInvoiceId }] });
      referenceTaxId = resolveChainReference(root, chain);
    }

    const serial = await this.reserveSerial(m, tenantId);
    const built = input.build({ serial, ins: input.ins, referenceTaxId });
    const submission = await subs.save(
      subs.create({
        tenantId,
        invoiceId: input.invoiceId,
        ins: input.ins,
        rootInvoiceId,
        profileId: input.profileId,
        uid: newUid(),
        taxId: built.taxId,
        serial: String(serial),
        referenceTaxId,
        activeReferenceTaxId: isMain ? built.taxId : null,
        status: MoadianSubmissionStatus.QUEUED,
        packet: built.packet,
      }),
    );
    return { submission, created: true };
  }

  private async reserveSerial(m: EntityManager, tenantId: string): Promise<number> {
    const result = await m
      .getRepository(MoadianCredentialEntity)
      .createQueryBuilder()
      .update(MoadianCredentialEntity)
      .set({ nextSerial: () => 'next_serial + 1' })
      .where('tenant_id = :tenantId', { tenantId })
      .returning('next_serial')
      .execute();
    const row = (result.raw as Array<{ next_serial: string | number }>)[0];
    if (!row) throw new Error('Moadian credential not found for tenant');
    return Number(row.next_serial) - 1;
  }

  findByInvoice(tenantId: string, invoiceId: string, ins: number): Promise<MoadianSubmissionEntity | null> {
    return this.scope.run(tenantId, (m) =>
      m.getRepository(MoadianSubmissionEntity).findOne({ where: { tenantId, invoiceId, ins } }),
    );
  }

  findById(tenantId: string, id: string): Promise<MoadianSubmissionEntity | null> {
    return this.scope.run(tenantId, (m) =>
      m.getRepository(MoadianSubmissionEntity).findOne({ where: { tenantId, id } }),
    );
  }

  /** Never touches uid, taxId, serial or packet. */
  update(
    tenantId: string,
    id: string,
    patch: Partial<
      Pick<
        MoadianSubmissionEntity,
        'status' | 'referenceNumber' | 'errors' | 'warnings' | 'pollCount' | 'sentAt' | 'lastPolledAt'
      >
    >,
  ): Promise<MoadianSubmissionEntity | null> {
    return this.scope.run(tenantId, async (m) => {
      const repo = m.getRepository(MoadianSubmissionEntity);
      // Runtime whitelist: the type alone does not stop a caller from passing uid/taxId/serial/packet.
      const safe: Record<string, unknown> = {};
      for (const key of MUTABLE_FIELDS) {
        if (key in patch) safe[key] = (patch as Record<string, unknown>)[key];
      }
      if (Object.keys(safe).length > 0) await repo.update({ id, tenantId }, safe as never);
      return repo.findOne({ where: { tenantId, id } });
    });
  }

  /**
   * Atomically claims a QUEUED/UNKNOWN row for a network send using compare-and-set on
   * (status, attempt_count). Only the winner receives the updated row and may call submitBatch.
   */
  claimForSend(
    tenantId: string,
    id: string,
    expectedAttemptCount: number,
  ): Promise<MoadianSubmissionEntity | null> {
    return this.scope.run(tenantId, async (m) => {
      const repo = m.getRepository(MoadianSubmissionEntity);
      const result = await repo
        .createQueryBuilder()
        .update(MoadianSubmissionEntity)
        .set({ attemptCount: () => 'attempt_count + 1' })
        .where('id = :id', { id })
        .andWhere('tenant_id = :tenantId', { tenantId })
        .andWhere('status IN (:...allowed)', {
          allowed: [MoadianSubmissionStatus.QUEUED, MoadianSubmissionStatus.UNKNOWN],
        })
        .andWhere('attempt_count = :expectedAttemptCount', { expectedAttemptCount })
        .andWhere('sent_at IS NULL')
        .andWhere('reference_number IS NULL')
        .returning('id')
        .execute();
      const row = (result.raw as Array<{ id: string }>)[0];
      if (!row) return null;
      return repo.findOne({ where: { tenantId, id } });
    });
  }

  /**
   * Marks the submission confirmed and, for an amendment or return, advances the root's
   * activeReferenceTaxId to this taxid in the same transaction.
   */
  confirm(
    tenantId: string,
    submission: MoadianSubmissionEntity,
    warnings: MoadianSubmissionEntity['warnings'],
    pollCount: number,
    referenceNumber: string | null = null,
  ): Promise<void> {
    return this.scope.run(tenantId, async (m) => {
      const repo = m.getRepository(MoadianSubmissionEntity);
      const resolvedReference = submission.referenceNumber ?? referenceNumber ?? null;
      await repo.update(
        { id: submission.id, tenantId },
        {
          status: MoadianSubmissionStatus.SUCCESS,
          errors: [],
          warnings,
          pollCount,
          lastPolledAt: new Date(),
          ...(resolvedReference !== null ? { referenceNumber: resolvedReference } : {}),
          ...(submission.sentAt == null ? { sentAt: new Date() } : {}),
        },
      );
      const advances =
        submission.ins === MoadianInvoiceSubject.CORRECTIVE || submission.ins === MoadianInvoiceSubject.RETURN;
      if (advances && submission.rootInvoiceId) {
        await repo.update(
          { tenantId, invoiceId: submission.rootInvoiceId, ins: MoadianInvoiceSubject.MAIN },
          { activeReferenceTaxId: submission.taxId },
        );
      }
    });
  }
}
