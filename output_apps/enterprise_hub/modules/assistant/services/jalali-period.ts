import { BadRequestException } from '@nestjs/common';
import {
  jalaliToGregorian,
  parseJalaliDate,
} from '../../data_import/normaliser/normalise';
import { ASSISTANT_TZ_OFFSET_MS } from '../constants/assistant.constants';

/** بازه‌های نام‌دار قابل‌فهم برای ابزارهای دستیار (بر پایه تقویم شمسی). */
export const ASSISTANT_PERIODS = [
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'this_year',
  'last_year',
  'last_30_days',
  'all',
] as const;

export type AssistantPeriod = (typeof ASSISTANT_PERIODS)[number];

/** بازه زمانی نیم‌باز `[from, to)`؛ مرز تهی یعنی بدون محدودیت. */
export interface DateRange {
  from?: Date;
  to?: Date;
  /** برچسب خوانا برای مدل و کاربر (مثلاً `1405/07/01 تا 1405/08/01`). */
  label: string;
}

export interface CalendarBoundary {
  fromIso: string;
  toIso: string;
  fromJalali: string;
  toJalali: string;
}

export interface CalendarContext {
  todayIso: string;
  todayJalali: string;
  boundaries: {
    today: CalendarBoundary;
    yesterday: CalendarBoundary;
    thisWeek: CalendarBoundary;
    lastWeek: CalendarBoundary;
    thisMonth: CalendarBoundary;
    thisFiscalYear: CalendarBoundary;
  };
}

/** تاریخ شمسی امروز در منطقه زمانی ایران. */
export function jalaliToday(now: Date): { jy: number; jm: number; jd: number } {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now);
  const pick = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value);
  return { jy: pick('year'), jm: pick('month'), jd: pick('day') };
}

/** تبدیل تاریخ میلادی به رشته شمسی YYYY/MM/DD. */
export function formatJalaliDate(date: Date): string {
  const { jy, jm, jd } = jalaliToday(date);
  return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
}

/** نیمه‌شب تهران در روز شمسی داده‌شده، به‌صورت لحظه UTC. */
export function tehranMidnight(jy: number, jm: number, jd: number): Date {
  const { gy, gm, gd } = jalaliToGregorian(jy, jm, jd);
  return new Date(Date.UTC(gy, gm - 1, gd) - ASSISTANT_TZ_OFFSET_MS);
}

/** مرزهای تقویمی محاسبه‌شده در سمت سرور برای تزریق به پرامپت دستیار. */
export function getCalendarContext(now: Date = new Date()): CalendarContext {
  const { jy, jm, jd } = jalaliToday(now);
  const todayStart = tehranMidnight(jy, jm, jd);
  const todayEnd = new Date(todayStart.getTime() + 24 * 3600 * 1000);

  const yesterdayStart = new Date(todayStart.getTime() - 24 * 3600 * 1000);
  const yesterdayEnd = todayStart;

  // تقویم هجری شمسی: شروع هفته روز شنبه است.
  // getDay(): 0=Sun, 1=Mon, ..., 6=Sat
  const dayOfWeek = now.getDay();
  const daysSinceSaturday = (dayOfWeek + 1) % 7;
  const thisWeekStart = new Date(todayStart.getTime() - daysSinceSaturday * 24 * 3600 * 1000);
  const thisWeekEnd = new Date(thisWeekStart.getTime() + 7 * 24 * 3600 * 1000);

  const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 24 * 3600 * 1000);
  const lastWeekEnd = thisWeekStart;

  const thisMonthStart = monthStart(jy, jm);
  const thisMonthEnd = monthStart(jy, jm + 1);

  const thisFiscalYearStart = tehranMidnight(jy, 1, 1);
  const thisFiscalYearEnd = tehranMidnight(jy + 1, 1, 1);

  const b = (from: Date, to: Date): CalendarBoundary => ({
    fromIso: from.toISOString().slice(0, 10),
    toIso: new Date(to.getTime() - 1).toISOString().slice(0, 10),
    fromJalali: formatJalaliDate(from),
    toJalali: formatJalaliDate(new Date(to.getTime() - 1)),
  });

  return {
    todayIso: now.toISOString().slice(0, 10),
    todayJalali: `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`,
    boundaries: {
      today: b(todayStart, todayEnd),
      yesterday: b(yesterdayStart, yesterdayEnd),
      thisWeek: b(thisWeekStart, thisWeekEnd),
      lastWeek: b(lastWeekStart, lastWeekEnd),
      thisMonth: b(thisMonthStart, thisMonthEnd),
      thisFiscalYear: b(thisFiscalYearStart, thisFiscalYearEnd),
    },
  };
}

/** تبدیل بلوک تقویمی سرور به متن راهنما برای پرامپت دستیار. */
export function formatCalendarBlock(now: Date = new Date()): string {
  const ctx = getCalendarContext(now);
  const b = ctx.boundaries;
  return [
    '[CALENDAR_CONTEXT]',
    `Today ISO: ${ctx.todayIso}`,
    `Today Jalali: ${ctx.todayJalali}`,
    `Today boundary: ${b.today.fromIso} (${b.today.fromJalali}) to ${b.today.toIso} (${b.today.toJalali})`,
    `Yesterday boundary: ${b.yesterday.fromIso} (${b.yesterday.fromJalali}) to ${b.yesterday.toIso} (${b.yesterday.toJalali})`,
    `This week boundary: ${b.thisWeek.fromIso} (${b.thisWeek.fromJalali}) to ${b.thisWeek.toIso} (${b.thisWeek.toJalali})`,
    `Last week boundary: ${b.lastWeek.fromIso} (${b.lastWeek.fromJalali}) to ${b.lastWeek.toIso} (${b.lastWeek.toJalali})`,
    `This month boundary: ${b.thisMonth.fromIso} (${b.thisMonth.fromJalali}) to ${b.thisMonth.toIso} (${b.thisMonth.toJalali})`,
    `This fiscal year boundary: ${b.thisFiscalYear.fromIso} (${b.thisFiscalYear.fromJalali}) to ${b.thisFiscalYear.toIso} (${b.thisFiscalYear.toJalali})`,
    '[/CALENDAR_CONTEXT]',
  ].join('\n');
}

