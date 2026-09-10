/**
 * اعتبارسنجی سمت کلاینت - دقیقاً منطبق با قواعد class-validator تعریف‌شده
 * در `CreateDamageCalculationDto` (بک‌اند NestJS). این اعتبارسنجی صرفاً
 * برای تجربه کاربری سریع‌تر است؛ اعتبارسنجی نهایی و معتبر همیشه در
 * سمت سرور (ValidationPipe) انجام می‌شود.
 */
import { DamageCalculationMethod } from "@/types/damages";

export interface DamageCalculationFormValues {
  principalAmount: string;
  dueDate: string;
  paymentDate: string;
  calculationMethod: DamageCalculationMethod;
  cpiIndexAtDueDate: string;
  cpiIndexAtPaymentDate: string;
  annualInterestRate: string;
  contractReferenceNumber: string;
}

export type DamageCalculationFormErrors = Partial<
  Record<keyof DamageCalculationFormValues, string>
>;

export const INITIAL_DAMAGE_CALCULATION_FORM_VALUES: DamageCalculationFormValues =
  {
    principalAmount: "",
    dueDate: "",
    paymentDate: "",
    calculationMethod: DamageCalculationMethod.CPI_INDEX,
    cpiIndexAtDueDate: "",
    cpiIndexAtPaymentDate: "",
    annualInterestRate: "",
    contractReferenceNumber: "",
  };

function isPositiveNumberWithMaxTwoDecimals(value: number): boolean {
  if (!Number.isFinite(value) || value <= 0) return false;
  const decimalPart = value.toString().split(".")[1];
  return !decimalPart || decimalPart.length <= 2;
}

/**
 * اعتبارسنجی مقادیر فرم و بازگرداندن هم خطاها و هم DTO نرمال‌شده
 * (در صورت معتبر بودن) که مستقیماً قابل ارسال به بک‌اند است.
 */
export function validateDamageCalculationForm(
  values: DamageCalculationFormValues,
): {
  errors: DamageCalculationFormErrors;
  isValid: boolean;
} {
  const errors: DamageCalculationFormErrors = {};

  const principalAmount = Number(values.principalAmount);
  if (!values.principalAmount) {
    errors.principalAmount = "اصل مبلغ بدهی الزامی است.";
  } else if (!isPositiveNumberWithMaxTwoDecimals(principalAmount)) {
    errors.principalAmount =
      "اصل مبلغ باید عددی مثبت با حداکثر ۲ رقم اعشار باشد.";
  }

  if (!values.dueDate) {
    errors.dueDate = "تاریخ سررسید الزامی است.";
  }

  if (!values.paymentDate) {
    errors.paymentDate = "تاریخ پرداخت الزامی است.";
  }

  if (
    values.dueDate &&
    values.paymentDate &&
    new Date(values.paymentDate).getTime() < new Date(values.dueDate).getTime()
  ) {
    errors.paymentDate = "تاریخ پرداخت نمی‌تواند قبل از تاریخ سررسید باشد.";
  }

  if (values.calculationMethod === DamageCalculationMethod.CPI_INDEX) {
    const dueIndex = Number(values.cpiIndexAtDueDate);
    const paymentIndex = Number(values.cpiIndexAtPaymentDate);

    if (!values.cpiIndexAtDueDate || !(dueIndex > 0)) {
      errors.cpiIndexAtDueDate =
        "شاخص بانک مرکزی در تاریخ سررسید الزامی و باید مثبت باشد.";
    }
    if (!values.cpiIndexAtPaymentDate || !(paymentIndex > 0)) {
      errors.cpiIndexAtPaymentDate =
        "شاخص بانک مرکزی در تاریخ پرداخت الزامی و باید مثبت باشد.";
    }
  }

  if (values.calculationMethod === DamageCalculationMethod.ANNUAL_RATE) {
    const rate = Number(values.annualInterestRate);
    if (
      values.annualInterestRate === "" ||
      Number.isNaN(rate) ||
      rate < 0 ||
      rate > 100
    ) {
      errors.annualInterestRate = "نرخ سود سالانه باید بین ۰ تا ۱۰۰ درصد باشد.";
    }
  }

  if (values.contractReferenceNumber.length > 64) {
    errors.contractReferenceNumber =
      "شماره قرارداد/فاکتور نباید بیش از ۶۴ کاراکتر باشد.";
  }

  return { errors, isValid: Object.keys(errors).length === 0 };
}
