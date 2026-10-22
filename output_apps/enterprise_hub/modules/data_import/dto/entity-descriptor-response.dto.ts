import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** توصیف یک فیلد قابل نگاشت در پاسخ `GET /entities`. */
export class EntityFieldDescriptorDto {
  @ApiProperty({ description: 'شناسه فیلد' })
  key: string;

  @ApiProperty({ description: 'برچسب فارسی' })
  labelFa: string;

  @ApiProperty({ description: 'آیا فیلد اجباری است؟' })
  required: boolean;

  @ApiProperty({
    description: 'نوع داده فیلد',
    enum: [
      'text',
      'number',
      'date',
      'phone',
      'email',
      'money',
      'national_id',
      'enum',
    ],
  })
  type: string;

  @ApiPropertyOptional({ description: 'مقادیر مجاز فیلد enum', type: [String] })
  enumValues?: readonly string[];
}

/** توصیف یک موجودیت قابل ورود در پاسخ `GET /entities`. */
export class EntityDescriptorDto {
  @ApiProperty({ description: 'کلید موجودیت' })
  key: string;

  @ApiProperty({ description: 'برچسب فارسی' })
  labelFa: string;

  @ApiProperty({ type: [EntityFieldDescriptorDto] })
  fields: EntityFieldDescriptorDto[];
}

/** خطای یک فیلد در یک ردیف فایل. */
export class ImportRowFieldErrorDto {
  @ApiProperty({ description: 'شماره ردیف فایل (سربرگ = ۱)' })
  row: number;

  @ApiProperty({ description: 'شناسه فیلد' })
  field: string;

  @ApiProperty({ description: 'پیام خطا' })
  message: string;
}
