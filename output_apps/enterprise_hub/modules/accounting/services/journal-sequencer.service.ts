import { ConflictException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { GL_CHAIN_GENESIS_HASH } from '../entities/gl-sequencer.entity';
import { JournalEntryStatus } from '../enums/accounting.enum';

export interface CanonicalChainLine {
  accountId: number;
  debit: string;
  credit: string;
  txDebit: string;
  txCredit: string;
  bookDebit: string;
  bookCredit: string;
}

export interface CanonicalChainPayload {
  entityId: string;
  glAuditNumber: string;
  postedAtUtc: string;
  lines: CanonicalChainLine[];
}

export interface SealEntryResult {
  glAuditNumber: string;
  prevChainHash: string;
  chainHash: string;
  postedAtUtc: Date;
}

export interface VerifyChainResult {
  status: 'VALID' | 'BROKEN';
  gaps: number;
  totalEntries: number;
  verifiedCount: number;
  verified: string;
  headHash: string;
  lastAuditNumber: string;
  brokenAtAuditNumber?: string;
  reason?: string;
}

/**
 * Per-entity GL audit-number sequencer and SHA-256 hash chain (T178).
 *
 * Pre-image: `prev_hash || canonical(entity_id, gl_audit_number, posted_at_utc, lines with three amounts)`.
 * Allocated at commit inside the posting transaction under a row lock on `fin_gl_sequencers`.
 */
@Injectable()
export class JournalSequencerService {
  constructor(private readonly scope: TenantScope) {}

  static buildCanonicalPreImage(payload: CanonicalChainPayload): string {
    const normalizedLines = payload.lines.map((l) => ({
      accountId: l.accountId,
      debit: String(l.debit ?? '0.00'),
      credit: String(l.credit ?? '0.00'),
      txDebit: String(l.txDebit ?? l.debit ?? '0.00'),
      txCredit: String(l.txCredit ?? l.credit ?? '0.00'),
      bookDebit: String(l.bookDebit ?? l.debit ?? '0.00'),
      bookCredit: String(l.bookCredit ?? l.credit ?? '0.00'),
    }));
    return JSON.stringify({
      entityId: payload.entityId,
      glAuditNumber: payload.glAuditNumber,
      postedAtUtc: payload.postedAtUtc,
      lines: normalizedLines,
    });
  }

  static computeChainHash(prevHash: string, canonicalPreImage: string): string {
    return createHash('sha256')
      .update(`${prevHash}|${canonicalPreImage}`, 'utf8')
      .digest('hex');
  }

  /**
   * Allocates the next gapless GL audit number and seals `chain_hash` for a newly POSTED entry.
   * Must be called inside the posting transaction after lines are inserted.
   */
  async sealEntry(
    tenantId: string,
    entryId: number,
    manager: EntityManager,
  ): Promise<SealEntryResult> {
    return this.scope.within(tenantId, manager, async (m) => {
      await m.query(
        `INSERT INTO "fin_gl_sequencers" ("tenant_id", "last_audit_number", "head_hash")
         VALUES ($1, 0, $2)
         ON CONFLICT ("tenant_id") DO NOTHING`,
        [tenantId, GL_CHAIN_GENESIS_HASH],
      );

      const seqRows: Array<{ last_audit_number: string; head_hash: string }> = await m.query(
        `SELECT "last_audit_number", "head_hash"
           FROM "fin_gl_sequencers"
          WHERE "tenant_id" = $1
          FOR UPDATE`,
        [tenantId],
      );
      const seq = seqRows[0];
      const nextNumber = (BigInt(seq.last_audit_number) + 1n).toString();
      const prevHash = seq.head_hash;
      const postedAtUtc = new Date();
      const postedAtIso = postedAtUtc.toISOString();

      const lineRows: Array<{
        account_id: number;
        debit: string;
        credit: string;
        tx_debit: string | null;
        tx_credit: string | null;
        book_debit: string | null;
        book_credit: string | null;
      }> = await m.query(
        `SELECT "account_id", "debit"::text, "credit"::text,
                "tx_debit"::text, "tx_credit"::text,
                "book_debit"::text, "book_credit"::text
           FROM "fin_journal_entry_lines"
          WHERE "tenant_id" = $1 AND "journal_entry_id" = $2
          ORDER BY "id" ASC`,
        [tenantId, entryId],
      );

      const canonical = JournalSequencerService.buildCanonicalPreImage({
        entityId: tenantId,
        glAuditNumber: nextNumber,
        postedAtUtc: postedAtIso,
        lines: lineRows.map((l) => ({
          accountId: Number(l.account_id),
          debit: l.debit,
          credit: l.credit,
          txDebit: l.tx_debit ?? l.debit,
          txCredit: l.tx_credit ?? l.credit,
          bookDebit: l.book_debit ?? l.debit,
          bookCredit: l.book_credit ?? l.credit,
        })),
      });
      const chainHash = JournalSequencerService.computeChainHash(prevHash, canonical);

      const sealed: Array<{ id: number }> = await m.query(
        `UPDATE "fin_journal_entries"
            SET "gl_audit_number" = $1,
                "prev_chain_hash" = $2,
                "chain_hash" = $3,
                "posted_at_utc" = $4
          WHERE "id" = $5 AND "tenant_id" = $6 AND "chain_hash" IS NULL
        RETURNING "id"`,
        [nextNumber, prevHash, chainHash, postedAtIso, entryId, tenantId],
      );
      // Already sealed or not ours: fail before the sequencer advances so no number is burned
      // and the chain head cannot fork.
      if (sealed.length === 0) {
        throw new ConflictException(`Journal entry ${entryId} is already sealed or not found.`);
      }

      await m.query(
        `UPDATE "fin_gl_sequencers"
            SET "last_audit_number" = $1,
                "head_hash" = $2,
                "updated_at" = now()
          WHERE "tenant_id" = $3`,
        [nextNumber, chainHash, tenantId],
      );

      return {
        glAuditNumber: nextNumber,
        prevChainHash: prevHash,
        chainHash,
        postedAtUtc,
      };
    });
  }

  /** Recomputes and verifies every sealed POSTED entry in `gl_audit_number` order for a tenant. */
  async verifyChain(tenantId: string): Promise<VerifyChainResult> {
    return this.scope.within(tenantId, undefined, async (m) => {
      const entries: Array<{
        id: number;
        gl_audit_number: string;
        prev_chain_hash: string | null;
        chain_hash: string | null;
        posted_at_utc: Date | string | null;
      }> = await m.query(
        `SELECT "id", "gl_audit_number"::text, "prev_chain_hash", "chain_hash", "posted_at_utc"
           FROM "fin_journal_entries"
          WHERE "tenant_id" = $1
            AND "status" = $2
            AND "gl_audit_number" IS NOT NULL
          ORDER BY "gl_audit_number"::bigint ASC`,
        [tenantId, JournalEntryStatus.POSTED],
      );

      const entryIds = entries.map((e) => Number(e.id));
      const linesByEntry = new Map<number, CanonicalChainLine[]>();
      if (entryIds.length > 0) {
        const allLines: Array<{
          journal_entry_id: number;
          account_id: number;
          debit: string;
          credit: string;
          tx_debit: string | null;
          tx_credit: string | null;
          book_debit: string | null;
          book_credit: string | null;
        }> = await m.query(
          `SELECT "journal_entry_id", "account_id", "debit"::text, "credit"::text,
                  "tx_debit"::text, "tx_credit"::text,
                  "book_debit"::text, "book_credit"::text
             FROM "fin_journal_entry_lines"
            WHERE "tenant_id" = $1 AND "journal_entry_id" = ANY($2::int[])
            ORDER BY "id" ASC`,
          [tenantId, entryIds],
        );
        for (const l of allLines) {
          const entryIdNum = Number(l.journal_entry_id);
          const list = linesByEntry.get(entryIdNum) ?? [];
          list.push({
            accountId: Number(l.account_id),
            debit: l.debit,
            credit: l.credit,
            txDebit: l.tx_debit ?? l.debit,
            txCredit: l.tx_credit ?? l.credit,
            bookDebit: l.book_debit ?? l.debit,
            bookCredit: l.book_credit ?? l.credit,
          });
          linesByEntry.set(entryIdNum, list);
        }
      }

      let expectedNumber = 1n;
      let prevHash = GL_CHAIN_GENESIS_HASH;
      let gaps = 0;
      let verifiedCount = 0;
      let brokenAtAuditNumber: string | undefined;
      let reason: string | undefined;

      for (const e of entries) {
        const actualNum = BigInt(e.gl_audit_number);
        let entryOk = true;

        if (actualNum !== expectedNumber) {
          if (actualNum > expectedNumber) {
            gaps += Number(actualNum - expectedNumber);
          } else {
            gaps += 1;
          }
          entryOk = false;
          if (!brokenAtAuditNumber) {
            brokenAtAuditNumber = e.gl_audit_number;
            reason = `Expected GL audit number ${expectedNumber.toString()}, found ${e.gl_audit_number}`;
          }
        }

        const postedAtIso =
          e.posted_at_utc instanceof Date
            ? e.posted_at_utc.toISOString()
            : new Date(String(e.posted_at_utc)).toISOString();
        const canonical = JournalSequencerService.buildCanonicalPreImage({
          entityId: tenantId,
          glAuditNumber: e.gl_audit_number,
          postedAtUtc: postedAtIso,
          lines: linesByEntry.get(Number(e.id)) ?? [],
        });
        const expectedHash = JournalSequencerService.computeChainHash(prevHash, canonical);

        if (e.prev_chain_hash !== prevHash || e.chain_hash !== expectedHash) {
          entryOk = false;
          if (!brokenAtAuditNumber) {
            brokenAtAuditNumber = e.gl_audit_number;
            reason = `Hash mismatch at GL audit number ${e.gl_audit_number}`;
          }
        }

        if (entryOk) {
          verifiedCount += 1;
        }
        prevHash = e.chain_hash ?? expectedHash;
        expectedNumber = actualNum + 1n;
      }

      // Tamper evidence: the sequencer row is the committed head. Deleted tail entries or a
      // rewritten head both make the recomputed head differ from it.
      const headRows: Array<{ last_audit_number: string; head_hash: string }> = await m.query(
        `SELECT "last_audit_number"::text, "head_hash" FROM "fin_gl_sequencers" WHERE "tenant_id" = $1`,
        [tenantId],
      );
      const head = headRows[0];
      if (
        !brokenAtAuditNumber &&
        head &&
        (head.last_audit_number !== (entries.length ? entries[entries.length - 1].gl_audit_number : '0') ||
          head.head_hash !== prevHash)
      ) {
        brokenAtAuditNumber = head.last_audit_number;
        reason = 'Sequencer head does not match the last sealed entry (entries removed or altered)';
      }

      const totalEntries = entries.length;
      const lastAuditNumber = totalEntries > 0 ? entries[totalEntries - 1].gl_audit_number : '0';
      const status: 'VALID' | 'BROKEN' = gaps === 0 && !brokenAtAuditNumber ? 'VALID' : 'BROKEN';

      return {
        status,
        gaps,
        totalEntries,
        verifiedCount,
        verified: `${verifiedCount}/${totalEntries}`,
        headHash: prevHash,
        lastAuditNumber,
        ...(brokenAtAuditNumber ? { brokenAtAuditNumber, reason } : {}),
      };
    });
  }
}
