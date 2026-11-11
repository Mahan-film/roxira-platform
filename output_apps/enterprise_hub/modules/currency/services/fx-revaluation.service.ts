import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { createHash } from 'crypto';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { AccountLevel, AccountType } from '../../accounting/enums/accounting.enum';
import { toMinor } from '../../accounting/money';
import { AccountingService } from '../../accounting/services/accounting.service';
import { findTemplate } from '../../posting_rules/domain/posting-templates';
import {
  PostingRequest,
  PostingResult,
  PostingRulesService,
} from '../../posting_rules/services/posting-rules.service';
import { CURRENCY_METADATA } from '../constants/currency.constants';
import { Currency } from '../enums/currency.enum';
import { CurrencyService } from './currency.service';

export interface ForeignAccountBalance {
  accountCode: string;
  accountName: string;
  currency: Currency;
  foreignAmountMinor: bigint; // foreign currency minor units (e.g. 1000 USD = 100000n cents)
  bookValueRialMinor: bigint; // current ledger book value in Rial minor units
  isLiability?: boolean; // true for AP (liabilities)
  rateRialPerUnit?: bigint; // optional explicit exchange rate in Rial per 1 foreign unit
}

export interface RevaluationItemResult {
  accountCode: string;
  accountName: string;
  currency: Currency;
  foreignAmountMinor: bigint;
  rateRialPerUnit: bigint; // Rial per 1 foreign unit in minor units
  currentValueRialMinor: bigint;
  bookValueRialMinor: bigint;
  diffRialMinor: bigint;
  type: 'gain' | 'loss' | 'neutral';
  isLiability: boolean;
  gainMinor: bigint;
  lossMinor: bigint;
  fingerprint: string;
}

export interface MonthEndRevaluationVoucherPlan {
  period: string; // e.g. '1405-08'
  docType: 'currency.fx_revaluation';
  totalGainMinor: bigint;
  totalLossMinor: bigint;
  netImpactMinor: bigint;
  items: RevaluationItemResult[];
  voucherLines: Array<{
    accountCode: string;
    description: string;
    debitMinor: bigint;
    creditMinor: bigint;
  }>;
}

/** Converts floating number to fixed-precision integer without float math drift */
function floatToScaledUnits(val: number, scale = 8): bigint {
  const fixed = val.toFixed(scale);
  const [intPart, fracPart = ''] = fixed.split('.');
  const padded = fracPart.padEnd(scale, '0').slice(0, scale);
  return BigInt(intPart) * (10n ** BigInt(scale)) + BigInt(padded);
}

@Injectable()
export class FxRevaluationService {
  constructor(
    private readonly currencyService: CurrencyService,
    private readonly moduleRef: ModuleRef,
    @Optional() private readonly scope?: TenantScope,
  ) {}

  private get postingRules(): PostingRulesService {
    const service = this.moduleRef.get(PostingRulesService, { strict: false });
    if (!service) {
      throw new Error('PostingRulesService is not available in container');
    }
    return service;
  }

  private get accounting(): AccountingService {
    const service = this.moduleRef.get(AccountingService, { strict: false });
    if (!service) {
      throw new Error('AccountingService is not available in container');
    }
    return service;
  }

  /**
   * Computes the exchange rate of 1 unit of foreign currency to Iranian Rial (IRR) as integer minor units.
   * Uses exact scaled integer division with half-up rounding (Lesson 8).
   */
  getRateToRial(currency: Currency): bigint {
    if (currency === Currency.IRR) {
      return 1n;
    }
    if (currency === Currency.IRT) {
      return 10n;
    }

    const irrPerUsd = this.currencyService.unitsPerUsd(Currency.IRR);
    const currPerUsd = this.currencyService.unitsPerUsd(currency);
    if (currPerUsd <= 0) {
      throw new BadRequestException(`Invalid currency rate for ${currency}`);
    }

    // Scale by 10^8 for exact integer division with half-up rounding
    const irrScaled = floatToScaledUnits(irrPerUsd, 8);
    const currScaled = floatToScaledUnits(currPerUsd, 8);
    return (irrScaled + (currScaled / 2n)) / currScaled;
  }

