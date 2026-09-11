"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BadgeDollarSign,
  CheckCircle2Icon,
  Loader2Icon,
  Receipt,
  RefreshCw,
} from "lucide-react";

import { ContractForm } from "@/components/hr/contract-form";
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
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  calculatePayroll,
  issuePayslip,
  listContracts,
} from "@/lib/api/hr-client";
import { ApiClientError } from "@/lib/api/http-client";
import { formatRial } from "@/lib/format";
import {
  CONTRACT_TYPE_LABELS,
  ContractStatus,
  type Employee,
  type EmploymentContract,
  type PayrollCalculation,
  type Payslip,
} from "@/types/hr";

interface PayslipPreviewProps {
  employee: Employee;
  onIssued?: (payslip: Payslip) => void;
}

/** محاسبه دوره جاری شمسی جهت مقدار پیش‌فرض فرم فیش حقوقی */
function getJalaliPeriod(): { year: number; month: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US-u-ca-persian", {
      year: "numeric",
      month: "numeric",
    }).formatToParts(new Date());
    const year = Number(parts.find((part) => part.type === "year")?.value);
    const month = Number(parts.find((part) => part.type === "month")?.value);
    if (year && month) {
      return { year, month };
    }
  } catch {
    // در صورت عدم پشتیبانی مرورگر، به تاریخ میلادی برمی‌گردیم.
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function PreviewRow({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: number;
  emphasize?: boolean;
}) {
  return (
    <div
      className={
        emphasize
          ? "flex items-center justify-between rounded-lg bg-emerald-500/10 px-3 py-2 font-bold text-emerald-600 dark:text-emerald-400"
          : "flex items-center justify-between px-3 py-1.5 text-sm"
      }
    >
      <span>{label}</span>
      <span dir="ltr" className="font-mono">
        {formatRial(value)}
      </span>
    </div>
  );
}

/**
 * پیش‌نمایش و صدور فیش حقوقی کارمند انتخاب‌شده.
 *
 * - بارگذاری قرارداد فعال کارمند.
 * - پیش‌محاسبه حقوق (بیمه ۷٪، مالیات پله‌ای) و نمایش تفکیک اقلام.
 * - صدور فیش و ثبت خودکار سند هزینه در دفتر روزنامه.
 */
export function PayslipPreview({ employee, onIssued }: PayslipPreviewProps) {
  const [contract, setContract] = useState<EmploymentContract | null>(null);
  const [isLoadingContract, setIsLoadingContract] = useState(true);
  const [calculation, setCalculation] = useState<PayrollCalculation | null>(
    null,
  );
  const [issuedPayslip, setIssuedPayslip] = useState<Payslip | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [isIssuing, setIsIssuing] = useState(false);

  const initialPeriod = getJalaliPeriod();
  const [periodYear, setPeriodYear] = useState(String(initialPeriod.year));
  const [periodMonth, setPeriodMonth] = useState(String(initialPeriod.month));
  const [overtimeAmount, setOvertimeAmount] = useState("0");
  const [otherDeductions, setOtherDeductions] = useState("0");

  const loadContract = useCallback(
    async (signal?: AbortSignal) => {
      setIsLoadingContract(true);
      setErrorMessage(null);
      try {
        const contracts = await listContracts(employee.id, signal);
        const active =
          contracts.find((item) => item.status === ContractStatus.ACTIVE) ??
          contracts[0] ??
          null;
        setContract(active);
        setCalculation(null);
        setIssuedPayslip(null);
      } catch (error) {
        if (error instanceof ApiClientError) {
          setErrorMessage(error.details.join(" | "));
        } else if (!(error instanceof DOMException)) {
          setErrorMessage("دریافت قراردادهای کارمند ناموفق بود.");
        }
      } finally {
        setIsLoadingContract(false);
      }
    },
    [employee.id],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadContract(controller.signal);
    return () => controller.abort();
  }, [loadContract]);

  async function handleCalculate() {
    if (!contract) {
      return;
    }
    setIsCalculating(true);
    setErrorMessage(null);
    try {
      const result = await calculatePayroll({
        contractId: contract.id,
        overtimeAmount: Number(overtimeAmount) || 0,
        otherDeductions: Number(otherDeductions) || 0,
      });
      setCalculation(result);
      setIssuedPayslip(null);
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrorMessage(error.details.join(" | "));
      } else {
        setErrorMessage("محاسبه حقوق ناموفق بود.");
      }
    } finally {
      setIsCalculating(false);
    }
  }

  async function handleIssue() {
    if (!contract) {
      return;
    }
    setIsIssuing(true);
    setErrorMessage(null);
    try {
      const payslip = await issuePayslip({
        employeeId: employee.id,
        contractId: contract.id,
        periodYear: Number(periodYear),
        periodMonth: Number(periodMonth),
        overtimeAmount: Number(overtimeAmount) || 0,
        otherDeductions: Number(otherDeductions) || 0,
      });
      setIssuedPayslip(payslip);
      setCalculation(null);
      onIssued?.(payslip);
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrorMessage(error.details.join(" | "));
      } else {
        setErrorMessage("صدور فیش حقوقی ناموفق بود.");
      }
    } finally {
      setIsIssuing(false);
    }
  }

  if (isLoadingContract) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (!contract) {
    return (
      <ContractForm
        employee={employee}
        onCreated={(created) => {
          setContract(created);
          setErrorMessage(null);
        }}
      />
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <CardTitle className="flex items-center gap-2">
            <Receipt className="size-4 text-emerald-500" />
            پیش‌نمایش فیش حقوقی — {employee.fullName}
          </CardTitle>
          <CardDescription>
            قرارداد فعال {contract.contractNumber} ·{" "}
            {CONTRACT_TYPE_LABELS[contract.contractType]} · پایه{" "}
            {formatRial(contract.baseSalary)}
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void loadContract()}
        >
          <RefreshCw className="size-3.5" />
          بازخوانی
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-2">
            <Label htmlFor="ps-year">سال دوره</Label>
            <Input
              id="ps-year"
              inputMode="numeric"
              dir="ltr"
              value={periodYear}
              onChange={(event) => setPeriodYear(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ps-month">ماه دوره</Label>
            <Input
              id="ps-month"
              inputMode="numeric"
              dir="ltr"
              value={periodMonth}
              onChange={(event) => setPeriodMonth(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ps-overtime">اضافه‌کاری (ریال)</Label>
            <Input
              id="ps-overtime"
              inputMode="numeric"
              value={overtimeAmount}
              onChange={(event) => setOvertimeAmount(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ps-other">سایر کسورات (ریال)</Label>
            <Input
              id="ps-other"
              inputMode="numeric"
              value={otherDeductions}
              onChange={(event) => setOtherDeductions(event.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => void handleCalculate()}
            disabled={isCalculating}
          >
            {isCalculating ? (
              <>
                <Loader2Icon className="animate-spin" />
                در حال محاسبه...
              </>
            ) : (
              <>
                <BadgeDollarSign />
                محاسبه حقوق
              </>
            )}
          </Button>
          <Button
            onClick={() => void handleIssue()}
            disabled={isIssuing || !calculation}
          >
            {isIssuing ? (
              <>
                <Loader2Icon className="animate-spin" />
                در حال صدور...
              </>
            ) : (
              <>
                <Receipt />
                صدور فیش و ثبت سند
              </>
            )}
          </Button>
        </div>

        {errorMessage && (
          <Alert variant="destructive">
            <AlertTitle>خطا در عملیات حقوق و دستمزد</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        {issuedPayslip && (
          <Alert>
            <CheckCircle2Icon className="size-4 text-emerald-500" />
            <AlertTitle>فیش حقوقی صادر شد</AlertTitle>
            <AlertDescription className="flex flex-col gap-1">
              <span>
                شماره فیش: <span dir="ltr">{issuedPayslip.payslipNumber}</span> —
                خالص پرداختی {formatRial(issuedPayslip.netPay)}
              </span>
              {issuedPayslip.journalEntryNumber && (
                <span>
                  سند خودکار دفتر روزنامه:{" "}
                  <span dir="ltr">{issuedPayslip.journalEntryNumber}</span>
                </span>
              )}
            </AlertDescription>
          </Alert>
        )}

        {calculation && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-1">
              <span className="px-3 text-xs font-semibold text-muted-foreground">
                اقلام حقوق و مزایا
              </span>
              <PreviewRow label="حقوق پایه" value={calculation.baseSalary} />
              <PreviewRow label="حق مسکن" value={calculation.housingAllowance} />
              <PreviewRow label="بن خواربار" value={calculation.foodAllowance} />
              <PreviewRow
                label="حق اولاد"
                value={calculation.childAllowance}
              />
              <PreviewRow
                label="اضافه‌کاری"
                value={calculation.overtimeAmount}
              />
              <Separator className="my-1" />
              <PreviewRow
                label="جمع حقوق و مزایا (ناخالص)"
                value={calculation.grossPay}
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="px-3 text-xs font-semibold text-muted-foreground">
                کسورات
              </span>
              <PreviewRow
                label="بیمه تأمین اجتماعی (۷٪ سهم کارگر)"
                value={calculation.insuranceDeduction}
              />
              <PreviewRow
                label="مالیات بر حقوق"
                value={calculation.incomeTax}
              />
              <PreviewRow
                label="سایر کسورات"
                value={calculation.otherDeductions}
              />
              <Separator className="my-1" />
              <PreviewRow label="خالص پرداختی" value={calculation.netPay} emphasize />
              <span className="px-3 text-[11px] text-muted-foreground">
                درآمد مشمول مالیات: {formatRial(calculation.taxableIncome)}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
