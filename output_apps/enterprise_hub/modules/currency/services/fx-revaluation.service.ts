import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { createHash } from 'crypto';
import { EntityManager } from 'typeorm';
import { TenantScope } from '../../access/services/tenant-scope';
import { MONEY_SCALE } from '../../accounting/constants/accounting.constants';
import { AccountLevel, AccountType } from '../../accounting/enums/accounting.enum';
import { ChartOfAccountEntity } from '../../accounting/entities/chart-of-account.entity';
import { JournalEntryEntity } from '../../accounting/entities/journal-entry.entity';
import { parseScaled, toMinor } from '../../accounting/money';
import { AccountingService } from '../../accounting/services/accounting.service';
import { DEFAULT_ROLE_ACCOUNTS } from '../../posting_rules/constants/posting-roles';
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

/** Validates strict Gregorian calendar YYYY-MM-DD (rejecting rolled-over dates like 2026-02-31). */
function isValidIsoCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() + 1 === month &&
    utc.getUTCDate() === day
  );
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
    private readonly scope: TenantScope,
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

  private getScaledRateRatio(currency: Currency): { numerator: bigint; denominator: bigint } {
    if (currency === Currency.IRR) {
      return { numerator: 1n, denominator: 1n };
    }
    if (currency === Currency.IRT) {
      return { numerator: 10n, denominator: 1n };
    }

    const irrPerUsd = this.currencyService.unitsPerUsd(Currency.IRR);
    const currPerUsd = this.currencyService.unitsPerUsd(currency);
    if (currPerUsd <= 0) {
      throw new BadRequestException(`Invalid currency rate for ${currency}`);
    }

    // Scale by 10^12 so balance revaluation performs a single final integer division
    return {
      numerator: floatToScaledUnits(irrPerUsd, 12),
      denominator: floatToScaledUnits(currPerUsd, 12),
    };
  }

  /**
   * Computes the exchange rate of 1 unit of foreign currency to Iranian Rial (IRR) as integer minor units.
   * Uses exact scaled integer division with half-up rounding (Lesson 8).
   */
  getRateToRial(currency: Currency): bigint {
    const { numerator, denominator } = this.getScaledRateRatio(currency);
    return (numerator + denominator / 2n) / denominator;
  }

  /**
   * Revalues a single foreign currency account balance against exchange rates.
   * Accurately handles assets vs liabilities (AP):
   * For liabilities, an increase in foreign exchange value represents an increased obligation (LOSS).
   */
  revalueBalance(
    balance: ForeignAccountBalance,
    customRate?: bigint,
    postingDate?: string,
  ): RevaluationItemResult {
    if (balance.currency === Currency.IRR || balance.currency === Currency.IRT) {
      throw new BadRequestException('حساب ریالی یا تومانی مشمول تسعیر ارز نیست');
    }
    const meta = CURRENCY_METADATA[balance.currency];
    if (!meta) {
      throw new BadRequestException(`متادیتای ارز «${balance.currency}» تعریف نشده است`);
    }

    const rawRate = customRate ?? balance.rateRialPerUnit;
    if (rawRate !== undefined && rawRate <= 0n) {
      throw new BadRequestException('Exchange rate must be strictly positive');
    }

    const foreignScale = 10n ** BigInt(meta.decimals);
    const rialMinorFactor = 10n ** BigInt(MONEY_SCALE);

    // Exact single integer division with half-up rounding into Rial minor units (10^MONEY_SCALE)
    let rate: bigint;
    let currentValue: bigint;
    let rateFingerprintKey: string;

    if (rawRate !== undefined && rawRate > 0n) {
      rate = rawRate;
      currentValue =
        (balance.foreignAmountMinor * rate * rialMinorFactor + foreignScale / 2n) / foreignScale;
      rateFingerprintKey = `${rate}`;
    } else {
      const { numerator, denominator } = this.getScaledRateRatio(balance.currency);
      rate = (numerator + denominator / 2n) / denominator;
      const totalDen = denominator * foreignScale;
      currentValue =
        (balance.foreignAmountMinor * numerator * rialMinorFactor + totalDen / 2n) / totalDen;
      rateFingerprintKey = `${numerator}/${denominator}`;
    }

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
      .update(
        `${balance.accountCode}:${balance.currency}:${balance.foreignAmountMinor}:${balance.bookValueRialMinor}:${rateFingerprintKey}:${Boolean(balance.isLiability)}:${postingDate ?? ''}`,
      )
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

  private requireRoleAccount(role: string, code: string | undefined): string {
    if (!code) {
      throw new BadRequestException(`posting role «${role}» has no account mapped for currency.fx_revaluation`);
    }
    return code;
  }

  /**
   * The ledger balance is debit-positive (ChartOfAccountEntity.balance), so a liability with a normal
   * credit balance is stored negative. The client book value is a non-negative amount on the account's
   * normal side, so credit-nature accounts (liability, equity, revenue) are negated before comparing.
   */
  private naturalBookValueMinor(balance: string | number | null | undefined, accountType?: AccountType): bigint {
    if (balance === undefined || balance === null) return 0n;
    const minor = toMinor(balance);
    const creditNature =
      accountType === AccountType.LIABILITY ||
      accountType === AccountType.EQUITY ||
      accountType === AccountType.REVENUE;
    return creditNature ? -minor : minor;
  }

  /**
   * Generates a complete month-end FX revaluation voucher plan for all foreign-currency accounts.
   * Resolves posting roles fx_gain and fx_loss from resolved roles or template defaults.
   */
  generateMonthEndVoucher(
    period: string,
    balances: ForeignAccountBalance[],
    rates?: Partial<Record<Currency, bigint>>,
    resolvedAccounts?: { fxGain?: string; fxLoss?: string },
    postingDate?: string,
  ): MonthEndRevaluationVoucherPlan {
    const tpl = findTemplate('currency.fx_revaluation');
    const fxGainAccount = this.requireRoleAccount(
      'fx_gain',
      resolvedAccounts?.fxGain ?? tpl?.defaults?.fx_gain ?? DEFAULT_ROLE_ACCOUNTS.fx_gain,
    );
    const fxLossAccount = this.requireRoleAccount(
      'fx_loss',
      resolvedAccounts?.fxLoss ?? tpl?.defaults?.fx_loss ?? DEFAULT_ROLE_ACCOUNTS.fx_loss,
    );

    const items = balances.map((b) =>
      this.revalueBalance(b, rates?.[b.currency] ?? b.rateRialPerUnit, postingDate),
    );

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
    if (!isValidIsoCalendarDate(request.date)) {
      throw new BadRequestException('date must match a valid Gregorian YYYY-MM-DD calendar date');
    }

    // 2. Validate Accounts & Reconcile against Chart of Accounts (Blocker 1)
    const accounts = await this.accounting.listAccounts(tenantId);
    const accountMap = new Map(accounts.map((a) => [a.code, a]));

    for (const b of request.balances) {
      if (b.currency === Currency.IRR || b.currency === Currency.IRT) {
        throw new BadRequestException('حساب ریالی یا تومانی مشمول تسعیر ارز نیست');
      }
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
      if (acc.currency && acc.currency !== b.currency) {
        throw new BadRequestException(
          `واحد پول حساب «${b.accountCode}» در سیستم «${acc.currency}» است و نمی‌توان آن را با ارز «${b.currency}» تسعیر کرد.`,
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
    }

    // Resolve posting roles for fx_gain and fx_loss for this tenant
    const desc = await this.postingRules.describe(tenantId);
    const revalDesc = desc.find((d) => d.docType === 'currency.fx_revaluation');
    const fxGainAccount = this.requireRoleAccount(
      'fx_gain',
      revalDesc?.roles.find((r) => r.role === 'fx_gain')?.accountCode ?? DEFAULT_ROLE_ACCOUNTS.fx_gain,
    );
    const fxLossAccount = this.requireRoleAccount(
      'fx_loss',
      revalDesc?.roles.find((r) => r.role === 'fx_loss')?.accountCode ?? DEFAULT_ROLE_ACCOUNTS.fx_loss,
    );

    const plan = this.generateMonthEndVoucher(
      request.period,
      request.balances,
      request.rates,
      { fxGain: fxGainAccount, fxLoss: fxLossAccount },
      request.date,
    );

    const executePosting = async (em?: EntityManager) => {
      if (!em || typeof em.getRepository !== 'function') {
        throw new Error('TenantScope transactional EntityManager is required for FX revaluation');
      }

      const postingResults: PostingResult[] = [];
      const orderedItems = [...plan.items].sort((a, b) =>
        a.accountCode < b.accountCode
          ? -1
          : a.accountCode > b.accountCode
            ? 1
            : a.currency < b.currency
              ? -1
              : a.currency > b.currency
                ? 1
                : 0,
      );

      for (const item of orderedItems) {
        // 1. Lock the account row FIRST (SELECT ... FOR UPDATE) in deterministic accountCode order
        //    to avoid deadlocks and ensure concurrent identical requests observe the committed
        //    posting_sources row on wake-up and replay cleanly instead of failing balance checks.
        const lockedAccount = await em
          .getRepository(ChartOfAccountEntity)
          .createQueryBuilder('acc')
          .setLock('pessimistic_write')
          .where('acc.tenant_id = :tenantId AND acc.code = :code', {
            tenantId,
            code: item.accountCode,
          })
          .getOne();

        if (!lockedAccount) {
          throw new BadRequestException(
            `حساب با کد «${item.accountCode}» در سرفصل حساب‌های این سازمان یافت نشد.`,
          );
        }

        // 2. Check existing active (non-reversed) source under the account lock.
        //    A reversed voucher no longer counts, so the next attempt posts under :r1, :r2, ...
        const baseSourceId = `${request.period}:${item.accountCode}:${item.currency}`;
        let sourceId = baseSourceId;
        let existingSource = await this.postingRules.findSource(
          tenantId,
          'currency_revaluation',
          sourceId,
          'currency.fx_revaluation',
          em,
        );
        for (let n = 1; existingSource?.entryId && existingSource.reversalEntryId; n++) {
          if (n > 50) {
            throw new ConflictException(
              `تسعیر ارز دوره «${request.period}» برای حساب «${item.accountCode}» بیش از حد مجاز برگشت خورده است؛ موضوع را بررسی کنید.`,
            );
          }
          sourceId = `${baseSourceId}:r${n}`;
          existingSource = await this.postingRules.findSource(
            tenantId,
            'currency_revaluation',
            sourceId,
            'currency.fx_revaluation',
            em,
          );
        }

        if (existingSource?.entryId) {
          let existingEntry: { entryNumber: string; description?: string | null } | null = null;
          try {
            existingEntry = await this.accounting.findOneJournalEntry(
              tenantId,
              existingSource.entryId,
            );
          } catch {
            existingEntry = await em
              .getRepository(JournalEntryEntity)
              .findOne({ where: { tenantId, id: existingSource.entryId } });
          }
          const expectedFpTag = `[fp:${item.fingerprint}]`;
          if (!existingEntry?.description?.includes(expectedFpTag)) {
            throw new ConflictException(
              `تسعیر ارز برای دوره «${request.period}»، حساب «${item.accountCode}» و ارز «${item.currency}» قبلاً با پارامترهای متفاوتی ثبت شده است؛ اجرای مجدد با پارامترهای متفاوت مجاز نیست (HTTP 409 Conflict).`,
            );
          }
          if (item.gainMinor !== 0n || item.lossMinor !== 0n) {
            postingResults.push({
              entryId: existingSource.entryId,
              entryNumber: existingSource.entryNumber ?? existingEntry.entryNumber,
              replayed: true,
            });
          }
          continue;
        }

        // 3. Reconcile bookValueRialMinor (and subledger amount_fx when recorded) BEFORE skipping zero-diff items.
        const ledgerBalanceMinor = this.naturalBookValueMinor(
          lockedAccount.balance,
          lockedAccount.accountType,
        );
        const accountName = lockedAccount.name;

        if (ledgerBalanceMinor === 0n && item.foreignAmountMinor !== 0n) {
          throw new BadRequestException(
            `حساب «${item.accountCode}» دارای مانده ریالی صفر در دفتر کل است؛ تسعیر روی حساب بدون مانده مجاز نیست.`,
          );
        }

        if (item.bookValueRialMinor !== ledgerBalanceMinor) {
          throw new BadRequestException(
            `ارزش دفتری اعلام‌شده (${item.bookValueRialMinor}) با مانده دفتر کل حساب ${item.accountCode} (${ledgerBalanceMinor}) مغایرت دارد.`,
          );
        }

        if (typeof em.query === 'function') {
          const fxRows = (await em.query(
            `SELECT
               COUNT(l.amount_fx) AS fx_count,
               COALESCE(SUM(CASE WHEN l.debit > 0 THEN l.amount_fx WHEN l.credit > 0 THEN -l.amount_fx ELSE 0 END), 0) AS net_fx
             FROM fin_journal_entry_lines l
             INNER JOIN fin_journal_entries e ON e.id = l.journal_entry_id AND e.tenant_id = l.tenant_id
             WHERE l.tenant_id = $1
               AND l.account_id = $2
               AND l.currency = $3
               AND e.status = 'POSTED'`,
            [tenantId, lockedAccount.id, item.currency],
          )) as Array<{ fx_count?: string | number; net_fx?: string | number }>;

          const fxCount = Number(fxRows?.[0]?.fx_count ?? 0);
          if (fxCount > 0) {
            const rawNetFx = String(fxRows[0].net_fx ?? '0').trim();
            const isNeg = rawNetFx.startsWith('-');
            const absScaled6 = parseScaled(isNeg ? rawNetFx.slice(1) : rawNetFx, 6);
            const signedScaled6 = isNeg ? -absScaled6 : absScaled6;
            const fxDecimals = CURRENCY_METADATA[item.currency].decimals;
            const scaleDiff = 6 - fxDecimals;
            let ledgerFxMinor: bigint;
            if (scaleDiff === 0) {
              ledgerFxMinor = signedScaled6;
            } else if (scaleDiff > 0) {
              const div = 10n ** BigInt(scaleDiff);
              const absVal = signedScaled6 < 0n ? -signedScaled6 : signedScaled6;
              const rounded = (absVal + div / 2n) / div;
              ledgerFxMinor = signedScaled6 < 0n ? -rounded : rounded;
            } else {
              ledgerFxMinor = signedScaled6 * (10n ** BigInt(-scaleDiff));
            }
            const naturalFxMinor = item.isLiability ? -ledgerFxMinor : ledgerFxMinor;
            if (naturalFxMinor !== item.foreignAmountMinor) {
              throw new BadRequestException(
                `مانده ارزی اعلام‌شده (${item.foreignAmountMinor}) با مانده ارزی ثبت‌شده در دفتر کل حساب ${item.accountCode} (${naturalFxMinor}) مغایرت دارد.`,
              );
            }
          }
        }

        if (item.gainMinor === 0n && item.lossMinor === 0n) {
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
          description: `سند تسعیر ارز پایان دوره ${request.period} - ${accountName} (${item.currency}) [نرخ: ${item.rateRialPerUnit} ریال] [fp:${item.fingerprint}]`,
        };

        const result = await this.postingRules.post(tenantId, postReq, em);
        postingResults.push(result);
      }

      return { plan, postingResults };
    };

    // Atomic execution within a single transaction under TenantScope
    if (manager) {
      return executePosting(manager);
    }
    return this.scope.run(tenantId, (m) => executePosting(m));
  }
}
