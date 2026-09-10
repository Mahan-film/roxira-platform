"use client";

import { useId, useState, type FormEvent } from "react";
import { Loader2Icon, SendHorizonalIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import { createDamageCalculation } from "@/lib/api/damages-client";
import { ApiClientError } from "@/lib/api/http-client";
import {
  INITIAL_DAMAGE_CALCULATION_FORM_VALUES,
  validateDamageCalculationForm,
  type DamageCalculationFormErrors,
  type DamageCalculationFormValues,
} from "@/lib/validation/damage-calculation-validation";
import {
  DAMAGE_CALCULATION_METHOD_LABELS,
  DamageCalculationMethod,
  type CreateDamageCalculationDto,
  type DamageCalculationResponseDto,
} from "@/types/damages";

interface DamageCalculationFormProps {
  onCalculated: (result: DamageCalculationResponseDto) => void;
}

/**
 * فرم محاسبه خسارت تاخیر تادیه.
 *
 * این کامپوننت مستقیماً به اندپوینت `POST /enterprise-hub/damages`
 * (DamagesController.create) از طریق کلاینت تایپ‌سیف
 * `createDamageCalculation` متصل می‌شود و ورودی‌ها را دقیقاً منطبق
 * با `CreateDamageCalculationDto` بک‌اند اعتبارسنجی و ارسال می‌کند.
 */
export function DamageCalculationForm({
  onCalculated,
}: DamageCalculationFormProps) {
  const formId = useId();
  const [values, setValues] = useState<DamageCalculationFormValues>(
    INITIAL_DAMAGE_CALCULATION_FORM_VALUES,
  );
  const [errors, setErrors] = useState<DamageCalculationFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string[] | null>(null);

  function updateField<K extends keyof DamageCalculationFormValues>(
    field: K,
    value: DamageCalculationFormValues[K],
  ) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);

    const { errors: validationErrors, isValid } =
      validateDamageCalculationForm(values);
    setErrors(validationErrors);

    if (!isValid) return;

    const dto: CreateDamageCalculationDto = {
      principalAmount: Number(values.principalAmount),
      dueDate: values.dueDate,
      paymentDate: values.paymentDate,
      calculationMethod: values.calculationMethod,
      ...(values.calculationMethod === DamageCalculationMethod.CPI_INDEX
        ? {
            cpiIndexAtDueDate: Number(values.cpiIndexAtDueDate),
            cpiIndexAtPaymentDate: Number(values.cpiIndexAtPaymentDate),
          }
        : {}),
      ...(values.calculationMethod === DamageCalculationMethod.ANNUAL_RATE
        ? { annualInterestRate: Number(values.annualInterestRate) }
        : {}),
      ...(values.contractReferenceNumber
        ? { contractReferenceNumber: values.contractReferenceNumber }
        : {}),
    };

    setIsSubmitting(true);
    try {
      const result = await createDamageCalculation(dto);
      onCalculated(result);
    } catch (error) {
      if (error instanceof ApiClientError) {
        setSubmitError(error.details);
      } else {
        setSubmitError([
          "ارتباط با سرور برقرار نشد. لطفاً چند لحظه بعد دوباره تلاش کنید.",
        ]);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  const isCpiMethod = values.calculationMethod === DamageCalculationMethod.CPI_INDEX;
  const isAnnualRateMethod =
    values.calculationMethod === DamageCalculationMethod.ANNUAL_RATE;

  return (
    <Card>
      <CardHeader>
        <CardTitle>محاسبه خسارت تاخیر تادیه</CardTitle>
        <CardDescription>
          محاسبه فوری خسارت تاخیر تادیه بر اساس شاخص بانک مرکزی (ماده ۵۲۲
          قانون آیین دادرسی مدنی) یا نرخ سود سالانه قراردادی.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          id={formId}
          onSubmit={handleSubmit}
          className="flex flex-col gap-5"
          noValidate
        >
          <div className="grid gap-2">
            <Label htmlFor="principalAmount">اصل مبلغ بدهی (ریال)</Label>
            <Input
              id="principalAmount"
              inputMode="decimal"
              placeholder="۵۰۰۰۰۰۰۰۰"
              value={values.principalAmount}
              onChange={(event) =>
                updateField("principalAmount", event.target.value)
              }
              aria-invalid={Boolean(errors.principalAmount)}
            />
            {errors.principalAmount && (
              <p className="text-sm text-destructive">
                {errors.principalAmount}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="dueDate">تاریخ سررسید</Label>
              <Input
                id="dueDate"
                type="date"
                value={values.dueDate}
                onChange={(event) => updateField("dueDate", event.target.value)}
                aria-invalid={Boolean(errors.dueDate)}
              />
              {errors.dueDate && (
                <p className="text-sm text-destructive">{errors.dueDate}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="paymentDate">تاریخ پرداخت</Label>
              <Input
                id="paymentDate"
                type="date"
                value={values.paymentDate}
                onChange={(event) =>
                  updateField("paymentDate", event.target.value)
                }
                aria-invalid={Boolean(errors.paymentDate)}
              />
              {errors.paymentDate && (
                <p className="text-sm text-destructive">
                  {errors.paymentDate}
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="calculationMethod">روش محاسبه</Label>
            <Select
              value={values.calculationMethod}
              onValueChange={(value) =>
                updateField(
                  "calculationMethod",
                  value as DamageCalculationMethod,
                )
              }
            >
              <SelectTrigger id="calculationMethod" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(DamageCalculationMethod).map((method) => (
                  <SelectItem key={method} value={method}>
                    {DAMAGE_CALCULATION_METHOD_LABELS[method]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isCpiMethod && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="cpiIndexAtDueDate">
                  شاخص بانک مرکزی در تاریخ سررسید
                </Label>
                <Input
                  id="cpiIndexAtDueDate"
                  inputMode="decimal"
                  placeholder="۱۸۵٫۴"
                  value={values.cpiIndexAtDueDate}
                  onChange={(event) =>
                    updateField("cpiIndexAtDueDate", event.target.value)
                  }
                  aria-invalid={Boolean(errors.cpiIndexAtDueDate)}
                />
                {errors.cpiIndexAtDueDate && (
                  <p className="text-sm text-destructive">
                    {errors.cpiIndexAtDueDate}
                  </p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="cpiIndexAtPaymentDate">
                  شاخص بانک مرکزی در تاریخ پرداخت
                </Label>
                <Input
                  id="cpiIndexAtPaymentDate"
                  inputMode="decimal"
                  placeholder="۲۳۱٫۹"
                  value={values.cpiIndexAtPaymentDate}
                  onChange={(event) =>
                    updateField("cpiIndexAtPaymentDate", event.target.value)
                  }
                  aria-invalid={Boolean(errors.cpiIndexAtPaymentDate)}
                />
                {errors.cpiIndexAtPaymentDate && (
                  <p className="text-sm text-destructive">
                    {errors.cpiIndexAtPaymentDate}
                  </p>
                )}
              </div>
            </div>
          )}

          {isAnnualRateMethod && (
            <div className="grid gap-2">
              <Label htmlFor="annualInterestRate">
                نرخ سود سالانه قراردادی (درصد)
              </Label>
              <Input
                id="annualInterestRate"
                inputMode="decimal"
                placeholder="۱۸"
                value={values.annualInterestRate}
                onChange={(event) =>
                  updateField("annualInterestRate", event.target.value)
                }
                aria-invalid={Boolean(errors.annualInterestRate)}
              />
              {errors.annualInterestRate && (
                <p className="text-sm text-destructive">
                  {errors.annualInterestRate}
                </p>
              )}
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="contractReferenceNumber">
              شماره قرارداد/فاکتور مرجع (اختیاری)
            </Label>
            <Input
              id="contractReferenceNumber"
              placeholder="INV-2024-00231"
              maxLength={64}
              value={values.contractReferenceNumber}
              onChange={(event) =>
                updateField("contractReferenceNumber", event.target.value)
              }
              aria-invalid={Boolean(errors.contractReferenceNumber)}
            />
            {errors.contractReferenceNumber && (
              <p className="text-sm text-destructive">
                {errors.contractReferenceNumber}
              </p>
            )}
          </div>

          {submitError && (
            <Alert variant="destructive">
              <AlertTitle>خطا در محاسبه خسارت</AlertTitle>
              <AlertDescription>
                <ul className="list-inside list-disc">
                  {submitError.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <Button type="submit" disabled={isSubmitting} className="mt-2">
            {isSubmitting ? (
              <>
                <Loader2Icon className="animate-spin" />
                در حال محاسبه...
              </>
            ) : (
              <>
                <SendHorizonalIcon />
                محاسبه خسارت تاخیر تادیه
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
