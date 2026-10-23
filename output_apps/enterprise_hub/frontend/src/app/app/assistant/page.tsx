"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Loader2, MessageSquareText, SendHorizontal, Wrench } from "lucide-react";

import { ErrorNotice, PageHeader, loadErrorMessage } from "@/components/app/app-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { askAssistant } from "@/lib/api/assistant-client";
import { useAssistantEnabled } from "@/lib/use-assistant-enabled";
import { cn } from "@/lib/utils";
import type { AssistantHistoryMessage, AssistantToolCall } from "@/types/assistant";

interface ChatEntry extends AssistantHistoryMessage {
  toolCalls?: AssistantToolCall[];
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
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries, pending]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = async (text: string) => {
    const message = text.trim();
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
        description="پرسش‌هایتان درباره فروش، مشتریان، انبار و حساب‌ها را به فارسی بپرسید. دستیار فقط داده‌های سازمان شما را می‌خواند و چیزی را تغییر نمی‌دهد."
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

          <form onSubmit={onSubmit} className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="مثلاً: فروش ماه گذشته؟"
              aria-label="پرسش از دستیار"
              rows={2}
              maxLength={2000}
              className="min-h-0 flex-1 resize-none"
            />
            <Button type="submit" disabled={pending || !input.trim()} aria-label="ارسال">
              <SendHorizontal className="size-4 rotate-180" aria-hidden="true" />
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
