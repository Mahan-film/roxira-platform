import { BankCode } from '../../banking/enums/banking.enum';
import { TreasuryDocKind } from '../enums/treasury.enum';
import { toMinor, minorToDecimal } from '../../accounting/money';
import {
  toAsciiDigits,
  fixPersianChars,
  jalaliToGregorian,
} from '../../data_import/normaliser/normalise';
import { BankSmsDirection, BankSmsParsedResult } from './bank-sms.types';

export interface BankRule {
  bank: BankCode;
  bankNameFa: string;
  namePatterns: RegExp[];
}

export const BANK_RULES: readonly BankRule[] = [
  {
    bank: BankCode.MELLI,
    bankNameFa: 'بانک ملی ایران',
    namePatterns: [/بانک\s*ملی(\s*ایران)?/i, /ملی\s*ایران/i],
  },
  {
    bank: BankCode.MELLAT,
    bankNameFa: 'بانک ملت',
    namePatterns: [/بانک\s*ملت/i],
  },
  {
    bank: BankCode.SADERAT,
    bankNameFa: 'بانک صادرات ایران',
    namePatterns: [/بانک\s*صادرات(\s*ایران)?/i, /صادرات\s*ایران/i],
  },
  {
    bank: BankCode.TEJARAT,
    bankNameFa: 'بانک تجارت',
    namePatterns: [/بانک\s*تجارت/i],
  },
  {
    bank: BankCode.SAMAN,
    bankNameFa: 'بانک سامان',
    namePatterns: [/بانک\s*سامان/i, /سامان/i],
  },
  {
    bank: BankCode.PASARGAD,
    bankNameFa: 'بانک پاسارگاد',
    namePatterns: [/بانک\s*پاسارگاد/i, /پاسارگاد/i],
  },
  {
    bank: BankCode.PARSIAN,
    bankNameFa: 'بانک پارسیان',
    namePatterns: [/بانک\s*پارسیان/i, /پارسیان/i],
  },
  {
    bank: BankCode.SEPAH,
    bankNameFa: 'بانک سپه',
    namePatterns: [/بانک\s*سپه/i, /سپه/i],
  },
];

/**
 * Normalises raw SMS: folds digits to ASCII, fixes Arabic characters, cleans extra whitespace.
 */
