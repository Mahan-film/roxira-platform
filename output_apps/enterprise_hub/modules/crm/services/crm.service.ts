import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MONEY_SCALE } from '../constants/crm.constants';
import { AddLeadNoteDto } from '../dto/add-lead-note.dto';
import {
  ContactMessageResponseDto,
  PaginatedContactMessagesResponseDto,
} from '../dto/contact-message-response.dto';
import {
  LeadResponseDto,
  PaginatedLeadsResponseDto,
} from '../dto/crm-lead-response.dto';
import { CreateContactRecordDto } from '../dto/create-contact-record.dto';
import { CreateLeadDto } from '../dto/create-lead.dto';
import {
  LeadStatsResponseDto,
  PipelineStageGroupDto,
  StageMetricDto,
} from '../dto/pipeline-stats-response.dto';
import {
  QueryContactRecordDto,
  QueryLeadDto,
} from '../dto/query-lead.dto';
import { UpdateLeadDto } from '../dto/update-lead.dto';
import { UpdateLeadStageDto } from '../dto/update-lead-stage.dto';
import { ContactMessageEntity } from '../entities/contact-message.entity';
import { CrmLeadEntity } from '../entities/crm-lead.entity';
import {
  ContactChannel,
  OPEN_PIPELINE_STAGES,
  PIPELINE_STAGE_ORDER,
  PipelineStage,
} from '../enums/crm.enums';
import { CrmRepository } from '../repositories/crm.repository';

/** حداقل اطلاعات لازم برای غنی‌سازی خروجی سرنخ با تعداد تماس. */
type LeadWithCount = { lead: CrmLeadEntity; contactCount: number };

/**
 * سرویس مدیریت ارتباط با مشتریان (CRM) و پایپ‌لاین سرنخ‌ها.
 *
 * تمام منطق کسب‌وکار (یکتایی رایانامه، انتقال مراحل فروش، ثبت یادداشت و
 * سوابق تماس و محاسبه آمار ریالی فرصت‌های باز/نرخ تبدیل) اینجا متمرکز است؛
 * Controller فقط مسیریابی می‌کند و Repository تنها لایه دسترسی به پایگاه‌داده
 * است (Rule #3 - AGENTS.md).
 */
@Injectable()
export class CrmService {
  constructor(private readonly crmRepository: CrmRepository) {}

