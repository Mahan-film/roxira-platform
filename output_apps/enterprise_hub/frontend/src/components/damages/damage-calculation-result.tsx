import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

import { formatPersianDate, formatRial } from "@/lib/format";
import {
  DAMAGE_CALCULATION_METHOD_LABELS,
  type DamageCalculationResponseDto,
} from "@/types/damages";

interface DamageCalculationResultProps {
  result: DamageCalculationResponseDto;
}

/**
 * نمایش نتیجه محاسبه خسارت تاخیر تادیه بازگردانده‌شده از
 * `POST /enterprise-hub/damages` (DamageCalculationResponseDto).
 */
export function DamageCalculationResult({
  result,
}: DamageCalculationResultProps) {
  return (
    <Card className="border-primary/30" data-testid="damage-calculation-result">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>نتیجه محاسبه</CardTitle>
          <Badge variant="secondary">
            {DAMAGE_CALCULATION_METHOD_LABELS[result.calculationMethod]}
          </Badge>
        </div>
        <CardDescription>
          شناسه رکورد: <span className="font-mono">{result.id}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ResultField label="اصل مبلغ بدهی" value={formatRial(result.principalAmount)} />
          <ResultField label="تعداد روزهای تاخیر" value={`${result.delayedDays.toLocaleString("fa-IR")} روز`} />
          <ResultField label="تاریخ سررسید" value={formatPersianDate(result.dueDate)} />
          <ResultField label="تاریخ پرداخت" value={formatPersianDate(result.paymentDate)} />
        </div>

        <Separator />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ResultField
            label="مبلغ خسارت تاخیر تادیه"
            value={formatRial(result.damageAmount)}
            emphasize
          />
          <ResultField
            label="مبلغ کل قابل پرداخت"
            value={formatRial(result.totalPayable)}
            emphasize
          />
        </div>

        {result.contractReferenceNumber && (
          <ResultField
            label="شماره قرارداد/فاکتور مرجع"
            value={result.contractReferenceNumber}
          />
        )}

        <Separator />

        <div>
          <p className="text-sm text-muted-foreground">مرجع قانونی محاسبه</p>
          <p className="mt-1 text-sm leading-relaxed">{result.legalBasis}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ResultField({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p
        className={
          emphasize
            ? "mt-1 text-lg font-semibold text-primary"
            : "mt-1 text-sm font-medium"
        }
      >
        {value}
      </p>
    </div>
  );
}
