"use client";

import { useState } from "react";
import { FileTextIcon } from "lucide-react";

import { DamageCalculationForm } from "./damage-calculation-form";
import { DamageCalculationResult } from "./damage-calculation-result";
import { Card, CardContent } from "@/components/ui/card";
import type { DamageCalculationResponseDto } from "@/types/damages";

/**
 * بخش اصلی محاسبه‌گر: فرم محاسبه در کنار نمایش نتیجه، با مدیریت
 * حالت (state) نتیجه‌ی آخرین محاسبه‌ی موفق.
 */
export function DamageCalculatorSection() {
  const [result, setResult] = useState<DamageCalculationResponseDto | null>(
    null,
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
      <DamageCalculationForm onCalculated={setResult} />

      {result ? (
        <DamageCalculationResult result={result} />
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
            <FileTextIcon className="size-10" />
            <p className="text-sm">
              پس از تکمیل فرم و محاسبه، نتیجه خسارت تاخیر تادیه در این بخش
              نمایش داده می‌شود.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
