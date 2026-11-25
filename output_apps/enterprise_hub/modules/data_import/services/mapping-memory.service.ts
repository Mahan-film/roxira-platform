import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { normaliseKey } from '../normaliser/normalise';
import { ImportMappingMemoryRepository } from '../repositories/import-mapping-memory.repository';

export type MappingDateFormat = 'jalali' | 'gregorian' | 'auto';

const META_DATE_FORMAT_KEY = '__dateFormat';

export interface RememberedMapping {
  entity: string;
  mapping: Record<string, string | null>;
  version: number;
  dateFormat?: MappingDateFormat;
}

/** امضای پایدار یک جدول: هش مجموعهٔ مرتب‌شدهٔ سربرگ‌های نرمال‌شده (ترتیب ستون‌ها بی‌اثر است). */
export function headerSignature(headers: string[]): string {
  const keys = headers.map((h) => normaliseKey(h)).filter(Boolean).sort();
  return createHash('sha256').update(keys.join('\u0001')).digest('hex').slice(0, 32);
}

/**
 * تطبیق نگاشت ذخیره‌شده با سربرگ‌های فایل جدید بر اساس کلید نرمال‌شده
 * (پوشش معادل‌های فارسی/عربی مانند ي/ی، ك/ک، نیم‌فاصله و تغییر ترتیب ستون‌ها).
 */
export function alignMappingToHeaders(
  headers: string[],
  savedMapping: Record<string, string | null>,
): Record<string, string | null> {
  const byNormKey = new Map<string, string | null>();
  for (const [col, field] of Object.entries(savedMapping)) {
    if (col === META_DATE_FORMAT_KEY) continue;
    const norm = normaliseKey(col);
    if (norm && !byNormKey.has(norm)) {
      byNormKey.set(norm, field);
    }
  }
  const aligned: Record<string, string | null> = {};
  for (const header of headers) {
    if (Object.prototype.hasOwnProperty.call(savedMapping, header)) {
      aligned[header] = savedMapping[header];
    } else {
      const norm = normaliseKey(header);
      aligned[header] = norm && byNormKey.has(norm) ? (byNormKey.get(norm) ?? null) : null;
    }
  }
  return aligned;
}

/** حافظهٔ نگاشت هر مستأجر: یادگرفتن نگاشت تأییدشده و پیشنهاد آن برای فایل‌های بعدیِ هم‌ساختار. */
@Injectable()
export class MappingMemoryService {
  private readonly logger = new Logger(MappingMemoryService.name);

  constructor(private readonly repository: ImportMappingMemoryRepository) {}

  async recall(tenantId: string, signature: string): Promise<RememberedMapping | null> {
    try {
      const row = await this.repository.find(tenantId, signature);
      if (!row) return null;
      const rawMapping = row.mapping ?? {};
      const rawDateFmt = rawMapping[META_DATE_FORMAT_KEY];
      const dateFormat: MappingDateFormat | undefined =
        rawDateFmt === 'jalali' || rawDateFmt === 'gregorian' || rawDateFmt === 'auto'
          ? rawDateFmt
          : undefined;
      const cleanMapping: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(rawMapping)) {
        if (k !== META_DATE_FORMAT_KEY) {
          cleanMapping[k] = v;
        }
      }
      return {
        entity: row.entity,
        mapping: cleanMapping,
        version: row.uses ?? 1,
        ...(dateFormat ? { dateFormat } : {}),
      };
    } catch (error) {
      this.logger.warn(`[MAPPING-MEMORY] خواندن ناموفق بود: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async remember(
    tenantId: string,
    signature: string,
    entity: string,
    mapping: Record<string, string | null>,
    dateFormat?: MappingDateFormat,
  ): Promise<void> {
    try {
      const payload: Record<string, string | null> = { ...mapping };
      if (dateFormat) {
        payload[META_DATE_FORMAT_KEY] = dateFormat;
      }
      await this.repository.upsert(tenantId, signature, entity, payload);
    } catch (error) {
      // never fail an import because the memory could not be saved
      this.logger.warn(`[MAPPING-MEMORY] ذخیره ناموفق بود: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
