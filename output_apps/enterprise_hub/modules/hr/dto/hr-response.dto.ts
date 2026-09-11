import { ApiProperty } from '@nestjs/swagger';
import {
  ContractStatus,
  ContractType,
  EmployeeStatus,
  Gender,
  MaritalStatus,
  PayslipStatus,
} from '../enums/hr.enum';

/** DTO خروجی پرونده کارمند */
export class EmployeeResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() employeeNumber: string;
  @ApiProperty() firstName: string;
  @ApiProperty() lastName: string;
  @ApiProperty({ description: 'نام و نام خانوادگی' }) fullName: string;
  @ApiProperty() nationalId: string;
  @ApiProperty({ nullable: true }) fatherName: string | null;
  @ApiProperty({ nullable: true }) birthDate: string | null;
  @ApiProperty({ enum: Gender }) gender: Gender;
  @ApiProperty() mobile: string;
  @ApiProperty({ nullable: true }) email: string | null;
  @ApiProperty() jobTitle: string;
  @ApiProperty() department: string;
  @ApiProperty({ enum: MaritalStatus }) maritalStatus: MaritalStatus;
  @ApiProperty() dependants: number;
  @ApiProperty({ enum: EmployeeStatus }) status: EmployeeStatus;
  @ApiProperty() hireDate: string;
  @ApiProperty({ nullable: true }) terminationDate: string | null;
  @ApiProperty({ nullable: true }) bankAccountNumber: string | null;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
}

/** DTO خروجی قرارداد/حکم حقوقی */
export class ContractResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() contractNumber: string;
  @ApiProperty() employeeId: number;
  @ApiProperty({ description: 'نام و نام خانوادگی کارمند' })
  employeeFullName: string;
  @ApiProperty({ enum: ContractType }) contractType: ContractType;
  @ApiProperty() startDate: string;
  @ApiProperty({ nullable: true }) endDate: string | null;
  @ApiProperty() jobTitle: string;
  @ApiProperty() department: string;
  @ApiProperty() baseSalary: number;
  @ApiProperty() housingAllowance: number;
  @ApiProperty() foodAllowance: number;
  @ApiProperty() childAllowance: number;
  @ApiProperty() insuranceRate: number;
  @ApiProperty() isInsuranceSubject: boolean;
  @ApiProperty({ enum: ContractStatus }) status: ContractStatus;
  @ApiProperty({ nullable: true }) description: string | null;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
}

/** DTO خروجی تفکیک محاسبه حقوق */
export class PayrollCalculationResponseDto {
  @ApiProperty() contractId: number;
  @ApiProperty() employeeId: number;
  @ApiProperty() employeeFullName: string;
  @ApiProperty() baseSalary: number;
  @ApiProperty() housingAllowance: number;
  @ApiProperty() foodAllowance: number;
  @ApiProperty() childAllowance: number;
  @ApiProperty() overtimeAmount: number;
  @ApiProperty({ description: 'جمع حقوق و مزایا (ریال)' }) grossPay: number;
  @ApiProperty({ description: 'کسر بیمه سهم کارگر ۷٪ (ریال)' })
  insuranceDeduction: number;
  @ApiProperty({ description: 'درآمد مشمول مالیات (ریال)' }) taxableIncome: number;
  @ApiProperty({ description: 'مالیات بر حقوق (ریال)' }) incomeTax: number;
  @ApiProperty({ description: 'سایر کسورات (ریال)' }) otherDeductions: number;
  @ApiProperty({ description: 'خالص پرداختی (ریال)' }) netPay: number;
}

/** DTO خروجی فیش حقوقی */
export class PayslipResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() payslipNumber: string;
  @ApiProperty() employeeId: number;
  @ApiProperty() employeeFullName: string;
  @ApiProperty() employeeNumber: string;
  @ApiProperty({ nullable: true }) contractId: number | null;
  @ApiProperty() periodYear: number;
  @ApiProperty() periodMonth: number;
  @ApiProperty() baseSalary: number;
  @ApiProperty() housingAllowance: number;
  @ApiProperty() foodAllowance: number;
  @ApiProperty() childAllowance: number;
  @ApiProperty() overtimeAmount: number;
  @ApiProperty() grossPay: number;
  @ApiProperty() insuranceDeduction: number;
  @ApiProperty() incomeTax: number;
  @ApiProperty() otherDeductions: number;
  @ApiProperty() netPay: number;
  @ApiProperty({ enum: PayslipStatus }) status: PayslipStatus;
  @ApiProperty({ nullable: true }) journalEntryId: number | null;
  @ApiProperty({
    nullable: true,
    description: 'شماره سند خودکار هزینه حقوق در دفتر روزنامه',
  })
  journalEntryNumber: string | null;
  @ApiProperty() issuedAt: string;
  @ApiProperty() createdAt: string;
}

/** DTO صفحه‌بندی‌شده پرسنل */
export class PaginatedEmployeeResponseDto {
  @ApiProperty({ type: [EmployeeResponseDto] })
  data: EmployeeResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}

/** DTO صفحه‌بندی‌شده فیش‌های حقوقی */
export class PaginatedPayslipResponseDto {
  @ApiProperty({ type: [PayslipResponseDto] })
  data: PayslipResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}

/** DTO آمار تحلیلی منابع انسانی */
export class HrStatsResponseDto {
  @ApiProperty({ description: 'کل پرسنل' }) totalEmployees: number;
  @ApiProperty({ description: 'پرسنل شاغل' }) activeEmployees: number;
  @ApiProperty({ description: 'پرسنل در مرخصی بدون حقوق' }) onLeaveEmployees: number;
  @ApiProperty({ description: 'پرسنل پایان همکاری' }) terminatedEmployees: number;
  @ApiProperty({ description: 'قراردادهای فعال' }) activeContracts: number;
  @ApiProperty({ description: 'جمع حقوق پایه ماهانه قراردادهای فعال (ریال)' })
  totalBaseSalary: number;
  @ApiProperty({ description: 'جمع کل حقوق و مزایای فیش‌های صادرشده (ریال)' })
  totalGrossPay: number;
  @ApiProperty({ description: 'جمع کل خالص پرداختی فیش‌ها (ریال)' }) totalNetPay: number;
  @ApiProperty({ description: 'جمع کل بیمه و مالیات کسرشده (ریال)' }) totalDeductions: number;
  @ApiProperty({ description: 'تعداد فیش‌های حقوقی صادرشده' }) totalPayslips: number;
  @ApiProperty({ description: 'میانگین خالص پرداختی هر فیش (ریال)' }) averageNetPay: number;
}
