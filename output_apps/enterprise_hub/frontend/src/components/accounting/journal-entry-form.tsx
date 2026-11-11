"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  CheckCircle2Icon,
  CirclePlusIcon,
  KeyboardIcon,
  Loader2Icon,
  ScaleIcon,
  SendHorizonalIcon,
  ShieldCheckIcon,
  Trash2Icon,
  WandSparklesIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { MoneyInput } from "@/components/ui/money-input";
import { Money } from "@/components/ui/money";
import { isoToJalaliInput } from "@/lib/jalali";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { createJournalEntry, updateJournalEntry } from "@/lib/api/accounting-client";
import { ApiClientError } from "@/lib/api/http-client";
import { inferServiceDomain } from "@/lib/api/auth-client";
import { useAuth } from "@/components/auth/auth-provider";
import { VoucherAttachments } from "@/components/accounting/voucher-attachments";
import { AccountSearchModal } from "@/components/accounting/account-search-modal";
import {
  computeBalancingAmount,
  getNextCellCoordinates,
  isAccountSearchKey,
  isCancelKey,
  isInsertLineKey,
  isSaveShortcut,
} from "@/lib/voucher-keyboard";
import { formatMoneyRial } from "@/lib/fa-format";
import {
  ACCOUNT_TYPE_LABELS,
  type ChartOfAccount,
  type CreateJournalEntryDto,
  type JournalEntryResponse,
} from "@/types/accounting";

interface FormLine {
  uid: string;
  accountCode: string;
  debit: string;
  credit: string;
  description: string;
}

interface JournalEntryFormProps {
  accounts: ChartOfAccount[];
  onCreated?: (entry: JournalEntryResponse) => void;
  /** When set, the form edits this voucher (PUT with its version) instead of creating one. */
  entry?: JournalEntryResponse | null;
  onUpdated?: (entry: JournalEntryResponse) => void;
  onCancel?: () => void;
}

function createEmptyLine(uid: string): FormLine {
  return { uid, accountCode: "", debit: "", credit: "", description: "" };
}

/** Today's local date as a Gregorian ISO date (yyyy-mm-dd). */
function todayIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

/**
 * فرم ثبت آرتیکل دوطرفه (Double-Entry Journal Entry).
 *
 * - سطرها داینامیک و حداقل دوتایی هستند (یک بدهکار و یک بستانکار).
 * - هر سطر فقط یکی از بدهکار/بستانکار را می‌پذیرد.
 * - تراز بودن سند به‌صورت آنی نمایش و سمت سرور نیز مجدداً کنترل می‌شود.
 * - متصل به `POST /enterprise-hub/accounting/journal-entries`.
 */
