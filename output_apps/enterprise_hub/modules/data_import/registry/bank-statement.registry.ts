import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { BankingService } from '../../banking/services/banking.service';
import { StatementLineInput } from '../../banking/repositories/banking.repository';
import { fixPersianChars, toAsciiDigits } from '../normaliser/normalise';
import {
  AdapterCommitContext,
  AdapterCommitResult,
  AdapterRowFailure,
  EntityImportAdapter,
  ImportFieldDefinition,
  ImportOwnerId,
  NormalisedRecord,
  UndoOutcome,
} from './import-registry.types';

/**
 * Signed rial amount from a bank-export cell.
 *
 * Handles `1,250,000`, `۱٬۲۵۰٬۰۰۰`, `-500,000`, `500,000-`, `(500,000)` and `… تومان` (× 10).
 * Returns null for an empty cell or a placeholder dash, NaN when the cell is not a number.
 */
export function parseSignedRials(raw: unknown): number | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : Number.NaN;
  }
  const text = fixPersianChars(toAsciiDigits(String(raw)))
    .replace(/[‌‎‏]/g, '')
    .trim();
  if (text === '' || /^[-–—−]+$/.test(text)) {
    return null;
  }
  const negative =
    /^\(.*\)$/.test(text) || /^[-−]/.test(text) || /[-−]$/.test(text);
  const isToman = /تومان/.test(text) && !/ریال/.test(text);
  const numeric = text
    .replace(/[٬,\s]/g, '')
    .replace(/٫/g, '.')
    .replace(/(تومان|ریال|IRR|IRT|rial|toman)/gi, '')
    .replace(/^[(\-−]+|[)\-−]+$/g, '');
  if (!/^\d+(\.\d+)?$/.test(numeric)) {
    return Number.NaN;
  }
  const amount = Number(numeric) * (isToman ? 10 : 1);
  return Math.round((negative ? -amount : amount) * 100) / 100;
}

/** A statement row turned into a line, or why it cannot be one. */
export type StatementRowResult =
  | { ok: true; line: StatementLineInput }
  | { ok: false; message: string };

/**
 * Turns a normalised `bank-statement` record into a statement line.
 *
 * Bank point of view: بدهکار/برداشت = money out (withdrawal), بستانکار/واریز = money in (deposit).
 * A single signed «مبلغ» column is used when there are no separate columns (negative = withdrawal).
 */
export function toStatementLine(
  values: Record<string, unknown>,
): StatementRowResult {
  const date = typeof values.date === 'string' ? values.date : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, message: 'تاریخ تراکنش معتبر نیست.' };
  }
  const withdrawalRaw = parseSignedRials(values.withdrawal);
  const depositRaw = parseSignedRials(values.deposit);
  const amountRaw = parseSignedRials(values.amount);
  const balance = parseSignedRials(values.balance);
  for (const [label, value] of [
    ['برداشت (بدهکار)', withdrawalRaw],
    ['واریز (بستانکار)', depositRaw],
    ['مبلغ', amountRaw],
    ['مانده', balance],
  ] as const) {
    if (value !== null && Number.isNaN(value)) {
      return { ok: false, message: `${label} قابل تفسیر نیست.` };
    }
  }

  let withdrawal = Math.abs(withdrawalRaw ?? 0);
  let deposit = Math.abs(depositRaw ?? 0);
  if (withdrawal === 0 && deposit === 0 && amountRaw !== null) {
    if (amountRaw < 0) {
      withdrawal = -amountRaw;
    } else {
      deposit = amountRaw;
    }
  }
  if (withdrawal > 0 && deposit > 0) {
    return { ok: false, message: 'یک سطر نمی‌تواند هم برداشت و هم واریز داشته باشد.' };
  }
  if (withdrawal === 0 && deposit === 0) {
    return { ok: false, message: 'سطر مبلغ برداشت یا واریز ندارد (سطر جمع یا مانده؟).' };
  }

  const text = (key: string, max: number): string | null => {
    const value = values[key];
    if (value === null || value === undefined) {
      return null;
    }
    const trimmed = String(value).trim();
    return trimmed ? trimmed.slice(0, max) : null;
  };
  const reference = text('reference', 64);
  const time = text('time', 16) ?? '';
  const fingerprint = [date, time, withdrawal, deposit, balance ?? '', reference ?? ''].join('|');

  return {
    ok: true,
    line: {
      txnDate: date,
      description: text('description', 1000),
      withdrawal,
      deposit,
      balance,
      reference,
      dedupeKey: `bank:${createHash('sha1').update(fingerprint).digest('hex')}`,
    },
  };
}

