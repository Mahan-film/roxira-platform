import { Injectable } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { PartyEntity } from '../entities/party.entity';
import { PartyRole } from '../enums/party-role.enum';

export interface PartyInput {
  code: string;
  name: string;
  role: PartyRole;
  nationalId: string | null;
  economicCode: string | null;
  phone: string | null;
  email: string | null;
  creditLimit?: string;
  active?: boolean;
}

export interface PartyPatch {
  name?: string;
  role?: PartyRole;
  nationalId?: string | null;
  economicCode?: string | null;
  phone?: string | null;
  email?: string | null;
  creditLimit?: string;
  active?: boolean;
}

export interface PartyFilter {
  role?: PartyRole;
  active?: boolean;
  search?: string;
  limit: number;
  offset: number;
}

export interface UpsertedPartyRow {
  code: string;
  id: number;
  inserted: boolean;
}

/** ILIKE wildcards must not come from user input; escape them, backslash first. */
const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * The only access point to `erp_parties`. The table has FORCE row-level security, so every call
 * runs in a TenantScope transaction (`app.tenant_id`), and every query also filters by `tenantId`
 * itself (AGENTS.md §4). Methods taking a `manager` join the transaction opened by
 * `runInTransaction`.
 */
@Injectable()
export class PartiesRepository {
  constructor(private readonly scope: TenantScope) {}

  runInTransaction<T>(tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.scope.run(tenantId, work);
  }

  private within<T>(tenantId: string, manager: EntityManager | undefined, work: (m: EntityManager) => Promise<T>): Promise<T> {
    return this.scope.within(tenantId, manager, work);
  }

  // ------------------------------------------------------------------ reads

  /** Role filter matches the role itself and 'both' (a customer filter returns customer + both). */
  list(tenantId: string, filter: PartyFilter): Promise<{ rows: PartyEntity[]; total: number }> {
    return this.within(tenantId, undefined, async (m) => {
      const qb = m
        .getRepository(PartyEntity)
        .createQueryBuilder('p')
        .where('p.tenant_id = :tenantId', { tenantId });
      if (filter.role) {
        qb.andWhere('(p.role = :role OR p.role = :both)', { role: filter.role, both: PartyRole.BOTH });
      }
      if (filter.active !== undefined) {
        qb.andWhere('p.active = :active', { active: filter.active });
      }
      if (filter.search) {
        qb.andWhere('(p.code ILIKE :pattern OR p.name ILIKE :pattern)', {
          pattern: `%${escapeLike(filter.search)}%`,
        });
      }
      const total = await qb.getCount();
      const rows = await qb.orderBy('p.code', 'ASC').limit(filter.limit).offset(filter.offset).getMany();
      return { rows, total };
    });
  }

  findByCode(tenantId: string, code: string): Promise<PartyEntity | null> {
    return this.within(tenantId, undefined, (m) =>
      m.getRepository(PartyEntity).findOne({ where: { tenantId, code } }),
    );
  }

  findById(tenantId: string, id: number): Promise<PartyEntity | null> {
    return this.within(tenantId, undefined, (m) =>
      m.getRepository(PartyEntity).findOne({ where: { tenantId, id } }),
    );
  }

  // ------------------------------------------------------------------ writes

  create(tenantId: string, input: PartyInput): Promise<PartyEntity> {
    return this.within(tenantId, undefined, async (m) => {
      const repo = m.getRepository(PartyEntity);
      return repo.save(repo.create({ ...input, active: input.active ?? true, tenantId }));
    });
  }

  /** Updates only the given fields and `updated_at` (UpdateDateColumn); null when the row is gone. */
  async update(tenantId: string, id: number, patch: PartyPatch): Promise<PartyEntity | null> {
    return this.within(tenantId, undefined, async (m) => {
      const repo = m.getRepository(PartyEntity);
      if (Object.keys(patch).length > 0) await repo.update({ id, tenantId }, patch);
      return repo.findOne({ where: { id, tenantId } });
    });
  }

  /** Codes of the tenant's parties among the given ones (the importer's existence check). */
  async findExistingCodes(tenantId: string, codes: string[]): Promise<string[]> {
    if (codes.length === 0) return [];
    return this.within(tenantId, undefined, async (m) => {
      const rows: Array<{ code: string }> = await m.query(
        `SELECT "code" FROM "erp_parties" WHERE "tenant_id" = $1 AND "code" = ANY($2::text[])`,
        [tenantId, codes],
      );
      return rows.map((r) => r.code);
    });
  }

  /**
   * Upsert by (tenant_id, code) in one statement per row inside ONE TenantScope transaction.
   * `inserted` comes from `xmax = 0`: 0 means the row was written by this INSERT, not by the
   * conflict update. On conflict the name/role/contact columns are overwritten; `active` is kept.
   */
  async insertMany(tenantId: string, inputs: PartyInput[]): Promise<UpsertedPartyRow[]> {
    if (inputs.length === 0) return [];
    return this.runInTransaction(tenantId, async (m) => {
      const out: UpsertedPartyRow[] = [];
      for (const input of inputs) {
        const rows: Array<{ id: number; code: string; inserted: boolean }> = await m.query(
          `INSERT INTO "erp_parties"
             ("tenant_id", "code", "name", "role", "national_id", "economic_code", "phone", "email", "active")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT ("tenant_id", "code") DO UPDATE SET
             "name" = EXCLUDED."name",
             "role" = EXCLUDED."role",
             "national_id" = EXCLUDED."national_id",
             "economic_code" = EXCLUDED."economic_code",
             "phone" = EXCLUDED."phone",
             "email" = EXCLUDED."email",
             "updated_at" = now()
           RETURNING "id", "code", (xmax = 0) AS inserted`,
          [
            tenantId,
            input.code,
            input.name,
            input.role,
            input.nationalId ?? null,
            input.economicCode ?? null,
            input.phone ?? null,
            input.email ?? null,
            input.active ?? true,
          ],
        );
        out.push({ id: Number(rows[0].id), code: String(rows[0].code), inserted: Boolean(rows[0].inserted) });
      }
      return out;
    });
  }

  /** Hard delete of exactly the ids given (importer undo). Returns how many rows went away. */
  async deleteByIds(tenantId: string, ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    return this.within(tenantId, undefined, async (m) => {
      const result = await m.getRepository(PartyEntity).delete({ tenantId, id: In(ids) });
      return result.affected ?? 0;
    });
  }
}
