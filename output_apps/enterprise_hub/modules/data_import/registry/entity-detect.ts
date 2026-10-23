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

/** شناسه فیلدهای موجودیت که دست‌کم یک ستون منطبق دارند. */
function matchedFieldKeys(
  headers: string[],
  adapter: EntityImportAdapter,
): Set<string> {
  const index = synonymIndex(adapter.fields);
  const matched = new Set<string>();
  for (const header of headers) {
    const field = header ? index.get(normaliseKey(header)) : undefined;
    if (field) {
      matched.add(field);
    }
  }
  return matched;
}

/**
 * Detection confidence (0..1): how many of the entity's REQUIRED fields the headers cover, lowered when
 * a runner-up entity scores close to the winner. Extra source columns we do not import (warehouse,
 * notes, ...) no longer pull it down: a correctly detected 13-column goods table used to show 23%.
 */
function detectionConfidence(
  headers: string[],
  adapter: EntityImportAdapter,
  bestScore: number,
  secondScore: number,
): number {
  if (bestScore <= 0) {
    return 0;
  }
  const required = adapter.fields.filter((field) => field.required);
  const matched = matchedFieldKeys(headers, adapter);
  const coverage =
    required.length > 0
      ? required.filter((field) => matched.has(field.key)).length /
        required.length
      : 1;
  const margin = Math.min(1, 0.5 + (bestScore - secondScore) / bestScore);
  return Math.round(coverage * margin * 100) / 100;
}

/** نتیجه تشخیص خودکار موجودیت. */
export interface EntityDetection {
  key: string | null;
  /** پوشش فیلدهای الزامی موجودیت، با کسر در صورت نزدیکی رقیب (۰..۱). */
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
  const bestAdapter = adapters.find((adapter) => adapter.key === best.key);
  const confidence = bestAdapter
    ? detectionConfidence(headers, bestAdapter, best.score, second?.score ?? 0)
    : 0;
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

/** How many leading rows are searched for the real header row. */
export const HEADER_SCAN_ROWS = 15;

/**
 * Finds the header row when a sheet starts with title rows (bank name, account number, period:
 * typical for Iranian bank statement exports). The row with the best synonym score across all
 * entities wins, but only when it beats the first row by at least two recognised columns, so
 * ordinary files keep row 0 as their header.
 */
export function locateHeaderRow(
  rows: string[][],
  adapters: EntityImportAdapter[],
  maxScan: number = HEADER_SCAN_ROWS,
): number {
  if (rows.length < 2 || adapters.length === 0) {
    return 0;
  }
  const score = (row: string[]) =>
    Math.max(...adapters.map((adapter) => scoreEntityHeaders(row, adapter)));
  const firstScore = score(rows[0]);
  let bestIndex = 0;
  let bestScore = firstScore;
  const limit = Math.min(rows.length - 1, maxScan);
  for (let index = 1; index < limit; index += 1) {
    const rowScore = score(rows[index]);
    if (rowScore > bestScore) {
      bestScore = rowScore;
      bestIndex = index;
    }
  }
  return bestScore >= firstScore + 2 ? bestIndex : 0;
}