/**
 * رجیستری ورود داده «صورتحساب بانک» (Bank statement).
 *
 * فرض‌ها (خروجی اکسل/CSV اینترنت‌بانک‌های ملت، ملی، صادرات، تجارت، پاسارگاد و
 * سامان؛ نام ستون‌ها بین بانک‌ها و نسخه‌ها فرق دارد و این فهرست مترادف‌ها از
 * نمونه‌های رایج گردآوری شده و با فایل واقعی هر بانک باید تکمیل شود):
 * - ستون‌ها: تاریخ (+ زمان/ساعت)، شرح، بدهکار/برداشت، بستانکار/واریز، مانده،
 *   شماره پیگیری/مرجع/سند/سریال، شعبه. گاهی به‌جای دو ستون، یک ستون «مبلغ» علامت‌دار.
 * - تاریخ جلالی متنی (`1403/07/15` یا `1403/07/15 14:22`)؛ سال دورقمی پشتیبانی نمی‌شود.
 * - مبالغ ریالی (تومان فقط اگر در خود سلول نوشته شده باشد)؛ منفی به شکل `-`،
 *   `500-` یا `(500)`.
 * - سطرهای عنوان بالای جدول (نام بانک، شماره حساب، بازه) با یافتن خودکار ردیف
 *   سربرگ رد می‌شوند؛ سطر «جمع»/«مانده از قبل» بدون مبلغ، به‌عنوان ردیف ناموفق
 *   گزارش می‌شود.
 * - ترتیب صعودی یا نزولی سطرها هر دو پذیرفته است.
 *
 * حساب مقصد از `bankAccountId` انتخاب‌شده در ویزارد می‌آید؛ اگر سازمان فقط یک
 * حساب بانکی داشته باشد، همان استفاده می‌شود. درج فقط از طریق BankingService.
 */
@Injectable()
export class BankStatementRegistry implements EntityImportAdapter {
  readonly key = 'bank-statement';
  readonly labelFa = 'صورتحساب بانک';

