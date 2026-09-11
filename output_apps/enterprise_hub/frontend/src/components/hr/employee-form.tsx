"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2Icon, Loader2Icon, UserPlus } from "lucide-react";

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
import { createEmployee } from "@/lib/api/hr-client";
import { ApiClientError } from "@/lib/api/http-client";
import {
  Gender,
  GENDER_LABELS,
  MaritalStatus,
  MARITAL_STATUS_LABELS,
  type Employee,
} from "@/types/hr";

interface EmployeeFormProps {
  onCreated?: (employee: Employee) => void;
}

/**
 * فرم ثبت پرسنل جدید متصل به
 * `POST /enterprise-hub/hr/employees`.
 */
export function EmployeeForm({ onCreated }: EmployeeFormProps) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [mobile, setMobile] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [department, setDepartment] = useState("منابع انسانی");
  const [hireDate, setHireDate] = useState("");
  const [gender, setGender] = useState<Gender>(Gender.MALE);
  const [maritalStatus, setMaritalStatus] = useState<MaritalStatus>(
    MaritalStatus.SINGLE,
  );
  const [dependants, setDependants] = useState("0");
  const [email, setEmail] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  function validate(): string[] {
    const messages: string[] = [];
    if (firstName.trim().length < 2) {
      messages.push("نام باید حداقل ۲ نویسه باشد.");
    }
    if (lastName.trim().length < 2) {
      messages.push("نام خانوادگی باید حداقل ۲ نویسه باشد.");
    }
    if (!/^[0-9]{10}$/.test(nationalId.trim())) {
      messages.push("کد ملی باید دقیقاً ۱۰ رقم باشد.");
    }
    if (!/^0?9[0-9]{9}$/.test(mobile.trim())) {
      messages.push("شماره همراه باید با 09 شروع شده و ۱۱ رقم باشد.");
    }
    if (jobTitle.trim().length < 2) {
      messages.push("عنوان شغلی را وارد کنید.");
    }
    if (department.trim().length < 2) {
      messages.push("واحد سازمانی را وارد کنید.");
    }
    return messages;
  }

  function resetForm() {
    setFirstName("");
    setLastName("");
    setNationalId("");
    setMobile("");
    setJobTitle("");
    setGender(Gender.MALE);
    setMaritalStatus(MaritalStatus.SINGLE);
    setDependants("0");
    setEmail("");
    setBankAccountNumber("");
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
      const employee = await createEmployee({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        nationalId: nationalId.trim(),
        mobile: mobile.trim(),
        jobTitle: jobTitle.trim(),
        department: department.trim(),
        gender,
        maritalStatus,
        dependants: Number(dependants) || 0,
        hireDate: hireDate || undefined,
        email: email.trim() || undefined,
        bankAccountNumber: bankAccountNumber.trim() || undefined,
      });

      setSuccessMessage(
        `پرسنل «${employee.fullName}» با کد پرسنلی ${employee.employeeNumber} ثبت شد.`,
      );
      resetForm();
      onCreated?.(employee);
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
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="size-4 text-indigo-500" />
          ثبت پرسنل جدید
        </CardTitle>
        <CardDescription>
          کد پرسنلی به‌صورت خودکار تولید می‌شود و کد ملی باید یکتا باشد.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="hr-first-name">نام</Label>
              <Input
                id="hr-first-name"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                maxLength={64}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="hr-last-name">نام خانوادگی</Label>
              <Input
                id="hr-last-name"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                maxLength={64}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="hr-national-id">کد ملی</Label>
              <Input
                id="hr-national-id"
                dir="ltr"
                inputMode="numeric"
                value={nationalId}
                placeholder="0079541234"
                onChange={(event) => setNationalId(event.target.value)}
                maxLength={10}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="hr-mobile">شماره همراه</Label>
              <Input
                id="hr-mobile"
                dir="ltr"
                value={mobile}
                placeholder="09121234567"
                onChange={(event) => setMobile(event.target.value)}
                maxLength={20}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="hr-job-title">عنوان شغلی</Label>
              <Input
                id="hr-job-title"
                value={jobTitle}
                placeholder="مثلاً کارشناس منابع انسانی"
                onChange={(event) => setJobTitle(event.target.value)}
                maxLength={120}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="hr-department">واحد سازمانی</Label>
              <Input
                id="hr-department"
                value={department}
                onChange={(event) => setDepartment(event.target.value)}
                maxLength={120}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="hr-hire-date">تاریخ استخدام</Label>
              <Input
                id="hr-hire-date"
                type="date"
                dir="ltr"
                value={hireDate}
                onChange={(event) => setHireDate(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="hr-dependants">تعداد فرزندان</Label>
              <Input
                id="hr-dependants"
                inputMode="numeric"
                value={dependants}
                onChange={(event) => setDependants(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>جنسیت</Label>
              <Select<Gender>
                value={gender}
                onValueChange={(value) => setGender(value ?? Gender.MALE)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="انتخاب جنسیت" />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(Gender).map((item) => (
                    <SelectItem key={item} value={item}>
                      {GENDER_LABELS[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>وضعیت تأهل</Label>
              <Select<MaritalStatus>
                value={maritalStatus}
                onValueChange={(value) =>
                  setMaritalStatus(value ?? MaritalStatus.SINGLE)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="انتخاب وضعیت" />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(MaritalStatus).map((item) => (
                    <SelectItem key={item} value={item}>
                      {MARITAL_STATUS_LABELS[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="hr-email">رایانامه (اختیاری)</Label>
              <Input
                id="hr-email"
                type="email"
                dir="ltr"
                value={email}
                placeholder="name@example.com"
                onChange={(event) => setEmail(event.target.value)}
                maxLength={120}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="hr-bank">شماره حساب بانکی (اختیاری)</Label>
              <Input
                id="hr-bank"
                dir="ltr"
                value={bankAccountNumber}
                onChange={(event) => setBankAccountNumber(event.target.value)}
                maxLength={32}
              />
            </div>
          </div>

          {errors && (
            <Alert variant="destructive">
              <AlertTitle>خطا در ثبت پرسنل</AlertTitle>
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
              <AlertTitle>پرسنل ثبت شد</AlertTitle>
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
                <UserPlus />
                ثبت پرسنل
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
