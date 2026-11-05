import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { CreateFixedAssetDto, DepreciationRunDto } from '../dto/fixed-asset.dto';
import { nextMonthCharge, periodIndex } from '../assets/depreciation';
import { FixedAssetEntity } from '../entities/fixed-asset.entity';
import { AccountLevel } from '../enums/accounting.enum';
import { fromDb, minorToDecimal, MoneyFormatError, toMinor } from '../money';
import { AccountingRepository } from '../repositories/accounting.repository';
import { FixedAssetRepository } from '../repositories/fixed-asset.repository';
import { gregorianToJalali, isoDate, jalaliMonthEnd } from '../../hr/services/jalali-period';
import { PostingRulesService } from '../../posting_rules/services/posting-rules.service';

export interface DepreciationRunResult {
  year: number;
  month: number;
  /** First voucher of the run (kept for callers of the old single-voucher shape). */
  entryNumber: string | null;
  /** One engine voucher per charged asset, in asset order. */
  entryNumbers: string[];
  totalCharged: string;
  charged: Array<{ code: string; amount: string }>;
  skipped: Array<{ code: string; reason: 'ALREADY_DONE' | 'NOT_ACQUIRED_YET' | 'PREVIOUS_MONTH_MISSING' }>;
}

/**
 * Posting port. PostingRulesModule imports AccountingModule, so AccountingModule cannot import it
 * back; the engine is looked up lazily through ModuleRef (see accounting.module.ts).
 */
export const FIXED_ASSET_POSTING = Symbol('FIXED_ASSET_POSTING');
export type FixedAssetPosting = Pick<PostingRulesService, 'post'>;

const realDay = (day: string): void => {
  const parsed = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
    throw new BadRequestException(`تاریخ ${day} معتبر نیست.`);
  }
};

/** Fixed asset register and monthly depreciation posted to the ledger. */
@Injectable()
export class FixedAssetService {
  constructor(
    private readonly assets: FixedAssetRepository,
    private readonly ledger: AccountingRepository,
    @Inject(FIXED_ASSET_POSTING) private readonly posting: FixedAssetPosting,
  ) {}

  list(tenantId: string) {
    return this.assets.list(tenantId).then((rows) =>
      rows.map((a) => ({
        ...a,
        netBookValue: minorToDecimal(fromDb(a.cost) - fromDb(a.accumulatedDepreciation)),
      })),
    );
  }

