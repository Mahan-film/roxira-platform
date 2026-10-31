import { toAsciiDigits } from '../../normaliser/normalise';

export type DateSystem = 'jalali' | 'gregorian' | 'mixed' | 'unknown';

export interface DateSystemGuess {
  system: DateSystem;
  jalali: number;
  gregorian: number;
  ambiguous: number;
}

/** تشخیص تقویم یک ستون تاریخ از روی سال‌ها (۱۲۰۰–۱۶۰۰ جلالی، ۱۹۰۰+ میلادی). */
export function detectDateSystem(values: string[]): DateSystemGuess {
  let jalali = 0;
  let gregorian = 0;
  let ambiguous = 0;
  for (const raw of values) {
    const text = toAsciiDigits(raw).trim();
    const match =
      /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/.exec(text) ??
      /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(text);
    if (!match) {
      if (text) {
        ambiguous += 1;
      }
      continue;
    }
    const year = [match[1], match[3]].map(Number).find((n) => n >= 1000) ?? 0;
    if (year >= 1200 && year <= 1600) {
      jalali += 1;
    } else if (year >= 1900 && year <= 2200) {
      gregorian += 1;
    } else {
      ambiguous += 1;
    }
  }
  let system: DateSystem = 'unknown';
  if (jalali > 0 && gregorian === 0) {
    system = 'jalali';
  } else if (gregorian > 0 && jalali === 0) {
    system = 'gregorian';
  } else if (jalali > 0 && gregorian > 0) {
    system = 'mixed';
  }
  return { system, jalali, gregorian, ambiguous };
}
