import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityTarget, In, MoreThanOrEqual, ObjectLiteral, Repository } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import {
  CaptureAuditEntity,
  CaptureDocumentEntity,
  CaptureFileEntity,
  CaptureSettingsEntity,
  CaptureStatus,
  CaptureVendorEntity,
  CaptureVendorRuleEntity,
} from '../entities/capture.entities';

/**
 * The only layer touching the capture tables. EVERY method takes the tenant id and filters by it:
 * a document id from a client is never enough to reach another tenant's row.
 */
@Injectable()
export class CaptureRepository {
  private resolvedScope?: TenantScope | null;

  constructor(
    @InjectRepository(CaptureDocumentEntity) private readonly docs: Repository<CaptureDocumentEntity>,
    @InjectRepository(CaptureFileEntity) private readonly files: Repository<CaptureFileEntity>,
    @InjectRepository(CaptureVendorEntity) private readonly vendors: Repository<CaptureVendorEntity>,
    @InjectRepository(CaptureVendorRuleEntity) private readonly rules: Repository<CaptureVendorRuleEntity>,
    @InjectRepository(CaptureSettingsEntity) private readonly settings: Repository<CaptureSettingsEntity>,
    @InjectRepository(CaptureAuditEntity) private readonly audit: Repository<CaptureAuditEntity>,
    @Optional() private readonly scope?: TenantScope,
  ) {}

  private getScope(): TenantScope | null {
    if (this.resolvedScope !== undefined) return this.resolvedScope;
    if (this.scope) return (this.resolvedScope = this.scope);
    const conn =
      this.docs?.manager?.connection ??
      this.files?.manager?.connection ??
      this.vendors?.manager?.connection ??
      this.rules?.manager?.connection ??
      this.settings?.manager?.connection ??
      this.audit?.manager?.connection;
    if (conn && typeof conn.transaction === 'function') {
      return (this.resolvedScope = new TenantScope(conn));
    }
    return (this.resolvedScope = null);
  }

  private withRepo<E extends ObjectLiteral, T>(
    tenantId: string,
    target: EntityTarget<E>,
    fallback: Repository<E>,
    work: (repo: Repository<E>) => Promise<T>,
  ): Promise<T> {
    const scope = this.getScope();
    if (!scope) return work(fallback);
    return scope.run(tenantId, (m) => work(m.getRepository(target)));
  }

  saveDocument(doc: Partial<CaptureDocumentEntity> & { tenantId: string }): Promise<CaptureDocumentEntity> {
    return this.withRepo(doc.tenantId, CaptureDocumentEntity, this.docs, (repo) =>
      repo.save(repo.create(doc)),
    );
  }

  findDocument(tenantId: string, id: string): Promise<CaptureDocumentEntity | null> {
    return this.withRepo(tenantId, CaptureDocumentEntity, this.docs, (repo) =>
      repo.findOne({ where: { tenantId, id } }),
    );
  }

  /** Conditional transition: only moves a document that is still in one of `from`. */
  async transition(
    tenantId: string,
    id: string,
    from: CaptureStatus[],
    patch: Partial<CaptureDocumentEntity>,
  ): Promise<boolean> {
    return this.withRepo(tenantId, CaptureDocumentEntity, this.docs, async (repo) => {
      const result = await repo
        .createQueryBuilder()
        .update(CaptureDocumentEntity)
        .set(patch as never)
        .where('id = :id AND tenant_id = :tenantId AND status IN (:...from)', { id, tenantId, from })
        .execute();
      return (result.affected ?? 0) > 0;
    });
  }

  findPostedByDedupeKey(tenantId: string, dedupeKey: string, excludeId?: string): Promise<CaptureDocumentEntity | null> {
    return this.withRepo(tenantId, CaptureDocumentEntity, this.docs, (repo) => {
      const qb = repo
        .createQueryBuilder('d')
        .where('d.tenant_id = :tenantId AND d.dedupe_key = :dedupeKey', { tenantId, dedupeKey })
        .andWhere("d.status IN ('posted','auto_posted','reversed')");
      if (excludeId) {
        qb.andWhere('d.id <> :excludeId', { excludeId });
      }
      return qb.getOne();
    });
  }

  findPostedBySha(tenantId: string, sha: string, excludeId?: string): Promise<CaptureDocumentEntity | null> {
    return this.withRepo(tenantId, CaptureDocumentEntity, this.docs, (repo) => {
      const qb = repo
        .createQueryBuilder('d')
        .where('d.tenant_id = :tenantId AND d.source_sha256 = :sha', { tenantId, sha })
        .andWhere("d.status IN ('posted','auto_posted')");
      if (excludeId) {
        qb.andWhere('d.id <> :excludeId', { excludeId });
      }
      return qb.getOne();
    });
  }

  listQueue(tenantId: string, since: Date): Promise<CaptureDocumentEntity[]> {
    return this.withRepo(tenantId, CaptureDocumentEntity, this.docs, (repo) =>
      repo
        .createQueryBuilder('d')
        .where('d.tenant_id = :tenantId AND d.reviewed_at IS NULL', { tenantId })
        .andWhere(
          "(d.status = 'needs_review' OR (d.status = 'auto_posted' AND d.created_at >= :since))",
          { since },
        )
        .orderBy('d.created_at', 'DESC')
        .limit(200)
        .getMany(),
    );
  }

