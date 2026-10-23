import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountingModule } from '../accounting/accounting.module';
import { HrController } from './controllers/hr.controller';
import { EmployeeEntity } from './entities/employee.entity';
import { EmploymentContractEntity } from './entities/employment-contract.entity';
import { PayrollRunEntity } from './entities/payroll-run.entity';
import { PayslipEntity } from './entities/payslip.entity';
import { HrRepository } from './repositories/hr.repository';
import { HrService } from './services/hr.service';
import { PayrollRunService } from './services/payroll-run.service';

/**
 * ماژول جامع منابع انسانی و حقوق و دستمزد (HR & Payroll).
 *
 * Layer Boundaries (طبق AGENTS.md):
 * - Controller: فقط مسیریابی HTTP + اعتبارسنجی DTO.
 * - Service: منطق کسب‌وکار (کارگزینی، محاسبه حقوق، مالیات پله‌ای، صدور
 *   فیش و هماهنگی ثبت سند خودکار).
 * - Repository: تنها لایه با دسترسی مستقیم به جداول HR.
 *
 * جداول متصل: `hr_employees`، `hr_employment_contracts`، `hr_payslips` و
 * `hr_payroll_runs` (اجرای ماهانه حقوق).
 * برای ثبت سند هزینه حقوق در دفتر روزنامه، `AccountingModule` (که
 * `AccountingService` را export می‌کند) import می‌شود؛ این وابستگی یک‌طرفه
 * است و هیچ چرخه‌ای ایجاد نمی‌کند (Rule #1 - AGENTS.md).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      EmployeeEntity,
      EmploymentContractEntity,
      PayslipEntity,
      PayrollRunEntity,
    ]),
    AccountingModule,
  ],
  controllers: [HrController],
  providers: [HrService, PayrollRunService, HrRepository],
  exports: [HrService],
})
export class HrModule {}