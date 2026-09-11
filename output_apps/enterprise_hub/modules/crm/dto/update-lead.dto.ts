import { PartialType } from '@nestjs/swagger';
import { CreateLeadDto } from './create-lead.dto';

/**
 * DTO ویرایش اطلاعات سرنخ
 * (PATCH /enterprise-hub/crm/leads/:id).
 *
 * تمام فیلدها اختیاری‌اند؛ فقط فیلدهای ارسال‌شده به‌روزرسانی می‌شوند.
 */
export class UpdateLeadDto extends PartialType(CreateLeadDto) {}
