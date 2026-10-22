import { Injectable } from '@nestjs/common';
import {
  CrmActivityImportInput,
  CrmService,
} from '../../crm/services/crm.service';
import {
  AdapterCommitResult,
  CommitRowResult,
  EntityImportAdapter,
  ImportFieldDefinition,
  NormalisedRecord,
  UndoOutcome,
} from './import-registry.types';

/** رجیستری ورود داده فعالیت‌های CRM (تماس/پیگیری). */
@Injectable()
export class CrmActivitiesRegistry implements EntityImportAdapter {
  readonly key = 'crm-activities';
  readonly labelFa = 'فعالیت‌های CRM';

  readonly fields: readonly ImportFieldDefinition[] = [
    {
      key: 'partyCode',
      labelFa: 'کد طرف حساب',
      required: false,
      type: 'text',
      synonyms: [
        'partyCode',
        'party code',
        'PartyID',
        'TafziliCode',
        'طرف حساب',
        'کد تفصیلی',
      ],
    },
    {
      key: 'date',
      labelFa: 'تاریخ پیگیری',
      required: false,
      type: 'date',
      synonyms: ['date', 'TarikhPeygiri', 'Tarikh', 'تاریخ', 'تاریخ پیگیری'],
    },
    {
      key: 'owner',
      labelFa: 'کارشناس',
      required: false,
      type: 'text',
      synonyms: ['owner', 'KarshenasName', 'Karshenas', 'کارشناس', 'کارشناس مسئول'],
    },
    {
      key: 'channel',
      labelFa: 'کانال تماس',
      required: false,
      type: 'text',
      synonyms: ['channel', 'NoeTamas', 'نوع تماس', 'کانال'],
    },
    {
      key: 'stage',
      labelFa: 'مرحله فروش',
      required: false,
      type: 'text',
      synonyms: ['stage', 'MarhaleForoosh', 'Marhale', 'مرحله فروش', 'مرحله'],
    },
    {
      key: 'currency',
      labelFa: 'ارز مذاکره',
      required: false,
      type: 'text',
      synonyms: ['currency', 'ArzMozakere', 'Arz', 'ارز', 'ارز مذاکره'],
    },
    {
      key: 'amount',
      labelFa: 'مبلغ پیشنهادی (ارزی)',
      required: false,
      type: 'money',
      synonyms: [
        'amount',
        'GheymatPishnahadi_Arz',
        'GheymatPishnahadi',
        'مبلغ پیشنهادی',
        'مبلغ',
      ],
    },
    {
      key: 'probability',
      labelFa: 'احتمال موفقیت',
      required: false,
      type: 'number',
      synonyms: [
        'probability',
        'EhtemalMovafaghiat',
        'Ehtemal',
        'احتمال موفقیت',
        'احتمال',
      ],
    },
    {
      key: 'notes',
      labelFa: 'توضیحات',
      required: false,
      type: 'text',
      synonyms: ['notes', 'TozihatMozakere', 'Tozihat', 'توضیحات', 'یادداشت'],
    },
  ];

  constructor(private readonly crmService: CrmService) {}

  duplicateKeys(): string[] {
    return [];
  }

  async findExistingDuplicateKeys(): Promise<string[]> {
    return [];
  }

  async commit(
    tenantId: string,
    records: NormalisedRecord[],
  ): Promise<AdapterCommitResult> {
    const inputs = records.map((record) => this.toInput(record));
    const inserted: CommitRowResult[] = [];
    const failed = [];

    try {
      const ids = await this.crmService.importActivities(tenantId, inputs);
      records.forEach((record, index) => {
        inserted.push({ rowNumber: record.rowNumber, ownerId: ids[index] });
      });
    } catch (error) {
      const message = this.errorMessage(error, 'درج فعالیت ناموفق بود.');
      for (const record of records) {
        failed.push({ rowNumber: record.rowNumber, message });
      }
    }

    return { inserted, failed };
  }

  async undo(tenantId: string, ownerIds: number[]): Promise<UndoOutcome> {
    const { removed } =
      await this.crmService.removeImportedActivities(tenantId, ownerIds);
    return { removed, refused: [] };
  }

  private toInput(record: NormalisedRecord): CrmActivityImportInput {
    const values = record.values;
    const input: CrmActivityImportInput = {};
    if (values.partyCode) {
      input.partyCode = String(values.partyCode);
    }
    if (typeof values.date === 'string') {
      input.date = values.date;
    }
    if (values.owner) {
      input.owner = String(values.owner);
    }
    if (values.channel) {
      input.channel = String(values.channel);
    }
    if (values.stage) {
      input.stage = String(values.stage);
    }
    if (values.currency) {
      input.currency = String(values.currency);
    }
    if (typeof values.amount === 'number') {
      input.amount = values.amount;
    }
    if (typeof values.probability === 'number') {
      input.probability = values.probability;
    }
    if (values.notes) {
      input.notes = String(values.notes);
    }
    return input;
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return fallback;
  }
}
