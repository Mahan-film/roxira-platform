/**
 * Fixed-asset register and depreciation schedule (#250, R-18). Pure: entity rows in, rows and
 * ReportTables out, money as exact integer minor units (bigint).
 *
 * The schedule does not carry a second depreciation formula: every month asks `nextMonthCharge`
 * (assets/depreciation.ts) for the next charge on the running totals. It returns 0 once nothing is
 * left to depreciate, which ends the plan.
 */
import { isoDate, jalaliMonthEnd } from '../../hr/services/jalali-period';
import { fromDb } from '../money';
import { ReportColumn, ReportTable } from '../reports/report-table';
import { DepreciationMethod, nextMonthCharge } from './depreciation';

export type FixedAssetStatus = 'ACTIVE' | 'FULLY_DEPRECIATED' | 'DISPOSED';

/** The `FixedAssetEntity` fields the register and schedule read, exactly as stored (decimal strings). */
export interface FixedAssetRow {
  code: string;
  name: string;
  category: string;
  /** YYYY-MM-DD. */
  acquisitionDate: string;
  cost: string;
  salvageValue: string;
  method: DepreciationMethod;
  lifeMonths: number | null;
  annualRate: string | null;
  accumulatedDepreciation: string;
  monthsDepreciated: number;
  nextPeriodIndex: number;
  status: FixedAssetStatus;
}

export interface AssetRegisterRow {
  code: string;
  name: string;
  category: string;
  acquisitionDate: string;
  method: DepreciationMethod;
  status: FixedAssetStatus;
  costMinor: bigint;
  accumulatedMinor: bigint;
  bookValueMinor: bigint;
}

export interface AssetRegisterTotals {
  costMinor: bigint;
  accumulatedMinor: bigint;
  bookValueMinor: bigint;
}

export interface AssetRegisterResult {
  rows: AssetRegisterRow[];
  totals: AssetRegisterTotals;
}

/** One row per asset, plus the column totals; a disposed asset is still listed with its status. */
export function assetRegister(assets: readonly FixedAssetRow[]): AssetRegisterResult {
  const rows = assets.map((asset): AssetRegisterRow => {
    const costMinor = fromDb(asset.cost);
    const accumulatedMinor = fromDb(asset.accumulatedDepreciation);
    return {
      code: asset.code,
      name: asset.name,
      category: asset.category,
      acquisitionDate: asset.acquisitionDate,
      method: asset.method,
      status: asset.status,
      costMinor,
      accumulatedMinor,
      bookValueMinor: costMinor - accumulatedMinor,
    };
  });
  const totals = rows.reduce<AssetRegisterTotals>(
    (acc, row) => ({
      costMinor: acc.costMinor + row.costMinor,
      accumulatedMinor: acc.accumulatedMinor + row.accumulatedMinor,
      bookValueMinor: acc.bookValueMinor + row.bookValueMinor,
    }),
    { costMinor: 0n, accumulatedMinor: 0n, bookValueMinor: 0n },
  );
  return { rows, totals };
}

export interface DepreciationScheduleRow {
  /** 1-based month of the asset's life. */
  period: number;
  /** YYYY-MM-DD, the last day of the Jalali month. */
  day: string;
  chargeMinor: bigint;
  accumulatedMinor: bigint;
  bookValueMinor: bigint;
}

export interface DepreciationSchedule {
  assetCode: string;
  assetName: string;
  method: DepreciationMethod;
  openingAccumulatedMinor: bigint;
  rows: DepreciationScheduleRow[];
  closingAccumulatedMinor: bigint;
  closingBookValueMinor: bigint;
}

/** `nextPeriodIndex` (year * 12 + month - 1) as the last Gregorian day of that Jalali month. */
const monthEndDay = (index: number): string => {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return isoDate(jalaliMonthEnd(year, month));
};

/**
 * The remaining month-by-month plan from the asset's stored totals. Amounts go through `fromDb`
 * (the same path `FixedAssetService.runMonth` uses) so the plan matches what will be posted.
 * A straight-line asset closes on its salvage value; a declining-balance charge is geometric and
 * the plan ends when the charge rounds to zero.
 */