  readonly fields: readonly ImportFieldDefinition[] = [
    {
      key: 'date',
      labelFa: 'تاریخ تراکنش',
      required: true,
      type: 'date',
      synonyms: [
        'date',
        'transaction date',
        'value date',
        'تاریخ',
        'تاریخ تراکنش',
        'تاریخ عملیات',
        'تاریخ و زمان',
        'تاریخ و ساعت',
        'تاریخ گردش',
      ],
    },
    {
      key: 'time',
      labelFa: 'زمان',
      required: false,
      type: 'text',
      synonyms: ['time', 'زمان', 'ساعت', 'زمان تراکنش', 'ساعت تراکنش'],
    },
    {
      key: 'description',
      labelFa: 'شرح',
      required: false,
      type: 'text',
      synonyms: [
        'description',
        'narration',
        'details',
        'شرح',
        'شرح تراکنش',
        'شرح عملیات',
        'شرح سند',
        'نوع تراکنش',
        'توضیحات',
        'بابت',
      ],
    },
    {
      key: 'withdrawal',
      labelFa: 'برداشت (بدهکار)',
      required: false,
      type: 'text',
      synonyms: [
        'withdrawal',
        'debit',
        'بدهکار',
        'برداشت',
        'مبلغ برداشت',
        'مبلغ بدهکار',
        'گردش بدهکار',
        'بدهکار (ریال)',
        'برداشت (ریال)',
      ],
    },
    {
      key: 'deposit',
      labelFa: 'واریز (بستانکار)',
      required: false,
      type: 'text',
      synonyms: [
        'deposit',
        'credit',
        'بستانکار',
        'واریز',
        'مبلغ واریز',
        'مبلغ بستانکار',
        'گردش بستانکار',
        'بستانکار (ریال)',
        'واریز (ریال)',
      ],
    },
    {
      key: 'amount',
      labelFa: 'مبلغ (علامت‌دار)',
      required: false,
      type: 'text',
      synonyms: ['amount', 'مبلغ', 'مبلغ تراکنش', 'مبلغ (ریال)'],
    },
    {
      key: 'balance',
      labelFa: 'مانده',
      required: false,
      type: 'text',
      synonyms: [
        'balance',
        'running balance',
        'مانده',
        'مانده حساب',
        'مانده پس از تراکنش',
        'مانده (ریال)',
        'موجودی پس از تراکنش',
      ],
    },
    {
      key: 'reference',
      labelFa: 'شماره پیگیری / مرجع',
      required: false,
      type: 'text',
      synonyms: [
        'reference',
        'ref',
        'reference no',
        'tracking code',
        'شماره پیگیری',
        'کد پیگیری',
        'شماره مرجع',
        'کد مرجع',
        'شماره سند',
        'سریال',
        'شماره سریال',
        'شماره چک',
        'شناسه واریز',
      ],
    },
    {
      key: 'branch',
      labelFa: 'شعبه',
      required: false,
      type: 'text',
      synonyms: ['branch', 'شعبه', 'کد شعبه', 'نام شعبه'],
    },
  ];

  constructor(private readonly bankingService: BankingService) {}

  duplicateKeys(record: NormalisedRecord): string[] {
    const result = toStatementLine(record.values);
    return result.ok ? [result.line.dedupeKey] : [];
  }

  async findExistingDuplicateKeys(
    tenantId: string,
    keys: string[],
  ): Promise<string[]> {
    return this.bankingService.findExistingDedupeKeys(tenantId, keys);
  }

  async commit(
    tenantId: string,
    records: NormalisedRecord[],
    context?: AdapterCommitContext,
  ): Promise<AdapterCommitResult> {
    const failed: AdapterRowFailure[] = [];
    const ready: { rowNumber: number; line: StatementLineInput }[] = [];
    for (const record of records) {
      const result = toStatementLine(record.values);
      if (result.ok) {
        ready.push({ rowNumber: record.rowNumber, line: result.line });
      } else {
        failed.push({ rowNumber: record.rowNumber, message: result.message });
      }
    }
    if (ready.length === 0) {
      return { inserted: [], failed };
    }

    try {
      const ids = await this.bankingService.importStatementLines(
        tenantId,
        context?.bankAccountId,
        ready.map((row) => row.line),
      );
      return {
        inserted: ready.map((row, index) => ({
          rowNumber: row.rowNumber,
          ownerId: ids[index],
        })),
        failed,
      };
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'ثبت سطرهای صورتحساب ناموفق بود.';
      return {
        inserted: [],
        failed: [
          ...failed,
          ...ready.map((row) => ({ rowNumber: row.rowNumber, message })),
        ],
      };
    }
  }

  async undo(tenantId: string, ownerIds: ImportOwnerId[]): Promise<UndoOutcome> {
    const ids = ownerIds.map(Number).filter((id) => Number.isInteger(id));
    const { removed, refused } = await this.bankingService.removeImportedLines(
      tenantId,
      ids,
    );
    return {
      removed,
      refused: refused.map((ownerId) => ({
        ownerId,
        message: 'این سطر بانک تطبیق خورده است؛ ابتدا تطبیق را لغو کنید.',
      })),
    };
  }
}
