import { ApiProperty } from '@nestjs/swagger';
import {
  IsObject,
  IsUUID,
  ValidationOptions,
  registerDecorator,
} from 'class-validator';
import {
  CRM_LEAD_FIELDS,
  CrmLeadField,
} from '../constants/data-import.constants';

const ALLOWED_FIELDS = new Set<string>(CRM_LEAD_FIELDS);

/** اعتبارسنجی مقادیر نگاشت: هر مقدار یا خالی است یا یک فیلد معتبر سرنخ. */
function isValidLeadFieldMapping(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return Object.values(value as Record<string, unknown>).every(
    (field) =>
      typeof field === 'string' &&
      (field === '' || ALLOWED_FIELDS.has(field as CrmLeadField)),
  );
}

export function IsLeadFieldMapping(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isLeadFieldMapping',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: (value: unknown): boolean => isValidLeadFieldMapping(value),
        defaultMessage: (): string =>
          'نگاشت ستون‌ها شامل فیلد نامعتبر سرنخ است.',
      },
    });
  };
}

/**
 * ورودی تأیید و ورود نهایی سرنخ‌ها
 * (POST /enterprise-hub/data-import/crm-leads/commit).
 */
export class CommitImportDto {
  @ApiProperty({ description: 'شناسه بارگذاری بازگشتی از preview' })
  @IsUUID('4', { message: 'شناسه بارگذاری نامعتبر است.' })
  uploadId: string;

  @ApiProperty({
    description: 'نگاشت نهایی ستون‌ها به فیلدهای سرنخ CRM',
    type: Object,
    example: { 'نام مشتری': 'fullName', 'موبایل': 'phone' },
  })
  @IsObject({ message: 'نگاشت ستون‌ها باید یک شیء باشد.' })
  @IsLeadFieldMapping()
  mapping: Record<string, string>;
}
