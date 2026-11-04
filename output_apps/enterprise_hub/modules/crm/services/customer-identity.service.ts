import { Injectable } from '@nestjs/common';
import { CrmLeadEntity } from '../entities/crm-lead.entity';
import { CrmRepository } from '../repositories/crm.repository';
import { normalizePhone } from '../utils/phone';

export const WALK_IN_NAME = 'مشتری گذری';

export interface CustomerHint {
  phone?: string;
  name?: string;
}

/**
 * Who a sale is for, at three levels of knowledge: nobody (the built-in walk-in customer),
 * a phone only, or a name and phone. A phone matches an existing customer exactly (after
 * normalisation) before anything is created, and a created record is minimal and never implies
 * consent to marketing.
 */
@Injectable()
export class CustomerIdentityService {
  constructor(private readonly crmRepository: CrmRepository) {}

  /** The tenant's anonymous customer, created on first use (never one per sale). */
  async walkIn(tenantId: string): Promise<CrmLeadEntity> {
    return (
      (await this.crmRepository.findWalkInLead(tenantId)) ??
      this.crmRepository.createWalkInLead(tenantId, WALK_IN_NAME)
    );
  }

  /**
   * Customer for a sale. No hint: the walk-in customer. A phone: the customer with that exact
   * phone, else a new minimal record (name falls back to the phone). A matching customer keeps its
   * own name; a typed name only fills a customer that has none.
   */
  async resolve(
    tenantId: string,
    hint: CustomerHint | undefined,
    countryCode = 'IR',
  ): Promise<{ lead: CrmLeadEntity; level: 'anonymous' | 'phone' | 'name_phone'; created: boolean }> {
    const phone = normalizePhone(hint?.phone, countryCode);
    const name = hint?.name?.trim() || undefined;
    if (!phone) {
      return { lead: await this.walkIn(tenantId), level: 'anonymous', created: false };
    }
    const level = name ? 'name_phone' : 'phone';
    const existing = await this.crmRepository.findLeadByPhoneNormalized(tenantId, phone);
    if (existing) {
      return { lead: existing, level, created: false };
    }
    const now = new Date();
    const lead = await this.crmRepository.createLead(tenantId, {
      fullName: name ?? hint!.phone!.trim(),
      email: null,
      phone: hint!.phone!.trim(),
      company: null,
      marketingConsent: false,
      isWalkIn: false,
      source: 'POS',
      pipelineStage: 'WON' as CrmLeadEntity['pipelineStage'],
      estimatedValue: 0,
      owner: null,
      notes: null,
      createdAt: now,
      updatedAt: now,
    });
    return { lead, level, created: true };
  }
}
