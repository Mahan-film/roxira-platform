import { BadRequestException, Injectable } from '@nestjs/common';
import { CurrencyService } from './currency.service';
import { Currency } from '../enums/currency.enum';

export interface ForeignAccountBalance {
  accountCode: string;
  accountName: string;
  currency: Currency;
  foreignAmount: number; // e.g. 1000 USD
  bookValueRial: bigint; // e.g. 850,000,000 Rials in ledger
  isRealised?: boolean;
}

export interface RevaluationItemResult {
  accountCode: string;
  accountName: string;
  currency: Currency;
  foreignAmount: number;
  rateToRial: number; // Rial per 1 unit of foreign currency
  currentValueRial: bigint;
  bookValueRial: bigint;
  diffRial: bigint;
  type: 'gain' | 'loss' | 'neutral';
  isRealised: boolean;
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
  constructor(private readonly currencyService: CurrencyService) {}

  /**
   * Computes the exchange rate of 1 unit of foreign currency to Iranian Rial (IRR).
   */
  getRateToRial(currency: Currency): number {
    if (currency === Currency.IRR) {
      return 1;
    }
    if (currency === Currency.IRT) {
      return 10;
    }
    // Rate in IRR per unit = unitsPerUsd(IRR) / unitsPerUsd(currency)
    const irrPerUsd = this.currencyService.unitsPerUsd(Currency.IRR);
    const currPerUsd = this.currencyService.unitsPerUsd(currency);
    if (currPerUsd <= 0) {
      throw new BadRequestException(`Invalid currency rate for ${currency}`);
    }
    return irrPerUsd / currPerUsd;
  }

  /**
   * Revalues a single foreign currency account balance against the latest exchange rates.
   */
  revalueBalance(balance: ForeignAccountBalance): RevaluationItemResult {
    const rate = this.getRateToRial(balance.currency);
    const currentValue = BigInt(Math.round(balance.foreignAmount * rate));
    const diff = currentValue - balance.bookValueRial;

    let type: 'gain' | 'loss' | 'neutral' = 'neutral';
    let gainMinor = BigInt(0);
    let lossMinor = BigInt(0);

    if (diff > BigInt(0)) {
      type = 'gain';
      gainMinor = diff;
    } else if (diff < BigInt(0)) {
      type = 'loss';
      lossMinor = -diff;
    }

    return {
      accountCode: balance.accountCode,
      accountName: balance.accountName,
      currency: balance.currency,
      foreignAmount: balance.foreignAmount,
      rateToRial: rate,
      currentValueRial: currentValue,
      bookValueRial: balance.bookValueRial,
      diffRial: diff,
      type,
      isRealised: Boolean(balance.isRealised),
      gainMinor,
      lossMinor,
    };
  }

  /**
   * Generates a complete month-end FX revaluation voucher plan for all foreign-currency accounts.
   * Ensures balanced voucher lines: total debit equals total credit down to 0 Rials.
   */
  generateMonthEndVoucher(
    period: string,
    balances: ForeignAccountBalance[],
    gainAccountCode: string = '4060', // سود تسعیر ارز
    lossAccountCode: string = '5080', // زیان تسعیر ارز
  ): MonthEndRevaluationVoucherPlan {
    const items = balances.map((b) => this.revalueBalance(b));

    let totalGain = BigInt(0);
    let totalLoss = BigInt(0);
    const voucherLines: Array<{
      accountCode: string;
      description: string;
      debitMinor: bigint;
      creditMinor: bigint;
    }> = [];

    for (const item of items) {
      if (item.type === 'gain') {
        totalGain += item.gainMinor;
        // Asset adjustment Dr
        voucherLines.push({
          accountCode: item.accountCode,
          description: `تعدیل تسعیر ارز پایان دوره ${period} - ${item.accountName} (${item.foreignAmount} ${item.currency})`,
          debitMinor: item.gainMinor,
          creditMinor: BigInt(0),
        });
        // Gain Cr
        voucherLines.push({
          accountCode: gainAccountCode,
          description: `سود تسعیر ارز پایان دوره ${period} - ${item.accountName}`,
          debitMinor: BigInt(0),
          creditMinor: item.gainMinor,
        });
      } else if (item.type === 'loss') {
        totalLoss += item.lossMinor;
        // Loss Dr
        voucherLines.push({
          accountCode: lossAccountCode,
          description: `زیان تسعیر ارز پایان دوره ${period} - ${item.accountName}`,
          debitMinor: item.lossMinor,
          creditMinor: BigInt(0),
        });
        // Asset adjustment Cr
        voucherLines.push({
          accountCode: item.accountCode,
          description: `تعدیل تسعیر ارز پایان دوره ${period} - ${item.accountName} (${item.foreignAmount} ${item.currency})`,
          debitMinor: BigInt(0),
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
}
