import { isoDate, jalaliMonthEnd } from '../../hr/services/jalali-period';
import {
  assetRegister,
  assetRegisterTable,
  depreciationSchedule,
  depreciationScheduleTable,
  FixedAssetRow,
} from './asset-register';
import { periodIndex } from './depreciation';

const jalali = (day: string): string => `ت:${day}`;

const asset = (over: Partial<FixedAssetRow> & Pick<FixedAssetRow, 'code'>): FixedAssetRow => ({
  name: `دارایی ${over.code}`,
  category: 'رایانه و تجهیزات',
  acquisitionDate: '2026-04-10',
  cost: '0.00',
  salvageValue: '0.00',
  method: 'STRAIGHT_LINE',
  lifeMonths: null,
  annualRate: null,
  accumulatedDepreciation: '0.00',
  monthsDepreciated: 0,
  nextPeriodIndex: periodIndex(1405, 1),
  status: 'ACTIVE',
  ...over,
});

// 2026-04-10 is 1405/01/21.
const straight = asset({ code: 'FA-1', cost: '1200.00', method: 'STRAIGHT_LINE', lifeMonths: 12 });
const declining = asset({
  code: 'FA-2',
  cost: '1000.00',
  method: 'DECLINING_BALANCE',
  annualRate: '0.24',
  accumulatedDepreciation: '20.00',
  monthsDepreciated: 1,
  nextPeriodIndex: periodIndex(1405, 2),
});
const disposed = asset({
  code: 'FA-3',
  name: 'خودرو',
  category: 'وسایل نقلیه',
  cost: '500.00',
  accumulatedDepreciation: '300.00',
  monthsDepreciated: 3,
  nextPeriodIndex: periodIndex(1405, 4),
  status: 'DISPOSED',
});

describe('assetRegister', () => {
  const result = assetRegister([straight, declining, disposed]);

  it('returns one row per asset with exact minor-unit amounts and a book value', () => {
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toMatchObject({
      code: 'FA-1',
      method: 'STRAIGHT_LINE',
      status: 'ACTIVE',
      costMinor: 120000n,
      accumulatedMinor: 0n,
      bookValueMinor: 120000n,
    });
    expect(result.rows[1]).toMatchObject({
      code: 'FA-2',
      method: 'DECLINING_BALANCE',
      costMinor: 100000n,
      accumulatedMinor: 2000n,
      bookValueMinor: 98000n,
    });
  });

  it('still lists a disposed asset with its status', () => {
    const row = result.rows.find((candidate) => candidate.code === 'FA-3')!;
    expect(row.status).toBe('DISPOSED');
    expect(row.bookValueMinor).toBe(20000n);
  });

  it('totals each amount column exactly', () => {
    expect(result.totals).toEqual({
      costMinor: 270000n,
      accumulatedMinor: 32000n,
      bookValueMinor: 238000n,
    });
    expect(result.totals.bookValueMinor).toBe(result.totals.costMinor - result.totals.accumulatedMinor);
  });
});

describe('depreciationSchedule', () => {
  it('plans a straight-line asset month by month and closes on salvage', () => {
    const schedule = depreciationSchedule(straight);
    expect(schedule.rows).toHaveLength(12);
    expect(schedule.rows.every((row) => row.chargeMinor === 10000n)).toBe(true);
    expect(schedule.rows[0].period).toBe(1);
    expect(schedule.rows[0].day).toBe(isoDate(jalaliMonthEnd(1405, 1)));
    expect(schedule.rows[11].accumulatedMinor).toBe(120000n);
    expect(schedule.rows[11].bookValueMinor).toBe(0n);
    expect(schedule.closingBookValueMinor).toBe(0n);
  });

  it('plans a declining-balance asset from its running totals with the shared formula', () => {
    const schedule = depreciationSchedule(declining);
    expect(schedule.rows[0].chargeMinor).toBe(1960n);
    expect(schedule.closingAccumulatedMinor).toBe(
      schedule.openingAccumulatedMinor + schedule.rows.reduce((sum, row) => sum + row.chargeMinor, 0n),
    );
    expect(schedule.closingBookValueMinor).toBe(100000n - schedule.closingAccumulatedMinor);
    expect(schedule.closingBookValueMinor).toBeGreaterThanOrEqual(0n);
  });

  it('reaches salvage when the remaining amount is smaller than a month charge', () => {
    const short = asset({
      code: 'FA-4',
      cost: '1000.00',
      salvageValue: '990.00',
      method: 'DECLINING_BALANCE',
      annualRate: '0.24',
      accumulatedDepreciation: '5.00',
      monthsDepreciated: 1,
    });
    const schedule = depreciationSchedule(short);
    expect(schedule.rows).toHaveLength(1);
    expect(schedule.rows[0].chargeMinor).toBe(500n);
    expect(schedule.closingBookValueMinor).toBe(99000n);
  });
});

describe('assetRegisterTable', () => {
  const table = assetRegisterTable(assetRegister([straight, declining, disposed]), jalali);

  it('has one column per register field and money columns', () => {
    expect(table.title).toBe('دفتر دارایی‌های ثابت');
    expect(table.columns.map((column) => column.title)).toEqual([
      'کد',
      'نام دارایی',
      'گروه',
      'تاریخ تحصیل',
      'روش',
      'وضعیت',
      'بهای تمام‌شده',
      'استهلاک انباشته',
      'ارزش دفتری',
    ]);
    expect(table.columns.filter((column) => column.money)).toHaveLength(3);
    expect(table.rows).toHaveLength(4);
    for (const row of table.rows) {
      expect(row.cells).toHaveLength(table.columns.length);
    }
  });

  it('renders dates through jalali and carries a bold total row', () => {
    expect(table.rows[0].cells[3]).toBe(jalali('2026-04-10'));
    expect(table.rows[2].cells[5]).toBe('واگذارشده');
    const total = table.rows[3];
    expect(total.bold).toBe(true);
    expect(total.cells).toEqual(['', 'جمع', '', '', '', '', 270000n, 32000n, 238000n]);
  });
});

describe('depreciationScheduleTable', () => {
  const schedule = depreciationSchedule(straight);
  const table = depreciationScheduleTable(schedule, jalali);

  it('has schedule columns and a bold total row', () => {
    expect(table.title).toBe('جدول استهلاک دارایی');
    expect(table.columns.map((column) => column.title)).toEqual([
      'دوره',
      'تاریخ',
      'هزینه استهلاک',
      'استهلاک انباشته',
      'ارزش دفتری',
    ]);
    expect(table.columns.filter((column) => column.money)).toHaveLength(3);
    expect(table.rows).toHaveLength(schedule.rows.length + 1);
    expect(table.rows[0].cells[0]).toBe('1');
    expect(table.rows[0].cells[1]).toBe(jalali(schedule.rows[0].day));
    const total = table.rows[schedule.rows.length];
    expect(total.bold).toBe(true);
    expect(total.cells).toEqual(['', 'جمع', 120000n, 120000n, 0n]);
  });
});
