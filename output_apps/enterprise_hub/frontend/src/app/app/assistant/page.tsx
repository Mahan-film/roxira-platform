"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Loader2, MessageSquareText, Paperclip, SendHorizontal, Wrench, X } from "lucide-react";

import { ErrorNotice, PageHeader, loadErrorMessage } from "@/components/app/app-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { InvoiceCaptureCard } from "@/components/app/invoice-capture-card";
import { askAssistant } from "@/lib/api/assistant-client";
import {
  createCapture,
  fetchCaptureQueue,
  fetchCaptureSettings,
  markCaptureReviewed,
  saveCaptureSettings,
} from "@/lib/api/invoice-capture-client";
import { useAssistantEnabled } from "@/lib/use-assistant-enabled";
import { cn } from "@/lib/utils";
import type { AssistantHistoryMessage, AssistantToolCall } from "@/types/assistant";
import type { CaptureSettings, CaptureView } from "@/types/invoice-capture";

interface ChatEntry extends AssistantHistoryMessage {
  toolCalls?: AssistantToolCall[];
  /** Draft card of an invoice the user sent (photo / PDF / voice note). */
  capture?: CaptureView;
}

/** Files the capture pipeline accepts; the server sniffs the real type by magic bytes. */
const CAPTURE_ACCEPT = "image/png,image/jpeg,image/webp,application/pdf,audio/*";

