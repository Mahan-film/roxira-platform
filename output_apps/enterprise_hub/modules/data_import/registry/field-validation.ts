import { normaliseFieldValue } from '../normaliser/normalise';
import { ImportFieldDefinition } from './import-registry.types';

/**
 * اعتبارسنجی مقدار نرمال‌شده یک فیلد بر پایه نوع آن.
 *
 * پیام خطا فارسی و کاربرپسند است تا مستقیماً در پاسخ preview/commit قابل
 * نمایش باشد. برای فیلدهای اختیاری خالی، `null` برگردانده می‌شود.
 */
export function validateFieldValue(
  field: ImportFieldDefinition,
  value: unknown,
): string | null {
  const isEmpty =
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '');

  if (isEmpty) {
    return field.required ? `${field.labelFa} الزامی است.` : null;
  }

  switch (field.type) {
    case 'number':
    case 'money':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return `${field.labelFa} باید یک عدد معتبر باشد.`;
      }
      if (value < 0) {
        return `${field.labelFa} نمی‌تواند منفی باشد.`;
      }
      return null;
    case 'date':
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return `${field.labelFa} تاریخ معتبر نیست.`;
      }
      return null;
    case 'email':
      if (
        typeof value !== 'string' ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
      ) {
        return `${field.labelFa} رایانامه معتبر نیست.`;
      }
      return null;
    case 'phone':
      if (typeof value !== 'string' || !/^\+?\d{8,15}$/.test(value)) {
        return `${field.labelFa} شماره تماس معتبر نیست.`;
      }
      return null;
    case 'national_id':
      if (typeof value !== 'string' || !/^\d{10}$/.test(value)) {
        return `${field.labelFa} باید دقیقاً ۱۰ رقم باشد.`;
      }
      return null;
    case 'enum':
      if (
        typeof value !== 'string' ||
        !field.enumValues ||
        !field.enumValues.includes(value)
      ) {
        const allowed = (field.enumValues ?? []).join('، ');
        return `${field.labelFa} باید یکی از مقادیر مجاز باشد: ${allowed}.`;
      }
      return null;
    default:
      return null;
  }
}

/** نرمال‌سازی و اعتبارسنجی یک مقدار خام ستون. */
export function normaliseAndValidate(
  field: ImportFieldDefinition,
  raw: string,
): { value: unknown; error: string | null } {
  const value = normaliseFieldValue(raw, field);

  const parseFailed =
    (value === null || value === '') && raw.trim() !== '';
  if (parseFailed) {
    return { value, error: `${field.labelFa} قابل تفسیر نیست.` };
  }

  return { value, error: validateFieldValue(field, value) };
}