export function normaliseSms(text: string): string {
  return fixPersianChars(toAsciiDigits(text ?? ''))
    .replace(/[‌‍‎‏]/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

/**
 * Checks whether an incoming message is a recognised Iranian bank SMS.
 */
export function isBankSms(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const normalised = normaliseSms(text);
  const hasDirection = /واریز|برداشت/.test(normalised);
  if (!hasDirection) return false;

  return BANK_RULES.some((rule) =>
    rule.namePatterns.some((pattern) => pattern.test(normalised)),
  );
}

/**
 * Parses Iranian bank SMS text and extracts structured transaction attributes.
 */
export function parseBankSms(rawText: string): BankSmsParsedResult {
  const normalised = normaliseSms(rawText);

  // 1. Identify Bank
  let detectedBank: BankRule | null = null;
  for (const rule of BANK_RULES) {
    if (rule.namePatterns.some((p) => p.test(normalised))) {
      detectedBank = rule;
      break;
    }
  }

  if (!detectedBank) {
    throw new Error('بانک ارسال‌کننده پیامک شناسایی نشد.');
  }

  // 2. Identify Direction
  const isDeposit = /واریز/.test(normalised);
  const isWithdraw = /برداشت/.test(normalised);

  if (!isDeposit && !isWithdraw) {
    throw new Error('نوع تراکنش (واریز یا برداشت) در متن پیامک یافت نشد.');
  }

  const direction: BankSmsDirection = isDeposit ? 'deposit' : 'withdraw';
  const docKind: TreasuryDocKind = isDeposit ? TreasuryDocKind.RECEIPT : TreasuryDocKind.PAYMENT;

  // 3. Extract Amount
  // Matches patterns like:
  // "واریز: 2,500,000 ریال", "واریز مبلغ: 3,000,000", "برداشت: 500,000 ریال"
  const amountMatch =
    /(?:واریز|برداشت)(?:\s*مبلغ)?\s*[:\s]\s*([\d,]+(?:\.\d+)?)\s*(?:ریال|تومان)?/i.exec(normalised);

  if (!amountMatch) {
    throw new Error('مبلغ تراکنش در متن پیامک یافت نشد.');
  }

  const rawAmountStr = amountMatch[1].replace(/,/g, '');
  let amountMinor = toMinor(rawAmountStr);

  // If text mentions "تومان" right after the amount, convert to Rials (x10)
  const fullAmountSegment = amountMatch[0];
  if (/تومان/.test(fullAmountSegment)) {
    amountMinor = amountMinor * 10n;
  }
  const amountDecimal = minorToDecimal(amountMinor);

  // 4. Extract Balance (مانده / موجودی)
  let balanceMinor: bigint | undefined;
  let balanceDecimal: string | undefined;

  const balanceMatch =
    /(?:مانده|موجودی)\s*[:\s]\s*([\d,]+(?:\.\d+)?)\s*(?:ریال|تومان)?/i.exec(normalised);

  if (balanceMatch) {
    const rawBalanceStr = balanceMatch[1].replace(/,/g, '');
    let balMinor = toMinor(rawBalanceStr);
    if (/تومان/.test(balanceMatch[0])) {
      balMinor = balMinor * 10n;
    }
    balanceMinor = balMinor;
    balanceDecimal = minorToDecimal(balanceMinor);
  }

  // 5. Extract Account / Card Tail
  let accountTail: string | undefined;
  let cardTail: string | undefined;

  // Match card patterns: "کارت: ...6037", "به کارت: 6037", "از کارت: 6037"
  const cardMatch = /(?:کارت|card)\s*[:\s]\s*(?:\.{2,4})?(\d{4,16})/i.exec(normalised);
  if (cardMatch) {
    cardTail = cardMatch[1];
  }

  // Match account / deposit patterns: "حساب: ...4321", "سپرده: ...7788", "به: ...5678", "از: ...5678"
  const accountMatch =
    /(?:حساب|سپرده|(?:به|از)\s*سپرده|(?:به|از)\s*حساب|(?:به|از))\s*[:\s]\s*(?:\.{2,4})?(\d{4,16})/i.exec(
      normalised,
    );
  if (accountMatch) {
    accountTail = accountMatch[1];
  }

  // 6. Extract Reference / Tracking Number
  let reference: string | undefined;
  const refMatch =
    /(?:پیگیری|مرجع|سند|شماره\s*پیگیری|کد\s*پیگیری)\s*[:\s]\s*([a-zA-Z0-9]+)/i.exec(normalised);
  if (refMatch) {
    reference = refMatch[1];
  }

  // 7. Extract Date and Time
  let dateTime: string | undefined;
  // Match Jalali date: "1403/08/22" or "03/08/22" or "1403-08-22"
  const dateMatch = /(\d{2,4})[\/\-](\d{1,2})[\/\-](\d{1,2})/i.exec(normalised);
  const timeMatch = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(normalised);

  if (dateMatch) {
    let jy = parseInt(dateMatch[1], 10);
    if (jy < 100) jy += 1400; // 03 -> 1403
    const jm = parseInt(dateMatch[2], 10);
    const jd = parseInt(dateMatch[3], 10);

    const hour = timeMatch ? parseInt(timeMatch[1], 10) : 12;
    const minute = timeMatch ? parseInt(timeMatch[2], 10) : 0;
    const second = timeMatch && timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;

    try {
      const g = jalaliToGregorian(jy, jm, jd);
      const isoDate = `${String(g.gy).padStart(4, '0')}-${String(g.gm).padStart(2, '0')}-${String(
        g.gd,
      ).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(
        2,
        '0',
      )}:${String(second).padStart(2, '0')}.000Z`;
      dateTime = isoDate;
    } catch {
      // Date conversion fallback
    }
  }

  return {
    bank: detectedBank.bank,
    bankNameFa: detectedBank.bankNameFa,
    direction,
    docKind,
    amountMinor,
    amountDecimal,
    balanceMinor,
    balanceDecimal,
    dateTime,
    cardTail,
    accountTail,
    reference,
    rawText,
  };
}
