import { Injectable } from '@nestjs/common';
import { AccountLevel, AccountType } from '../../accounting/enums/accounting.enum';
import {
  AccountingImportAccountInput,
  AccountingService,
} from '../../accounting/services/accounting.service';
import { normalizeCurrency } from '../../currency/normaliser/currency-normaliser';
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
  'بهای تمام شده': AccountType.EXPENSE,
  'سایر درآمدها': AccountType.REVENUE,
  'سایر هزینه‌ها': AccountType.EXPENSE,
  'حقوق صاحبان سهام': AccountType.EQUITY,
  فروش: AccountType.REVENUE,
  هزینهها: AccountType.EXPENSE,
  'هزینه‌ها': AccountType.EXPENSE,
};

const ACCOUNT_LEVEL_ALIASES: Record<string, string> = {
  گروه: AccountLevel.GROUP,
  کل: AccountLevel.KOL,
  معین: AccountLevel.MOEIN,
  تفصیلی: AccountLevel.TAFSILI,
  تفضیلی: AccountLevel.TAFSILI,
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
      synonyms: ['code', 'account code', 'AccountCode', 'کد حساب', 'کد'],
    },
    {
      key: 'name',
      labelFa: 'نام حساب',
      required: true,
      type: 'text',
      synonyms: [
        'name',
        'account name',
        'AccountName',
        'NameHesab',
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
        'Nature',
        'Mahyat',
        'AccountGroup',
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
      // Free text, normalised in toInput with the shared currency normaliser (IRR, IRT, USD, EUR, TRY,
      // AED, CNY, OMR, MULTI and Persian names such as «درهم»); unknown values fall back to IRR.
      type: 'text',
      synonyms: [
        'currency',
        'DefaultCurrency',
        'Arz',
        'VahedPoolPishfarz',
        'واحد پول',
        'ارز',
      ],
    },
    {
      // Optional hierarchy, as written by the chart of accounts export (reports/export/chart-of-accounts).
      key: 'level',
      labelFa: 'سطح',
      required: false,
      type: 'enum',
      enumValues: Object.values(AccountLevel),
      enumAliases: ACCOUNT_LEVEL_ALIASES,
      synonyms: ['level', 'AccountLevel', 'account level', 'سطح', 'سطح حساب'],
    },
    {
      key: 'parentCode',
      labelFa: 'کد حساب بالاتر',
      required: false,
      type: 'text',
      synonyms: ['parentCode', 'parent code', 'ParentCode', 'کد حساب بالاتر', 'کد حساب بالادست', 'کد بالادست'],
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
    if (typeof values.level === 'string' && values.level) {
      input.level = values.level as AccountLevel;
    }
    if (typeof values.parentCode === 'string' && values.parentCode.trim()) {
      input.parentCode = values.parentCode.trim();
    }
    if (typeof values.currency === 'string' && values.currency) {
      const currency = normalizeCurrency(values.currency);
      if (currency) {
        input.currency = currency;
      }
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