  private roundMoney(value: number): number {
    const factor = 10 ** MONEY_SCALE;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private toLeadResponse(
    lead: CrmLeadEntity,
    contactCount: number,
  ): LeadResponseDto {
    return {
      id: lead.id,
      fullName: lead.fullName,
      email: lead.email,
      phone: lead.phone,
      company: lead.company,
      pipelineStage: lead.pipelineStage,
      estimatedValue: this.roundMoney(Number(lead.estimatedValue)),
      owner: lead.owner,
      notes: lead.notes,
      contactCount,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
    };
  }

  private toContactResponse(
    contact: ContactMessageEntity,
  ): ContactMessageResponseDto {
    return {
      id: contact.id,
      leadId: contact.leadId,
      senderName: contact.senderName,
      senderPhone: contact.senderPhone,
      senderEmail: contact.senderEmail,
      subject: contact.subject,
      message: contact.message,
      channel: contact.channel,
      createdAt: contact.createdAt,
    };
  }

  private async enrichSingle(
    tenantId: string,
    lead: CrmLeadEntity,
  ): Promise<LeadResponseDto> {
    const contactCount = await this.crmRepository.countContactsByLeadId(
      tenantId,
      lead.id,
    );
    return this.toLeadResponse(lead, contactCount);
  }

  // ---------------------------------------------------------------------------
  // سرنخ‌ها (Leads)
  // ---------------------------------------------------------------------------

  async createLead(
    tenantId: string,
    dto: CreateLeadDto,
  ): Promise<LeadResponseDto> {
    const email = this.normalizeEmail(dto.email);
    const existing = await this.crmRepository.findLeadByEmail(tenantId, email);
    if (existing) {
      throw new ConflictException(
        `سرنخی با رایانامه ${email} قبلاً ثبت شده است.`,
      );
    }

    const now = new Date();
    const created = await this.crmRepository.createLead(tenantId, {
      fullName: dto.fullName.trim(),
      email,
      phone: dto.phone?.trim() || null,
      company: dto.company?.trim() || null,
      pipelineStage: dto.pipelineStage ?? PipelineStage.NEW,
      estimatedValue: this.roundMoney(dto.estimatedValue ?? 0),
      owner: dto.owner?.trim() || null,
      notes: dto.notes?.trim() || null,
      createdAt: now,
      updatedAt: now,
    });

    return this.toLeadResponse(created, 0);
  }

  async listLeads(
    tenantId: string,
    query: QueryLeadDto,
  ): Promise<PaginatedLeadsResponseDto> {
    const [entities, total] = await this.crmRepository.findLeadsAndCount(
      tenantId,
      {
        search: query.search?.trim() || undefined,
        stage: query.stage,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      },
    );

    const counts = await this.crmRepository.getContactCountsByLeadIds(
      tenantId,
      entities.map((entity) => entity.id),
    );

    return {
      data: entities.map((entity) =>
        this.toLeadResponse(entity, counts.get(entity.id) ?? 0),
      ),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async getLead(tenantId: string, id: number): Promise<LeadResponseDto> {
    const lead = await this.crmRepository.findLeadById(tenantId, id);
    if (!lead) {
      throw new NotFoundException(`سرنخ با شناسه ${id} یافت نشد.`);
    }
    return this.enrichSingle(tenantId, lead);
  }

  async updateLead(
    tenantId: string,
    id: number,
    dto: UpdateLeadDto,
  ): Promise<LeadResponseDto> {
    const lead = await this.crmRepository.findLeadById(tenantId, id);
    if (!lead) {
      throw new NotFoundException(`سرنخ با شناسه ${id} یافت نشد.`);
    }

    if (dto.email !== undefined) {
      const email = this.normalizeEmail(dto.email);
      if (email !== lead.email) {
        const duplicate = await this.crmRepository.findLeadByEmail(
          tenantId,
          email,
        );
        if (duplicate) {
          throw new ConflictException(
            `سرنخی با رایانامه ${email} قبلاً ثبت شده است.`,
          );
        }
        lead.email = email;
      }
    }
    if (dto.fullName !== undefined) {
      lead.fullName = dto.fullName.trim();
    }
    if (dto.phone !== undefined) {
      lead.phone = dto.phone?.trim() || null;
    }
    if (dto.company !== undefined) {
      lead.company = dto.company?.trim() || null;
    }
    if (dto.pipelineStage !== undefined) {
      lead.pipelineStage = dto.pipelineStage;
    }
    if (dto.estimatedValue !== undefined) {
      lead.estimatedValue = this.roundMoney(dto.estimatedValue);
    }
    if (dto.owner !== undefined) {
      lead.owner = dto.owner?.trim() || null;
    }
    if (dto.notes !== undefined) {
      lead.notes = dto.notes?.trim() || null;
    }

    lead.updatedAt = new Date();
    const saved = await this.crmRepository.saveLead(tenantId, lead);
    return this.enrichSingle(tenantId, saved);
  }

  async updateLeadStage(
    tenantId: string,
    id: number,
    dto: UpdateLeadStageDto,
  ): Promise<LeadResponseDto> {
    const lead = await this.crmRepository.findLeadById(tenantId, id);
    if (!lead) {
      throw new NotFoundException(`سرنخ با شناسه ${id} یافت نشد.`);
    }

    lead.pipelineStage = dto.pipelineStage;
    lead.updatedAt = new Date();
    const saved = await this.crmRepository.saveLead(tenantId, lead);
    return this.enrichSingle(tenantId, saved);
  }

  async addLeadNote(
    tenantId: string,
    id: number,
    dto: AddLeadNoteDto,
  ): Promise<LeadResponseDto> {
    const lead = await this.crmRepository.findLeadById(tenantId, id);
    if (!lead) {
      throw new NotFoundException(`سرنخ با شناسه ${id} یافت نشد.`);
    }

    const stamp = new Date().toISOString();
    const entry = `[${stamp}] ${dto.note.trim()}`;
    lead.notes = lead.notes ? `${lead.notes}\n${entry}` : entry;
    lead.updatedAt = new Date();

    const saved = await this.crmRepository.saveLead(tenantId, lead);
    return this.enrichSingle(tenantId, saved);
  }

  // ---------------------------------------------------------------------------
  // سوابق تماس (Contacts)
  // ---------------------------------------------------------------------------

  async listContactRecords(
    tenantId: string,
    leadId: number,
    query: QueryContactRecordDto,
  ): Promise<PaginatedContactMessagesResponseDto> {
    const lead = await this.crmRepository.findLeadById(tenantId, leadId);
    if (!lead) {
      throw new NotFoundException(`سرنخ با شناسه ${leadId} یافت نشد.`);
    }

    const [entities, total] =
      await this.crmRepository.findContactMessagesAndCount(tenantId, leadId, {
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });

    return {
      data: entities.map((entity) => this.toContactResponse(entity)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async addContactRecord(
    tenantId: string,
    leadId: number,
    dto: CreateContactRecordDto,
  ): Promise<ContactMessageResponseDto> {
    const lead = await this.crmRepository.findLeadById(tenantId, leadId);
    if (!lead) {
      throw new NotFoundException(`سرنخ با شناسه ${leadId} یافت نشد.`);
    }

    const created = await this.crmRepository.createContactMessage(tenantId, {
      leadId: lead.id,
      senderName: dto.senderName?.trim() || lead.fullName,
      senderPhone: dto.senderPhone?.trim() || lead.phone || '',
      senderEmail: dto.senderEmail?.trim() || lead.email,
      subject: dto.subject.trim(),
      message: dto.message.trim(),
      channel: dto.channel ?? ContactChannel.PHONE,
      createdAt: new Date(),
    });

    lead.updatedAt = new Date();
    await this.crmRepository.saveLead(tenantId, lead);

    return this.toContactResponse(created);
  }

  // ---------------------------------------------------------------------------
  // آمار تحلیلی فروش و پایپ‌لاین
  // ---------------------------------------------------------------------------

  async getStats(tenantId: string): Promise<LeadStatsResponseDto> {
    const aggregates = await this.crmRepository.getStageAggregates(tenantId);
    const aggregateByStage = new Map(
      aggregates.map((row) => [
        row.stage as PipelineStage,
        {
          count: Number(row.count),
          value: Number(row.value),
        },
      ]),
    );

    let totalLeads = 0;
    let openLeads = 0;
    let wonLeads = 0;
    let lostLeads = 0;
    let openPipelineValue = 0;
    let wonRevenue = 0;
    let lostValue = 0;
    let totalPipelineValue = 0;

    const byStage: StageMetricDto[] = PIPELINE_STAGE_ORDER.map((stage) => {
      const metric = aggregateByStage.get(stage) ?? { count: 0, value: 0 };
      totalLeads += metric.count;
      totalPipelineValue += metric.value;

      if (OPEN_PIPELINE_STAGES.has(stage)) {
        openLeads += metric.count;
        openPipelineValue += metric.value;
      } else if (stage === PipelineStage.WON) {
        wonLeads += metric.count;
        wonRevenue += metric.value;
      } else if (stage === PipelineStage.LOST) {
        lostLeads += metric.count;
        lostValue += metric.value;
      }

      return {
        stage,
        count: metric.count,
        value: this.roundMoney(metric.value),
        share: 0,
      };
    });

    for (const metric of byStage) {
      metric.share =
        totalPipelineValue > 0
          ? this.roundMoney((metric.value / totalPipelineValue) * 100)
          : 0;
    }

    const closedLeads = wonLeads + lostLeads;

    return {
      totalLeads,
      openLeads,
      wonLeads,
      lostLeads,
      openPipelineValue: this.roundMoney(openPipelineValue),
      wonRevenue: this.roundMoney(wonRevenue),
      lostValue: this.roundMoney(lostValue),
      totalPipelineValue: this.roundMoney(totalPipelineValue),
      averageDealValue:
        totalLeads > 0
          ? this.roundMoney(totalPipelineValue / totalLeads)
          : 0,
      conversionRate:
        totalLeads > 0
          ? this.roundMoney((wonLeads / totalLeads) * 100)
          : 0,
      winRate:
        closedLeads > 0
          ? this.roundMoney((wonLeads / closedLeads) * 100)
          : 0,
      byStage,
    };
  }

  async getPipeline(tenantId: string): Promise<PipelineStageGroupDto[]> {
    const leads = await this.crmRepository.findAllLeads(tenantId);
    const counts = await this.crmRepository.getContactCountsByLeadIds(
      tenantId,
      leads.map((lead) => lead.id),
    );

    const grouped = new Map<PipelineStage, LeadWithCount[]>();
    for (const stage of PIPELINE_STAGE_ORDER) {
      grouped.set(stage, []);
    }

    for (const lead of leads) {
      const bucket = grouped.get(lead.pipelineStage);
      const item: LeadWithCount = {
        lead,
        contactCount: counts.get(lead.id) ?? 0,
      };
      if (bucket) {
        bucket.push(item);
      } else {
        // مرحله ناشناخته (داده قدیمی) در ستون NEW نمایش داده می‌شود.
        grouped.get(PipelineStage.NEW)!.push(item);
      }
    }

    return PIPELINE_STAGE_ORDER.map((stage) => {
      const items = grouped.get(stage) ?? [];
      const totalValue = items.reduce(
        (sum, item) => sum + Number(item.lead.estimatedValue),
        0,
      );
      return {
        stage,
        count: items.length,
        totalValue: this.roundMoney(totalValue),
        leads: items.map((item) =>
          this.toLeadResponse(item.lead, item.contactCount),
        ),
      };
    });
  }
}