  /**
   * Revalues a single foreign currency account balance against exchange rates.
   * Accurately handles assets vs liabilities (AP):
   * For liabilities, an increase in foreign exchange value represents an increased obligation (LOSS).
   */
  revalueBalance(balance: ForeignAccountBalance, customRate?: bigint): RevaluationItemResult {
    const rate = customRate ?? balance.rateRialPerUnit ?? this.getRateToRial(balance.currency);
    const decimals = CURRENCY_METADATA[balance.currency]?.decimals ?? 2;
    const scale = 10n ** BigInt(decimals);

    const currentValue = (balance.foreignAmountMinor * rate) / scale;
    const diff = currentValue - balance.bookValueRialMinor;

    let type: 'gain' | 'loss' | 'neutral' = 'neutral';
    let gainMinor = 0n;
    let lossMinor = 0n;

    if (balance.isLiability) {
      // Liabilities:
      // If current value > book value, our liability grew -> LOSS!
      // If current value < book value, our liability shrank -> GAIN!
      if (diff > 0n) {
        type = 'loss';
        lossMinor = diff;
      } else if (diff < 0n) {
        type = 'gain';
        gainMinor = -diff;
      }
    } else {
      // Assets:
      // If current value > book value, asset value grew -> GAIN!
      // If current value < book value, asset value shrank -> LOSS!
      if (diff > 0n) {
        type = 'gain';
        gainMinor = diff;
      } else if (diff < 0n) {
        type = 'loss';
        lossMinor = -diff;
      }
    }

    const fingerprint = createHash('sha256')
      .update(`${balance.accountCode}:${balance.currency}:${balance.foreignAmountMinor}:${balance.bookValueRialMinor}:${rate}`)
      .digest('hex')
      .slice(0, 16);

    return {
      accountCode: balance.accountCode,
      accountName: balance.accountName,
      currency: balance.currency,
      foreignAmountMinor: balance.foreignAmountMinor,
      rateRialPerUnit: rate,
      currentValueRialMinor: currentValue,
      bookValueRialMinor: balance.bookValueRialMinor,
      diffRialMinor: diff,
      type,
      isLiability: Boolean(balance.isLiability),
      gainMinor,
      lossMinor,
      fingerprint,
    };
  }

  /**
   * Generates a complete month-end FX revaluation voucher plan for all foreign-currency accounts.
   * Resolves posting roles fx_gain and fx_loss from the posting rules template defaults.
   */
  generateMonthEndVoucher(
    period: string,
    balances: ForeignAccountBalance[],
    rates?: Partial<Record<Currency, bigint>>,
  ): MonthEndRevaluationVoucherPlan {
    const tpl = findTemplate('currency.fx_revaluation');
    const fxGainAccount = tpl?.defaults?.fx_gain ?? '4120';
    const fxLossAccount = tpl?.defaults?.fx_loss ?? '5210';

    const items = balances.map((b) => this.revalueBalance(b, rates?.[b.currency] ?? b.rateRialPerUnit));

    let totalGain = 0n;
    let totalLoss = 0n;
    const voucherLines: Array<{
      accountCode: string;
      description: string;
      debitMinor: bigint;
      creditMinor: bigint;
    }> = [];

    for (const item of items) {
      if (item.type === 'gain') {
        totalGain += item.gainMinor;
        voucherLines.push({
          accountCode: item.accountCode,
          description: `تعدیل تسعیر ارز پایان دوره ${period} - ${item.accountName} (${item.foreignAmountMinor} ${item.currency}) [نرخ: ${item.rateRialPerUnit} ریال]`,
          debitMinor: item.gainMinor,
          creditMinor: 0n,
        });
        voucherLines.push({
          accountCode: fxGainAccount,
          description: `سود تسعیر ارز پایان دوره ${period} - ${item.accountName}`,
          debitMinor: 0n,
          creditMinor: item.gainMinor,
        });
      } else if (item.type === 'loss') {
        totalLoss += item.lossMinor;
        voucherLines.push({
          accountCode: fxLossAccount,
          description: `زیان تسعیر ارز پایان دوره ${period} - ${item.accountName}`,
          debitMinor: item.lossMinor,
          creditMinor: 0n,
        });
        voucherLines.push({
          accountCode: item.accountCode,
          description: `تعدیل تسعیر ارز پایان دوره ${period} - ${item.accountName} (${item.foreignAmountMinor} ${item.currency}) [نرخ: ${item.rateRialPerUnit} ریال]`,
          debitMinor: 0n,
          creditMinor: item.lossMinor,
        });
      }
    }

    return {
      period,
      docType: 'currency.fx_revaluation',
      totalGainMinor: totalGain,
      totalLossMinor: totalLoss,
      netImpactMinor: totalGain - totalLoss,
      items,
      voucherLines,
    };
  }

  /**
   * Posts month-end FX revaluation vouchers through PostingRulesService.
   * Atomically executes across all balances in a single transaction with full idempotency (Lesson 18).
   * Validates account types (ASSET vs LIABILITY) against the chart of accounts and rejects revenue/expense.
   * Throws HTTP 409 Conflict if same period and currency is re-run with different parameters.
   */
  async postMonthEndRevaluation(
    tenantId: string,
    request: {
      period: string; // e.g. '1405-08'
      date: string; // '2026-11-21'
      balances: ForeignAccountBalance[];
      rates?: Partial<Record<Currency, bigint>>;
    },
    manager?: EntityManager,
  ): Promise<{
    plan: MonthEndRevaluationVoucherPlan;
    postingResults: PostingResult[];
  }> {
    // 1. Strict Date and Period Format Validation
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(request.period)) {
      throw new BadRequestException('period must match YYYY-MM format with valid month (01-12)');
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(request.date) || isNaN(Date.parse(request.date))) {
      throw new BadRequestException('date must match valid YYYY-MM-DD format');
    }

