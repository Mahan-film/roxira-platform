/**
 * پروفایل‌های «محصول مبدأ»: تشخیص خروجی یک نرم‌افزار حسابداری مشخص از روی مجموعهٔ سربرگ‌ها.
 *
 * قاعدهٔ سخت: برای هر پروفایل `evidence` صادقانه ثبت می‌شود.
 *  - `spec`      : ساختار در مشخصات منتشرشده تعریف شده (مثلاً IIF/OFX) — در readerها اعمال می‌شود، نه اینجا.
 *  - `heuristic` : سربرگ‌ها از مستندات عمومی/حافظه‌اند و با خروجی واقعی آن محصول آزمایش نشده‌اند.
 *  - `proven`    : با فایل واقعی همان محصول و تست متکی بر آن تأیید شده.
 *
 * سپیدار، همکاران سیستم، راهکاران و محک: «هیچ سربرگ تأییدشده‌ای» در مخزن یا منابع عمومی نیست
 * (docs/IMPORT_SOURCE_PRODUCTS.md)، پس پروفایلی برایشان ثبت نمی‌شود. وقتی کسی خروجی واقعی را
 * پیوست کرد، یک ورودی `proven` همراه تست با همان فایل اضافه کنید. تا آن زمان حافظهٔ نگاشت
 * هر مستأجر (mapping-memory) همان کار را برای فایل‌های تکراری خود او می‌کند.
 */

import { normaliseKey } from '../../normaliser/normalise';

export type ProfileEvidence = 'proven' | 'heuristic';

export interface SourceProfile {
  id: string;
  vendor: string;
  titleFa: string;
  evidence: ProfileEvidence;
  entity: string;
  /** سربرگ‌هایی که همه باید وجود داشته باشند (هر عضو یک گروه مترادف است). */
  required: string[][];
  /** نگاشت: گروه سربرگ → فیلد موجودیت. */
  mapping: Array<{ headers: string[]; field: string }>;
  warningsFa: string[];
}

export interface ProfileMatch {
  profile: SourceProfile;
  /** سربرگ واقعی فایل → فیلد (null برای ستون‌های بی‌نگاشت). */
  mapping: Record<string, string | null>;
}

const key = (value: string): string => normaliseKey(value.replace(/^\*/, '').replace(/[/_.-]+/g, ' '));

export const SOURCE_PROFILES: readonly SourceProfile[] = [
  {
    id: 'xero-bank-statement',
    vendor: 'Xero',
    titleFa: 'صورت‌حساب بانکی Xero (CSV)',
    evidence: 'heuristic',
    entity: 'bank-statement',
    required: [['date'], ['amount'], ['payee', 'description']],
    mapping: [
      { headers: ['date'], field: 'date' },
      { headers: ['amount'], field: 'amount' },
      { headers: ['description', 'payee'], field: 'description' },
      { headers: ['reference', 'check number', 'cheque number'], field: 'reference' },
    ],
    warningsFa: ['مبلغ‌ها به ارز حساب Xero هستند؛ پیش از ثبت، ارز را بررسی کنید.'],
  },
  {
    id: 'odoo-journal-items',
    vendor: 'Odoo',
    titleFa: 'ردیف‌های سند (Journal Items) اودو',
    evidence: 'heuristic',
    entity: 'accounting-journal-lines',
    required: [['journal entry', 'journal entry name', 'entry', 'move', 'number'], ['date'], ['account', 'account code', 'account name'], ['debit'], ['credit']],
    mapping: [
      { headers: ['journal entry', 'journal entry name', 'journal items journal entry', 'entry', 'move', 'number'], field: 'voucherNo' },
      { headers: ['date'], field: 'date' },
      { headers: ['account code', 'journal items account code', 'account'], field: 'accountCode' },
      { headers: ['label', 'name', 'description'], field: 'description' },
      { headers: ['debit'], field: 'debitRial' },
      { headers: ['credit'], field: 'creditRial' },
    ],
    warningsFa: ['مبلغ‌ها به ارز شرکت اودو هستند، نه لزوماً ریال؛ واحد پول را تأیید کنید و «کد حساب» را با نمودار حساب‌های روکسیرا یکی کنید.'],
  },
  {
    id: 'erpnext-gl-entry',
    vendor: 'ERPNext',
    titleFa: 'دفتر کل (GL Entry) ERPNext',
    evidence: 'heuristic',
    entity: 'accounting-journal-lines',
    required: [['voucher no'], ['posting date', 'date'], ['account'], ['debit', 'debit inr', 'debit usd'], ['credit', 'credit inr', 'credit usd']],
    mapping: [
      { headers: ['voucher no'], field: 'voucherNo' },
      { headers: ['posting date', 'date'], field: 'date' },
      { headers: ['account'], field: 'accountCode' },
      { headers: ['remarks', 'against account'], field: 'description' },
      { headers: ['debit', 'debit inr', 'debit usd'], field: 'debitRial' },
      { headers: ['credit', 'credit inr', 'credit usd'], field: 'creditRial' },
    ],
    warningsFa: ['مبلغ‌ها به ارز شرکت ERPNext هستند؛ واحد پول را تأیید کنید و نام حساب را با نمودار حساب‌های روکسیرا یکی کنید.'],
  },
];

/** تطبیق سربرگ‌های یک جدول با پروفایل‌ها؛ فقط اگر همهٔ سربرگ‌های الزامی بیایند. */
export function matchSourceProfile(headers: string[]): ProfileMatch | null {
  const normalised = new Map(headers.map((h) => [key(h), h]));
  for (const profile of SOURCE_PROFILES) {
    const ok = profile.required.every((group) => group.some((h) => normalised.has(key(h))));
    if (!ok) continue;
    const mapping: Record<string, string | null> = {};
    for (const header of headers) mapping[header] = null;
    const usedFields = new Set<string>();
    for (const { headers: names, field } of profile.mapping) {
      const found = names.map((n) => normalised.get(key(n))).find((h): h is string => h !== undefined && mapping[h] === null);
      if (found && !usedFields.has(field)) {
        mapping[found] = field;
        usedFields.add(field);
      }
    }
    return { profile, mapping };
  }
  return null;
}
