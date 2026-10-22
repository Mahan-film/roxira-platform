import { Injectable } from '@nestjs/common';
import {
  AccountingOpeningBalanceInput,
  AccountingService,
} from '../../accounting/services/accounting.service';
import {
  AdapterCommitResult,
  CommitRowResult,
  EntityImportAdapter,
  ImportFieldDefinition,
  NormalisedRecord,
  UndoOutcome,
} from './import-registry.types';

/**
 * رجیستری ورود داده مانده‌های افتتاحیه (سطرهای دفتر روزنامه).
 *
 * تمام سطرهای یک فایل در یک سند دوطرفه واحد ثبت می‌شوند؛ بنابراین شرط
 * «جمع بدهکار = جمع بستانکار» توسط سرویس حسابداری اعمال می‌شود. undo با حذف
 * همان سند، اثر آن را از مانده حساب‌ها برمی‌گرداند.
 */
@Injectable()
export class AccountingOpeningBalancesRegistry implements EntityImportAdapter {
  readonly key = 'accounting-opening-balances';
  readonly labelFa = 'مانده‌های افتتاحیه (حسابداری)';

  readonly fields: readonly ImportFieldDefinition[] = [
    {
      key: 'accountCode',
      labelFa: 'کد حساب',
      required: true,
      type: 'text',
      synonyms: [
        'accountCode',
        'account code',
        'code',
        'کد حساب',
        'حساب',
        'کد',
      ],
    },
    {
      key: 'debit',
      labelFa: 'بدهکار (ریال)',
      required: false,
      type: 'money',
      synonyms: [
        'debit',
        'debit amount',
        'بدهکار',
        'بدهی',
        'مبلغ بدهکار',
      ],
    },
    {
      key: 'credit',
      labelFa: 'بستانکار (ریال)',
      required: false,
      type: 'money',
      synonyms: [
        'credit',
        'credit amount',
        'بستانکار',
        'بستانکاری',
        'مبلغ بستانکار',
      ],
    },
    {
      key: 'date',
      labelFa: 'تاریخ',
      required: false,
      type: 'date',
      synonyms: ['date', 'تاریخ', 'تاریخ سند'],
    },
    {
      key: 'description',
      labelFa: 'شرح',
      required: false,
      type: 'text',
      synonyms: [
        'description',
        'desc',
        'شرح',
        'توضیحات',
        'شرح سطر',
      ],
    },
  ];

  constructor(private readonly accountingService: AccountingService) {}

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
    const failed = [];
    const valid: {
      rowNumber: number;
      input: AccountingOpeningBalanceInput;
    }[] = [];

    for (const record of records) {
      const debit =
        typeof record.values.debit === 'number' ? record.values.debit : 0;
      const credit =
        typeof record.values.credit === 'number' ? record.values.credit : 0;

      if (debit <= 0 && credit <= 0) {
        failed.push({
          rowNumber: record.rowNumber,
          message: 'یکی از بدهکار یا بستانکار باید بزرگ‌تر از صفر باشد.',
        });
        continue;
      }

      const input: AccountingOpeningBalanceInput = {
        accountCode: String(record.values.accountCode ?? '').trim(),
        debit,
        credit,
      };
      if (typeof record.values.date === 'string') {
        input.date = record.values.date;
      }
      if (record.values.description) {
        input.description = String(record.values.description);
      }
      valid.push({ rowNumber: record.rowNumber, input });
    }

    if (valid.length === 0) {
      return { inserted: [], failed };
    }

    try {
      const entryId = await this.accountingService.importOpeningBalances(
        tenantId,
        valid.map((item) => item.input),
      );
      const inserted: CommitRowResult[] = valid.map((item) => ({
        rowNumber: item.rowNumber,
        ownerId: entryId,
      }));
      return { inserted, failed };
    } catch (error) {
      const message = this.errorMessage(error, 'ثبت سند افتتاحیه ناموفق بود.');
      for (const item of valid) {
        failed.push({ rowNumber: item.rowNumber, message });
      }
      return { inserted: [], failed };
    }
  }

  async undo(tenantId: string, ownerIds: number[]): Promise<UndoOutcome> {
    const uniqueIds = Array.from(new Set(ownerIds));
    const { removed } =
      await this.accountingService.removeImportedJournalEntries(
        tenantId,
        uniqueIds,
      );
    return { removed, refused: [] };
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return fallback;
  }
}