    // 2. Validate Accounts & Reconcile against Chart of Accounts (Blocker 1)
    const accounts = await this.accounting.listAccounts(tenantId);
    const accountMap = new Map(accounts.map((a) => [a.code, a]));

    for (const b of request.balances) {
      const acc = accountMap.get(b.accountCode);
      if (!acc) {
        throw new BadRequestException(
          `حساب با کد «${b.accountCode}» در سرفصل حساب‌های این سازمان یافت نشد.`,
        );
      }
      if (acc.level === AccountLevel.GROUP || acc.level === AccountLevel.KOL) {
        throw new BadRequestException(
          `حساب «${b.accountCode}» در سطح گروه یا کل است و سند تسعیر روی آن ثبت نمی‌شود؛ حساب معین یا تفصیلی انتخاب کنید.`,
        );
      }
      if (b.isLiability) {
        if (acc.accountType !== AccountType.LIABILITY) {
          throw new BadRequestException(
            `حساب بدهی ارزی «${b.accountCode}» باید دارای ماهیت بدهی (LIABILITY) باشد، اما ماهیت آن «${acc.accountType}» است.`,
          );
        }
      } else {
        if (acc.accountType !== AccountType.ASSET) {
          throw new BadRequestException(
            `حساب دارایی ارزی «${b.accountCode}» باید دارای ماهیت دارایی (ASSET) باشد، اما ماهیت آن «${acc.accountType}» است.`,
          );
        }
      }

      // Reconcile book value against ledger if a non-zero ledger balance exists
      if (acc.balance !== undefined && acc.balance !== null) {
        const ledgerBalanceMinor = toMinor(acc.balance);
        if (ledgerBalanceMinor !== 0n && b.bookValueRialMinor !== ledgerBalanceMinor) {
          throw new BadRequestException(
            `ارزش دفتری اعلام‌شده (${b.bookValueRialMinor}) با مانده دفتر کل حساب ${acc.code} (${ledgerBalanceMinor}) مغایرت دارد.`,
          );
        }
      }
    }

    const plan = this.generateMonthEndVoucher(
      request.period,
      request.balances,
      request.rates,
    );

    const executePosting = async (em?: EntityManager) => {
      const postingResults: PostingResult[] = [];

      for (const item of plan.items) {
        if (item.gainMinor === 0n && item.lossMinor === 0n) {
          continue;
        }

        const sourceId = `${request.period}:${item.accountCode}:${item.currency}`;

        // Idempotency check with HTTP 409 on conflicting rerun (Lesson 18)
        const existingSource = await this.postingRules.findSource(
          tenantId,
          'currency_revaluation',
          sourceId,
          'currency.fx_revaluation',
          em,
        );

        if (existingSource?.entryId) {
          const existingEntry = await this.accounting.findOneJournalEntry(
            tenantId,
            existingSource.entryId,
          );
          const expectedFpTag = `[fp:${item.fingerprint}]`;
          if (!existingEntry?.description?.includes(expectedFpTag)) {
            throw new ConflictException(
              `تسعیر ارز برای دوره «${request.period}»، حساب «${item.accountCode}» و ارز «${item.currency}» قبلاً با پارامترهای متفاوتی ثبت شده است؛ اجرای مجدد با پارامترهای متفاوت مجاز نیست (HTTP 409 Conflict).`,
            );
          }
          postingResults.push({
            entryId: existingSource.entryId,
            entryNumber: existingSource.entryNumber ?? existingEntry.entryNumber,
            replayed: true,
          });
          continue;
        }

        const postReq: PostingRequest = {
          docType: 'currency.fx_revaluation',
          sourceType: 'currency_revaluation',
          sourceId,
          date: request.date,
          amounts: {
            gain: item.gainMinor,
            loss: item.lossMinor,
          },
          overrides: {
            monetary_asset: item.accountCode,
          },
          description: `سند تسعیر ارز پایان دوره ${request.period} - ${item.accountName} (${item.currency}) [نرخ: ${item.rateRialPerUnit} ریال] [fp:${item.fingerprint}]`,
        };

        const result = await this.postingRules.post(tenantId, postReq, em);
        postingResults.push(result);
      }

      return { plan, postingResults };
    };

    // Atomic execution within a single transaction (Major 3)
    if (manager) {
      return executePosting(manager);
    }
    if (this.scope) {
      return this.scope.run(tenantId, (m) => executePosting(m));
    }
    return executePosting();
  }
}
