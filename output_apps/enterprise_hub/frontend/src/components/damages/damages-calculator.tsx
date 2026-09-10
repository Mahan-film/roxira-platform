"use client";

import React, { useState } from "react";
import { calculateDamage } from "@/lib/api/damages-client";
import { DamageCalculationMethod, DamageCalculationResponse } from "@/types/damages";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Calculator, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";

export function DamagesCalculator() {
  const [method, setMethod] = useState<DamageCalculationMethod>(DamageCalculationMethod.CPI_INDEX);
  const [principalAmount, setPrincipalAmount] = useState<number>(100000000);
  const [dueDate, setDueDate] = useState<string>("2023-03-20");
  const [paymentDate, setPaymentDate] = useState<string>("2024-03-20");
  const [cpiDue, setCpiDue] = useState<number>(100);
  const [cpiPayment, setCpiPayment] = useState<number>(145.5);
  const [annualRate, setAnnualRate] = useState<number>(23);
  const [contractRef, setContractRef] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DamageCalculationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const data = await calculateDamage({
        principalAmount: Number(principalAmount),
        dueDate,
        paymentDate,
        calculationMethod: method,
        cpiIndexAtDueDate: method === DamageCalculationMethod.CPI_INDEX ? Number(cpiDue) : undefined,
        cpiIndexAtPaymentDate: method === DamageCalculationMethod.CPI_INDEX ? Number(cpiPayment) : undefined,
        annualInterestRate: method === DamageCalculationMethod.ANNUAL_RATE ? Number(annualRate) : undefined,
        contractReferenceNumber: contractRef || undefined,
      });
      setResult(data);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "خطا در برقراری ارتباط با سرور. لطفاً چند لحظه بعد دوباره تلاش کنید.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full max-w-6xl mx-auto p-4" dir="rtl">
      <Card className="lg:col-span-7 shadow-lg border-muted">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl font-bold flex items-center gap-2">
                <Calculator className="w-5 h-5 text-primary" />
                محاسبه‌گر هوشمند خسارت تاخیر تادیه
              </CardTitle>
              <CardDescription className="mt-1">
                منطبق با ماده ۵۲۲ آیین دادرسی مدنی و نرخ سود بانکی
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-xs">
              استعلام رسمی
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex gap-4 p-1 bg-muted rounded-lg">
              <button
                type="button"
                onClick={() => setMethod(DamageCalculationMethod.CPI_INDEX)}
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                  method === DamageCalculationMethod.CPI_INDEX
                    ? "bg-background text-foreground shadow"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                شاخص تورم بانک مرکزی (ماده ۵۲۲)
              </button>
              <button
                type="button"
                onClick={() => setMethod(DamageCalculationMethod.ANNUAL_RATE)}
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                  method === DamageCalculationMethod.ANNUAL_RATE
                    ? "bg-background text-foreground shadow"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                نرخ سود سالانه قراردادی
              </button>
            </div>

            <div className="space-y-2">
              <Label>اصل مبلغ دین (ریال)</Label>
              <Input
                type="number"
                value={principalAmount}
                onChange={(e) => setPrincipalAmount(Number(e.target.value))}
                required
                min={1}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>تاریخ سررسید دین</Label>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>تاریخ پرداخت واقعی</Label>
                <Input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  required
                />
              </div>
            </div>

            {method === DamageCalculationMethod.CPI_INDEX ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-muted/40 rounded-lg border border-dashed">
                <div className="space-y-2">
                  <Label>شاخص در سررسید</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={cpiDue}
                    onChange={(e) => setCpiDue(Number(e.target.value))}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>شاخص در پرداخت</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={cpiPayment}
                    onChange={(e) => setCpiPayment(Number(e.target.value))}
                    required
                  />
                </div>
              </div>
            ) : (
              <div className="p-4 bg-muted/40 rounded-lg border border-dashed space-y-2">
                <Label>نرخ سود توافقی سالانه (درصد)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={annualRate}
                  onChange={(e) => setAnnualRate(Number(e.target.value))}
                  required
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>شماره قرارداد یا فاکتور مرجع (اختیاری)</Label>
              <Input
                type="text"
                placeholder="مثال: CNT-1405-992"
                value={contractRef}
                onChange={(e) => setContractRef(e.target.value)}
              />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>خطا در محاسبه</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={loading} className="w-full text-base py-5 font-semibold">
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 ml-2 animate-spin" />
                  در حال استعلام از موتور سازمانی...
                </>
              ) : (
                "محاسبه و صدور سند رسمی"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="lg:col-span-5 space-y-6">
        {result ? (
          <Card className="border-primary/50 shadow-xl bg-card">
            <CardHeader className="bg-primary/5 border-b pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-bold flex items-center gap-2 text-primary">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  نتیجه رسمی محاسبه
                </CardTitle>
                <Badge variant="secondary">{result.delayedDays} روز تاخیر</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-4 text-sm">
              <div className="flex justify-between py-2 border-b">
                <span className="text-muted-foreground">اصل خواسته:</span>
                <span className="font-bold">{result.principalAmount.toLocaleString("fa-IR")} ریال</span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="text-muted-foreground">خسارت تاخیر تادیه:</span>
                <span className="font-bold text-amber-600 dark:text-amber-400">
                  {result.damageAmount.toLocaleString("fa-IR")} ریال
                </span>
              </div>
              <div className="flex justify-between py-3 border-b bg-muted/30 px-2 rounded font-bold text-base">
                <span>مبلغ کل قابل پرداخت:</span>
                <span className="text-emerald-600 dark:text-emerald-400">
                  {result.totalPayable.toLocaleString("fa-IR")} ریال
                </span>
              </div>
              <div className="space-y-1 text-xs text-muted-foreground pt-2">
                <div className="font-semibold text-foreground">مبنای قانونی و رویه قضایی:</div>
                <p className="leading-relaxed bg-muted/50 p-2.5 rounded border">{result.legalBasis}</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-dashed flex items-center justify-center p-8 text-center text-muted-foreground h-full min-h-[300px]">
            <div className="space-y-3">
              <Calculator className="w-12 h-12 mx-auto text-muted-foreground/40" />
              <p className="text-sm">پس از تکمیل فرم و ثبت، نتیجه رسمی و استناد قانونی در این بخش نمایش داده می‌شود.</p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
