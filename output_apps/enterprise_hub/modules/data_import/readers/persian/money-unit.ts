import { fixPersianChars, toAsciiDigits } from '../../normaliser/normalise';

export type MoneyUnit = 'rial' | 'toman' | 'unknown';

export interface MoneyUnitGuess {
  unit: MoneyUnit;
  /** ضریب تبدیل به ریال (۱ برای ریال، ۱۰ برای تومان، …) یا null اگر نامشخص است. */
  toRial: number | null;
  evidence: string;
}

const MULTIPLIERS: Array<[RegExp, number, string]> = [
  [/میلیون\s*تومان|million\s*toman/i, 10_000_000, 'میلیون تومان'],
  [/هزار\s*تومان|thousand\s*toman/i, 10_000, 'هزار تومان'],
  [/میلیون\s*ریال|million\s*rial/i, 1_000_000, 'میلیون ریال'],
  [/هزار\s*ریال|thousand\s*rial/i, 1_000, 'هزار ریال'],
];

/**
 * تشخیص واحد مبلغ یک ستون از روی «نام ستون و نمونه مقادیر»؛ هرگز حدس عددی نمی‌زند.
 * نتیجهٔ `unknown` یعنی کاربر باید در پیش‌نمایش واحد را تأیید کند (پیش‌فرض ریال).
 */
export function detectMoneyUnit(header: string, samples: string[] = []): MoneyUnitGuess {
  const normalisedHeader = fixPersianChars(toAsciiDigits(header)).trim();
  const candidates = [normalisedHeader, ...samples.slice(0, 50).map((s) => fixPersianChars(s))];
  const joined = candidates.join(' | ');

  for (const [pattern, factor, label] of MULTIPLIERS) {
    if (pattern.test(joined)) {
      return { unit: factor % 10 === 0 && /تومان|toman/i.test(label) ? 'toman' : 'rial', toRial: factor, evidence: label };
    }
  }

  const headerToman = /تومان|toman|\bIRT\b|\bTMN\b/i.test(normalisedHeader);
  const headerRial = /ریال|rial|\bIRR\b|\bRLS\b/i.test(normalisedHeader);
  if (headerToman && !headerRial) {
    return { unit: 'toman', toRial: 10, evidence: 'نام ستون «تومان» است' };
  }
  if (headerRial && !headerToman) {
    return { unit: 'rial', toRial: 1, evidence: 'نام ستون «ریال» است' };
  }

  const cellToman = samples.filter((s) => /تومان|toman/i.test(s)).length;
  const cellRial = samples.filter((s) => /ریال|rial/i.test(fixPersianChars(s))).length;
  if (cellToman > 0 && cellRial === 0) {
    return { unit: 'toman', toRial: 10, evidence: 'مقدارها با «تومان» نوشته شده‌اند' };
  }
  if (cellRial > 0 && cellToman === 0) {
    return { unit: 'rial', toRial: 1, evidence: 'مقدارها با «ریال» نوشته شده‌اند' };
  }
  return { unit: 'unknown', toRial: null, evidence: 'واحد در نام ستون یا مقدارها نیامده است' };
}