/** صف بازبینی روزانه + تنظیم ثبت خودکار (فقط مدیر سازمان می‌تواند تغییر دهد). */
function CaptureReviewQueue() {
  const [items, setItems] = useState<CaptureView[] | null>(null);
  const [settings, setSettings] = useState<CaptureSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    fetchCaptureQueue().then(setItems).catch((caught) => setError(loadErrorMessage(caught)));
    fetchCaptureSettings().then(setSettings).catch(() => undefined);
  };

  return (
    <details
      className="rounded-xl border border-border p-3 text-sm"
      onToggle={(event) => {
        if ((event.currentTarget as HTMLDetailsElement).open) load();
      }}
    >
      <summary className="cursor-pointer font-bold">
        صف بازبینی روزانهٔ فاکتورها{items ? ` (${items.length.toLocaleString("fa-IR")})` : ""}
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        {settings && (
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={settings.autoEnabled}
              onChange={(event) =>
                saveCaptureSettings({ ...settings, autoEnabled: event.target.checked })
                  .then(setSettings)
                  .catch((caught) => setError(loadErrorMessage(caught)))
              }
            />
            ثبت خودکار فاکتور (پیش‌فرض خاموش؛ فقط برای فروشندگانی که قانون ثبت خودکار دارند و با اطمینان بالا)
          </label>
        )}
        {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
        {items?.length === 0 && <p className="text-xs text-muted-foreground">موردی برای بازبینی نیست.</p>}
        {items?.map((item) => (
          <div key={item.id} className="flex flex-col gap-2">
            <InvoiceCaptureCard
              view={item}
              onChange={(next) => setItems((current) => current?.map((x) => (x.id === next.id ? next : x)) ?? null)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-end"
              onClick={() =>
                markCaptureReviewed(item.id)
                  .then(() => setItems((current) => current?.filter((x) => x.id !== item.id) ?? null))
                  .catch((caught) => setError(loadErrorMessage(caught)))
              }
            >
              بازبینی شد
            </Button>
          </div>
        ))}
      </div>
    </details>
  );
}

/** Persian labels for the read-only tools the backend may call. */
const TOOL_LABELS: Record<string, string> = {
  invoicing_sales_summary: "خلاصه فروش (صورتحساب‌ها)",
  invoicing_customer_balance: "مانده حساب مشتری",
  inventory_low_stock: "کالاهای زیر حد سفارش",
  inventory_list_items: "فهرست کالاها",
  inventory_list_warehouses: "فهرست انبارها",
  inventory_warehouse_stock: "موجودی انبار",
  crm_list_leads: "مشتریان (CRM)",
  accounting_trial_balance: "تراز آزمایشی",
  accounting_account_ledger: "گردش حساب",
};

const SUGGESTIONS = [
  "فروش ماه گذشته چقدر بود؟",
  "کدام کالاها زیر حد سفارش هستند؟",
  "مانده حساب مشتری «آلفا» چقدر است؟",
];

/** Earlier turns sent with each question (backend keeps at most 10). */
const HISTORY_LIMIT = 10;

function ToolCallList({ calls }: { calls: AssistantToolCall[] }) {
  if (calls.length === 0) return null;
  return (
    <details className="mt-2 text-xs text-muted-foreground">
      <summary className="flex cursor-pointer items-center gap-1.5">
        <Wrench className="size-3.5" aria-hidden="true" />
        داده‌هایی که خوانده شد ({calls.length.toLocaleString("fa-IR")})
      </summary>
      <ul className="mt-2 flex flex-col gap-1.5">
        {calls.map((call, index) => (
          <li
            key={`${call.name}-${index}`}
            className="rounded-lg border border-border bg-background/60 px-2.5 py-1.5"
          >
            <span className={cn("font-bold", !call.ok && "text-rose-300")}>
              {TOOL_LABELS[call.name] ?? call.name}
            </span>
            {Object.keys(call.arguments).length > 0 && (
              <code dir="ltr" className="ms-2 break-all font-mono text-[11px]">
                {JSON.stringify(call.arguments)}
              </code>
            )}
            {call.error && <span className="block text-rose-300">{call.error}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

export default function SuiteAssistantPage() {
  const enabled = useAssistantEnabled();
  if (enabled === false) {
    return (
      <PageHeader
        title="دستیار هوشمند"
        description="دستیار هوشمند در حال حاضر فعال نیست."
        icon={<MessageSquareText className="size-6 text-indigo-300" aria-hidden="true" />}
      />
    );
  }
  return <SuiteAssistantChat />;
}

function SuiteAssistantChat() {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries, pending]);

  useEffect(() => () => abortRef.current?.abort(), []);

  /** A file (photo / PDF / voice note) plus optional text goes to invoice capture, not to chat. */
  const sendCapture = async (attachment: File, text: string) => {
    if (pending) return;
    setEntries((current) => [
      ...current,
      { role: "user", content: `${attachment.name}${text.trim() ? `\n${text.trim()}` : ""}` },
    ]);
    setInput("");
    setFile(null);
    setError(null);
    setPending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const capture = await createCapture({ file: attachment, text }, controller.signal);
      setEntries((current) => [
        ...current,
        { role: "assistant", content: "پیش‌نویس سند آماده است؛ فیلدها را بررسی و ثبت کنید.", capture },
      ]);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(loadErrorMessage(caught));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setPending(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const send = async (text: string) => {
    const message = text.trim();
    if (file) {
      await sendCapture(file, text);
      return;
    }
    if (!message || pending) return;
    const history = entries
      .slice(-HISTORY_LIMIT)
      .map(({ role, content }) => ({ role, content }));
    setEntries((current) => [...current, { role: "user", content: message }]);
    setInput("");
    setError(null);
    setPending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await askAssistant({ message, history }, controller.signal);
      setEntries((current) => [
        ...current,
        { role: "assistant", content: response.answer, toolCalls: response.toolCalls },
      ]);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(loadErrorMessage(caught));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setPending(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send(input);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(input);
    }
  };

  return (
    <>
      <PageHeader
        title="دستیار هوشمند"
        description="پرسش‌هایتان درباره فروش، مشتریان، انبار و حساب‌ها را به فارسی بپرسید. برای ثبت فاکتور، عکس، PDF یا پیام صوتی را پیوست کنید؛ پیش‌نویس سند را می‌بینید و تا تأیید شما چیزی ثبت نمی‌شود (مگر ثبت خودکار را مدیر برای فروشنده‌ای فعال کرده باشد)."
        icon={<MessageSquareText className="size-6 text-indigo-300" aria-hidden="true" />}
      />

      <Card className="flex min-h-[60vh] flex-1 flex-col">
        <CardContent className="flex flex-1 flex-col gap-4 p-4">
          <div className="flex flex-1 flex-col gap-3" aria-live="polite">
            {entries.length === 0 && (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
                <p className="text-sm text-muted-foreground">نمونه پرسش‌ها:</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => void send(suggestion)}
                      className="rounded-xl border border-border px-3 py-2 text-xs transition-colors hover:bg-muted"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {entries.map((entry, index) => (
              <div
                key={index}
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-7",
                  entry.role === "user"
                    ? "self-start bg-indigo-500/15 ring-1 ring-indigo-500/30"
                    : "self-end bg-muted",
                )}
              >
                {entry.content}
                {entry.toolCalls && <ToolCallList calls={entry.toolCalls} />}
                {entry.capture && (
                  <div className="mt-3 whitespace-normal">
                    <InvoiceCaptureCard
                      view={entry.capture}
                      onChange={(next) =>
                        setEntries((current) =>
                          current.map((item) =>
                            item.capture?.id === next.id ? { ...item, capture: next } : item,
                          ),
                        )
                      }
                    />
                  </div>
                )}
              </div>
            ))}

            {pending && (
              <span className="flex items-center gap-1.5 self-end text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                در حال خواندن داده‌ها…
              </span>
            )}
            <div ref={endRef} />
          </div>

          <ErrorNotice title="پاسخ دریافت نشد" message={error} />

          <CaptureReviewQueue />

          {file && (
            <div className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-xs">
              <Paperclip className="size-3.5" aria-hidden="true" />
              <span dir="ltr" className="truncate">{file.name}</span>
              <button
                type="button"
                aria-label="حذف پیوست"
                onClick={() => {
                  setFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          )}

          <form onSubmit={onSubmit} className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={CAPTURE_ACCEPT}
              className="hidden"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <Button
              type="button"
              variant="outline"
              aria-label="پیوست عکس، PDF یا پیام صوتی فاکتور"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="size-4" aria-hidden="true" />
            </Button>
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={file ? "توضیح فاکتور (اختیاری)" : "مثلاً: فروش ماه گذشته؟"}
              aria-label="پرسش از دستیار"
              rows={2}
              maxLength={2000}
              className="min-h-0 flex-1 resize-none"
            />
            <Button type="submit" disabled={pending || (!input.trim() && !file)} aria-label="ارسال">
              <SendHorizontal className="size-4 rotate-180" aria-hidden="true" />
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
