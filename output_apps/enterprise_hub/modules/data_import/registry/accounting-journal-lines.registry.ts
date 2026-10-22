import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  AccountingService,
} from '../../accounting/services/accounting.service';
import { JournalEntryLineDto } from '../../accounting/dto/create-journal-entry.dto';
import {
  AdapterCommitResult,
  CommitRowResult,
  EntityImportAdapter,
  ImportFieldDefinition,
  NormalisedRecord,
  UndoOutcome,
} from './import-registry.types';

/**
 * رجیستری ورود داده سطرهای دفتر روزنامه (Journal lines).
 *
 * ردیف‌های خام هر سند بر پایه «شماره سند» گروه می‌شوند و هر گروه به‌صورت یک
 * سند دوطرفهٔ تراز از طریق `AccountingService.createJournalEntry` ثبت می‌شود.
 *
 * فیلدهای چندارزی (currency/amount_fx/fx_rate/party_code روی سطر و
 * currency/fx_rate/amount_fx روی فاکتور) در تسک موازی به سرویس حسابداری اضافه
 * می‌شوند؛ تا آن زمان پشت یک بررسی ویژگی نادیده گرفته می‌شوند.
 */
@Injectable()
export class AccountingJournalLinesRegistry implements EntityImportAdapter {
  readonly key = 'accounting-journal-lines';
  readonly labelFa = 'سطرهای دفتر روزنامه (حسابداری)';

  readonly fields: readonly ImportFieldDefinition[] = [
    {
      key: 'voucherNo',
      labelFa: 'شماره سند',
      required: true,
      type: 'text',
      synonyms: [
        'voucherNo',
        'voucher no',
        'voucher number',
        'ShomareSanad',
        'Sanad',
        'شماره سند',
        'سند',
      ],
    },
    {
      key: 'lineNo',
      labelFa: 'ردیف سند',
      required: false,
      type: 'number',
      synonyms: ['lineNo', 'line no', 'RadifSanad', 'ردیف', 'ردیف سند'],
    },
    {
      key: 'date',
      labelFa: 'تاریخ سند',
      required: false,
      type: 'date',
      synonyms: ['date', 'TarikhSanad', 'Tarikh', 'تاریخ', 'تاریخ سند'],
    },
    {
      key: 'accountCode',
      labelFa: 'کد حساب',
      required: true,
      type: 'text',
      synonyms: [
        'accountCode',
        'account code',
        'HesabCode',
        'Hesab',
        'کد حساب',
        'حساب',
      ],
    },
    {
      key: 'partyCode',
      labelFa: 'کد تفصیلی طرف حساب',
      required: false,
      type: 'text',
      synonyms: [
        'partyCode',
        'party code',
        'TafziliCode',
        'Tafzili',
        'کد تفصیلی',
        'تفصیلی',
        'طرف حساب',
      ],
    },
    {
      key: 'description',
      labelFa: 'شرح',
      required: false,
      type: 'text',
      synonyms: [
        'description',
        'SharhArticel',
        'Sharh',
        'شرح',
        'شرح سطر',
      ],
    },
    {
      key: 'currency',
      labelFa: 'ارز',
      required: false,
      type: 'text',
      synonyms: ['currency', 'VahedArz', 'Arz', 'واحد ارز', 'ارز'],
    },
    {
      key: 'amountFx',
      labelFa: 'مبلغ ارزی',
      required: false,
      type: 'number',
      synonyms: [
        'amountFx',
        'amount fx',
        'MablaghArzi',
        'MablaghArz',
        'مبلغ ارزی',
      ],
    },
    {
      key: 'fxRate',
      labelFa: 'نرخ تسعیر',
      required: false,
      type: 'number',
      synonyms: ['fxRate', 'fx rate', 'NerkhTasir', 'Nerkh', 'نرخ', 'نرخ تسعیر'],
    },
    {
      key: 'debitRial',
      labelFa: 'بدهکار (ریال)',
      required: false,
      type: 'money',
      synonyms: [
        'debitRial',
        'debit rial',
        'Bedehkar_Rial',
        'Bedehkar',
        'Deebit',
        'بدهکار',
        'بدهکار ریال',
      ],
    },
    {
      key: 'creditRial',
      labelFa: 'بستانکار (ریال)',
      required: false,
      type: 'money',
      synonyms: [
        'creditRial',
        'credit rial',
        'Bestankar_Rial',
        'Bestankar',
        'بستانکار',
        'بستانکار ریال',
      ],
    },
  ];

  constructor(private readonly accountingService: AccountingService) {}

  duplicateKeys(record: NormalisedRecord): string[] {
    const voucher = record.values.voucherNo;
    const line = record.values.lineNo;
    if (voucher === undefined || voucher === null) {
      return [];
    }
    return [`voucher:${String(voucher).trim()}:${String(line ?? '')}`];
  }

  async findExistingDuplicateKeys(): Promise<string[]> {
    return [];
  }

  async commit(
    tenantId: string,
    records: NormalisedRecord[],
  ): Promise<AdapterCommitResult> {
    const groups = new Map<string, NormalisedRecord[]>();
    records.forEach((record, index) => {
      const voucher = String(record.values.voucherNo ?? '').trim();
      const key = voucher || `__line_${record.rowNumber}_${index}`;
      const list = groups.get(key) ?? [];
      list.push(record);
      groups.set(key, list);
    });

    const inserted: CommitRowResult[] = [];
    const failed = [];

    for (const [voucher, group] of groups) {
      const lines: JournalEntryLineDto[] = group.map((record) => {
        const line: JournalEntryLineDto = {
          accountCode: String(record.values.accountCode ?? '').trim(),
          debit:
            typeof record.values.debitRial === 'number'
              ? record.values.debitRial
              : 0,
          credit:
            typeof record.values.creditRial === 'number'
              ? record.values.creditRial
              : 0,
        };
        if (record.values.description) {
          line.description = String(record.values.description).slice(0, 255);
        }
        return line;
      });

      const dateRecord = group.find(
        (record) => typeof record.values.date === 'string',
      );
      const date =
        (dateRecord?.values.date as string | undefined) ??
        new Date().toISOString();

      try {
        const entry = await this.accountingService.createJournalEntry(tenantId, {
          entryNumber: `PKG-${voucher}-${randomUUID().slice(0, 8)}`,
          date,
          description: 'ورود بسته دیتابیس (سطرهای دفتر روزنامه)',
          lines,
        });
        for (const record of group) {
          inserted.push({ rowNumber: record.rowNumber, ownerId: entry.id });
        }
      } catch (error) {
        for (const record of group) {
          failed.push({
            rowNumber: record.rowNumber,
            message: this.errorMessage(error, 'ثبت سند ناموفق بود.'),
          });
        }
      }
    }

    return { inserted, failed };
  }

  async undo(tenantId: string, ownerIds: number[]): Promise<UndoOutcome> {
    const unique = Array.from(new Set(ownerIds));
    const { removed } =
      await this.accountingService.removeImportedJournalEntries(tenantId, unique);
    return { removed, refused: [] };
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return fallback;
  }
}
