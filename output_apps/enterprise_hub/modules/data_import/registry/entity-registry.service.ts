import { Inject, Injectable } from '@nestjs/common';
import {
  EntityImportAdapter,
  ImportFieldDefinition,
  ImportFieldType,
} from './import-registry.types';

/** توکن تزریق فهرست آداپتورهای موجودیت‌ها. */
export const ENTITY_IMPORT_ADAPTERS = 'ENTITY_IMPORT_ADAPTERS';

/** توصیف عمومی یک فیلد برای خروجی `GET /entities`. */
export interface EntityFieldDescriptor {
  key: string;
  labelFa: string;
  required: boolean;
  type: ImportFieldType;
  enumValues?: readonly string[];
}

/** توصیف عمومی یک موجودیت برای خروجی `GET /entities`. */
export interface EntityDescriptor {
  key: string;
  labelFa: string;
  fields: EntityFieldDescriptor[];
}

/** رجیستری موجودیت‌های قابل ورود؛ تنها منبع حقیقت فهرست و فیلدها. */
@Injectable()
export class EntityRegistryService {
  constructor(
    @Inject(ENTITY_IMPORT_ADAPTERS)
    private readonly adapters: EntityImportAdapter[],
  ) {}

  /** همه آداپتورهای ثبت‌شده. */
  all(): EntityImportAdapter[] {
    return this.adapters;
  }

  /** آداپتور یک موجودیت با کلید؛ در صورت نبود `null`. */
  get(key: string): EntityImportAdapter | null {
    return this.adapters.find((adapter) => adapter.key === key) ?? null;
  }

  /** کلیدهای موجودیت‌های ثبت‌شده. */
  keys(): string[] {
    return this.adapters.map((adapter) => adapter.key);
  }

  /** توصیف عمومی همه موجودیت‌ها. */
  descriptors(): EntityDescriptor[] {
    return this.adapters.map((adapter) => ({
      key: adapter.key,
      labelFa: adapter.labelFa,
      fields: adapter.fields.map((field) => {
        const descriptor: EntityFieldDescriptor = {
          key: field.key,
          labelFa: field.labelFa,
          required: field.required,
          type: field.type,
        };
        if (field.enumValues) {
          descriptor.enumValues = field.enumValues;
        }
        return descriptor;
      }),
    }));
  }
}

/** تبدیل توصیف فیلد به نگاشت معتبر (برای اعتبارسنجی ورودی commit). */
export function fieldKeysOf(
  fields: readonly ImportFieldDefinition[],
): Set<string> {
  return new Set(fields.map((field) => field.key));
}
