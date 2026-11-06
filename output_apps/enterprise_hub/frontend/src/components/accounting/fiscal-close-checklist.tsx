"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Lock,
  LockOpen,
  type LucideIcon,
} from "lucide-react";

import { LoadingLine, loadErrorMessage } from "@/components/app/app-ui";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listJournalEntries } from "@/lib/api/accounting-client";
import { listPeriodLocks } from "@/lib/api/accounting-reports-client";
import { getReconciliationSummary, listBankAccounts } from "@/lib/api/banking-client";
import { formatJalaliDate } from "@/lib/fa-format";
import {
  buildCloseChecklist,
  canConfirmClose,
  periodLockState,
  type ChecklistItem,
} from "@/lib/fiscal-close";
import { JournalEntryStatus } from "@/types/accounting";
import type { FiscalYear } from "@/types/accounting-reports";

interface FiscalCloseChecklistProps {
  year: FiscalYear;
  onReadyChange: (ready: boolean) => void;
}

type BadgeVariant = "secondary" | "destructive" | "outline";

const STATUS_META: Record<
  ChecklistItem["status"],
  { label: string; variant: BadgeVariant; icon: LucideIcon }
> = {
  ok: { label: "آماده", variant: "secondary", icon: CheckCircle2 },
  blocked: { label: "نیاز به اقدام", variant: "destructive", icon: AlertTriangle },
  unknown: { label: "بررسی دستی", variant: "outline", icon: CircleHelp },
};

type BankDifference = { accountName: string; difference: number | null };

export function FiscalCloseChecklist({ year, onReadyChange }: FiscalCloseChecklistProps) {
  const [items, setItems] = useState<ChecklistItem[] | null>(null);
  const [lockState, setLockState] = useState<"locked" | "open" | null>(null);
  const [typed, setTyped] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  const onReadyChangeRef = useRef(onReadyChange);
  onReadyChangeRef.current = onReadyChange;

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    setItems(null);
    setLockState(null);
    setLoadError(null);
    setTyped("");

    const drafts = listJournalEntries(
      {
        status: JournalEntryStatus.DRAFT,
        fromDate: year.startDate,
        toDate: year.endDate,
        page: 1,
        limit: 1,
      },
      controller.signal,
    )
      .then((res) => res.total)
      .catch(() => null);

    const banks = listBankAccounts(controller.signal)
      .then((accounts) =>
        Promise.all(
          accounts.map((account) =>
            getReconciliationSummary(account.id, year.endDate, controller.signal)
              .then((summary) => ({ accountName: account.name, difference: summary.difference }))
              .catch(() => ({ accountName: account.name, difference: null })),
          ),
        ),
      )
      .catch((): BankDifference[] | null => null);

    const locks = listPeriodLocks(controller.signal)
      .then((result) => ({
        state: periodLockState(result, year.startDate, year.endDate),
        error: null as string | null,
      }))
      .catch((err: unknown) => ({ state: "open" as const, error: loadErrorMessage(err) }));

    Promise.all([drafts, banks, locks]).then(([draftCount, bankDifferences, lockResult]) => {
      if (cancelled) return;
      setItems(buildCloseChecklist({ draftCount, bankDifferences }));
      setLockState(lockResult.state);
      if (lockResult.error) setLoadError(lockResult.error);
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [year.id]);

  useEffect(() => {
    onReadyChange(items !== null && canConfirmClose(items, typed, year.name));
  }, [items, typed, year.name, onReadyChange]);

  useEffect(() => {
    return () => onReadyChangeRef.current(false);
  }, []);

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <p className="text-sm font-medium">
          {formatJalaliDate(year.startDate)} تا {formatJalaliDate(year.endDate)}
        </p>
        <div className="flex items-center gap-2">
          {lockState === "locked" && (
            <>
              <Badge variant="secondary">
                <Lock className="size-3.5" aria-hidden="true" />
                قفل
              </Badge>
              <span className="text-sm text-muted-foreground">این سال مالی قفل است</span>
            </>
          )}
          {lockState === "open" && (
            <Badge variant="outline">
              <LockOpen className="size-3.5" aria-hidden="true" />
              باز
            </Badge>
          )}
        </div>
      </div>

      {items === null && !loadError && <LoadingLine show />}

      {items !== null && (
        <div className="grid gap-2">
          {items.map((item) => {
            const meta = STATUS_META[item.status];
            const StatusIcon = meta.icon;
            return (
              <div
                key={item.key}
                className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3"
              >
                <Badge variant={meta.variant}>
                  <StatusIcon className="size-3.5" aria-hidden="true" />
                  {meta.label}
                </Badge>
                <span className="font-bold">{item.label}</span>
                <span className="text-sm text-muted-foreground">{item.detail}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid gap-1">
        <Label htmlFor="fiscal-close-typed">برای تأیید، نام سال مالی را تایپ کنید</Label>
        <Input
          id="fiscal-close-typed"
          dir="auto"
          value={typed}
          placeholder={year.name}
          aria-describedby="fiscal-close-hint"
          onChange={(event) => setTyped(event.target.value)}
        />
        <p id="fiscal-close-hint" className="text-sm text-muted-foreground">
          نام سال: {year.name}
        </p>
      </div>

      {loadError && (
        <p role="alert" className="text-sm text-destructive">
          {loadError}
        </p>
      )}
    </div>
  );
}