export function depreciationSchedule(asset: FixedAssetRow): DepreciationSchedule {
  const costMinor = fromDb(asset.cost);
  const salvageMinor = fromDb(asset.salvageValue);
  const openingAccumulatedMinor = fromDb(asset.accumulatedDepreciation);
  let accumulatedMinor = openingAccumulatedMinor;
  let monthsDone = asset.monthsDepreciated;
  const rows: DepreciationScheduleRow[] = [];
  for (;;) {
    const chargeMinor = nextMonthCharge({
      costMinor,
      salvageMinor,
      accumulatedMinor,
      monthsDone,
      method: asset.method,
      lifeMonths: asset.lifeMonths,
      annualRate: asset.annualRate,
    });
    if (chargeMinor <= 0n) {
      break;
    }
    accumulatedMinor += chargeMinor;
    monthsDone += 1;
    rows.push({
      period: monthsDone,
      day: monthEndDay(asset.nextPeriodIndex + rows.length),
      chargeMinor,
      accumulatedMinor,
      bookValueMinor: costMinor - accumulatedMinor,
    });
  }
  return {
    assetCode: asset.code,
    assetName: asset.name,
    method: asset.method,
    openingAccumulatedMinor,
    rows,
    closingAccumulatedMinor: accumulatedMinor,
    closingBookValueMinor: costMinor - accumulatedMinor,
  };
}

const METHOD_TITLES: Readonly<Record<DepreciationMethod, string>> = {
  STRAIGHT_LINE: 'خط مستقیم',
  DECLINING_BALANCE: 'نزولی',
};

const STATUS_TITLES: Readonly<Record<FixedAssetStatus, string>> = {
  ACTIVE: 'فعال',
  FULLY_DEPRECIATED: 'مستهلک‌شده',
  DISPOSED: 'واگذارشده',
};

export function assetRegisterTable(
  result: AssetRegisterResult,
  jalali: (day: string) => string,
): ReportTable {
  const columns: ReportColumn[] = [
    { title: 'کد', width: 0.7 },
    { title: 'نام دارایی', width: 1.8 },
    { title: 'گروه', width: 1 },
    { title: 'تاریخ تحصیل', width: 0.9 },
    { title: 'روش', width: 0.8 },
    { title: 'وضعیت', width: 0.8 },
    { title: 'بهای تمام‌شده', money: true },
    { title: 'استهلاک انباشته', money: true },
    { title: 'ارزش دفتری', money: true },
  ];
  return {
    title: 'دفتر دارایی‌های ثابت',
    subtitle: `مجموع ${result.rows.length} دارایی (مبالغ به ریال)`,
    columns,
    rows: [
      ...result.rows.map((row) => ({
        cells: [
          row.code,
          row.name,
          row.category,
          jalali(row.acquisitionDate),
          METHOD_TITLES[row.method],
          STATUS_TITLES[row.status],
          row.costMinor,
          row.accumulatedMinor,
          row.bookValueMinor,
        ],
      })),
      {
        cells: [
          '',
          'جمع',
          '',
          '',
          '',
          '',
          result.totals.costMinor,
          result.totals.accumulatedMinor,
          result.totals.bookValueMinor,
        ],
        bold: true,
      },
    ],
  };
}

export function depreciationScheduleTable(
  schedule: DepreciationSchedule,
  jalali: (day: string) => string,
): ReportTable {
  return {
    title: 'جدول استهلاک دارایی',
    subtitle: `${schedule.assetCode} ${schedule.assetName}، روش ${METHOD_TITLES[schedule.method]} (مبالغ به ریال)`,
    columns: [
      { title: 'دوره', width: 0.6 },
      { title: 'تاریخ', width: 0.9 },
      { title: 'هزینه استهلاک', money: true },
      { title: 'استهلاک انباشته', money: true },
      { title: 'ارزش دفتری', money: true },
    ],
    rows: [
      ...schedule.rows.map((row) => ({
        cells: [String(row.period), jalali(row.day), row.chargeMinor, row.accumulatedMinor, row.bookValueMinor],
      })),
      {
        cells: [
          '',
          'جمع',
          schedule.closingAccumulatedMinor - schedule.openingAccumulatedMinor,
          schedule.closingAccumulatedMinor,
          schedule.closingBookValueMinor,
        ],
        bold: true,
      },
    ],
  };
}
