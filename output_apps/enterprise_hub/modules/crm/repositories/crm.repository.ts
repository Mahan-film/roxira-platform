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
 * تمام کوئری‌ها و تجمیع‌های تحلیلی فروش اینجا متمرکز شده‌اند و Service هیچ
 * دسترسی مستقیمی به پایگاه‌داده ندارد (Rule #3 - AGENTS.md: Repository Pattern).
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

  async createLead(data: Partial<CrmLeadEntity>): Promise<CrmLeadEntity> {
    const entity = this.leads.create(data);
    return this.leads.save(entity);
  }

  async saveLead(entity: CrmLeadEntity): Promise<CrmLeadEntity> {
    return this.leads.save(entity);
  }

  async findLeadById(id: number): Promise<CrmLeadEntity | null> {
    return this.leads.findOne({ where: { id } });
  }

  async findLeadByEmail(email: string): Promise<CrmLeadEntity | null> {
    return this.leads.findOne({ where: { email } });
  }

  async findLeadsAndCount(options: {
    search?: string;
    stage?: string;
    skip: number;
    take: number;
  }): Promise<[CrmLeadEntity[], number]> {
    const query = this.leads.createQueryBuilder('lead');

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

  async findAllLeads(): Promise<CrmLeadEntity[]> {
    return this.leads.find({
      order: { updatedAt: 'DESC', id: 'DESC' },
      take: 1000,
    });
  }

  async countAllLeads(): Promise<number> {
    return this.leads.count();
  }

  /** تجمیع تعداد و ارزش ریالی سرنخ‌ها به تفکیک مرحله. */
  async getStageAggregates(): Promise<StageAggregateRow[]> {
    return this.leads
      .createQueryBuilder('lead')
      .select('lead.pipelineStage', 'stage')
      .addSelect('COUNT(lead.id)', 'count')
      .addSelect('COALESCE(SUM(lead.estimatedValue), 0)', 'value')
      .groupBy('lead.pipelineStage')
      .getRawMany<StageAggregateRow>();
  }

  // ---------------------------------------------------------------------------
  // سوابق تماس (Contacts)
  // ---------------------------------------------------------------------------

  async createContactMessage(
    data: Partial<ContactMessageEntity>,
  ): Promise<ContactMessageEntity> {
    const entity = this.contacts.create(data);
    return this.contacts.save(entity);
  }

  async findContactMessagesAndCount(
    leadId: number,
    options: { skip: number; take: number },
  ): Promise<[ContactMessageEntity[], number]> {
    return this.contacts.findAndCount({
      where: { leadId },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: options.skip,
      take: options.take,
    });
  }

  async countContactsByLeadId(leadId: number): Promise<number> {
    return this.contacts.count({ where: { leadId } });
  }

  /** شمارش سوابق تماس برای مجموعه‌ای از سرنخ‌ها (برای غنی‌سازی فهرست). */
  async getContactCountsByLeadIds(
    leadIds: number[],
  ): Promise<Map<number, number>> {
    if (leadIds.length === 0) {
      return new Map();
    }

    const rows = await this.contacts
      .createQueryBuilder('contact')
      .select('contact.leadId', 'leadId')
      .addSelect('COUNT(contact.id)', 'count')
      .where({ leadId: In(leadIds) })
      .groupBy('contact.leadId')
      .getRawMany<ContactCountRow>();

    return new Map(
      rows.map((row) => [Number(row.leadId), Number(row.count)]),
    );
  }
}