  async create(tenantId: string, actor: string, dto: CreateFixedAssetDto): Promise<FixedAssetEntity> {
    realDay(dto.acquisitionDate);
    let cost: bigint;
    let salvage: bigint;
    try {
      cost = toMinor(dto.cost);
      salvage = toMinor(dto.salvageValue ?? 0);
    } catch (error) {
      if (error instanceof MoneyFormatError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    if (cost <= 0n || salvage >= cost) {
      throw new BadRequestException('بهای تمام‌شده باید مثبت و ارزش اسقاط کمتر از آن باشد.');
    }
    if (dto.method === 'STRAIGHT_LINE' && !dto.lifeMonths) {
      throw new BadRequestException('برای خط مستقیم، عمر مفید به ماه لازم است.');
    }
    if (dto.method === 'DECLINING_BALANCE' && (!dto.annualRate || Number(dto.annualRate) <= 0)) {
      throw new BadRequestException('برای روش نزولی، نرخ سالانه لازم است.');
    }
    const jalali = gregorianToJalali(dto.acquisitionDate);
    if (!jalali) {
      throw new BadRequestException('تاریخ خرید معتبر نیست.');
    }

    return this.assets.scoped(tenantId, async (manager) => {
      if (await this.assets.findByCode(tenantId, dto.code, manager)) {
        throw new ConflictException(`دارایی با کد ${dto.code} قبلاً ثبت شده است.`);
      }
      const codes = [dto.assetAccountCode, dto.accumulatedAccountCode, dto.expenseAccountCode];
      const found = await this.ledger.findAccountsByCodes(tenantId, [...new Set(codes)], manager);
      for (const code of codes) {
        const account = found.find((a) => a.code === code);
        if (!account) {
          throw new BadRequestException(`حساب ${code} یافت نشد.`);
        }
        if (account.level === AccountLevel.GROUP || account.level === AccountLevel.KOL) {
          throw new BadRequestException(`حساب ${code} حساب گروه یا کل است.`);
        }
      }
      return this.assets.save(
        tenantId,
        {
          code: dto.code,
          name: dto.name.trim(),
          category: dto.category.trim(),
          acquisitionDate: dto.acquisitionDate,
          cost: minorToDecimal(cost),
          salvageValue: minorToDecimal(salvage),
          method: dto.method,
          lifeMonths: dto.method === 'STRAIGHT_LINE' ? dto.lifeMonths! : null,
          annualRate: dto.method === 'DECLINING_BALANCE' ? dto.annualRate! : null,
          rateSource: dto.rateSource?.trim() || null,
          rateVerified: false,
          assetAccountCode: dto.assetAccountCode,
          accumulatedAccountCode: dto.accumulatedAccountCode,
          expenseAccountCode: dto.expenseAccountCode,
          nextPeriodIndex: periodIndex(jalali.jy, jalali.jm),
          createdBy: actor,
        },
        manager,
      );
    });
  }

  /**
   * Charges one Jalali month for every active asset in one balanced journal entry dated the last
   * day of that month. A month is charged once per asset (database key), months cannot be skipped,
   * and the whole run is one transaction: a locked period or an unknown account books nothing.
   */
  async runMonth(tenantId: string, dto: DepreciationRunDto): Promise<DepreciationRunResult> {
    const target = periodIndex(dto.year, dto.month);
    const date = isoDate(jalaliMonthEnd(dto.year, dto.month));
    return this.assets.scoped(tenantId, async (manager) => {
      const active = await this.assets.lockActive(tenantId, manager);
      const result: DepreciationRunResult = {
        year: dto.year,
        month: dto.month,
        entryNumber: null,
        entryNumbers: [],
        totalCharged: '0.00',
        charged: [],
        skipped: [],
      };
      const todo: Array<{ asset: FixedAssetEntity; charge: bigint }> = [];
      for (const asset of active) {
        if (target < asset.nextPeriodIndex) {
          const acquired = gregorianToJalali(asset.acquisitionDate)!;
          result.skipped.push({
            code: asset.code,
            reason: target < periodIndex(acquired.jy, acquired.jm) ? 'NOT_ACQUIRED_YET' : 'ALREADY_DONE',
          });
        } else if (target > asset.nextPeriodIndex) {
          result.skipped.push({ code: asset.code, reason: 'PREVIOUS_MONTH_MISSING' });
        } else {
          const charge = nextMonthCharge({
            costMinor: fromDb(asset.cost),
            salvageMinor: fromDb(asset.salvageValue),
            accumulatedMinor: fromDb(asset.accumulatedDepreciation),
            monthsDone: asset.monthsDepreciated,
            method: asset.method,
            lifeMonths: asset.lifeMonths,
            annualRate: asset.annualRate,
          });
          if (charge > 0n) {
            todo.push({ asset, charge });
          }
        }
      }
      if (todo.length === 0) {
        return result;
      }
      const base = await this.assets.entriesInPeriod(tenantId, dto.year, dto.month, manager);
      const period = `${dto.year}${String(dto.month).padStart(2, '0')}`;
      let total = 0n;
      for (const [i, { asset, charge }] of todo.entries()) {
        const entryNumber = `DEP-${period}-${base + i + 1}`;
        // One voucher per asset and period; the engine returns the first one if it was already posted.
        const voucher = await this.posting.post(
          tenantId,
          {
            docType: 'asset.depreciation',
            sourceType: 'asset_depreciation',
            sourceId: `${asset.id}:${period}`,
            date,
            amounts: { charge },
            description: `استهلاک ماه ${dto.year}/${dto.month} ${asset.code}`,
            entryNumber,
            overrides: { depreciation_expense: asset.expenseAccountCode, accumulated_depreciation: asset.accumulatedAccountCode },
          },
          manager,
        );
        const accumulated = fromDb(asset.accumulatedDepreciation) + charge;
        const full = accumulated >= fromDb(asset.cost) - fromDb(asset.salvageValue);
        await this.assets.applyCharge(
          tenantId,
          asset,
          { year: dto.year, month: dto.month, amount: minorToDecimal(charge), journalEntryId: voucher.entryId },
          { accumulatedDepreciation: minorToDecimal(accumulated), status: full ? 'FULLY_DEPRECIATED' : 'ACTIVE' },
          manager,
        );
        result.charged.push({ code: asset.code, amount: minorToDecimal(charge) });
        result.entryNumbers.push(voucher.entryNumber);
        total += charge;
      }
      result.entryNumber = result.entryNumbers[0] ?? null;
      result.totalCharged = minorToDecimal(total);
      return result;
    });
  }
}
