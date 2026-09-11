/**
 * تایپ‌های مشترک ماژول منابع انسانی و حقوق و دستمزد (HR & Payroll).
 * این تایپ‌ها دقیقاً منطبق بر DTOهای Swagger بک‌اند NestJS در
 * `modules/hr/dto` هستند (Contract-First Synchronization — Rule #4).
 */

export enum Gender {
  MALE = "MALE",
  FEMALE = "FEMALE",
}

export const GENDER_LABELS: Record<Gender, string> = {
  [Gender.MALE]: "مرد",
  [Gender.FEMALE]: "زن",
};

export enum MaritalStatus {
  SINGLE = "SINGLE",
  MARRIED = "MARRIED",
}

export const MARITAL_STATUS_LABELS: Record<MaritalStatus, string> = {
  [MaritalStatus.SINGLE]: "مجرد",
  [MaritalStatus.MARRIED]: "متأهل",
};

export enum EmployeeStatus {
  ACTIVE = "ACTIVE",
  ON_LEAVE = "ON_LEAVE",
  TERMINATED = "TERMINATED",
}

export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  [EmployeeStatus.ACTIVE]: "شاغل",
  [EmployeeStatus.ON_LEAVE]: "مرخصی بدون حقوق",
  [EmployeeStatus.TERMINATED]: "پایان همکاری",
};

export enum ContractType {
  PERMANENT = "PERMANENT",
  FIXED_TERM = "FIXED_TERM",
  PROBATION = "PROBATION",
  PART_TIME = "PART_TIME",
}

export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  [ContractType.PERMANENT]: "دائم",
  [ContractType.FIXED_TERM]: "مدت معین",
  [ContractType.PROBATION]: "آزمایشی",
  [ContractType.PART_TIME]: "پاره‌وقت",
};

export enum ContractStatus {
  ACTIVE = "ACTIVE",
  SUSPENDED = "SUSPENDED",
  ENDED = "ENDED",
}

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  [ContractStatus.ACTIVE]: "فعال",
  [ContractStatus.SUSPENDED]: "معلق",
  [ContractStatus.ENDED]: "خاتمه‌یافته",
};

export enum PayslipStatus {
  DRAFT = "DRAFT",
  ISSUED = "ISSUED",
  PAID = "PAID",
}

export const PAYSLIP_STATUS_LABELS: Record<PayslipStatus, string> = {
  [PayslipStatus.DRAFT]: "پیش‌نویس",
  [PayslipStatus.ISSUED]: "صادرشده",
  [PayslipStatus.PAID]: "پرداخت‌شده",
};

export interface Employee {
  id: number;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  fullName: string;
  nationalId: string;
  fatherName: string | null;
  birthDate: string | null;
  gender: Gender;
  mobile: string;
  email: string | null;
  jobTitle: string;
  department: string;
  maritalStatus: MaritalStatus;
  dependants: number;
  status: EmployeeStatus;
  hireDate: string;
  terminationDate: string | null;
  bankAccountNumber: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEmployeeDto {
  employeeNumber?: string;
  firstName: string;
  lastName: string;
  nationalId: string;
  fatherName?: string;
  birthDate?: string;
  gender?: Gender;
  mobile: string;
  email?: string;
  jobTitle: string;
  department: string;
  maritalStatus?: MaritalStatus;
  dependants?: number;
  hireDate?: string;
  bankAccountNumber?: string;
}

export interface EmploymentContract {
  id: number;
  contractNumber: string;
  employeeId: number;
  employeeFullName: string;
  contractType: ContractType;
  startDate: string;
  endDate: string | null;
  jobTitle: string;
  department: string;
  baseSalary: number;
  housingAllowance: number;
  foodAllowance: number;
  childAllowance: number;
  insuranceRate: number;
  isInsuranceSubject: boolean;
  status: ContractStatus;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateContractDto {
  employeeId: number;
  contractNumber?: string;
  contractType?: ContractType;
  startDate: string;
  endDate?: string;
  jobTitle?: string;
  department?: string;
  baseSalary: number;
  housingAllowance?: number;
  foodAllowance?: number;
  childAllowance?: number;
  insuranceRate?: number;
  isInsuranceSubject?: boolean;
  description?: string;
}

export interface PayrollCalculation {
  contractId: number;
  employeeId: number;
  employeeFullName: string;
  baseSalary: number;
  housingAllowance: number;
  foodAllowance: number;
  childAllowance: number;
  overtimeAmount: number;
  grossPay: number;
  insuranceDeduction: number;
  taxableIncome: number;
  incomeTax: number;
  otherDeductions: number;
  netPay: number;
}

export interface Payslip {
  id: number;
  payslipNumber: string;
  employeeId: number;
  employeeFullName: string;
  employeeNumber: string;
  contractId: number | null;
  periodYear: number;
  periodMonth: number;
  baseSalary: number;
  housingAllowance: number;
  foodAllowance: number;
  childAllowance: number;
  overtimeAmount: number;
  grossPay: number;
  insuranceDeduction: number;
  incomeTax: number;
  otherDeductions: number;
  netPay: number;
  status: PayslipStatus;
  journalEntryId: number | null;
  journalEntryNumber: string | null;
  issuedAt: string;
  createdAt: string;
}

export interface CalculatePayrollDto {
  contractId?: number;
  employeeId?: number;
  overtimeAmount?: number;
  otherDeductions?: number;
}

export interface IssuePayslipDto extends CalculatePayrollDto {
  periodYear: number;
  periodMonth: number;
}

export interface QueryEmployeeDto {
  page?: number;
  limit?: number;
  search?: string;
  status?: EmployeeStatus;
  department?: string;
}

export interface QueryPayslipDto {
  page?: number;
  limit?: number;
  employeeId?: number;
  periodYear?: number;
  periodMonth?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface HrStats {
  totalEmployees: number;
  activeEmployees: number;
  onLeaveEmployees: number;
  terminatedEmployees: number;
  activeContracts: number;
  totalBaseSalary: number;
  totalGrossPay: number;
  totalNetPay: number;
  totalDeductions: number;
  totalPayslips: number;
  averageNetPay: number;
}
