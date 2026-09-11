/**
 * انواع شمارشی ماژول منابع انسانی و حقوق و دستمزد (HR & Payroll).
 *
 * این مقادیر در ستون‌های varchar جداول `hr_employees`،
 * `hr_employment_contracts` و `hr_payslips` ذخیره می‌شوند تا نگاشت آن‌ها
 * ساده و بدون وابستگی به نوع enum پایگاه‌داده بماند.
 */

/** جنسیت کارمند */
export enum Gender {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
}

/** وضعیت تأهل کارمند */
export enum MaritalStatus {
  SINGLE = 'SINGLE',
  MARRIED = 'MARRIED',
}

/**
 * وضعیت استخدامی کارمند در چرخه عمر کارگزینی.
 *
 * ACTIVE: شاغل؛ ON_LEAVE: مرخصی بدون حقوق؛ TERMINATED: پایان همکاری.
 */
export enum EmployeeStatus {
  ACTIVE = 'ACTIVE',
  ON_LEAVE = 'ON_LEAVE',
  TERMINATED = 'TERMINATED',
}

/** نوع قرارداد کار */
export enum ContractType {
  PERMANENT = 'PERMANENT',
  FIXED_TERM = 'FIXED_TERM',
  PROBATION = 'PROBATION',
  PART_TIME = 'PART_TIME',
}

/** وضعیت اعتبار قرارداد کار */
export enum ContractStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  ENDED = 'ENDED',
}

/**
 * وضعیت فیش حقوقی.
 *
 * DRAFT: پیش‌نویس؛ ISSUED: صادرشده (سند حسابداری نیز ثبت شده)؛
 * PAID: پرداخت‌شده به کارمند.
 */
export enum PayslipStatus {
  DRAFT = 'DRAFT',
  ISSUED = 'ISSUED',
  PAID = 'PAID',
}

/** برچسب‌های فارسی انواع شمارشی جهت پاسخ‌های API و UI */
export const GENDER_LABELS: Record<Gender, string> = {
  [Gender.MALE]: 'مرد',
  [Gender.FEMALE]: 'زن',
};

export const MARITAL_STATUS_LABELS: Record<MaritalStatus, string> = {
  [MaritalStatus.SINGLE]: 'مجرد',
  [MaritalStatus.MARRIED]: 'متأهل',
};

export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  [EmployeeStatus.ACTIVE]: 'شاغل',
  [EmployeeStatus.ON_LEAVE]: 'مرخصی بدون حقوق',
  [EmployeeStatus.TERMINATED]: 'پایان همکاری',
};

export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  [ContractType.PERMANENT]: 'دائم',
  [ContractType.FIXED_TERM]: 'مدت معین',
  [ContractType.PROBATION]: 'آزمایشی',
  [ContractType.PART_TIME]: 'پاره‌وقت',
};

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  [ContractStatus.ACTIVE]: 'فعال',
  [ContractStatus.SUSPENDED]: 'معلق',
  [ContractStatus.ENDED]: 'خاتمه‌یافته',
};

export const PAYSLIP_STATUS_LABELS: Record<PayslipStatus, string> = {
  [PayslipStatus.DRAFT]: 'پیش‌نویس',
  [PayslipStatus.ISSUED]: 'صادرشده',
  [PayslipStatus.PAID]: 'پرداخت‌شده',
};
