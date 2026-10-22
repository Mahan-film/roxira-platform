import { Injectable } from '@nestjs/common';
import { AccountType } from '../../accounting/enums/accounting.enum';
import {
  AccountingImportAccountInput,
  AccountingService,
} from '../../accounting/services/accounting.service';
import { Currency } from '../../currency/enums/currency.enum';
import {
  AdapterCommitResult,
  CommitRowResult,
  EntityImportAdapter,
  ImportFieldDefinition,
  NormalisedRecord,
  UndoOutcome,
} from './import-registry.types';

const ACCOUNT_TYPE_ALIASES: Record<string, string> = {
  دارایی: AccountType.ASSET,
  داراییها: AccountType.ASSET,
  'دارایی‌ها': AccountType.ASSET,
  بدهی: AccountType.LIABILITY,
  بدهیها: AccountType.LIABILITY,
  'بدهی‌ها': AccountType.LIABILITY,
  سرمایه: AccountType.EQUITY,
  درآمد: AccountType.REVENUE,
  درآمدها: AccountType.REVENUE,
  هزینه: AccountType.EXPENSE,
  هزینهها: AccountType.EXPENSE,
  'هزینه‌ها': AccountType.EXPENSE,
};

const CURRENCY_ALIASES: Record<string, string> = {
  ریال: Currency.IRR,
  دلار: Currency.USD,
  یورو: Currency.EUR,
  درهم: Currency.AED,
};

/** رجیستری ورود داده دفتر کل حساب‌ها (Chart of Accounts). */
@Injectable()
export class AccountingAccountsRegistry implements EntityImportAdapter {
  readonly key = 'accounting-accounts';
  readonly labelFa = 'دفتر کل حساب‌ها (حسابداری)';

  readonly fields: readonly ImportFieldDefinition[] = [
    {
      key: 'code',
      labelFa: 'کد حساب',
      required: true,
      type: 'text',
      synonyms: ['code', 'account code', 'کد حساب', 'کد'],
    },
    {
      key: 'name',
      labelFa: 'نام حساب',
      required: true,
      type: 'text',
      synonyms: [
        'name',
        'account name',
        'title',
        'نام حساب',
        'عنوان حساب',
        'شرح',
      ],
    },
    {
      key: 'accountType',
      labelFa: 'ماهیت حساب',
      required: true,
      type: 'enum',
      enumValues: Object.values(AccountType),
      enumAliases: ACCOUNT_TYPE_ALIASES,
      synonyms: [
        'accountType',
        'account type',
        'type',
        'ماهیت حساب',
        'نوع حساب',
        'نوع',
        'ماهیت',
      ],
    },
    {
      key: 'currency',
      labelFa: 'واحد پول',
      required: false,
      type: 'enum',
      enumValues: Object.values(Currency),
      enumAliases: CURRENCY_ALIASES,
      synonyms: ['currency', 'واحد پول', 'ارز'],
    },
  ];

  constructor(private readonly accountingService: AccountingService) {}

  duplicateKeys(record: NormalisedRecord): string[] {
    const code = record.values.code;
    if (typeof code === 'string' && code.trim()) {
      return [`code:${code.trim()}`];
    }
    return [];
  }

  async findExistingDuplicateKeys(
    tenantId: string,
    keys: string[],
  ): Promise<string[]> {
    const codes = keys
      .filter((key) => key.startsWith('code:'))
      .map((key) => key.slice('code:'.length));
    const found = await this.accountingService.findExistingAccountCodes(
      tenantId,
      codes,
    );
    return found.map((code) => `code:${code}`);
  }

  async commit(
    tenantId: string,
    records: NormalisedRecord[],
  ): Promise<AdapterCommitResult> {
    const inserted: CommitRowResult[] = [];
    const failed = [];

    for (const record of records) {
      try {
        const ids = await this.accountingService.importAccounts(tenantId, [
          this.toInput(record),
        ]);
        inserted.push({ rowNumber: record.rowNumber, ownerId: ids[0] });
      } catch (error) {
        failed.push({
          rowNumber: record.rowNumber,
          message: this.errorMessage(error, 'درج حساب ناموفق بود.'),
        });
      }
    }

    return { inserted, failed };
  }

  async undo(tenantId: string, ownerIds: number[]): Promise<UndoOutcome> {
    const { removed, refused } =
      await this.accountingService.removeImportedAccounts(tenantId, ownerIds);
    return {
      removed,
      refused: refused.map((ownerId) => ({
        ownerId,
        message: 'این حساب در یک سند استفاده شده و قابل حذف نیست.',
      })),
    };
  }

  private toInput(record: NormalisedRecord): AccountingImportAccountInput {
    const values = record.values;
    const input: AccountingImportAccountInput = {
      code: String(values.code ?? '').trim(),
      name: String(values.name ?? '').trim(),
      accountType: values.accountType as AccountType,
    };
    if (typeof values.currency === 'string' && values.currency) {
      input.currency = values.currency as Currency;
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
