"use client";

import { BookOpenIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRial } from "@/lib/format";
import {
  ACCOUNT_TYPE_LABELS,
  AccountType,
  type TrialBalanceResponse,
} from "@/types/accounting";

function accountTypeVariant(
  type: AccountType,
): "default" | "secondary" | "outline" | "destructive" {
  switch (type) {
    case AccountType.ASSET:
      return "default";
    case AccountType.LIABILITY:
      return "destructive";
    case AccountType.EQUITY:
      return "secondary";
    case AccountType.REVENUE:
      return "outline";
    default:
      return "secondary";
  }
}

interface TrialBalanceTableProps {
  trialBalance: TrialBalanceResponse | null;
  isLoading: boolean;
  errorMessage: string | null;
  selectedCode: string | null;
  onSelectAccount: (code: string) => void;
  onRefresh: () => void;
}

/**
 * جدول گردش مالی/تراز آزمایشی (Trial Balance) به تفکیک حساب با فرمت ریالی.
 * انتخاب هر حساب، دفتر معین آن را باز می‌کند.
 */
export function TrialBalanceTable({
  trialBalance,
  isLoading,
  errorMessage,
  selectedCode,
  onSelectAccount,
  onRefresh,
}: TrialBalanceTableProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">تراز آزمایشی و گردش حساب‌ها</h2>
        <Button type="button" variant="ghost" size="sm" onClick={onRefresh} disabled={isLoading}>
          بروزرسانی
        </Button>
      </div>

      {errorMessage && (
        <Alert variant="destructive">
          <AlertTitle>خطا در دریافت ترازنامه</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">کد حساب</TableHead>
              <TableHead className="min-w-48">نام حساب</TableHead>
              <TableHead className="w-28">ماهیت</TableHead>
              <TableHead className="w-36">جمع بدهکار</TableHead>
              <TableHead className="w-36">جمع بستانکار</TableHead>
              <TableHead className="w-36">مانده</TableHead>
              <TableHead className="w-28">دفتر معین</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, index) => (
                <TableRow key={`skeleton-${index}`}>
                  {Array.from({ length: 7 }).map((__, cellIndex) => (
                    <TableCell key={cellIndex}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : trialBalance && trialBalance.rows.length > 0 ? (
              trialBalance.rows.map((row) => (
                <TableRow
                  key={row.code}
                  data-state={selectedCode === row.code ? "selected" : undefined}
                  className={selectedCode === row.code ? "bg-muted/50" : undefined}
                >
                  <TableCell className="font-mono text-xs">{row.code}</TableCell>
                  <TableCell className="whitespace-nowrap">{row.name}</TableCell>
                  <TableCell>
                    <Badge variant={accountTypeVariant(row.accountType)}>
                      {ACCOUNT_TYPE_LABELS[row.accountType]}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-emerald-600 dark:text-emerald-400">
                    {formatRial(row.totalDebit)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-amber-600 dark:text-amber-400">
                    {formatRial(row.totalCredit)}
                  </TableCell>
                  <TableCell
                    className={
                      row.balance >= 0
                        ? "whitespace-nowrap font-medium"
                        : "whitespace-nowrap font-medium text-rose-600 dark:text-rose-400"
                    }
                  >
                    {formatRial(row.balance)}
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onSelectAccount(row.code)}
                    >
                      <BookOpenIcon />
                      گردش
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-10 text-center text-muted-foreground"
                >
                  حسابی برای نمایش وجود ندارد. ابتدا حساب ایجاد کنید.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}