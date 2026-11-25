import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { fixPersianChars, toAsciiDigits } from '../normaliser/normalise';

export type FuzzyEntityKind = 'parties' | 'inventory-items';
export type DuplicateCandidateStatus = 'PENDING' | 'MERGED' | 'DISMISSED';

export interface FuzzyRecordInput {
  id: string;
  code?: string;
  name: string;
  nationalId?: string;
  phone?: string;
  barcode?: string;
}

export interface FuzzyDuplicateCandidate {
  id: string;
  tenantId: string;
  entity: FuzzyEntityKind;
  left: FuzzyRecordInput;
  right: FuzzyRecordInput;
  score: number;
  reason: string;
  status: DuplicateCandidateStatus;
  merged: false | true;
  createdAt: string;
  resolvedAt?: string;
}

export interface EnqueueFuzzyDuplicatesOptions {
  entity: FuzzyEntityKind;
  records: FuzzyRecordInput[];
  threshold?: number;
}

const DEFAULT_THRESHOLD = 75;
const STOP_WORDS = new Set(['شرکت', 'شركت', 'فروشگاه', 'موسسه', 'مؤسسه', 'گروه', 'co', 'ltd', 'inc']);

/**
 * نرمال‌سازی متن فارسی/عربی برای مقایسه فازی (حذف نیم‌فاصله، علائم، پیشوند شرکت و ارقام فارسی به ASCII).
 */
export function normaliseFuzzyText(raw: string): string {
  const fixed = toAsciiDigits(fixPersianChars(raw ?? ''))
    .replace(/[\u200c\u200e\u200f]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .toLowerCase()
    .trim();
  if (!fixed) return '';
  const tokens = fixed
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOP_WORDS.has(t));
  return tokens.join(' ');
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
}

/** امتیاز شباهت ۰ تا ۱۰۰ (مقایسه مستقیم و مرتب‌شدهٔ واژگان، بدون وابستگی خارجی). */
export function tokenSortSimilarity(aRaw: string, bRaw: string): number {
  const a = normaliseFuzzyText(aRaw);
  const b = normaliseFuzzyText(bRaw);
  if (!a || !b) return 0;
  if (a === b) return 100;

  const aSorted = a.split(' ').sort().join(' ');
  const bSorted = b.split(' ').sort().join(' ');
  if (aSorted === bSorted) return 100;

  const maxLen = Math.max(aSorted.length, bSorted.length);
  const distSorted = levenshteinDistance(aSorted, bSorted);
  const scoreSorted = Math.round(((maxLen - distSorted) / maxLen) * 100);

  const maxRawLen = Math.max(a.length, b.length);
  const distDirect = levenshteinDistance(a, b);
  const scoreDirect = Math.round(((maxRawLen - distDirect) / maxRawLen) * 100);

  return Math.max(scoreSorted, scoreDirect);
}

/**
 * کلیدهای مسدودسازی (blocking keys) برای مقیاس‌پذیری در جدول‌های بزرگ (>۵۰هزار ردیف).
 */
function blockingKeysFor(record: FuzzyRecordInput): string[] {
  const keys = new Set<string>();
  const norm = normaliseFuzzyText(record.name);
  for (const token of norm.split(' ')) {
    if (token.length >= 2) {
      keys.add(`tok:${token.slice(0, 3)}`);
    }
  }
  if (record.nationalId?.trim()) {
    keys.add(`nid:${toAsciiDigits(record.nationalId.trim())}`);
  }
  if (record.phone?.trim()) {
    const digits = toAsciiDigits(record.phone.trim()).replace(/\D/g, '');
    if (digits.length >= 7) keys.add(`ph:${digits.slice(-8)}`);
  }
  if (record.barcode?.trim()) {
    keys.add(`bc:${toAsciiDigits(record.barcode.trim())}`);
  }
  return Array.from(keys);
}

/**
 * صف بازبینی موارد تکراری فازی برای طرف‌حساب‌ها و کالاها.
 * قانون سخت (T330): هیچ ادغامی بدون کلیک/تأیید صریح کاربر انجام نمی‌شود.
 */
@Injectable()
export class FuzzyDuplicateQueueService {
  private readonly queues = new Map<string, Map<string, FuzzyDuplicateCandidate>>();