function monthStart(jy: number, jm: number): Date {
  // jm ممکن است ۰ یا ۱۳ باشد؛ به سال قبل/بعد منتقل می‌شود.
  const year = jy + Math.floor((jm - 1) / 12);
  const month = ((((jm - 1) % 12) + 12) % 12) + 1;
  return tehranMidnight(year, month, 1);
}

function jalaliLabel(jy: number, jm: number): string {
  const year = jy + Math.floor((jm - 1) / 12);
  const month = ((((jm - 1) % 12) + 12) % 12) + 1;
  return `${year}/${String(month).padStart(2, '0')}`;
}

/** تبدیل تاریخ ورودی ابزار (شمسی یا میلادی) به نیمه‌شب تهران. */
function parseBoundary(value: string, field: string): Date {
  const iso = parseJalaliDate(value);
  if (!iso) {
    throw new BadRequestException(`تاریخ ${field} نامعتبر است: ${value}`);
  }
  const [gy, gm, gd] = iso.split('-').map(Number);
  return new Date(Date.UTC(gy, gm - 1, gd) - ASSISTANT_TZ_OFFSET_MS);
}

/**
 * تبدیل بازه نام‌دار یا تاریخ‌های صریح به بازه نیم‌باز.
 *
 * تاریخ‌های صریح (`from`/`to`، شمسی مانند `1405/07/01` یا میلادی) بر بازه
 * نام‌دار مقدم‌اند؛ `to` شامل خود آن روز است.
 */
export function resolvePeriod(
  input: { period?: string; from?: string; to?: string },
  now: Date = new Date(),
): DateRange {
  if (input.from || input.to) {
    const from = input.from ? parseBoundary(input.from, 'شروع') : undefined;
    const toDay = input.to ? parseBoundary(input.to, 'پایان') : undefined;
    const to = toDay ? new Date(toDay.getTime() + 24 * 60 * 60 * 1000) : undefined;
    if (from && to && from >= to) {
      throw new BadRequestException('تاریخ شروع باید پیش از تاریخ پایان باشد.');
    }
    return {
      from,
      to,
      label: `${input.from ?? '…'} تا ${input.to ?? '…'}`,
    };
  }

  const period = (input.period ?? 'this_month') as AssistantPeriod;
  const { jy, jm, jd } = jalaliToday(now);
  switch (period) {
    case 'today': {
      const start = tehranMidnight(jy, jm, jd);
      const to = new Date(start.getTime() + 24 * 3600 * 1000);
      return { from: start, to, label: `امروز (${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')})` };
    }
    case 'yesterday': {
      const todayStart = tehranMidnight(jy, jm, jd);
      const start = new Date(todayStart.getTime() - 24 * 3600 * 1000);
      return { from: start, to: todayStart, label: `دیروز (${formatJalaliDate(start)})` };
    }
    case 'this_week': {
      const todayStart = tehranMidnight(jy, jm, jd);
      const dayOfWeek = now.getDay();
      const daysSinceSaturday = (dayOfWeek + 1) % 7;
      const start = new Date(todayStart.getTime() - daysSinceSaturday * 24 * 3600 * 1000);
      const to = new Date(start.getTime() + 7 * 24 * 3600 * 1000);
      return { from: start, to, label: `این هفته (${formatJalaliDate(start)} تا ${formatJalaliDate(new Date(to.getTime() - 1))})` };
    }
    case 'last_week': {
      const todayStart = tehranMidnight(jy, jm, jd);
      const dayOfWeek = now.getDay();
      const daysSinceSaturday = (dayOfWeek + 1) % 7;
      const thisWeekStart = new Date(todayStart.getTime() - daysSinceSaturday * 24 * 3600 * 1000);
      const start = new Date(thisWeekStart.getTime() - 7 * 24 * 3600 * 1000);
      return { from: start, to: thisWeekStart, label: `هفته گذشته (${formatJalaliDate(start)} تا ${formatJalaliDate(new Date(thisWeekStart.getTime() - 1))})` };
    }
    case 'this_month':
      return {
        from: monthStart(jy, jm),
        to: monthStart(jy, jm + 1),
        label: `ماه ${jalaliLabel(jy, jm)}`,
      };
    case 'last_month':
      return {
        from: monthStart(jy, jm - 1),
        to: monthStart(jy, jm),
        label: `ماه ${jalaliLabel(jy, jm - 1)}`,
      };
    case 'this_year':
      return {
        from: tehranMidnight(jy, 1, 1),
        to: tehranMidnight(jy + 1, 1, 1),
        label: `سال ${jy}`,
      };
    case 'last_year':
      return {
        from: tehranMidnight(jy - 1, 1, 1),
        to: tehranMidnight(jy, 1, 1),
        label: `سال ${jy - 1}`,
      };
    case 'last_30_days':
      return {
        from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        to: now,
        label: '۳۰ روز گذشته',
      };
    case 'all':
      return { label: 'همه زمان‌ها' };
    default:
      throw new BadRequestException(`بازه نامعتبر: ${String(period)}`);
  }
}
