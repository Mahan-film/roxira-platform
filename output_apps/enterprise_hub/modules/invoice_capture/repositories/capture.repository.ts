import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';
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
  constructor(
    @InjectRepository(CaptureDocumentEntity) private readonly docs: Repository<CaptureDocumentEntity>,
    @InjectRepository(CaptureFileEntity) private readonly files: Repository<CaptureFileEntity>,
    @InjectRepository(CaptureVendorEntity) private readonly vendors: Repository<CaptureVendorEntity>,
    @InjectRepository(CaptureVendorRuleEntity) private readonly rules: Repository<CaptureVendorRuleEntity>,
    @InjectRepository(CaptureSettingsEntity) private readonly settings: Repository<CaptureSettingsEntity>,
    @InjectRepository(CaptureAuditEntity) private readonly audit: Repository<CaptureAuditEntity>,
  ) {}

  saveDocument(doc: Partial<CaptureDocumentEntity> & { tenantId: string }): Promise<CaptureDocumentEntity> {
    return this.docs.save(this.docs.create(doc));
  }

  findDocument(tenantId: string, id: string): Promise<CaptureDocumentEntity | null> {
    return this.docs.findOne({ where: { tenantId, id } });
  }

  /** Conditional transition: only moves a document that is still in one of `from`. */
  async transition(
    tenantId: string,
    id: string,
    from: CaptureStatus[],
    patch: Partial<CaptureDocumentEntity>,
  ): Promise<boolean> {
    const result = await this.docs
      .createQueryBuilder()
      .update(CaptureDocumentEntity)
      .set(patch as never)
      .where('id = :id AND tenant_id = :tenantId AND status IN (:...from)', { id, tenantId, from })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  findPostedByDedupeKey(tenantId: string, dedupeKey: string, excludeId?: string): Promise<CaptureDocumentEntity | null> {
    const qb = this.docs
      .createQueryBuilder('d')
      .where('d.tenant_id = :tenantId AND d.dedupe_key = :dedupeKey', { tenantId, dedupeKey })
      .andWhere("d.status IN ('posted','auto_posted','reversed')");
    if (excludeId) {
      qb.andWhere('d.id <> :excludeId', { excludeId });
    }
    return qb.getOne();
  }

  findPostedBySha(tenantId: string, sha: string, excludeId?: string): Promise<CaptureDocumentEntity | null> {
    const qb = this.docs
      .createQueryBuilder('d')
      .where('d.tenant_id = :tenantId AND d.source_sha256 = :sha', { tenantId, sha })
      .andWhere("d.status IN ('posted','auto_posted')");
    if (excludeId) {
      qb.andWhere('d.id <> :excludeId', { excludeId });
    }
    return qb.getOne();
  }

  listQueue(tenantId: string, since: Date): Promise<CaptureDocumentEntity[]> {
    return this.docs
      .createQueryBuilder('d')
      .where('d.tenant_id = :tenantId AND d.reviewed_at IS NULL', { tenantId })
      .andWhere(
        "(d.status = 'needs_review' OR (d.status = 'auto_posted' AND d.created_at >= :since))",
        { since },
      )
      .orderBy('d.created_at', 'DESC')
      .limit(200)
      .getMany();
  }

  listRecent(tenantId: string, limit: number): Promise<CaptureDocumentEntity[]> {
    return this.docs.find({ where: { tenantId }, order: { createdAt: 'DESC' }, take: limit });
  }

  /** Spend and document count of the tenant since `since` (the daily cap check). */
  async usageSince(tenantId: string, since: Date): Promise<{ costUsd: number; documents: number }> {
    const row = await this.docs
      .createQueryBuilder('d')
      .select('COALESCE(SUM(d.cost_usd), 0)', 'cost')
      .addSelect('COUNT(*)', 'n')
      .where('d.tenant_id = :tenantId AND d.created_at >= :since', { tenantId, since })
      .getRawOne<{ cost: string; n: string }>();
    return { costUsd: Number(row?.cost ?? 0), documents: Number(row?.n ?? 0) };
  }

  async saveFile(file: CaptureFileEntity): Promise<void> {
    await this.files.save(file);
  }

  findFile(tenantId: string, documentId: string): Promise<CaptureFileEntity | null> {
    return this.files.findOne({ where: { tenantId, documentId } });
  }

  findVendorByTaxId(tenantId: string, taxId: string): Promise<CaptureVendorEntity | null> {
    return this.vendors.findOne({ where: { tenantId, taxId } });
  }

  findVendorByName(tenantId: string, normalizedName: string): Promise<CaptureVendorEntity | null> {
    return this.vendors.findOne({ where: { tenantId, normalizedName } });
  }

  findVendor(tenantId: string, id: string): Promise<CaptureVendorEntity | null> {
    return this.vendors.findOne({ where: { tenantId, id } });
  }

  saveVendor(vendor: Partial<CaptureVendorEntity> & { tenantId: string }): Promise<CaptureVendorEntity> {
    return this.vendors.save(this.vendors.create(vendor));
  }

  findRule(tenantId: string, vendorId: string): Promise<CaptureVendorRuleEntity | null> {
    return this.rules.findOne({ where: { tenantId, vendorId } });
  }

  listRules(tenantId: string): Promise<CaptureVendorRuleEntity[]> {
    return this.rules.find({ where: { tenantId } });
  }

  listVendors(tenantId: string, ids: string[]): Promise<CaptureVendorEntity[]> {
    return ids.length === 0 ? Promise.resolve([]) : this.vendors.find({ where: { tenantId, id: In(ids) } });
  }

  saveRule(rule: CaptureVendorRuleEntity): Promise<CaptureVendorRuleEntity> {
    return this.rules.save(rule);
  }

  findSettings(tenantId: string): Promise<CaptureSettingsEntity | null> {
    return this.settings.findOne({ where: { tenantId } });
  }

  saveSettings(settings: CaptureSettingsEntity): Promise<CaptureSettingsEntity> {
    return this.settings.save(settings);
  }

  async addAudit(entry: Omit<CaptureAuditEntity, 'id' | 'createdAt'>): Promise<void> {
    await this.audit.save(this.audit.create(entry));
  }

  listAudit(tenantId: string, documentId: string): Promise<CaptureAuditEntity[]> {
    return this.audit.find({ where: { tenantId, documentId }, order: { id: 'ASC' } });
  }

  recentSince(tenantId: string, since: Date): Promise<CaptureDocumentEntity[]> {
    return this.docs.find({ where: { tenantId, createdAt: MoreThanOrEqual(since) } });
  }
}
