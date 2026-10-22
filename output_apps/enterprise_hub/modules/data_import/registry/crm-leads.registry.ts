import { Injectable } from '@nestjs/common';
import { PipelineStage } from '../../crm/enums/crm.enums';
import { CrmRepository } from '../../crm/repositories/crm.repository';
import { LEAD_FIELD_SYNONYMS } from '../mapping/lead-field-synonyms';
import {
  ImportLeadData,
} from '../repositories/data-import.repository';
import {
  AdapterCommitResult,
  CommitRowResult,
  EntityImportAdapter,
  ImportFieldDefinition,
  NormalisedRecord,
  UndoOutcome,
} from './import-registry.types';

const PIPELINE_STAGE_ALIASES: Record<string, PipelineStage> = {
  'سرنخ جدید': PipelineStage.NEW,
  جدید: PipelineStage.NEW,
  'تماس گرفته شده': PipelineStage.CONTACTED,
  'تماس گرفته‌شده': PipelineStage.CONTACTED,
  'واجد شرایط': PipelineStage.QUALIFIED,
  'ارسال پیشنهاد': PipelineStage.PROPOSAL,
  پیشنهاد: PipelineStage.PROPOSAL,
  'برنده شده': PipelineStage.WON,
  'برنده‌شده': PipelineStage.WON,
  برنده: PipelineStage.WON,
  'از دست رفته': PipelineStage.LOST,
  باخته: PipelineStage.LOST,
};

const ESTIMATED_VALUE_SYNONYMS = LEAD_FIELD_SYNONYMS.estimatedValue;

/** رجیستری ورود داده سرنخ‌های CRM (موجودیت پایه فاز ۱). */
@Injectable()
export class CrmLeadsRegistry implements EntityImportAdapter {
  readonly key = 'crm-leads';
  readonly labelFa = 'سرنخ‌های فروش (CRM)';

  readonly fields: readonly ImportFieldDefinition[] = [
    {
      key: 'fullName',
      labelFa: 'نام و نام خانوادگی',
      required: true,
      type: 'text',
      synonyms: LEAD_FIELD_SYNONYMS.fullName,
    },
    {
      key: 'email',
      labelFa: 'رایانامه',
      required: true,
      type: 'email',
      synonyms: LEAD_FIELD_SYNONYMS.email,
    },
    {
      key: 'phone',
      labelFa: 'تلفن',
      required: false,
      type: 'phone',
      synonyms: LEAD_FIELD_SYNONYMS.phone,
    },
    {
      key: 'company',
      labelFa: 'شرکت',
      required: false,
      type: 'text',
      synonyms: LEAD_FIELD_SYNONYMS.company,
    },
    {
      key: 'pipelineStage',
      labelFa: 'مرحله فروش',
      required: false,
      type: 'enum',
      enumValues: Object.values(PipelineStage),
      enumAliases: PIPELINE_STAGE_ALIASES,
      synonyms: LEAD_FIELD_SYNONYMS.pipelineStage,
    },
    {
      key: 'estimatedValue',
      labelFa: 'ارزش برآوردی (ریال)',
      required: false,
      type: 'money',
      synonyms: ESTIMATED_VALUE_SYNONYMS,
    },
    {
      key: 'owner',
      labelFa: 'کارشناس مسئول',
      required: false,
      type: 'text',
      synonyms: LEAD_FIELD_SYNONYMS.owner,
    },
    {
      key: 'notes',
      labelFa: 'توضیحات',
      required: false,
      type: 'text',
      synonyms: LEAD_FIELD_SYNONYMS.notes,
    },
  ];

  constructor(private readonly crmRepository: CrmRepository) {}

  duplicateKeys(record: NormalisedRecord): string[] {
    const keys: string[] = [];
    const email = record.values.email;
    const phone = record.values.phone;
    if (typeof email === 'string' && email.trim()) {
      keys.push(`email:${email.trim().toLowerCase()}`);
    }
    if (typeof phone === 'string' && phone.trim()) {
      keys.push(`phone:${phone.trim()}`);
    }
    return keys;
  }

  async findExistingDuplicateKeys(
    tenantId: string,
    keys: string[],
  ): Promise<string[]> {
    const emails = keys
      .filter((key) => key.startsWith('email:'))
      .map((key) => key.slice('email:'.length));
    const phones = keys
      .filter((key) => key.startsWith('phone:'))
      .map((key) => key.slice('phone:'.length));

    const [foundEmails, foundPhones] = await Promise.all([
      emails.length > 0
        ? this.crmRepository.findLeadEmails(tenantId, emails)
        : Promise.resolve<string[]>([]),
      phones.length > 0
        ? this.crmRepository.findLeadPhones(tenantId, phones)
        : Promise.resolve<string[]>([]),
    ]);

    return [
      ...foundEmails.map((email) => `email:${email.toLowerCase()}`),
      ...foundPhones.map((phone) => `phone:${phone}`),
    ];
  }

  async commit(
    tenantId: string,
    records: NormalisedRecord[],
  ): Promise<AdapterCommitResult> {
    const now = new Date();
    const prepared = records.map((record) => ({
      rowNumber: record.rowNumber,
      data: this.toLeadData(record, now),
    }));

    if (prepared.length === 0) {
      return { inserted: [], failed: [] };
    }

    try {
      const saved = await this.crmRepository.createLeads(
        tenantId,
        prepared.map((item) => item.data),
      );
      const inserted: CommitRowResult[] = saved.map((entity, index) => ({
        rowNumber: prepared[index].rowNumber,
        ownerId: entity.id,
      }));
      return { inserted, failed: [] };
    } catch {
      const inserted: CommitRowResult[] = [];
      const failed = [];
      for (const item of prepared) {
        try {
          const saved = await this.crmRepository.createLead(tenantId, item.data);
          inserted.push({ rowNumber: item.rowNumber, ownerId: saved.id });
        } catch (error) {
          failed.push({
            rowNumber: item.rowNumber,
            message: this.errorMessage(error, 'درج سرنخ ناموفق بود.'),
          });
        }
      }
      return { inserted, failed };
    }
  }

  async undo(tenantId: string, ownerIds: number[]): Promise<UndoOutcome> {
    const removed = await this.crmRepository.deleteLeadsByIds(
      tenantId,
      ownerIds,
    );
    return { removed, refused: [] };
  }

  private toLeadData(record: NormalisedRecord, now: Date): ImportLeadData {
    const values = record.values;
    return {
      fullName: String(values.fullName ?? '').trim(),
      email: String(values.email ?? '')
        .trim()
        .toLowerCase(),
      phone: values.phone ? String(values.phone) : null,
      company: values.company ? String(values.company) : null,
      pipelineStage: (values.pipelineStage as PipelineStage) ?? PipelineStage.NEW,
      estimatedValue:
        typeof values.estimatedValue === 'number' ? values.estimatedValue : 0,
      owner: values.owner ? String(values.owner) : null,
      notes: values.notes ? String(values.notes) : null,
      createdAt: now,
      updatedAt: now,
    };
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return fallback;
  }
}
