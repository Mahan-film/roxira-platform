"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2Icon, FileSignature, Loader2Icon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createContract } from "@/lib/api/hr-client";
import { ApiClientError } from "@/lib/api/http-client";
import {
  CONTRACT_TYPE_LABELS,
  ContractType,
  type Employee,
  type EmploymentContract,
} from "@/types/hr";

interface ContractFormProps {
  employee: Employee;
  onCreated?: (contract: EmploymentContract) => void;
}

/**
 * فرم تعریف حکم/قرارداد حقوقی برای کارمند انتخاب‌شده
 * (`POST /enterprise-hub/hr/contracts`).
 */
export function ContractForm({ employee, onCreated }: ContractFormProps) {
  const [contractType, setContractType] = useState<ContractType>(
    ContractType.PERMANENT,
  );
  const [startDate, setStartDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [endDate, setEndDate] = useState("");
  const [baseSalary, setBaseSalary] = useState("");
  const [housingAllowance, setHousingAllowance] = useState("9000000");
  const [foodAllowance, setFoodAllowance] = useState("11000000");
  const [childAllowance, setChildAllowance] = useState("0");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  function validate(): string[] {
    const messages: string[] = [];
    if (!baseSalary.trim() || Number(baseSalary) <= 0) {
      messages.push("حقوق پایه باید بزرگ‌تر از صفر باشد.");
    }
    if (!startDate) {
      messages.push("تاریخ شروع قرارداد الزامی است.");
    }
    return messages;
  }

  async function submit() {
    setErrors(null);
    setSuccessMessage(null);

    const validationErrors = validate();
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      const contract = await createContract({
        employeeId: employee.id,
        contractType,
        startDate,
        endDate: endDate || undefined,
        baseSalary: Number(baseSalary),
        housingAllowance: Number(housingAllowance) || 0,
        foodAllowance: Number(foodAllowance) || 0,
        childAllowance: Number(childAllowance) || 0,
      });

      setSuccessMessage(
        `قرارداد ${contract.contractNumber} برای «${employee.fullName}» ثبت شد.`,
      );
      onCreated?.(contract);
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrors(error.details);
      } else {
        setErrors([
          "ارتباط با سرور برقرار نشد. لطفاً چند لحظه بعد دوباره تلاش کنید.",
        ]);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSignature className="size-4 text-violet-500" />
          تعریف حکم حقوقی برای {employee.fullName}
        </CardTitle>
        <CardDescription>
          این کارمند قرارداد فعالی ندارد؛ برای محاسبه و صدور فیش حقوقی، ابتدا
          اجزای حقوق را تعریف کنید.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="grid gap-2">
              <Label>نوع قرارداد</Label>
              <Select<ContractType>
                value={contractType}
                onValueChange={(value) =>
                  setContractType(value ?? ContractType.PERMANENT)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="انتخاب نوع" />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(ContractType).map((item) => (
                    <SelectItem key={item} value={item}>
                      {CONTRACT_TYPE_LABELS[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ct-start">تاریخ شروع</Label>
              <Input
                id="ct-start"
                type="date"
                dir="ltr"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ct-end">تاریخ پایان (اختیاری)</Label>
              <Input
                id="ct-end"
                type="date"
                dir="ltr"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ct-base">حقوق پایه (ریال)</Label>
              <Input
                id="ct-base"
                inputMode="numeric"
                value={baseSalary}
                placeholder="104000000"
                onChange={(event) => setBaseSalary(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ct-housing">حق مسکن (ریال)</Label>
              <Input
                id="ct-housing"
                inputMode="numeric"
                value={housingAllowance}
                onChange={(event) => setHousingAllowance(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ct-food">بن خواربار (ریال)</Label>
              <Input
                id="ct-food"
                inputMode="numeric"
                value={foodAllowance}
                onChange={(event) => setFoodAllowance(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ct-child">حق اولاد (ریال)</Label>
              <Input
                id="ct-child"
                inputMode="numeric"
                value={childAllowance}
                onChange={(event) => setChildAllowance(event.target.value)}
              />
            </div>
          </div>

          {errors && (
            <Alert variant="destructive">
              <AlertTitle>خطا در تعریف قرارداد</AlertTitle>
              <AlertDescription>
                <ul className="list-inside list-disc">
                  {errors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {successMessage && (
            <Alert>
              <CheckCircle2Icon className="size-4 text-emerald-500" />
              <AlertTitle>قرارداد ثبت شد</AlertTitle>
              <AlertDescription>{successMessage}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" disabled={isSubmitting} className="self-start">
            {isSubmitting ? (
              <>
                <Loader2Icon className="animate-spin" />
                در حال ثبت...
              </>
            ) : (
              <>
                <FileSignature />
                ثبت قرارداد
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
