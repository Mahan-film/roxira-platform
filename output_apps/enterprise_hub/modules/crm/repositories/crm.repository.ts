import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { ContactMessageEntity } from '../entities/contact-message.entity';
import { normalizePhone } from '../utils/phone';
import { PipelineStage } from '../enums/crm.enums';
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
  private resolvedScope?: TenantScope | null;

  constructor(
    @InjectRepository(CrmLeadEntity)
    private readonly leads: Repository<CrmLeadEntity>,
    @InjectRepository(ContactMessageEntity)
    private readonly contacts: Repository<ContactMessageEntity>,
    @Optional() private readonly scope?: TenantScope,
  ) {}

  private getScope(): TenantScope | null {
    if (this.resolvedScope !== undefined) return this.resolvedScope;
    if (this.scope) return (this.resolvedScope = this.scope);
    const conn = this.leads?.manager?.connection ?? this.contacts?.manager?.connection;
    if (conn && typeof conn.transaction === 'function') {
      return (this.resolvedScope = new TenantScope(conn));
    }
    return (this.resolvedScope = null);
  }

  private withLeads<T>(
    tenantId: string,
    work: (repo: Repository<CrmLeadEntity>) => Promise<T>,
  ): Promise<T> {
    const scope = this.getScope();
    if (!scope) return work(this.leads);
    return scope.run(tenantId, (m) => work(m.getRepository(CrmLeadEntity)));
  }

  // ---------------------------------------------------------------------------
  // سرنخ‌ها (Leads)
  // ---------------------------------------------------------------------------

  async createLead(
    tenantId: string,
    data: Partial<CrmLeadEntity>,
  ): Promise<CrmLeadEntity> {
    return this.withLeads(tenantId, async (repo) => {
      const entity = repo.create({
        ...data,
        tenantId,
        phoneNormalized: normalizePhone(data.phone),
      });
      return repo.save(entity);
    });
  }

  /** The tenant's built-in anonymous customer, or null before the first anonymous sale. */
  async findWalkInLead(tenantId: string): Promise<CrmLeadEntity | null> {
    return this.withLeads(tenantId, (repo) =>
      repo.findOne({ where: { tenantId, isWalkIn: true } }),
    );
  }

  /**
   * Creates the walk-in customer. The partial unique index allows one per tenant, so a concurrent
   * creator loses with a unique violation and reads the winner instead.
   */
  async createWalkInLead(tenantId: string, fullName: string): Promise<CrmLeadEntity> {
    const now = new Date();
    try {
      return await this.withLeads(tenantId, (repo) =>
        repo.save(
          repo.create({
            tenantId,
            fullName,
            email: null,
            phone: null,
            phoneNormalized: null,
            isWalkIn: true,
            marketingConsent: false,
            source: 'POS',
            pipelineStage: PipelineStage.WON,
            estimatedValue: 0,
            createdAt: now,
            updatedAt: now,
          }),
        ),
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        const existing = await this.findWalkInLead(tenantId);
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  /** A customer of this tenant with exactly this normalized phone (never the walk-in record). */
  async findLeadByPhoneNormalized(
    tenantId: string,
    phoneNormalized: string,
  ): Promise<CrmLeadEntity | null> {
    return this.withLeads(tenantId, (repo) =>
      repo.findOne({
        where: { tenantId, phoneNormalized, isWalkIn: false },
        order: { id: 'ASC' },
      }),
    );
  }

  /**
   * درج گروهی سرنخ‌ها در یک فراخوان (برای مهاجرت داده).
   *
   * همه ردیف‌ها با `tenantId` فراخوان می‌نشینند؛ در ورودی خالی، بدون کوئری
   * آرایه خالی برمی‌گردد.
   */
  async createLeads(
    tenantId: string,
    dataList: Partial<CrmLeadEntity>[],
  ): Promise<CrmLeadEntity[]> {
    if (dataList.length === 0) {
      return [];
    }
    return this.withLeads(tenantId, (repo) => {
      const entities = dataList.map((data) =>
        repo.create({
          ...data,
          tenantId,
          phoneNormalized: normalizePhone(data.phone),
        }),
      );
      return repo.save(entities, { chunk: 500 }); // stay under the bind-parameter limit
    });
  }

  /** مجموعه رایانامه‌های موجودِ مستأجر در میان فهرست داده‌شده (تشخیص تکراری). */
  async findLeadEmails(
    tenantId: string,
    emails: string[],
  ): Promise<string[]> {
    if (emails.length === 0) {
      return [];
    }
    return this.withLeads(tenantId, async (repo) => {
      const rows = await repo.find({
        where: { tenantId, email: In(emails) },
        select: { email: true },
      });
      return rows
        .map((row) => row.email)
        .filter((email): email is string => email !== null);
    });
  }

  /** مجموعه شماره تلفن‌های موجودِ مستأجر در میان فهرست داده‌شده (تشخیص تکراری). */
  async findLeadPhones(
    tenantId: string,
    phones: string[],
  ): Promise<string[]> {
    if (phones.length === 0) {
      return [];
    }
    return this.withLeads(tenantId, async (repo) => {
      const rows = await repo.find({
        where: { tenantId, phone: In(phones) },
        select: { phone: true },
      });
      return rows
        .map((row) => row.phone)
        .filter((phone): phone is string => phone !== null);
    });
  }

  /** حذف ردیف‌های یک دسته ورود داده با قید مستأجر (برای undo). */
  async deleteLeadsByIds(
    tenantId: string,
    ids: number[],
  ): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    return this.withLeads(tenantId, async (repo) => {
      const result = await repo.delete({ tenantId, id: In(ids) });
      return result.affected ?? 0;
    });
  }

  async saveLead(
    tenantId: string,
    entity: CrmLeadEntity,
  ): Promise<CrmLeadEntity> {
    return this.withLeads(tenantId, async (repo) => {
      entity.tenantId = tenantId;
      await repo.update(
        { id: entity.id, tenantId },
        {
          fullName: entity.fullName,
          email: entity.email,
          phone: entity.phone,
          phoneNormalized: normalizePhone(entity.phone),
          company: entity.company,
          pipelineStage: entity.pipelineStage,
          estimatedValue: entity.estimatedValue,
          owner: entity.owner,
          notes: entity.notes,
          updatedAt: entity.updatedAt,
        },
      );
      return entity;
    });
  }

  async findLeadById(
    tenantId: string,
    id: number,
  ): Promise<CrmLeadEntity | null> {
    return this.withLeads(tenantId, (repo) =>
      repo.findOne({ where: { id, tenantId } }),
    );
  }

  async findLeadByEmail(
    tenantId: string,
    email: string,
  ): Promise<CrmLeadEntity | null> {
    return this.withLeads(tenantId, (repo) =>
      repo.findOne({ where: { email, tenantId } }),
    );
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
    return this.withLeads(tenantId, (repo) => {
      const query = repo.createQueryBuilder('lead');

      query.andWhere('lead.tenantId = :tenantId', { tenantId });

      if (options.search) {
        const pattern = `%${options.search}%`;
        query.andWhere(
          '(lead.fullName ILIKE :pattern OR lead.email ILIKE :pattern OR lead.company ILIKE :pattern OR lead.phone ILIKE :pattern)',
          { pattern },
        );
      }
      query.andWhere('lead.isWalkIn = false');
      if (options.stage) {
        query.andWhere('lead.pipelineStage = :stage', { stage: options.stage });
      }

      query
        .orderBy('lead.updatedAt', 'DESC')
        .addOrderBy('lead.id', 'DESC')
        .skip(options.skip)
        .take(options.take);

      return query.getManyAndCount();
    });
  }

  async findAllLeads(tenantId: string): Promise<CrmLeadEntity[]> {
    return this.withLeads(tenantId, (repo) =>
      repo.find({
        where: { tenantId, isWalkIn: false },
        order: { updatedAt: 'DESC', id: 'DESC' },
        take: 1000,
      }),
    );
  }

  async countAllLeads(tenantId: string): Promise<number> {
    return this.withLeads(tenantId, (repo) =>
      repo.count({ where: { tenantId, isWalkIn: false } }),
    );
  }

  /** تجمیع تعداد و ارزش ریالی سرنخ‌ها به تفکیک مرحله (فقط مستأجر جاری). */
  async getStageAggregates(tenantId: string): Promise<StageAggregateRow[]> {
    return this.withLeads(tenantId, (repo) =>
      repo
        .createQueryBuilder('lead')
        .select('lead.pipelineStage', 'stage')
        .addSelect('COUNT(lead.id)', 'count')
        .addSelect('COALESCE(SUM(lead.estimatedValue), 0)', 'value')
        .where('lead.tenantId = :tenantId', { tenantId })
        .andWhere('lead.isWalkIn = false')
        .groupBy('lead.pipelineStage')
        .getRawMany<StageAggregateRow>(),
    );
  }

  // ---------------------------------------------------------------------------
  // سوابق تماس (Contacts)
  // ---------------------------------------------------------------------------

  async createContactMessage(
    tenantId: string,
    data: Partial<ContactMessageEntity>,
  ): Promise<ContactMessageEntity> {
    return this.contacts.manager.transaction(async (m) => {
      await m.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      const entity = m.create(ContactMessageEntity, { ...data, tenantId });
      return m.save(entity);
    });
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
