"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CheckCircle2Icon,
  CirclePlusIcon,
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
import { formatRial } from "@/lib/format";
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
  const [submitError, setSubmitError] = useState<string[] | null>(null);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [createdEntry, setCreatedEntry] = useState<JournalEntryResponse | null>(
    null,
  );

  // Load the edited voucher into the form whenever the target changes.
  useEffect(() => {
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
  }, [entry]);

  function updateLine(uid: string, patch: Partial<FormLine>) {
    setLines((prev) =>
      prev.map((line) => (line.uid === uid ? { ...line, ...patch } : line)),
    );
  }

  function addLine() {
    const id = nextLineId.current++;
    setLines((prev) => [...prev, createEmptyLine(`line-${id}`)]);
  }

  function removeLine(uid: string) {
    setLines((prev) => (prev.length > 2 ? prev.filter((l) => l.uid !== uid) : prev));
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
    if (!entryNumber.trim()) errors.push("شماره سند الزامی است.");
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
      entryNumber: entryNumber.trim(),
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
        <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
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
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">سطرهای سند</h3>
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                <CirclePlusIcon />
                افزودن سطر
              </Button>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-56">حساب</TableHead>
                    <TableHead className="w-36">بدهکار</TableHead>
                    <TableHead className="w-36">بستانکار</TableHead>
                    <TableHead className="min-w-48">شرح سطر</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => (
                    <TableRow key={line.uid}>
                      <TableCell>
                        <Select<string>
                          value={line.accountCode || null}
                          onValueChange={(value) =>
                            updateLine(line.uid, { accountCode: value ?? "" })
                          }
                        >
                          <SelectTrigger className="w-full">
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
                          helper={false}
                          className="min-w-36"
                          value={line.debit}
                          placeholder="0"
                          onChange={(digits) =>
                            updateLine(line.uid, {
                              debit: digits,
                              credit: "",
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <MoneyInput
                          helper={false}
                          className="min-w-36"
                          value={line.credit}
                          placeholder="0"
                          onChange={(digits) =>
                            updateLine(line.uid, {
                              credit: digits,
                              debit: "",
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={line.description}
                          onChange={(event) =>
                            updateLine(line.uid, { description: event.target.value })
                          }
                          placeholder="شرح اختیاری"
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => removeLine(line.uid)}
                          disabled={lines.length <= 2}
                          title="حذف سطر"
                        >
                          <Trash2Icon />
                        </Button>
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
                {formatRial(difference)}
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
                {formatRial(createdEntry.totalDebit)} / جمع بستانکار{" "}
                {formatRial(createdEntry.totalCredit)}
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
      </CardContent>
    </Card>
  );
}