import { PartialType } from '@nestjs/swagger';
import { CreateInvoiceDto } from './create-invoice.dto';

/**
 * DTO ویرایش صورتحساب (PATCH /enterprise-hub/invoicing/:id).
 *
 * همه فیلدها اختیاری‌اند؛ در صورت ارسال `items`، مالیات و جمع‌بندی دوباره
 * به‌صورت سمت سرور محاسبه می‌شود و نرخ VAT هر سطر روی همان سطر ذخیره می‌ماند.
 */
export class UpdateInvoiceDto extends PartialType(CreateInvoiceDto) {}
