import { BadRequestException, Inject, Injectable, Optional, forwardRef } from '@nestjs/common';
import { CurrencyService } from './currency.service';
import { Currency } from '../enums/currency.enum';
import { PostingRulesService, PostingResult } from '../../posting_rules/services/posting-rules.service';
import { EntityManager } from 'typeorm';

export interface ForeignAccountBalance {
  accountCode: string;
  accountName: string;
  currency: Currency;
  foreignAmountMinor: bigint; // foreign currency minor units (e.g. 1000 USD = 100000n cents)
  bookValueRialMinor: bigint; // current ledger book value in Rial minor units
  isLiability?: boolean; // true for AP (liabilities)
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

@Injectable()
export class FxRevaluationService {
  constructor(
    private readonly currencyService: CurrencyService,
    @Optional()
    @Inject(forwardRef(() => PostingRulesService))
    private readonly postingRules?: PostingRulesService,
  ) {}

  /**
   * Computes the exchange rate of 1 unit of foreign currency to Iranian Rial (IRR) as integer minor units.
   */
  getRateToRial(currency: Currency): bigint {
    if (currency === Currency.IRR) {
      return 1n;
    }
    if (currency === Currency.IRT) {
      return 10n;
    }
    // Rate in IRR per unit = unitsPerUsd(IRR) / unitsPerUsd(currency)
    const irrPerUsd = this.currencyService.unitsPerUsd(Currency.IRR);
    const currPerUsd = this.currencyService.unitsPerUsd(currency);
    if (currPerUsd <= 0) {
      throw new BadRequestException(`Invalid currency rate for ${currency}`);
    }
    return BigInt(Math.round(irrPerUsd / currPerUsd));
  }

  /**
   * Revalues a single foreign currency account balance against exchange rates.
   * Accurately handles assets vs liabilities (AP):
   * For liabilities, an increase in foreign exchange value represents an increased obligation (LOSS).
   */
  revalueBalance(balance: ForeignAccountBalance, customRate?: bigint): RevaluationItemResult {
    const rate = customRate ?? this.getRateToRial(balance.currency);
    const scale = (balance.currency === Currency.IRR || balance.currency === Currency.IRT) ? 1n : 100n;
    const currentValue = (balance.foreignAmountMinor * rate) / scale;
    const diff = currentValue - balance.bookValueRialMinor;

    let type: 'gain' | 'loss' | 'neutral' = 'neutral';
    let gainMinor = 0n;
    let lossMinor = 0n;

    if (balance.isLiability) {
      // For liabilities (e.g. Accounts Payable):
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
      // For assets (e.g. Cash, Bank, Accounts Receivable):
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
    };
  }

  /**
   * Generates a complete month-end FX revaluation voucher plan for all foreign-currency accounts.
   * Uses accounts defined in iran-chart-template.ts:
   *   gain: 4120 (درآمدهای غیرعملیاتی)
   *   loss: 5210 (هزینه‌های مالی)
   * Ensures balanced voucher lines down to 0 Rials.
   */
  generateMonthEndVoucher(
    period: string,
    balances: ForeignAccountBalance[],
    rates?: Partial<Record<Currency, bigint>>,
    gainAccountCode: string = '4120', // درآمدهای غیرعملیاتی
    lossAccountCode: string = '5210', // هزینه‌های مالی
  ): MonthEndRevaluationVoucherPlan {
    const items = balances.map((b) => this.revalueBalance(b, rates?.[b.currency]));

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
        // Debit monetary asset/liability adjustment
        voucherLines.push({
          accountCode: item.accountCode,
          description: `تعدیل تسعیر ارز پایان دوره ${period} - ${item.accountName} (${item.foreignAmountMinor / 100n} ${item.currency})`,
          debitMinor: item.gainMinor,
          creditMinor: 0n,
        });
        // Credit FX Gain
        voucherLines.push({
          accountCode: gainAccountCode,
          description: `سود تسعیر ارز پایان دوره ${period} - ${item.accountName}`,
          debitMinor: 0n,
          creditMinor: item.gainMinor,
        });
      } else if (item.type === 'loss') {
        totalLoss += item.lossMinor;
        // Debit FX Loss
        voucherLines.push({
          accountCode: lossAccountCode,
          description: `زیان تسعیر ارز پایان دوره ${period} - ${item.accountName}`,
          debitMinor: item.lossMinor,
          creditMinor: 0n,
        });
        // Credit monetary asset/liability adjustment
        voucherLines.push({
          accountCode: item.accountCode,
          description: `تعدیل تسعیر ارز پایان دوره ${period} - ${item.accountName} (${item.foreignAmountMinor / 100n} ${item.currency})`,
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
   * Ensures idempotency per tenant + period + accountCode.
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
    if (!this.postingRules) {
      throw new Error('PostingRulesService is not injected in FxRevaluationService');
    }

    const plan = this.generateMonthEndVoucher(
      request.period,
      request.balances,
      request.rates,
    );

    const postingResults: PostingResult[] = [];

    for (const item of plan.items) {
      if (item.gainMinor === 0n && item.lossMinor === 0n) {
        continue;
      }

      const result = await this.postingRules.post(
        tenantId,
        {
          docType: 'currency.fx_revaluation',
          sourceType: 'currency_revaluation',
          sourceId: `${request.period}:${item.accountCode}`,
          date: request.date,
          amounts: {
            gain: item.gainMinor,
            loss: item.lossMinor,
          },
          overrides: {
            monetary_asset: item.accountCode,
          },
          description: `سند تسعیر ارز پایان دوره ${request.period} - ${item.accountName}`,
        },
        manager,
      );

      postingResults.push(result);
    }

    return { plan, postingResults };
  }
}
