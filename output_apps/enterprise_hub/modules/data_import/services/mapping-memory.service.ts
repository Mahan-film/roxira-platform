import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { normaliseKey } from '../normaliser/normalise';
import { ImportMappingMemoryRepository } from '../repositories/import-mapping-memory.repository';

export interface RememberedMapping {
  entity: string;
  mapping: Record<string, string | null>;
}

/** امضای پایدار یک جدول: هش مجموعهٔ مرتب‌شدهٔ سربرگ‌های نرمال‌شده (ترتیب ستون‌ها بی‌اثر است). */
export function headerSignature(headers: string[]): string {
  const keys = headers.map((h) => normaliseKey(h)).filter(Boolean).sort();
  return createHash('sha256').update(keys.join('\u0001')).digest('hex').slice(0, 32);
}

/** حافظهٔ نگاشت هر مستأجر: یادگرفتن نگاشت تأییدشده و پیشنهاد آن برای فایل‌های بعدیِ هم‌ساختار. */
@Injectable()
export class MappingMemoryService {
  private readonly logger = new Logger(MappingMemoryService.name);

  constructor(private readonly repository: ImportMappingMemoryRepository) {}

  async recall(tenantId: string, signature: string): Promise<RememberedMapping | null> {
    try {
      const row = await this.repository.find(tenantId, signature);
      return row ? { entity: row.entity, mapping: row.mapping } : null;
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
  ): Promise<void> {
    try {
      await this.repository.upsert(tenantId, signature, entity, mapping);
    } catch (error) {
      // never fail an import because the memory could not be saved
      this.logger.warn(`[MAPPING-MEMORY] ذخیره ناموفق بود: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
