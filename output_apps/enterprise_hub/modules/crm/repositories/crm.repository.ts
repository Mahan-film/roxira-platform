import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ContactMessageEntity } from '../entities/contact-message.entity';
import { CrmLeadEntity } from '../entities/crm-lead.entity';

/** تجمیع سرنخ‌ها و ارزش ریالی به تفکیک مرحله پایپ‌لاین. */
export interface StageAggregateRow {
  stage: string;
  count: string;
  value: string;
}

/** شمارش سوابق تماس به تفکیک سرنخ. */
export interface ContactCountRow {
  leadId: string;
  count: string;
}

/**
 * لایه Repository — تنها نقطه دسترسی به جداول `crm_leads` و
 * `contact_messages` برای ماژول CRM.
 *
 * همه متدها `tenantId` را به‌عنوان پارامتر اول می‌گیرند و هر کوئری/ذخیره را به
 * همان مستأجر محدود می‌کنند تا هیچ داده‌ای از مستأجر دیگر خوانده یا تغییر نکند
 * (Rule #4 - AGENTS.md: جداسازی مستأجر در لایه Repository). Service هیچ دسترسی
 * مستقیمی به پایگاه‌داده ندارد (Rule #3 - AGENTS.md: Repository Pattern).
 */
@Injectable()
export class CrmRepository {
  constructor(
    @InjectRepository(CrmLeadEntity)
    private readonly leads: Repository<CrmLeadEntity>,
    @InjectRepository(ContactMessageEntity)
    private readonly contacts: Repository<ContactMessageEntity>,
  ) {}

  // ---------------------------------------------------------------------------
  // سرنخ‌ها (Leads)
  // ---------------------------------------------------------------------------

  async createLead(
    tenantId: string,
    data: Partial<CrmLeadEntity>,
  ): Promise<CrmLeadEntity> {
    const entity = this.leads.create({ ...data, tenantId });
    return this.leads.save(entity);
  }

  async saveLead(
    tenantId: string,
    entity: CrmLeadEntity,
  ): Promise<CrmLeadEntity> {
    entity.tenantId = tenantId;
    await this.leads.update(
      { id: entity.id, tenantId },
      {
        fullName: entity.fullName,
        email: entity.email,
        phone: entity.phone,
        company: entity.company,
        pipelineStage: entity.pipelineStage,
        estimatedValue: entity.estimatedValue,
        owner: entity.owner,
        notes: entity.notes,
        updatedAt: entity.updatedAt,
      },
    );
    return entity;
  }

  async findLeadById(
    tenantId: string,
    id: number,
  ): Promise<CrmLeadEntity | null> {
    return this.leads.findOne({ where: { id, tenantId } });
  }

  async findLeadByEmail(
    tenantId: string,
    email: string,
  ): Promise<CrmLeadEntity | null> {
    return this.leads.findOne({ where: { email, tenantId } });
  }

  async findLeadsAndCount(
    tenantId: string,
    options: {
      search?: string;
      stage?: string;
      skip: number;
      take: number;
    },
  ): Promise<[CrmLeadEntity[], number]> {
    const query = this.leads.createQueryBuilder('lead');

    query.andWhere('lead.tenantId = :tenantId', { tenantId });

    if (options.search) {
      const pattern = `%${options.search}%`;
      query.andWhere(
        '(lead.fullName ILIKE :pattern OR lead.email ILIKE :pattern OR lead.company ILIKE :pattern OR lead.phone ILIKE :pattern)',
        { pattern },
      );
    }
    if (options.stage) {
      query.andWhere('lead.pipelineStage = :stage', { stage: options.stage });
    }

    query
      .orderBy('lead.updatedAt', 'DESC')
      .addOrderBy('lead.id', 'DESC')
      .skip(options.skip)
      .take(options.take);

    return query.getManyAndCount();
  }

  async findAllLeads(tenantId: string): Promise<CrmLeadEntity[]> {
    return this.leads.find({
      where: { tenantId },
      order: { updatedAt: 'DESC', id: 'DESC' },
      take: 1000,
    });
  }

  async countAllLeads(tenantId: string): Promise<number> {
    return this.leads.count({ where: { tenantId } });
  }

  /** تجمیع تعداد و ارزش ریالی سرنخ‌ها به تفکیک مرحله (فقط مستأجر جاری). */
  async getStageAggregates(tenantId: string): Promise<StageAggregateRow[]> {
    return this.leads
      .createQueryBuilder('lead')
      .select('lead.pipelineStage', 'stage')
      .addSelect('COUNT(lead.id)', 'count')
      .addSelect('COALESCE(SUM(lead.estimatedValue), 0)', 'value')
      .where('lead.tenantId = :tenantId', { tenantId })
      .groupBy('lead.pipelineStage')
      .getRawMany<StageAggregateRow>();
  }

  // ---------------------------------------------------------------------------
  // سوابق تماس (Contacts)
  // ---------------------------------------------------------------------------

  async createContactMessage(
    tenantId: string,
    data: Partial<ContactMessageEntity>,
  ): Promise<ContactMessageEntity> {
    const entity = this.contacts.create({ ...data, tenantId });
    return this.contacts.save(entity);
  }

  async findContactMessagesAndCount(
    tenantId: string,
    leadId: number,
    options: { skip: number; take: number },
  ): Promise<[ContactMessageEntity[], number]> {
    return this.contacts.findAndCount({
      where: { leadId, tenantId },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: options.skip,
      take: options.take,
    });
  }

  async countContactsByLeadId(
    tenantId: string,
    leadId: number,
  ): Promise<number> {
    return this.contacts.count({ where: { leadId, tenantId } });
  }

  /** شمارش سوابق تماس برای مجموعه‌ای از سرنخ‌ها (برای غنی‌سازی فهرست). */
  async getContactCountsByLeadIds(
    tenantId: string,
    leadIds: number[],
  ): Promise<Map<number, number>> {
    if (leadIds.length === 0) {
      return new Map();
    }

    const rows = await this.contacts
      .createQueryBuilder('contact')
      .select('contact.leadId', 'leadId')
      .addSelect('COUNT(contact.id)', 'count')
      .where({ leadId: In(leadIds), tenantId })
      .groupBy('contact.leadId')
      .getRawMany<ContactCountRow>();

    return new Map(
      rows.map((row) => [Number(row.leadId), Number(row.count)]),
    );
  }
}
