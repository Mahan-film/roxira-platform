import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';

export interface MemoryFact {
  id: string;
  subject: string;
  fact: string;
  confirmedBy: string;
  confirmedAt: string;
  sourceConversationId: string | null;
  validFrom: string;
  validTo: string | null;
  recordedAt: string;
  supersededAt: string | null;
}

export interface NewMemoryFact {
  subject: string;
  fact: string;
  confirmedBy: string;
  sourceConversationId: string | null;
  validFrom: Date;
}

export interface RecallQuery {
  subject?: string;
  /** Business time: facts true at this instant. */
  validAt: Date;
  /** Knowledge time: facts as we knew them at this instant. Omit for the current belief. */
  knownAt?: Date;
  limit: number;
}

const COLUMNS = `id, subject, fact, confirmed_by AS "confirmedBy", confirmed_at AS "confirmedAt",
  source_conversation_id AS "sourceConversationId", valid_from AS "validFrom", valid_to AS "validTo",
  recorded_at AS "recordedAt", superseded_at AS "supersededAt"`;

/** Every statement runs inside TenantScope (app.tenant_id bound, FORCE RLS) and also filters tenant_id. */
@Injectable()
export class AssistantMemoryRepository {
  constructor(private readonly scope: TenantScope) {}

  /**
   * Stores a confirmed fact valid from `validFrom`. Rows are never edited: every current row that
   * overlaps [validFrom, infinity) is superseded; one that started earlier is re-inserted clipped at
   * `validFrom` (a new version, recorded now). So "as known at" queries still see the old belief.
   * An identical open-ended fact is returned unchanged.
   */
  async remember(tenantId: string, input: NewMemoryFact): Promise<MemoryFact> {
    return this.scope.run(tenantId, async (m) => {
      // Serialise writers of one subject: FOR UPDATE alone does not stop two first writes racing.
      await m.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`${tenantId}:${input.subject}`]);
      const current = await this.currentBySubject(tenantId, input.subject, m);
      const from = input.validFrom.getTime();
      const same = current.find((c) => c.fact === input.fact && c.validTo === null && new Date(c.validFrom).getTime() <= from);
      if (same) return same;
      const overlapping = current.filter((c) => c.validTo === null || new Date(c.validTo).getTime() > from);
      const id = randomUUID();
      const [row] = await m.query(
        `INSERT INTO assistant_memory_facts (id, tenant_id, subject, fact, confirmed_by, source_conversation_id, valid_from)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLUMNS}`,
        [id, tenantId, input.subject, input.fact, input.confirmedBy, input.sourceConversationId, input.validFrom],
      );
      for (const old of overlapping) {
        await m.query(
          `UPDATE assistant_memory_facts SET superseded_at = now(), superseded_by = $3
            WHERE tenant_id = $1 AND id = $2 AND superseded_at IS NULL`,
          [tenantId, old.id, id],
        );
        if (new Date(old.validFrom).getTime() < from) {
          await m.query(
            `INSERT INTO assistant_memory_facts
               (id, tenant_id, subject, fact, confirmed_by, confirmed_at, source_conversation_id, valid_from, valid_to)
             SELECT $3, tenant_id, subject, fact, confirmed_by, confirmed_at, source_conversation_id, valid_from, $4::timestamptz
               FROM assistant_memory_facts WHERE tenant_id = $1 AND id = $2`,
            [tenantId, old.id, randomUUID(), input.validFrom],
          );
        }
      }
      return row as MemoryFact;
    });
  }

  recall(tenantId: string, q: RecallQuery): Promise<MemoryFact[]> {
    return this.scope.run(tenantId, (m) =>
      m.query(
        `SELECT ${COLUMNS} FROM assistant_memory_facts
          WHERE tenant_id = $1
            AND ($2::text IS NULL OR subject = $2)
            AND valid_from <= $3::timestamptz AND (valid_to IS NULL OR valid_to > $3::timestamptz)
            AND (($4::timestamptz IS NULL AND superseded_at IS NULL)
                 OR ($4::timestamptz IS NOT NULL AND recorded_at <= $4::timestamptz
                     AND (superseded_at IS NULL OR superseded_at > $4::timestamptz)))
          ORDER BY subject, recorded_at DESC
          LIMIT $5`,
        [tenantId, q.subject ?? null, q.validAt, q.knownAt ?? null, q.limit],
      ),
    );
  }

  /** The user withdraws a confirmation. Hard delete, tenant-scoped. */
  async forget(tenantId: string, id: string): Promise<boolean> {
    return this.scope.run(tenantId, async (m) => {
      // TypeORM's postgres driver answers DELETE ... RETURNING with [rows, affectedCount].
      const [, affected] = (await m.query(`DELETE FROM assistant_memory_facts WHERE tenant_id = $1 AND id = $2`, [tenantId, id])) as [unknown, number];
      return affected > 0;
    });
  }

  private currentBySubject(tenantId: string, subject: string, m: EntityManager): Promise<MemoryFact[]> {
    return m.query(
      `SELECT ${COLUMNS} FROM assistant_memory_facts WHERE tenant_id = $1 AND subject = $2 AND superseded_at IS NULL FOR UPDATE`,
      [tenantId, subject],
    );
  }
}
