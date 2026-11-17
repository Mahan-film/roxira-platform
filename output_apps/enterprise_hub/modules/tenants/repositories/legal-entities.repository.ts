import { Injectable } from '@nestjs/common';
import { TenantScope } from '../../access/services/tenant-scope';
import { LegalEntityEntity } from '../entities/legal-entity.entity';

export interface UpsertLegalEntityInput {
  code: string;
  name: string;
  countryCode: string;
  vatId?: string | null;
  taxId?: string | null;
  einvoiceId?: string | null;
  vatGroupTin?: string | null;
  isDefault?: boolean;
}

/**
 * Persistence for `legal_entities`. Enforces `TenantScope` + `tenant_id` filter on every query
 * (table has FORCE ROW LEVEL SECURITY).
 */
@Injectable()
export class LegalEntitiesRepository {
  constructor(private readonly scope: TenantScope) {}

  list(tenantId: string): Promise<LegalEntityEntity[]> {
    return this.scope.run(tenantId, (m) =>
      m.getRepository(LegalEntityEntity).find({ where: { tenantId }, order: { isDefault: 'DESC', code: 'ASC' } }),
    );
  }

  findById(tenantId: string, id: string): Promise<LegalEntityEntity | null> {
    return this.scope.run(tenantId, (m) =>
      m.getRepository(LegalEntityEntity).findOne({ where: { tenantId, id } }),
    );
  }

  findDefault(tenantId: string): Promise<LegalEntityEntity | null> {
    return this.scope.run(tenantId, async (m) => {
      const repo = m.getRepository(LegalEntityEntity);
      const def = await repo.findOne({ where: { tenantId, isDefault: true } });
      if (def) return def;
      return repo.findOne({ where: { tenantId }, order: { createdAt: 'ASC' } });
    });
  }

  async upsert(tenantId: string, input: UpsertLegalEntityInput): Promise<LegalEntityEntity> {
    return this.scope.run(tenantId, async (m) => {
      const repo = m.getRepository(LegalEntityEntity);
      const code = input.code.trim().toUpperCase();
      const existing = await repo.findOne({ where: { tenantId, code } });
      if (existing) {
        existing.name = input.name.trim();
        existing.countryCode = input.countryCode.trim().toUpperCase();
        if (input.vatId !== undefined) existing.vatId = input.vatId;
        if (input.taxId !== undefined) existing.taxId = input.taxId;
        if (input.einvoiceId !== undefined) existing.einvoiceId = input.einvoiceId;
        if (input.vatGroupTin !== undefined) existing.vatGroupTin = input.vatGroupTin;
        if (input.isDefault !== undefined) existing.isDefault = input.isDefault;
        return repo.save(existing);
      }
      return repo.save(
        repo.create({
          tenantId,
          code,
          name: input.name.trim(),
          countryCode: input.countryCode.trim().toUpperCase(),
          vatId: input.vatId ?? null,
          taxId: input.taxId ?? null,
          einvoiceId: input.einvoiceId ?? null,
          vatGroupTin: input.vatGroupTin ?? null,
          isDefault: input.isDefault ?? false,
        }),
      );
    });
  }
}
