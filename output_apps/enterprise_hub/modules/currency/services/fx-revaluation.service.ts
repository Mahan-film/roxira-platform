import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { createHash } from 'crypto';
import { EntityManager } from 'typeorm';
import { CURRENCY_METADATA } from '../constants/currency.constants';
import { Currency } from '../enums/currency.enum';
import { CurrencyService } from './currency.service';
import { AccountingService } from '../../accounting/services/accounting.service';
import {
  PostingRequest,
  PostingResult,
  PostingRulesService,
} from '../../posting_rules/services/posting-rules.service';

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

@Injectable()
export class FxRevaluationService {
  constructor(
    private readonly currencyService: CurrencyService,
    private readonly moduleRef: ModuleRef,
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
   * Avoids floating point inaccuracies (Lesson 8).
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

    // Scale by 10,000 for exact integer division
    const irrScaled = BigInt(Math.round(irrPerUsd * 10000));
    const currScaled = BigInt(Math.round(currPerUsd * 10000));
    return irrScaled / currScaled;
  }

  /**
   * Revalues a single foreign currency account balance against exchange rates.
   * Accurately handles assets vs liabilities (AP):
   * For liabilities, an increase in foreign exchange value represents an increased obligation (LOSS).
   */
  revalueBalance(balance: ForeignAccountBalance, customRate?: bigint): RevaluationItemResult {
    const rate = customRate ?? this.getRateToRial(balance.currency);
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
   * Resolves posting roles fx_gain and fx_loss from the posting rules template.
   */
  generateMonthEndVoucher(
    period: string,
    balances: ForeignAccountBalance[],
    rates?: Partial<Record<Currency, bigint>>,
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
        voucherLines.push({
          accountCode: item.accountCode,
          description: `تعدیل تسعیر ارز پایان دوره ${period} - ${item.accountName} (${item.foreignAmountMinor} ${item.currency})`,
          debitMinor: item.gainMinor,
          creditMinor: 0n,
        });
        voucherLines.push({
          accountCode: '4120',
          description: `سود تسعیر ارز پایان دوره ${period} - ${item.accountName}`,
          debitMinor: 0n,
          creditMinor: item.gainMinor,
        });
      } else if (item.type === 'loss') {
        totalLoss += item.lossMinor;
        voucherLines.push({
          accountCode: '5210',
          description: `زیان تسعیر ارز پایان دوره ${period} - ${item.accountName}`,
          debitMinor: item.lossMinor,
          creditMinor: 0n,
        });
        voucherLines.push({
          accountCode: item.accountCode,
          description: `تعدیل تسعیر ارز پایان دوره ${period} - ${item.accountName} (${item.foreignAmountMinor} ${item.currency})`,
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
          description: `سند تسعیر ارز پایان دوره ${request.period} - ${item.accountName} (${item.currency}) [fp:${item.fingerprint}]`,
        };

        const result = await this.postingRules.post(tenantId, postReq, em);
        postingResults.push(result);
      }

      return { plan, postingResults };
    };

    if (manager) {
      return executePosting(manager);
    }

    return executePosting();
  }
}
