import { Injectable } from '@nestjs/common';
import { CrmLeadEntity } from '../../crm/entities/crm-lead.entity';
import { CrmRepository } from '../../crm/repositories/crm.repository';

/** داده آماده‌درج یک سرنخ واردشده (فیلدهای اختیاری null می‌شوند). */
export interface ImportLeadData extends Partial<CrmLeadEntity> {
  fullName: string;
  email: string;
}

/**
 * لایه Repository ماژول ورود داده — پوششی روی `CrmRepository` موجود.
 *
 * هیچ درج مستقیمی به پایگاه‌داده انجام نمی‌شود؛ همه نوشتن‌ها از طریق
 * `CrmRepository` و با `tenantId` فراخوان انجام می‌گیرد تا هر ردیف به مستأجر
 * درست بچسبد (Rule #3 و #4 - AGENTS.md).
 */
@Injectable()
export class DataImportRepository {
  constructor(private readonly crmRepository: CrmRepository) {}

  /** یافتن سرنخ موجود با همان (مستأجر، رایانامه). */
  findLeadByEmail(
    tenantId: string,
    email: string,
  ): Promise<CrmLeadEntity | null> {
    return this.crmRepository.findLeadByEmail(tenantId, email);
  }

  /** رایانامه‌های موجود مستأجر در میان فهرست داده‌شده. */
  findLeadEmails(tenantId: string, emails: string[]): Promise<string[]> {
    return this.crmRepository.findLeadEmails(tenantId, emails);
  }

  /** درج گروهی ردیف‌ها (همه با مستأجر فراخوان). */
  async createLeads(
    tenantId: string,
    rows: ImportLeadData[],
  ): Promise<number> {
    const saved = await this.crmRepository.createLeads(tenantId, rows);
    return saved.length;
  }

  /** درج یک ردیف (مسیر پشتیبان وقتی درج گروهی شکست می‌خورد). */
  async createLead(tenantId: string, row: ImportLeadData): Promise<number> {
    const saved = await this.crmRepository.createLead(tenantId, row);
    return saved.id;
  }
}
