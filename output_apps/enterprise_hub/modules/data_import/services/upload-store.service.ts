import { Injectable } from '@nestjs/common';
import { UPLOAD_TTL_MS } from '../constants/data-import.constants';

/** فایل تجزیه‌شده ذخیره‌شده در حافظه سرور (هرگز روی دیسک). */
export interface StoredUpload {
  headers: string[];
  rows: string[][];
  expiresAt: number;
}

/**
 * انبار درون‌حافظه‌ای بارگذاری‌ها با TTL ۳۰ دقیقه.
 *
 * کلید هر بارگذاری ترکیب `tenantId` و `uploadId` است تا یک مستأجر هرگز به
 * بارگذاری مستأجر دیگر (حتی با حدس uploadId) دسترسی نداشته باشد. داده مشتری
 * فقط در RAM نگه داشته می‌شود و هرگز در مخزن نوشته نمی‌شود.
 */
@Injectable()
export class UploadStoreService {
  private readonly uploads = new Map<string, StoredUpload>();

  private key(tenantId: string, uploadId: string): string {
    return `${tenantId}::${uploadId}`;
  }

  /** ذخیره بارگذاری تجزیه‌شده با انقضای ۳۰ دقیقه. */
  save(
    tenantId: string,
    uploadId: string,
    data: { headers: string[]; rows: string[][] },
  ): void {
    this.sweep();
    this.uploads.set(this.key(tenantId, uploadId), {
      headers: data.headers,
      rows: data.rows,
      expiresAt: Date.now() + UPLOAD_TTL_MS,
    });
  }

  /** خواندن بارگذاری در محدوده همان مستأجر؛ در صورت انقضا null. */
  get(tenantId: string, uploadId: string): StoredUpload | null {
    const storageKey = this.key(tenantId, uploadId);
    const entry = this.uploads.get(storageKey);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt < Date.now()) {
      this.uploads.delete(storageKey);
      return null;
    }
    return entry;
  }

  /** حذف بارگذاری پس از ورود موفق (آزادسازی حافظه). */
  remove(tenantId: string, uploadId: string): void {
    this.uploads.delete(this.key(tenantId, uploadId));
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.uploads) {
      if (entry.expiresAt < now) {
        this.uploads.delete(key);
      }
    }
  }
}
