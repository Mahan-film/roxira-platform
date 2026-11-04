import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { PostingRoleMapEntity } from '../entities/posting-role-map.entity';
import { PostingSourceEntity } from '../entities/posting-source.entity';

/**
 * The only access point to `fin_posting_role_maps` and `fin_posting_sources`. Both tables have
 * FORCE row-level security, so every call runs in a TenantScope transaction, and every query also
 * filters by `tenantId` itself (AGENTS.md §4).
 */
@Injectable()
export class PostingRulesRepository {
  constructor(private readonly scope: TenantScope) {}

  runInTransaction<T>(tenantId: string, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.scope.run(tenantId, work);
  }

  listMappings(tenantId: string, docTypes: string[], manager?: EntityManager): Promise<PostingRoleMapEntity[]> {
    return this.scope.within(tenantId, manager, async (m) =>
      (await m.getRepository(PostingRoleMapEntity).find({ where: { tenantId } })).filter((r) => docTypes.includes(r.docType)),
    );
  }

  listAllMappings(tenantId: string): Promise<PostingRoleMapEntity[]> {
    return this.scope.run(tenantId, (m) => m.getRepository(PostingRoleMapEntity).find({ where: { tenantId }, order: { docType: 'ASC', role: 'ASC' } }));
  }

  async upsertMapping(tenantId: string, docType: string, role: string, accountCode: string): Promise<void> {
    await this.scope.run(tenantId, (m) =>
      m.query(
        `INSERT INTO "fin_posting_role_maps" ("tenant_id","doc_type","role","account_code") VALUES ($1,$2,$3,$4)
         ON CONFLICT ("tenant_id","doc_type","role") DO UPDATE SET "account_code" = EXCLUDED."account_code", "updated_at" = now()`,
        [tenantId, docType, role, accountCode],
      ),
    );
  }

  async deleteMapping(tenantId: string, docType: string, role: string): Promise<void> {
    await this.scope.run(tenantId, (m) => m.getRepository(PostingRoleMapEntity).delete({ tenantId, docType, role }));
  }

  /** Inserts the idempotency row; returns false when this source document is already there. */
  async claimSource(tenantId: string, sourceType: string, sourceId: string, docType: string, manager: EntityManager): Promise<boolean> {
    const rows: Array<{ id: number }> = await this.scope.within(tenantId, manager, (m) =>
      m.query(
        `INSERT INTO "fin_posting_sources" ("tenant_id","source_type","source_id","doc_type") VALUES ($1,$2,$3,$4)
         ON CONFLICT ("tenant_id","source_type","source_id") DO NOTHING RETURNING "id"`,
        [tenantId, sourceType, sourceId, docType],
      ),
    );
    return rows.length > 0;
  }

  findSource(tenantId: string, sourceType: string, sourceId: string, manager?: EntityManager): Promise<PostingSourceEntity | null> {
    return this.scope.within(tenantId, manager, (m) =>
      m.getRepository(PostingSourceEntity).findOne({ where: { tenantId, sourceType, sourceId } }),
    );
  }

  async attachEntry(tenantId: string, sourceType: string, sourceId: string, entryId: number, entryNumber: string, manager: EntityManager): Promise<void> {
    await this.scope.within(tenantId, manager, (m) =>
      m.getRepository(PostingSourceEntity).update({ tenantId, sourceType, sourceId }, { entryId, entryNumber }),
    );
  }

  async attachReversal(tenantId: string, sourceType: string, sourceId: string, reversalEntryId: number, manager?: EntityManager): Promise<void> {
    await this.scope.within(tenantId, manager, (m) =>
      m.getRepository(PostingSourceEntity).update({ tenantId, sourceType, sourceId }, { reversalEntryId }),
    );
  }
}
