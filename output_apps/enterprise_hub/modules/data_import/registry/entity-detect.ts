import { normaliseKey } from '../normaliser/normalise';
import {
  EntityImportAdapter,
  ImportFieldDefinition,
} from './import-registry.types';

/** نگاشت مترادف نرمال‌شده به شناسه فیلد. */
function synonymIndex(
  fields: readonly ImportFieldDefinition[],
): Map<string, string> {
  const index = new Map<string, string>();
  for (const field of fields) {
    for (const synonym of field.synonyms) {
      const key = normaliseKey(synonym);
      if (key && !index.has(key)) {
        index.set(key, field.key);
      }
    }
  }
  return index;
}

/** امتیاز تطبیق سربرگ‌های یک فایل با مترادف‌های یک موجودیت. */
export function scoreEntityHeaders(
  headers: string[],
  adapter: EntityImportAdapter,
): number {
  const index = synonymIndex(adapter.fields);
  let score = 0;
  for (const header of headers) {
    if (!header) {
      continue;
    }
    if (index.has(normaliseKey(header))) {
      score += 1;
    }
  }
  return score;
}

/** نتیجه تشخیص خودکار موجودیت. */
export interface EntityDetection {
  key: string | null;
  /** نسبت سربرگ‌های منطبق به کل سربرگ‌های غیرخالی (۰..۱). */
  confidence: number;
  /**
   * آیا بهترین امتیاز مبهم است؟ (صفر، یا برابر با امتیاز رقیب)
   * در این حالت سرویس، تشخیص را به مدل زبانی واگذار می‌کند.
   */
  ambiguous: boolean;
}

/**
 * تشخیص خودکار موجودیت بر پایه امتیاز تطبیق مترادف سربرگ‌ها.
 *
 * هرگز یک موجودیت تازه اختراع نمی‌کند؛ در بدترین حالت نخستین موجودیت رجیستری
 * را با اطمینان صفر و پرچم `ambiguous` برمی‌گرداند.
 */
export function detectEntity(
  headers: string[],
  adapters: EntityImportAdapter[],
): EntityDetection {
  if (adapters.length === 0) {
    return { key: null, confidence: 0, ambiguous: true };
  }

  const scored = adapters
    .map((adapter) => ({
      key: adapter.key,
      score: scoreEntityHeaders(headers, adapter),
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];
  const nonEmptyHeaders = headers.filter((header) => header && header.trim())
    .length;
  const confidence =
    nonEmptyHeaders > 0 ? best.score / nonEmptyHeaders : 0;
  const ambiguous =
    best.score === 0 || (second !== undefined && second.score >= best.score);

  return {
    key: best.score > 0 ? best.key : best.key,
    confidence,
    ambiguous,
  };
}

/**
 * ساخت نگاشت قطعی (fallback) از سربرگ‌ها به فیلدهای یک موجودیت.
 * هر فیلد فقط یک بار (نخستین ستون منطبق) و ستون‌های ناشناخته حذف می‌شوند.
 */
export function buildEntityFallbackMapping(
  fields: readonly ImportFieldDefinition[],
  headers: string[],
): Record<string, string> {
  const index = synonymIndex(fields);
  const mapping: Record<string, string> = {};
  const usedFields = new Set<string>();

  for (const header of headers) {
    if (!header) {
      continue;
    }
    const field = index.get(normaliseKey(header));
    if (field && !usedFields.has(field)) {
      mapping[header] = field;
      usedFields.add(field);
    }
  }
  return mapping;
}
