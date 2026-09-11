"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { XIcon } from "lucide-react";

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

import { getAccountLedger } from "@/lib/api/accounting-client";
import { ApiClientError } from "@/lib/api/http-client";
import { formatPersianDate, formatRial } from "@/lib/format";
import {
  ACCOUNT_TYPE_LABELS,
  type AccountLedgerResponse,
} from "@/types/accounting";

interface AccountLedgerPanelProps {
  code: string;
  refreshKey?: number;
  onClose: () => void;
}

/**
 * پنل گردش حساب (دفتر معین) متصل به
 * `GET /enterprise-hub/accounting/accounts/:code/ledger`.
 */
export function AccountLedgerPanel({
  code,
  refreshKey = 0,
  onClose,
}: AccountLedgerPanelProps) {
  const [ledger, setLedger] = useState<AccountLedgerResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const load = useCallback(
    (signal?: AbortSignal) => {
      startTransition(async () => {
        try {
          const result = await getAccountLedger(code, { limit: 200 }, signal);
          setLedger(result);
          setErrorMessage(null);
        } catch (error) {
          if (error instanceof ApiClientError) {
            setErrorMessage(error.details.join(" | "));
          } else if (!(error instanceof DOMException)) {
            setErrorMessage("ارتباط با سرور برقرار نشد.");
          }
        }
      });
    },
    [code],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load, refreshKey]);

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold">
              دفتر معین {ledger ? ledger.account.name : code}
            </h3>
            {ledger && (
              <Badge variant="outline">
                {ACCOUNT_TYPE_LABELS[ledger.account.accountType]}
              </Badge>
            )}
          </div>
          <span className="font-mono text-xs text-muted-foreground" dir="ltr">
            {code}
          </span>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} title="بستن">
          <XIcon />
        </Button>
      </div>

      {errorMessage && (
        <Alert variant="destructive">
          <AlertTitle>خطا در دریافت گردش حساب</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      {ledger && (
        <div className="grid grid-cols-1 gap-3 rounded-lg border bg-muted/20 p-4 text-sm sm:grid-cols-4">
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground">مانده افتتاح</span>
            <span className="font-medium">{formatRial(ledger.openingBalance)}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground">جمع بدهکار</span>
            <span className="font-medium text-emerald-600 dark:text-emerald-400">
              {formatRial(ledger.totalDebit)}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground">جمع بستانکار</span>
            <span className="font-medium text-amber-600 dark:text-amber-400">
              {formatRial(ledger.totalCredit)}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground">مانده اختتام</span>
            <span className="font-bold">{formatRial(ledger.closingBalance)}</span>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">شماره سند</TableHead>
              <TableHead className="w-28">تاریخ</TableHead>
              <TableHead className="min-w-48">شرح</TableHead>
              <TableHead className="w-32">بدهکار</TableHead>
              <TableHead className="w-32">بستانکار</TableHead>
              <TableHead className="w-36">مانده تجمعی</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              Array.from({ length: 4 }).map((_, index) => (
                <TableRow key={`skeleton-${index}`}>
                  {Array.from({ length: 6 }).map((__, cellIndex) => (
                    <TableCell key={cellIndex}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : ledger && ledger.entries.length > 0 ? (
              ledger.entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap font-mono text-xs">
                    {entry.entryNumber}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatPersianDate(entry.date)}
                  </TableCell>
                  <TableCell className="min-w-48">{entry.description}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {entry.debit > 0 ? formatRial(entry.debit) : "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {entry.credit > 0 ? formatRial(entry.credit) : "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-medium">
                    {formatRial(entry.runningBalance)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-8 text-center text-muted-foreground"
                >
                  گردشی برای این حساب ثبت نشده است.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}