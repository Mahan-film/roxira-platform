import { PartialType } from '@nestjs/swagger';
import { CreateEmployeeDto } from './create-employee.dto';

/**
 * DTO ویرایش پرونده کارمند (PATCH /enterprise-hub/hr/employees/:id).
 * تمام فیلدها اختیاری هستند؛ تنها فیلدهای ارسال‌شده تغییر می‌کنند.
 */
export class UpdateEmployeeDto extends PartialType(CreateEmployeeDto) {}
