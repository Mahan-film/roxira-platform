import { BadRequestException } from '@nestjs/common';
import {
  jalaliToGregorian,
  parseJalaliDate,
} from '../../data_import/normaliser/normalise';
import { ASSISTANT_TZ_OFFSET_MS } from '../constants/assistant.constants';

/** بازه‌های نام‌دار قابل‌فهم برای ابزارهای دستیار (بر پایه تقویم شمسی). */
export const ASSISTANT_PERIODS = [
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

/** نیمه‌شب تهران در روز شمسی داده‌شده، به‌صورت لحظه UTC. */
export function tehranMidnight(jy: number, jm: number, jd: number): Date {
  const { gy, gm, gd } = jalaliToGregorian(jy, jm, jd);
  return new Date(Date.UTC(gy, gm - 1, gd) - ASSISTANT_TZ_OFFSET_MS);
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
  const { jy, jm } = jalaliToday(now);
  switch (period) {
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