export function JournalEntryForm({
  accounts,
  onCreated,
  entry = null,
  onUpdated,
  onCancel,
}: JournalEntryFormProps) {
  const { isAuthenticated, openLogin } = useAuth();
  const nextLineId = useRef(2);
  const isEditing = entry != null;
  const [entryNumber, setEntryNumber] = useState("");
  const [date, setDate] = useState(todayIso);
  // Remounts the date field after a reset so it shows the new value.
  const [dateKey, setDateKey] = useState(0);
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<FormLine[]>([
    createEmptyLine("line-0"),
    createEmptyLine("line-1"),
  ]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const [submitError, setSubmitError] = useState<string[] | null>(null);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [createdEntry, setCreatedEntry] = useState<JournalEntryResponse | null>(
    null,
  );
  const [showAccountSearch, setShowAccountSearch] = useState(false);

  // Load the edited voucher into the form whenever the target changes.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!entry) {
      // Leaving edit mode must not leave the old voucher in the new-voucher form.
      setEntryNumber("");
      setDescription("");
      setLines([createEmptyLine("line-0"), createEmptyLine("line-1")]);
      setSubmitError(null);
      setConflictError(null);
      return;
    }
    setEntryNumber(entry.entryNumber);
    setDescription(entry.description);
    setDate(entry.date.slice(0, 10));
    setDateKey((key) => key + 1);
    setLines(
      entry.lines.map((line, index) => ({
        uid: `edit-${index}`,
        accountCode: line.accountCode,
        debit: Number(line.debit) ? String(line.debit) : "",
        credit: Number(line.credit) ? String(line.credit) : "",
        description: line.description ?? "",
      })),
    );
    setSubmitError(null);
    setConflictError(null);
    setCreatedEntry(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [entry]);

  const [activeRowIndex, setActiveRowIndex] = useState(0);

  function focusCell(row: number, col: number) {
    if (typeof document === "undefined") return;
    const element = document.getElementById(`voucher-cell-${row}-${col}`);
    if (element) {
      element.focus();
      if (element instanceof HTMLInputElement) {
        element.select();
      }
    }
  }

  function updateLine(uid: string, patch: Partial<FormLine>) {
    setLines((prev) =>
      prev.map((line) => (line.uid === uid ? { ...line, ...patch } : line)),
    );
  }

  function addLineAndFocus() {
    const id = nextLineId.current++;
    const nextRow = lines.length;
    setLines((prev) => [...prev, createEmptyLine(`line-${id}`)]);
    setActiveRowIndex(nextRow);
    setTimeout(() => {
      focusCell(nextRow, 0);
    }, 50);
  }

  function removeLine(uid: string) {
    setLines((prev) => (prev.length > 2 ? prev.filter((l) => l.uid !== uid) : prev));
  }

  function autoBalanceRow(targetIndex: number) {
    const index = Math.max(0, Math.min(targetIndex, lines.length - 1));
    const targetLine = lines[index];
    if (!targetLine) return;
    const balancing = computeBalancingAmount(lines, index);
    updateLine(targetLine.uid, balancing);
  }

  function handleFormKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    // Ctrl+S / Cmd+S or Ctrl+Enter: submit entry from anywhere
    if (isSaveShortcut(event)) {
      event.preventDefault();
      event.stopPropagation();
      void submitEntry();
      return;
    }

    // Insert key or Alt+N: add new line and focus
    if (isInsertLineKey(event) || (event.altKey && (event.key === "n" || event.key === "N"))) {
      event.preventDefault();
      event.stopPropagation();
      addLineAndFocus();
      return;
    }

    // F2: account search
    if (isAccountSearchKey(event)) {
      event.preventDefault();
      event.stopPropagation();
      setShowAccountSearch(true);
      return;
    }

    // Esc: cancel modal or ask before discarding dirty entry
    if (isCancelKey(event)) {
      event.preventDefault();
      event.stopPropagation();
      if (showAccountSearch) {
        setShowAccountSearch(false);
        return;
      }
      const isDirty = Boolean(
        description.trim() ||
        entryNumber.trim() ||
        lines.some((l) => l.accountCode || l.debit || l.credit || l.description.trim()),
      );
      if (isDirty) {
        const confirmed =
          typeof window !== "undefined"
            ? window.confirm("تغییرات ذخیره‌نشده در سند وجود دارد. آیا از انصراف اطمینان دارید؟")
            : true;
        if (confirmed) {
          onCancel?.();
        }
      } else {
        onCancel?.();
      }
      return;
    }

    // Alt+B: auto-balance current active line
    if (event.altKey && (event.key === "b" || event.key === "B")) {
      event.preventDefault();
      event.stopPropagation();
      autoBalanceRow(activeRowIndex);
      return;
    }

    // Alt+Delete: delete active row
    if (event.altKey && event.key === "Delete") {
      event.preventDefault();
      event.stopPropagation();
      if (lines.length > 2 && activeRowIndex < lines.length) {
        const lineToDelete = lines[activeRowIndex];
        if (lineToDelete) {
          removeLine(lineToDelete.uid);
          const nextRow = Math.max(0, activeRowIndex - 1);
          setActiveRowIndex(nextRow);
          setTimeout(() => focusCell(nextRow, 0), 50);
        }
      }
      return;
    }
  }

  function generateEntryNumber() {
    const now = new Date();
    const year = isoToJalaliInput(now).slice(0, 4);
    const serial = String(now.getTime()).slice(-6);
    setEntryNumber(`JV-${year}-${serial}`);
  }

  const totalDebit = lines.reduce(
    (sum, line) => sum + (Number(line.debit) || 0),
    0,
  );
  const totalCredit = lines.reduce(
    (sum, line) => sum + (Number(line.credit) || 0),
    0,
  );
  const difference = Math.abs(totalDebit - totalCredit);
  const isBalanced = difference < 0.01 && totalDebit > 0;

  function validate(): string[] {
    const errors: string[] = [];
    if (!description.trim()) errors.push("شرح سند الزامی است.");

    const validLines = lines.filter(
      (line) =>
        line.accountCode &&
        ((Number(line.debit) || 0) > 0 || (Number(line.credit) || 0) > 0),
    );
    if (validLines.length < 2) {
      errors.push("حداقل دو سطر معتبر (بدهکار/بستانکار) لازم است.");
    }
    for (const line of validLines) {
      const debit = Number(line.debit) || 0;
      const credit = Number(line.credit) || 0;
      if (debit > 0 && credit > 0) {
        errors.push(`سطر حساب ${line.accountCode} نمی‌تواند هم‌زمان بدهکار و بستانکار باشد.`);
      }
    }
    if (difference >= 0.01) {
      errors.push("جمع بدهکار و بستانکار سند برابر نیست.");
    }
    return errors;
  }

  async function submitEntry() {
    if (isSubmittingRef.current) {
      return;
    }
    setSubmitError(null);
    setConflictError(null);
    setCreatedEntry(null);

    const validationErrors = validate();
    if (validationErrors.length > 0) {
      setSubmitError(validationErrors);
      return;
    }

    if (!isAuthenticated) {
      openLogin({
        serviceDomain: inferServiceDomain(),
        title: "ورود برای ثبت سند حسابداری",
        description:
          "ثبت سند در دفتر روزنامه سازمانی نیازمند احراز هویت است؛ شماره همراه خود را تأیید کنید.",
        onSuccess: () => {
          void submitEntry();
        },
      });
      return;
    }

    const payload: CreateJournalEntryDto = {
      entryNumber: entryNumber.trim() || undefined,
      // Noon local time keeps the Jalali day stable across time zones.
      date: date ? new Date(`${date}T12:00:00`).toISOString() : undefined,
      description: description.trim(),
      lines: lines
        .filter(
          (line) =>
            line.accountCode &&
            ((Number(line.debit) || 0) > 0 || (Number(line.credit) || 0) > 0),
        )
        .map((line) => {
          const debit = Number(line.debit) || 0;
          const credit = Number(line.credit) || 0;
          return {
            accountCode: line.accountCode,
            debit: debit > 0 ? debit : 0,
            credit: credit > 0 ? credit : 0,
            description: line.description.trim() || undefined,
          };
        }),
    };

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      if (entry) {
        const result = await updateJournalEntry(entry.id, {
          ...payload,
          expectedVersion: entry.version,
        });
        setCreatedEntry(result);
        onUpdated?.(result);
        return;
      }
      const result = await createJournalEntry(payload);
      setCreatedEntry(result);
      setEntryNumber("");
      setDescription("");
      setDate(todayIso());
      setDateKey((key) => key + 1);
      setLines([
        createEmptyLine(`line-${nextLineId.current++}`),
        createEmptyLine(`line-${nextLineId.current++}`),
      ]);
      onCreated?.(result);
    } catch (error) {
      if (error instanceof ApiClientError) {
        // 409 is the optimistic-lock conflict: another user saved after this form loaded.
        if (error.statusCode === 409) {
          setConflictError(error.details.join(" | "));
        } else {
          setSubmitError(error.details);
        }
      } else {
        setSubmitError([
          "ارتباط با سرور برقرار نشد. لطفاً چند لحظه بعد دوباره تلاش کنید.",
        ]);
      }
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitEntry();
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ScaleIcon className="size-4 text-indigo-500" />
              {isEditing ? "ویرایش سند دوطرفه" : "ثبت سند دوطرفه"}
            </CardTitle>
            <CardDescription className="mt-1">
              {isEditing
                ? "ویرایش پیش‌نویس یا موقت؛ در صورت تغییر هم‌زمان توسط کاربر دیگر، پیام تعارض نمایش داده می‌شود."
                : "آرتیکل‌های بدهکار/بستانکار با کنترل آنی تراز و اعتبارسنجی سرور."}
            </CardDescription>
          </div>
          <Badge variant={isBalanced || (totalDebit === 0 && totalCredit === 0) ? "default" : "destructive"} className="text-xs">
            {totalDebit === 0 && totalCredit === 0
              ? "سند خالی"
              : isBalanced
                ? "سند تراز است"
                : "سند ناتراز"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} onKeyDown={handleFormKeyDown} className="flex flex-col gap-5" noValidate>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label>شماره سند</Label>
              <div className="flex gap-2">
                <Input
                  value={entryNumber}
                  onChange={(event) => setEntryNumber(event.target.value)}
                  placeholder="JV-1405-000001"
                  maxLength={64}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  title="تولید خودکار شماره سند"
                  onClick={generateEntryNumber}
                >
                  <WandSparklesIcon />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                در صورت خالی بودن، خودکار ساخته می‌شود
              </p>
            </div>
            <div className="grid gap-2">
              <Label>تاریخ سند</Label>
              <JalaliDateInput key={dateKey} value={date} onChange={setDate} presets />
            </div>
            <div className="grid gap-2">
              <Label>شرح سند</Label>
              <Input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="فروش نقدی خدمات مشاوره"
                maxLength={1024}
              />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">سطرهای سند</h3>
                <div className="hidden items-center gap-1.5 text-xs text-muted-foreground md:flex flex-wrap">
                  <KeyboardIcon className="size-3.5 text-indigo-500" />
                  <span className="font-semibold text-foreground">کلیدهای حسابدار:</span>
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold">Insert</kbd>
                  <span>سطر جدید</span>
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold">Enter</kbd>
                  <span>سلول بعدی</span>
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold">F2</kbd>
                  <span>جستجوی حساب</span>
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold">Ctrl+S</kbd>
                  <span>ثبت سند</span>
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold">Esc</kbd>
                  <span>انصراف</span>
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold">Alt+B</kbd>
                  <span>موازنه</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => autoBalanceRow(activeRowIndex)}
                  title="موازنه خودکار سطر جاری (Alt+B)"
                >
                  <ScaleIcon className="size-3.5 text-indigo-500" />
                  موازنه خودکار
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={addLineAndFocus}>
                  <CirclePlusIcon />
                  افزودن سطر
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-56">حساب</TableHead>
                    <TableHead className="w-36">بدهکار</TableHead>
                    <TableHead className="w-36">بستانکار</TableHead>
                    <TableHead className="min-w-48">شرح سطر</TableHead>
                    <TableHead className="w-20">عملیات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line, index) => (
                    <TableRow key={line.uid} className={index === activeRowIndex ? "bg-muted/30" : undefined}>
                      <TableCell>
                        <Select<string>
                          value={line.accountCode || null}
                          onValueChange={(value) =>
                            updateLine(line.uid, { accountCode: value ?? "" })
                          }
                        >
                          <SelectTrigger
                            id={`voucher-cell-${index}-0`}
                            className="w-full"
                            onFocus={() => setActiveRowIndex(index)}
                            onKeyDown={(e) => {
                              if (isAccountSearchKey(e)) {
                                e.preventDefault();
                                e.stopPropagation();
                                setActiveRowIndex(index);
                                setShowAccountSearch(true);
                                return;
                              }
                              if (e.key === "Enter" || e.key === "Tab") {
                                if (!e.shiftKey) {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  focusCell(index, 1);
                                }
                              } else if (e.key === "ArrowDown" && (e.altKey || e.ctrlKey)) {
                                e.preventDefault();
                                e.stopPropagation();
                                focusCell(index + 1, 0);
                              } else if (e.key === "ArrowUp" && (e.altKey || e.ctrlKey)) {
                                e.preventDefault();
                                e.stopPropagation();
                                focusCell(index - 1, 0);
                              }
                            }}
                          >
                            <SelectValue placeholder="انتخاب حساب" />
                          </SelectTrigger>
                          <SelectContent>
                            {accounts.map((account) => (
                              <SelectItem key={account.id} value={account.code}>
                                {account.code} — {account.name} (
                                {ACCOUNT_TYPE_LABELS[account.accountType]})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <MoneyInput
                          id={`voucher-cell-${index}-1`}
                          helper={false}
                          className="min-w-36"
                          value={line.debit}
                          placeholder="0"
                          onFocus={() => setActiveRowIndex(index)}
                          onChange={(digits) =>
                            updateLine(line.uid, {
                              debit: digits,
                              credit: "",
                            })
                          }
                          onKeyDown={(e) => {
                            if ((e.ctrlKey || e.metaKey || e.altKey) && (e.key === "b" || e.key === "B")) {
                              e.preventDefault();
                              e.stopPropagation();
                              autoBalanceRow(index);
                              return;
                            }
                            if (e.key === "Enter") {
                              e.preventDefault();
                              e.stopPropagation();
                              const next = getNextCellCoordinates(index, 1, lines.length, Boolean(line.debit), "next");
                              focusCell(next.row, next.col);
                            } else if (e.key === "ArrowDown") {
                              e.preventDefault();
                              e.stopPropagation();
                              const next = getNextCellCoordinates(index, 1, lines.length, false, "down");
                              focusCell(next.row, next.col);
                            } else if (e.key === "ArrowUp") {
                              e.preventDefault();
                              e.stopPropagation();
                              const next = getNextCellCoordinates(index, 1, lines.length, false, "up");
                              focusCell(next.row, next.col);
                            }
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <MoneyInput
                          id={`voucher-cell-${index}-2`}
                          helper={false}
                          className="min-w-36"
                          value={line.credit}
                          placeholder="0"
                          onFocus={() => setActiveRowIndex(index)}
                          onChange={(digits) =>
                            updateLine(line.uid, {
                              credit: digits,
                              debit: "",
                            })
                          }
                          onKeyDown={(e) => {
                            if ((e.ctrlKey || e.metaKey || e.altKey) && (e.key === "b" || e.key === "B")) {
                              e.preventDefault();
                              e.stopPropagation();
                              autoBalanceRow(index);
                              return;
                            }
                            if (e.key === "Enter") {
                              e.preventDefault();
                              e.stopPropagation();
                              const next = getNextCellCoordinates(index, 2, lines.length, false, "next");
                              focusCell(next.row, next.col);
                            } else if (e.key === "ArrowDown") {
                              e.preventDefault();
                              e.stopPropagation();
                              const next = getNextCellCoordinates(index, 2, lines.length, false, "down");
                              focusCell(next.row, next.col);
                            } else if (e.key === "ArrowUp") {
                              e.preventDefault();
                              e.stopPropagation();
                              const next = getNextCellCoordinates(index, 2, lines.length, false, "up");
                              focusCell(next.row, next.col);
                            }
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          id={`voucher-cell-${index}-3`}
                          value={line.description}
                          onFocus={() => setActiveRowIndex(index)}
                          onChange={(event) =>
                            updateLine(line.uid, { description: event.target.value })
                          }
                          placeholder="شرح اختیاری"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              e.stopPropagation();
                              const next = getNextCellCoordinates(index, 3, lines.length, false, "next");
                              if (next.shouldAddRow) {
                                addLineAndFocus();
                              } else {
                                focusCell(next.row, next.col);
                              }
                            } else if (e.key === "ArrowDown") {
                              e.preventDefault();
                              e.stopPropagation();
                              const next = getNextCellCoordinates(index, 3, lines.length, false, "down");
                              focusCell(next.row, next.col);
                            } else if (e.key === "ArrowUp") {
                              e.preventDefault();
                              e.stopPropagation();
                              const next = getNextCellCoordinates(index, 3, lines.length, false, "up");
                              focusCell(next.row, next.col);
                            }
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => autoBalanceRow(index)}
                            title="موازنه خودکار این سطر با باقیمانده سند (Alt+B)"
                          >
                            <ScaleIcon className="size-3.5 text-indigo-500" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => removeLine(line.uid)}
                            disabled={lines.length <= 2}
                            title="حذف سطر (Alt+Delete)"
                          >
                            <Trash2Icon />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 rounded-lg border bg-muted/20 p-4 text-sm sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">جمع بدهکار</span>
              <span className="font-medium">
                <Money value={totalDebit} unit="rial" suffix />
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">جمع بستانکار</span>
              <span className="font-medium">
                <Money value={totalCredit} unit="rial" suffix />
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">اختلاف تراز</span>
              <span
                className={
                  difference < 0.01
                    ? "font-bold text-emerald-600 dark:text-emerald-400"
                    : "font-bold text-rose-600 dark:text-rose-400"
                }
              >
                {formatMoneyRial(difference)}
              </span>
            </div>
          </div>

          {conflictError && (
            <Alert variant="destructive">
              <AlertTitle>تعارض ویرایش</AlertTitle>
              <AlertDescription>{conflictError}</AlertDescription>
            </Alert>
          )}

          {submitError && (
            <Alert variant="destructive">
              <AlertTitle>خطا در ثبت سند</AlertTitle>
              <AlertDescription>
                <ul className="list-inside list-disc">
                  {submitError.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {createdEntry && (
            <Alert>
              <CheckCircle2Icon className="size-4 text-emerald-500" />
              <AlertTitle>
                {isEditing ? "سند با موفقیت ویرایش شد" : "سند با موفقیت ثبت شد"}
              </AlertTitle>
              <AlertDescription>
                شماره {createdEntry.entryNumber} — جمع بدهکار{" "}
                {formatMoneyRial(createdEntry.totalDebit)} / جمع بستانکار{" "}
                {formatMoneyRial(createdEntry.totalCredit)}
              </AlertDescription>
            </Alert>
          )}

          {createdEntry && <VoucherAttachments journalEntryId={createdEntry.id} />}

          {!isAuthenticated && (
            <Alert className="border-indigo-500/30 bg-indigo-500/5">
              <ShieldCheckIcon className="size-4 text-indigo-500" />
              <AlertTitle>احراز هویت لازم است</AlertTitle>
              <AlertDescription>
                برای ثبت سند در دفتر روزنامه، ابتدا با شماره همراه خود وارد شوید.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex items-center gap-2 self-start">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2Icon className="animate-spin" />
                  {isEditing ? "در حال ویرایش..." : "در حال ثبت..."}
                </>
              ) : (
                <>
                  <SendHorizonalIcon />
                  {isEditing
                    ? "ذخیره تغییرات"
                    : isAuthenticated
                      ? "ثبت سند"
                      : "ورود و ثبت سند"}
                </>
              )}
            </Button>
            {isEditing && (
              <Button
                type="button"
                variant="outline"
                onClick={() => onCancel?.()}
                disabled={isSubmitting}
              >
                انصراف
              </Button>
            )}
          </div>
        </form>

        <AccountSearchModal
          open={showAccountSearch}
          accounts={accounts}
          onSelect={(account) => {
            if (activeRowIndex < lines.length) {
              updateLine(lines[activeRowIndex].uid, { accountCode: account.code });
            }
            setShowAccountSearch(false);
            setTimeout(() => focusCell(activeRowIndex, 1), 50);
          }}
          onClose={() => {
            setShowAccountSearch(false);
            setTimeout(() => focusCell(activeRowIndex, 0), 50);
          }}
        />
      </CardContent>
    </Card>
  );
}