import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { EntityManager } from 'typeorm';
import { stableStringify } from '../repositories/audit.repository';
import { AuditService } from './audit.service';

/** Audit actions written for the general ledger; the verifier cross-checks them against the ledger tables. */
export const LEDGER_AUDIT = {
  POSTED: 'ledger.entry.posted',
  REVERSED: 'ledger.entry.reversed',
  PERIOD_LOCKED: 'ledger.period.locked',
  PERIOD_UNLOCKED: 'ledger.period.unlocked',
} as const;

export type LedgerEvent =
  | {
      kind: 'posted' | 'reversed';
      tenantId: string;
      entryId: number;
      entryNumber: string;
      entryDate: string;
      lines: Array<{ accountId: number; debitMinor: bigint; creditMinor: bigint }>;
      reversesEntryId?: number | null;
    }
  | {
      kind: 'period.locked' | 'period.unlocked';
      tenantId: string;
      actor: string | null;
      lockId: number;
      periodStart: string;
      periodEnd: string;
      reason: string | null;
    };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The thin hook the accounting service calls after a ledger change. It only records: it never reads
 * or changes ledger data, so ledger math is untouched. Passing the caller's transaction makes the
 * audit row commit or roll back together with the ledger change it describes.
 */
@Injectable()
export class LedgerAuditService {
  constructor(private readonly audit: AuditService) {}

  async record(event: LedgerEvent, manager?: EntityManager): Promise<void> {
    if ('entryId' in event) {
      const totalMinor = event.lines.reduce((s, l) => s + l.debitMinor, 0n);
      const digest = createHash('sha256')
        .update(stableStringify(event.lines.map((l) => [l.accountId, l.debitMinor.toString(), l.creditMinor.toString()])))
        .digest('hex');
      await this.audit.record(
        {
          tenantId: event.tenantId,
          actorUserId: null,
          action: event.kind === 'posted' ? LEDGER_AUDIT.POSTED : LEDGER_AUDIT.REVERSED,
          resourceType: 'journal_entry',
          resourceId: String(event.entryId),
          metadata: {
            entryNumber: event.entryNumber,
            entryDate: event.entryDate,
            lineCount: event.lines.length,
            totalMinor: totalMinor.toString(),
            linesDigest: digest,
            reversesEntryId: event.reversesEntryId ?? null,
          },
        },
        manager,
      );
      return;
    }
    await this.audit.record(
      {
        tenantId: event.tenantId,
        actorUserId: event.actor && UUID.test(event.actor) ? event.actor : null,
        action: event.kind === 'period.locked' ? LEDGER_AUDIT.PERIOD_LOCKED : LEDGER_AUDIT.PERIOD_UNLOCKED,
        resourceType: 'period_lock',
        resourceId: String(event.lockId),
        metadata: { actor: event.actor, periodStart: event.periodStart, periodEnd: event.periodEnd, reason: event.reason },
      },
      manager,
    );
  }
}