  listRecent(tenantId: string, limit: number): Promise<CaptureDocumentEntity[]> {
    return this.withRepo(tenantId, CaptureDocumentEntity, this.docs, (repo) =>
      repo.find({ where: { tenantId }, order: { createdAt: 'DESC' }, take: limit }),
    );
  }

  /** Spend and document count of the tenant since `since` (the daily cap check). */
  async usageSince(tenantId: string, since: Date): Promise<{ costUsd: number; documents: number }> {
    return this.withRepo(tenantId, CaptureDocumentEntity, this.docs, async (repo) => {
      const row = await repo
        .createQueryBuilder('d')
        .select('COALESCE(SUM(d.cost_usd), 0)', 'cost')
        .addSelect('COUNT(*)', 'n')
        .where('d.tenant_id = :tenantId AND d.created_at >= :since', { tenantId, since })
        .getRawOne<{ cost: string; n: string }>();
      return { costUsd: Number(row?.cost ?? 0), documents: Number(row?.n ?? 0) };
    });
  }

  async saveFile(file: CaptureFileEntity): Promise<void> {
    await this.withRepo(file.tenantId, CaptureFileEntity, this.files, async (repo) => {
      await repo.save(file);
    });
  }

  findFile(tenantId: string, documentId: string): Promise<CaptureFileEntity | null> {
    return this.withRepo(tenantId, CaptureFileEntity, this.files, (repo) =>
      repo.findOne({ where: { tenantId, documentId } }),
    );
  }

  findVendorByTaxId(tenantId: string, taxId: string): Promise<CaptureVendorEntity | null> {
    return this.withRepo(tenantId, CaptureVendorEntity, this.vendors, (repo) =>
      repo.findOne({ where: { tenantId, taxId } }),
    );
  }

  findVendorByName(tenantId: string, normalizedName: string): Promise<CaptureVendorEntity | null> {
    return this.withRepo(tenantId, CaptureVendorEntity, this.vendors, (repo) =>
      repo.findOne({ where: { tenantId, normalizedName } }),
    );
  }

  findVendor(tenantId: string, id: string): Promise<CaptureVendorEntity | null> {
    return this.withRepo(tenantId, CaptureVendorEntity, this.vendors, (repo) =>
      repo.findOne({ where: { tenantId, id } }),
    );
  }

  saveVendor(vendor: Partial<CaptureVendorEntity> & { tenantId: string }): Promise<CaptureVendorEntity> {
    return this.withRepo(vendor.tenantId, CaptureVendorEntity, this.vendors, (repo) =>
      repo.save(repo.create(vendor)),
    );
  }

  findRule(tenantId: string, vendorId: string): Promise<CaptureVendorRuleEntity | null> {
    return this.withRepo(tenantId, CaptureVendorRuleEntity, this.rules, (repo) =>
      repo.findOne({ where: { tenantId, vendorId } }),
    );
  }

  listRules(tenantId: string): Promise<CaptureVendorRuleEntity[]> {
    return this.withRepo(tenantId, CaptureVendorRuleEntity, this.rules, (repo) =>
      repo.find({ where: { tenantId } }),
    );
  }

  listVendors(tenantId: string, ids: string[]): Promise<CaptureVendorEntity[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.withRepo(tenantId, CaptureVendorEntity, this.vendors, (repo) =>
      repo.find({ where: { tenantId, id: In(ids) } }),
    );
  }

  saveRule(rule: CaptureVendorRuleEntity): Promise<CaptureVendorRuleEntity> {
    return this.withRepo(rule.tenantId, CaptureVendorRuleEntity, this.rules, (repo) =>
      repo.save(rule),
    );
  }

  findSettings(tenantId: string): Promise<CaptureSettingsEntity | null> {
    return this.withRepo(tenantId, CaptureSettingsEntity, this.settings, (repo) =>
      repo.findOne({ where: { tenantId } }),
    );
  }

  saveSettings(settings: CaptureSettingsEntity): Promise<CaptureSettingsEntity> {
    return this.withRepo(settings.tenantId, CaptureSettingsEntity, this.settings, (repo) =>
      repo.save(settings),
    );
  }

  async addAudit(entry: Omit<CaptureAuditEntity, 'id' | 'createdAt'>): Promise<void> {
    await this.withRepo(entry.tenantId, CaptureAuditEntity, this.audit, async (repo) => {
      await repo.save(repo.create(entry));
    });
  }

  listAudit(tenantId: string, documentId: string): Promise<CaptureAuditEntity[]> {
    return this.withRepo(tenantId, CaptureAuditEntity, this.audit, (repo) =>
      repo.find({ where: { tenantId, documentId }, order: { id: 'ASC' } }),
    );
  }

  recentSince(tenantId: string, since: Date): Promise<CaptureDocumentEntity[]> {
    return this.withRepo(tenantId, CaptureDocumentEntity, this.docs, (repo) =>
      repo.find({ where: { tenantId, createdAt: MoreThanOrEqual(since) } }),
    );
  }
}
