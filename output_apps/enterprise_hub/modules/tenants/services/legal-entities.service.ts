import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LegalEntityEntity } from '../entities/legal-entity.entity';
import { LegalEntitiesRepository, UpsertLegalEntityInput } from '../repositories/legal-entities.repository';

export interface EInvoicingRegistration {
  legalEntityId: string;
  countryCode: string;
  taxId: string;
  vatId: string | null;
  einvoiceId: string;
}

/**
 * Legal entity tax & e-invoicing registration service (T224).
 *
 * Tax, VAT, and e-invoicing IDs belong to the legal entity, never solely to the tenant.
 * For UAE (`AE`), a VAT group TIN is strictly refused for e-invoicing; each member entity must
 * present its own TIN (`taxId` / `einvoiceId`).
 */
@Injectable()
export class LegalEntitiesService {
  constructor(private readonly repository: LegalEntitiesRepository) {}

  list(tenantId: string): Promise<LegalEntityEntity[]> {
    return this.repository.list(tenantId);
  }

  getDefault(tenantId: string): Promise<LegalEntityEntity | null> {
    return this.repository.findDefault(tenantId);
  }

  async upsert(tenantId: string, input: UpsertLegalEntityInput): Promise<LegalEntityEntity> {
    const existing = await this.repository.findByCode(tenantId, input.code);
    const country = input.countryCode.trim().toUpperCase();
    const mergedGroupTin = (input.vatGroupTin !== undefined ? input.vatGroupTin : existing?.vatGroupTin)?.trim() ?? null;
    const mergedEinvoiceId = (input.einvoiceId !== undefined ? input.einvoiceId : existing?.einvoiceId)?.trim() ?? null;
    const mergedTaxId = (input.taxId !== undefined ? input.taxId : existing?.taxId)?.trim() ?? null;

    if (country === 'AE' && mergedGroupTin) {
      if (mergedEinvoiceId === mergedGroupTin || mergedTaxId === mergedGroupTin) {
        throw new BadRequestException(
          'UAE VAT group TIN cannot be used for e-invoicing; each member must use its own TIN.',
        );
      }
    }
    return this.repository.upsert(tenantId, input);
  }

  /**
   * Resolve the legal entity's registration IDs for e-invoicing, refusing any UAE VAT group TIN.
   */
  async resolveForEInvoicing(
    tenantId: string,
    legalEntityId?: string,
    overrideTin?: string | null,
  ): Promise<EInvoicingRegistration> {
    const entity = legalEntityId
      ? await this.repository.findById(tenantId, legalEntityId)
      : await this.repository.findDefault(tenantId);
    if (!entity) {
      throw new NotFoundException('Legal entity not found.');
    }
    return assertValidEInvoicingRegistration(entity, overrideTin);
  }
}

/** Pure validation helper so adapters and unit specs can verify UAE VAT group TIN refusal directly. */
export function assertValidEInvoicingRegistration(
  entity: Pick<LegalEntityEntity, 'id' | 'countryCode' | 'taxId' | 'vatId' | 'einvoiceId' | 'vatGroupTin'>,
  overrideTin?: string | null,
): EInvoicingRegistration {
  const country = entity.countryCode.toUpperCase();
  const memberTin = (overrideTin ?? entity.einvoiceId ?? entity.taxId ?? '').trim();
  const groupTin = entity.vatGroupTin?.trim() ?? null;

  if (country === 'AE') {
    if (groupTin && memberTin === groupTin) {
      throw new BadRequestException(
        'UAE VAT group TIN cannot be used for e-invoicing; each member must use its own TIN.',
      );
    }
    if (!memberTin) {
      throw new BadRequestException('UAE e-invoicing requires the member legal entity own TIN.');
    }
  } else if (!memberTin && !entity.vatId?.trim()) {
    throw new BadRequestException('Legal entity must have a taxId, vatId, or einvoiceId for e-invoicing.');
  }

  const fallbackId = (memberTin || entity.vatId || '').trim();
  const effectiveTaxId = (entity.taxId?.trim() || fallbackId);
  const effectiveEinvoiceId = (overrideTin?.trim() || entity.einvoiceId?.trim() || effectiveTaxId);
  return {
    legalEntityId: entity.id,
    countryCode: country,
    taxId: effectiveTaxId,
    vatId: entity.vatId ?? null,
    einvoiceId: effectiveEinvoiceId,
  };
}
