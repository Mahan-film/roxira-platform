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

/**
 * Monthly payroll run status. DRAFT: recalculable; POSTED: journal entry
 * created in accounting, payslips frozen.
 */
export enum PayrollRunStatus {
  DRAFT = 'DRAFT',
  POSTED = 'POSTED',
}

/**
 * How an allowance enters wage tax. PROGRESSIVE: joins cumulative taxable income; FLAT: taxed at
 * the flat statutory rate; EXEMPT: untaxed; NON_CASH: exempt up to the annual ceiling, the excess
 * joins taxable income.
 */
export enum AllowanceTaxTreatment {
  PROGRESSIVE = 'PROGRESSIVE',
  FLAT = 'FLAT',
  EXEMPT = 'EXEMPT',
  NON_CASH = 'NON_CASH',
}

/** STANDARD: progressive brackets. FLAT: flat rate above the exemption (faculty, judges). */
export enum WageTaxRegime {
  STANDARD = 'STANDARD',
  FLAT = 'FLAT',
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

/** انواع مرخصی طبق قانون کار */
export enum LeaveType {
  ANNUAL = 'ANNUAL',
  UNPAID = 'UNPAID',
  SICK = 'SICK',
  SPECIAL = 'SPECIAL',
}

/** وضعیت درخواست مرخصی */
export enum LeaveStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

/** وضعیت وام پرسنلی */
export enum LoanStatus {
  ACTIVE = 'ACTIVE',
  PAID_OFF = 'PAID_OFF',
  CANCELLED = 'CANCELLED',
}

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  [LeaveType.ANNUAL]: 'استحقاقی',
  [LeaveType.UNPAID]: 'بدون حقوق',
  [LeaveType.SICK]: 'استعلاجی',
  [LeaveType.SPECIAL]: 'مناسبتی (ازدواج/فوت)',
};

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  [LeaveStatus.PENDING]: 'در انتظار بررسی',
  [LeaveStatus.APPROVED]: 'تأییدشده',
  [LeaveStatus.REJECTED]: 'ردشده',
};

export const LOAN_STATUS_LABELS: Record<LoanStatus, string> = {
  [LoanStatus.ACTIVE]: 'جاری',
  [LoanStatus.PAID_OFF]: 'تسویه‌شده',
  [LoanStatus.CANCELLED]: 'لغوشده',
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

export const PAYROLL_RUN_STATUS_LABELS: Record<PayrollRunStatus, string> = {
  [PayrollRunStatus.DRAFT]: 'پیش‌نویس',
  [PayrollRunStatus.POSTED]: 'ثبت‌شده در حسابداری',
};
