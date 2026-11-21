import { Injectable } from '@nestjs/common';

export type TieOutCategory =
  | 'TRIAL_BALANCE'
  | 'ACCOUNTS_RECEIVABLE'
  | 'ACCOUNTS_PAYABLE'
  | 'INVENTORY_STOCK'
  | 'BANK_BALANCE';

export interface TieOutControlAccountRule {
  /** Account codes matching this control account (e.g. ['103', '1030', '1103']) */
  accountCodes: string[];
  /** Substring/alias patterns to match against account name or group (case-insensitive, normalized) */
  namePatterns: string[];
}

export interface EffectiveTieOutConfig {
  /** Unique id or version identifier */
  id?: string;
  /** Effective start date (ISO 'YYYY-MM-DD') */
  effectiveFrom: string;
  /** Optional effective end date (ISO 'YYYY-MM-DD'); undefined means open-ended */
  effectiveTo?: string;
  /** Base currency code for formatting, defaults to 'IRR' */
  currency: string;
  /** Rules for Accounts Receivable control accounts */
  accountsReceivable: TieOutControlAccountRule;
  /** Rules for Accounts Payable control accounts */
  accountsPayable: TieOutControlAccountRule;
  /** Rules for Inventory control accounts */
  inventory: TieOutControlAccountRule;
  /** Rules for Bank control accounts */
  bank: TieOutControlAccountRule;
}

/**
 * رجیستری تنظیمات کنترل سرفصل‌های افتتاحیه با تاریخ اثربخشی (Effective-Dated Config).
 * هیچ عدد، نرخ یا کد ثابتی بدون تاریخ در کد هاردکد نمی‌شود.
 */
@Injectable()
export class EffectiveTieOutConfigRegistry {
  private readonly configs: EffectiveTieOutConfig[] = [];

  constructor() {
    this.registerDefaultConfigs();
  }

  /**
   * ثبت تنظیمات تاریخ‌دار جدید. تنظیمات جدیدتر اولویت دارند.
   */
  registerConfig(config: EffectiveTieOutConfig): void {
    this.configs.push(config);
  }

  /**
   * حل و دریافت تنظیمات مؤثر برای یک تاریخ معین (asOfDate).
   * در صورت ارسال overrideهای سفارشی، با تنظیمات پایه ادغام می‌شوند.
   */
  resolveConfig(
    asOfDate?: string,
    overrides?: Partial<EffectiveTieOutConfig>,
  ): EffectiveTieOutConfig {
    const targetDate =
      asOfDate && /^\d{4}-\d{2}-\d{2}/.test(asOfDate)
        ? asOfDate.slice(0, 10)
        : new Date().toISOString().slice(0, 10);

    const matching = this.configs.filter((c) => {
      if (c.effectiveFrom && targetDate < c.effectiveFrom) {
        return false;
      }
      if (c.effectiveTo && targetDate > c.effectiveTo) {
        return false;
      }
      return true;
    });

    const base =
      matching.length > 0
        ? matching[matching.length - 1]
        : this.configs[this.configs.length - 1];

    if (!overrides) {
      return base;
    }

    return {
      ...base,
      ...overrides,
      currency: overrides.currency ?? base.currency,
      accountsReceivable: {
        accountCodes:
          overrides.accountsReceivable?.accountCodes ??
          base.accountsReceivable.accountCodes,
        namePatterns:
          overrides.accountsReceivable?.namePatterns ??
          base.accountsReceivable.namePatterns,
      },
      accountsPayable: {
        accountCodes:
          overrides.accountsPayable?.accountCodes ??
          base.accountsPayable.accountCodes,
        namePatterns:
          overrides.accountsPayable?.namePatterns ??
          base.accountsPayable.namePatterns,
      },
      inventory: {
        accountCodes:
          overrides.inventory?.accountCodes ?? base.inventory.accountCodes,
        namePatterns:
          overrides.inventory?.namePatterns ?? base.inventory.namePatterns,
      },
      bank: {
        accountCodes: overrides.bank?.accountCodes ?? base.bank.accountCodes,
        namePatterns: overrides.bank?.namePatterns ?? base.bank.namePatterns,
      },
    };
  }

  private registerDefaultConfigs(): void {
    // دوره ۱: استانداردهای تاریخی قبل از ۱۴۰۳ (تا ۲۰۲۳-۱۲-۳۱)
    this.registerConfig({
      id: 'legacy-standard-pre-2024',
      effectiveFrom: '1970-01-01',
      effectiveTo: '2023-12-31',
      currency: 'IRR',
      accountsReceivable: {
        accountCodes: ['103', '1030', '1103', '103001'],
        namePatterns: [
          'دریافتنی',
          'بدهکاران',
          'مشتریان',
          'accounts receivable',
          'trade receivables',
          'ar control',
        ],
      },
      accountsPayable: {
        accountCodes: ['201', '2010', '2101', '201001'],
        namePatterns: [
          'پرداختنی',
          'بستانکاران',
          'تامین‌کنندگان',
          'تأمین‌کنندگان',
          'accounts payable',
          'trade payables',
          'ap control',
        ],
      },
      inventory: {
        accountCodes: ['105', '1050', '1105', '105001'],
        namePatterns: [
          'موجودی کالا',
          'موجودی مواد',
          'انبار',
          'کالای تجاری',
          'inventory',
          'merchandise inventory',
          'stock value',
        ],
      },
      bank: {
        accountCodes: ['102', '1020', '1102', '102001'],
        namePatterns: [
          'بانک',
          'موجودی نزد بانک',
          'نقد و بانک',
          'bank',
          'cash at bank',
          'bank account',
        ],
      },
    });

    // دوره ۲: کدینگ استاندارد فعلی از ۲۰۲۴-۰۱-۰۱ به بعد
    this.registerConfig({
      id: 'standard-2024-onward',
      effectiveFrom: '2024-01-01',
      currency: 'IRR',
      accountsReceivable: {
        accountCodes: ['103', '1030', '1103', '103001', '103002', '110301'],
        namePatterns: [
          'دریافتنی',
          'بدهکاران',
          'مشتریان',
          'accounts receivable',
          'trade receivables',
          'ar control',
        ],
      },
      accountsPayable: {
        accountCodes: ['201', '2010', '2101', '201001', '201002', '210101'],
        namePatterns: [
          'پرداختنی',
          'بستانکاران',
          'تامین‌کنندگان',
          'تأمین‌کنندگان',
          'accounts payable',
          'trade payables',
          'ap control',
        ],
      },
      inventory: {
        accountCodes: ['105', '1050', '1105', '105001', '105002', '110501'],
        namePatterns: [
          'موجودی کالا',
          'موجودی مواد',
          'انبار',
          'کالای تجاری',
          'inventory',
          'merchandise inventory',
          'stock value',
        ],
      },
      bank: {
        accountCodes: ['102', '1020', '1102', '102001', '102002', '110201'],
        namePatterns: [
          'بانک',
          'موجودی نزد بانک',
          'نقد و بانک',
          'bank',
          'cash at bank',
          'bank account',
        ],
      },
    });
  }
}