  private tenantQueue(tenantId: string): Map<string, FuzzyDuplicateCandidate> {
    let q = this.queues.get(tenantId);
    if (!q) {
      q = new Map<string, FuzzyDuplicateCandidate>();
      this.queues.set(tenantId, q);
    }
    return q;
  }

  enqueueCandidates(
    tenantId: string,
    options: EnqueueFuzzyDuplicatesOptions,
  ): FuzzyDuplicateCandidate[] {
    const threshold = options.threshold ?? DEFAULT_THRESHOLD;
    const records = options.records;
    const buckets = new Map<string, number[]>();

    records.forEach((rec, idx) => {
      for (const key of blockingKeysFor(rec)) {
        const list = buckets.get(key) ?? [];
        list.push(idx);
        buckets.set(key, list);
      }
    });

    const seenPairs = new Set<string>();
    const queue = this.tenantQueue(tenantId);
    const added: FuzzyDuplicateCandidate[] = [];

    for (const indices of buckets.values()) {
      for (let i = 0; i < indices.length; i += 1) {
        for (let j = i + 1; j < indices.length; j += 1) {
          const idxA = indices[i];
          const idxB = indices[j];
          const pairKey = idxA < idxB ? `${idxA}:${idxB}` : `${idxB}:${idxA}`;
          if (seenPairs.has(pairKey)) continue;
          seenPairs.add(pairKey);

          const left = records[idxA];
          const right = records[idxB];
          const match = this.scorePair(left, right);
          if (match.score < threshold) continue;

          const candidate: FuzzyDuplicateCandidate = {
            id: randomUUID(),
            tenantId,
            entity: options.entity,
            left,
            right,
            score: match.score,
            reason: match.reason,
            status: 'PENDING',
            merged: false,
            createdAt: new Date().toISOString(),
          };
          queue.set(candidate.id, candidate);
          added.push(candidate);
        }
      }
    }

    return added.sort((a, b) => b.score - a.score);
  }

  listPending(tenantId: string, entity?: FuzzyEntityKind): FuzzyDuplicateCandidate[] {
    const items = Array.from(this.tenantQueue(tenantId).values()).filter(
      (c) => c.status === 'PENDING' && (!entity || c.entity === entity),
    );
    return items.sort((a, b) => b.score - a.score);
  }

  /**
   * تصمیم صریح کاربر روی یک جفت تکراری (ادغام یا رد). بدون فراخوانی این متد هیچ ادغامی رخ نمی‌دهد.
   */
  resolveCandidate(
    tenantId: string,
    candidateId: string,
    decision: 'MERGE' | 'DISMISS',
  ): FuzzyDuplicateCandidate {
    const candidate = this.tenantQueue(tenantId).get(candidateId);
    if (!candidate) {
      throw new NotFoundException('مورد تکراری در صف یافت نشد.');
    }
    candidate.status = decision === 'MERGE' ? 'MERGED' : 'DISMISSED';
    candidate.merged = decision === 'MERGE';
    candidate.resolvedAt = new Date().toISOString();
    return candidate;
  }

  private scorePair(
    left: FuzzyRecordInput,
    right: FuzzyRecordInput,
  ): { score: number; reason: string } {
    if (
      left.nationalId &&
      right.nationalId &&
      toAsciiDigits(left.nationalId.trim()) === toAsciiDigits(right.nationalId.trim())
    ) {
      return { score: 100, reason: 'شناسه ملی یکسان' };
    }
    if (
      left.barcode &&
      right.barcode &&
      toAsciiDigits(left.barcode.trim()) === toAsciiDigits(right.barcode.trim())
    ) {
      return { score: 100, reason: 'بارکد یکسان' };
    }
    const nameScore = tokenSortSimilarity(left.name, right.name);
    if (
      left.phone &&
      right.phone &&
      toAsciiDigits(left.phone).replace(/\D/g, '') ===
        toAsciiDigits(right.phone).replace(/\D/g, '')
    ) {
      return { score: Math.max(nameScore, 90), reason: 'شماره تماس یکسان' };
    }
    return { score: nameScore, reason: 'شباهت نام فازی' };
  }
}
