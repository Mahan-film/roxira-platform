"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Calculator,
  FileText,
  Gavel,
  Loader2,
  Mic,
  Scale,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
} from "lucide-react";

import {
  analyzeCase,
  calculateDelayDamages,
  getJudgeEngineHealth,
  retrialEvaluate,
  transcribeAudio,
  type RetrialType,
} from "@/lib/api/smart-judge-client";
import { ChatResultView } from "@/components/chat/chat-result";
import { SiteFooter } from "@/components/chat/site-footer";
import type { ChatFlow, ChatMessage } from "@/components/chat/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatRial } from "@/lib/format";
import { cn } from "@/lib/utils";

const RETRIAL_LABEL: Record<RetrialType, string> = {
  CRIMINAL_474: "اعاده دادرسی کیفری — ماده ۴۷۴",
  CIVIL_426: "اعاده دادرسی حقوقی — ماده ۴۲۶",
  SPECIAL_477: "اعاده دادرسی خاص — ماده ۴۷۷",
};

const WELCOME_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "سلام؛ من دستیار حقوقی هوشمند شما هستم. شرح پرونده، دادخواست یا ابطال‌خواهی خود را بنویسید یا با دکمه میکروفون آن را بگویید تا تحلیل، مبنای قانونی و پیش‌نویس لایحه را برایتان آماده کنم.",
};

let messageCounter = 0;
function nextId(): string {
  messageCounter += 1;
  return `msg-${messageCounter}`;
}

const QUICK_ACTIONS = [
  {
    label: "تنظیم لایحه اعاده دادرسی ۴۷۴",
    icon: Gavel,
    action: "retrial" as const,
  },
  { label: "تحلیل دادخواست", icon: FileText, action: "analysis" as const },
  { label: "محاسبه تاخیر تادیه", icon: Calculator, action: "damages" as const },
];

/**
 * فرمت‌های صوتی استاندارد و به‌ترتیب اولویت برای ضبط دیکته.
 * Opus/WebM سبک‌ترین و سازگارترین گزینه در مرورگرهای مبتنی بر Chromium است
 * و در صورت پشتیبانی‌نشدن، به ogg/mp4 عقب‌نشینی می‌کنیم تا خروجی ضبط همیشه
 * با پسوند مجاز سرور (`_ALLOWED_AUDIO_EXT`) منطبق بماند.
 */
const RECORDER_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
];

function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) {
    return undefined;
  }
  return RECORDER_MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

export function ChatShell() {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [flow, setFlow] = useState<ChatFlow>({ kind: "none" });
  const [damagesOpen, setDamagesOpen] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [principal, setPrincipal] = useState("");
  const [startYear, setStartYear] = useState("1400");
  const [endYear, setEndYear] = useState("1404");
  const [formError, setFormError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const push = useCallback((message: Omit<ChatMessage, "id">) => {
    setMessages((prev) => [...prev, { ...message, id: nextId() }]);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    getJudgeEngineHealth(controller.signal)
      .then(() => setOnline(true))
      .catch(() => setOnline(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, busy, damagesOpen, flow]);

  useEffect(() => {
    return () => {
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const runAnalysis = useCallback(
    async (text: string) => {
      setBusy(true);
      try {
        const data = await analyzeCase({ case_text: text, engine_tier: "tier2" });
        push({
          role: "assistant",
          content: "تحلیل پرونده آماده شد:",
          result: { kind: "analysis", data },
        });
      } catch (error) {
        push({
          role: "assistant",
          content: error instanceof Error ? error.message : "تحلیل پرونده ناموفق بود.",
          error: true,
        });
      } finally {
        setBusy(false);
      }
    },
    [push],
  );

  const runDamages = useCallback(
    async (payload: { principal_amount_irr: number; start_year: number; end_year: number }) => {
      setBusy(true);
      setDamagesOpen(false);
      try {
        const data = await calculateDelayDamages(payload);
        push({
          role: "assistant",
          content: "محاسبه خسارت تاخیر تادیه انجام شد:",
          result: { kind: "damages", data },
        });
      } catch (error) {
        push({
          role: "assistant",
          content: error instanceof Error ? error.message : "محاسبه خسارت ناموفق بود.",
          error: true,
        });
      } finally {
        setBusy(false);
      }
    },
    [push],
  );

  const runRetrial = useCallback(
    async (retrialType: RetrialType, description: string, identifier: string) => {
      setBusy(true);
      setFlow({ kind: "none" });
      try {
        const data = await retrialEvaluate({
          retrial_type: retrialType,
          case_description: description,
          user_identifier: identifier,
          is_verified: true,
        });
        push({
          role: "assistant",
          content: "سنجش اعاده دادرسی آماده شد:",
          result: { kind: "retrial", data },
        });
      } catch (error) {
        push({
          role: "assistant",
          content: error instanceof Error ? error.message : "ارزیابی اعاده دادرسی ناموفق بود.",
          error: true,
        });
      } finally {
        setBusy(false);
      }
    },
    [push],
  );

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    push({ role: "user", content: text });
    setInput("");

    if (flow.kind === "retrial-description") {
      setFlow({ kind: "retrial-identity", retrialType: flow.retrialType, description: text });
      push({
        role: "assistant",
        content:
          "بسیار خب. اکنون شماره موبایل یا نشانی ایمیل خود را وارد کنید تا هویت شما بررسی و تحلیل اعاده دادرسی آغاز شود.",
      });
      return;
    }

    if (flow.kind === "retrial-identity") {
      setFlow({
        kind: "retrial-confirm",
        retrialType: flow.retrialType,
        description: flow.description,
        identifier: text,
      });
      push({
        role: "assistant",
        content:
          "برای حفظ محرمانگی پرونده، تأیید هویت الزامی است. در ادامه تأیید کنید تا شانس پذیرش اعاده دادرسی و دادخواست رسمی آماده شود.",
      });
      return;
    }

    await runAnalysis(text);
  }, [busy, flow, input, push, runAnalysis]);

  const handleQuickAction = useCallback(
    (action: "analysis" | "retrial" | "damages") => {
      if (busy) return;
      setNotice(null);
      if (action === "analysis") {
        setFlow({ kind: "none" });
        setDamagesOpen(false);
        push({
          role: "assistant",
          content:
            "متن دادخواست، شرح پرونده یا خواسته خود را بنویسید؛ من مواد قانونی، استدلال و پیش‌نویس لایحه را تهیه می‌کنم.",
        });
      } else if (action === "retrial") {
        setDamagesOpen(false);
        setFlow({ kind: "retrial-description", retrialType: "CRIMINAL_474" });
        push({
          role: "assistant",
          content: `${RETRIAL_LABEL.CRIMINAL_474} انتخاب شد. لطفاً شرح ادله جدید و ابطال‌خواهی خود را بنویسید.`,
        });
      } else {
        setFlow({ kind: "none" });
        setDamagesOpen(true);
      }
      inputRef.current?.focus();
    },
    [busy, push],
  );

  const toggleRecording = useCallback(async () => {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setNotice("مرورگر شما از ضبط صدا پشتیبانی نمی‌کند.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const mimeType = pickRecorderMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (!blob.size) return;
        setTranscribing(true);
        try {
          const text = await transcribeAudio(blob);
          if (text) {
            setInput((prev) => (prev ? `${prev} ${text}` : text));
            inputRef.current?.focus();
          } else {
            setNotice("گفتاری تشخیص داده نشد؛ لطفاً دوباره تلاش کنید.");
          }
        } catch (error) {
          setNotice(error instanceof Error ? error.message : "تبدیل گفتار ناموفق بود.");
        } finally {
          setTranscribing(false);
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setNotice(null);
      setRecording(true);
    } catch {
      setNotice("دسترسی به میکروفون امکان‌پذیر نیست.");
    }
  }, [recording]);

  const submitDamages = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const amount = Number(principal.replace(/[^\d]/g, ""));
      const sy = Number(startYear);
      const ey = Number(endYear);
      if (!amount) {
        setFormError("مبلغ اصل را به ریال وارد کنید.");
        return;
      }
      if (!sy || !ey || ey < sy) {
        setFormError("بازه سال‌ها معتبر نیست.");
        return;
      }
      setFormError(null);
      push({
        role: "user",
        content: `محاسبه خسارت تاخیر تادیه برای مبلغ ${formatRial(amount)} از سال ${sy} تا ${ey}`,
      });
      void runDamages({ principal_amount_irr: amount, start_year: sy, end_year: ey });
    },
    [endYear, principal, push, runDamages, startYear],
  );

  const confirmRetrial = useCallback(() => {
    if (flow.kind !== "retrial-confirm") return;
    push({ role: "user", content: "تأیید هویت انجام شد." });
    void runRetrial(flow.retrialType, flow.description, flow.identifier);
  }, [flow, push, runRetrial]);

  const statusLabel = online === false ? "در حال اتصال مجدد" : "آماده پاسخگویی";
  const statusTone =
    online === null ? "bg-slate-500" : online ? "bg-emerald-400" : "bg-rose-400";

  return (
    <div className="dark flex h-dvh flex-col bg-[#070B14] text-slate-100">
      <header className="relative z-20 border-b border-white/5 bg-[#0A0F1C]/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400/25 to-amber-600/10 ring-1 ring-amber-400/25">
              <Scale className="size-5 text-amber-300" />
            </span>
            <div>
              <div className="text-sm font-bold">قاضی هوشمند</div>
              <div className="text-[10px] text-slate-400">دستیار حقوقی هوشمند</div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-slate-300">
            <span className={cn("size-2 rounded-full", statusTone)} />
            {statusLabel}
          </div>
        </div>
      </header>

      <main ref={scrollRef} className="relative flex-1 overflow-y-auto">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(201,162,75,0.10),transparent_70%)]"
        />
        <div className="relative mx-auto w-full max-w-3xl space-y-5 px-4 py-8">
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[92%] rounded-2xl border px-4 py-3 sm:max-w-[85%]",
                  message.role === "user"
                    ? "rounded-bl-md border-amber-400/25 bg-gradient-to-br from-amber-400/15 to-amber-600/5 text-amber-50"
                    : "rounded-br-md border-white/8 bg-[#0E1626] text-slate-100",
                  message.error && "border-rose-400/30 bg-rose-500/10 text-rose-200",
                )}
              >
                {message.role === "assistant" && (
                  <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold text-amber-300/80">
                    <Scale className="size-3" />
                    قاضی هوشمند
                  </div>
                )}
                {message.content && (
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed">
                    {message.content}
                  </p>
                )}
                {message.result && (
                  <div className="mt-3">
                    <ChatResultView result={message.result} />
                  </div>
                )}
              </div>
            </div>
          ))}

          {busy && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl rounded-br-md border border-white/8 bg-[#0E1626] px-4 py-3">
                <span className="flex gap-1">
                  <span className="size-1.5 animate-bounce rounded-full bg-amber-300 [animation-delay:-0.3s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-amber-300 [animation-delay:-0.15s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-amber-300" />
                </span>
                <span className="text-[11px] text-slate-400">در حال تحلیل...</span>
              </div>
            </div>
          )}

          {flow.kind === "retrial-confirm" && (
            <div className="flex justify-start">
              <div className="w-full max-w-md rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] p-4">
                <div className="flex items-center gap-2 text-[13px] font-bold text-amber-200">
                  <ShieldCheck className="size-4" />
                  تأیید هویت و سنجش اعاده دادرسی
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-300">
                  شناسه ثبت‌شده:{" "}
                  <span dir="ltr" className="font-mono text-slate-100">
                    {flow.identifier}
                  </span>
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    onClick={confirmRetrial}
                    disabled={busy}
                    className="bg-amber-400 text-slate-950 hover:bg-amber-300"
                  >
                    {busy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Sparkles className="size-4" />
                    )}
                    تأیید و دریافت تحلیل
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setFlow({ kind: "none" })}
                    disabled={busy}
                  >
                    انصراف
                  </Button>
                </div>
              </div>
            </div>
          )}

          {damagesOpen && (
            <div className="flex justify-start">
              <form
                onSubmit={submitDamages}
                className="w-full max-w-md space-y-3 rounded-2xl border border-white/10 bg-[#0E1626] p-4"
              >
                <div className="flex items-center gap-2 text-[13px] font-bold text-amber-200">
                  <Calculator className="size-4" />
                  محاسبه خسارت تاخیر تادیه
                </div>
                <label className="block space-y-1.5">
                  <span className="text-[11px] text-slate-400">مبلغ اصل (ریال)</span>
                  <Input
                    value={principal}
                    onChange={(event) => setPrincipal(event.target.value)}
                    placeholder="2000000000"
                    dir="ltr"
                    className="border-white/10 bg-black/30 text-slate-100 placeholder:text-slate-600"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block space-y-1.5">
                    <span className="text-[11px] text-slate-400">سال شروع</span>
                    <Input
                      value={startYear}
                      onChange={(event) => setStartYear(event.target.value)}
                      dir="ltr"
                      className="border-white/10 bg-black/30 text-slate-100"
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-[11px] text-slate-400">سال پایان</span>
                    <Input
                      value={endYear}
                      onChange={(event) => setEndYear(event.target.value)}
                      dir="ltr"
                      className="border-white/10 bg-black/30 text-slate-100"
                    />
                  </label>
                </div>
                {formError && <p className="text-[11px] text-rose-300">{formError}</p>}
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    disabled={busy}
                    className="bg-amber-400 text-slate-950 hover:bg-amber-300"
                  >
                    محاسبه
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setDamagesOpen(false)}
                  >
                    بستن
                  </Button>
                </div>
              </form>
            </div>
          )}
        </div>

        <SiteFooter />
      </main>

      <div className="relative z-20 border-t border-white/5 bg-[#0A0F1C]/85 px-4 py-3 backdrop-blur">
        <div className="mx-auto w-full max-w-3xl space-y-3">
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {QUICK_ACTIONS.map(({ label, icon: Icon, action }) => (
              <button
                key={label}
                type="button"
                onClick={() => handleQuickAction(action)}
                disabled={busy}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-2 text-[12px] text-slate-300 transition-all hover:border-amber-400/40 hover:bg-amber-400/10 hover:text-amber-100 disabled:opacity-50"
              >
                <Icon className="size-3.5 text-amber-300" />
                {label}
              </button>
            ))}
          </div>

          {recording && (
            <p className="flex items-center gap-1.5 text-[11px] text-rose-300">
              <span className="size-2 animate-pulse rounded-full bg-rose-400" />
              در حال ضبط صدا… برای پایان، دکمه توقف را بزنید.
            </p>
          )}

          {transcribing && (
            <p className="flex items-center gap-1.5 text-[11px] text-amber-200/90">
              <Loader2 className="size-3 animate-spin" />
              در حال تبدیل صوت به متن…
            </p>
          )}

          {notice && <p className="text-[11px] text-amber-200/80">{notice}</p>}

          {flow.kind !== "retrial-confirm" && (
            <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-[#0B111F] p-2 transition-colors focus-within:border-amber-400/40">
              <Textarea
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
                rows={1}
                placeholder="شرح پرونده، پرسش حقوقی یا ابطال‌خواهی خود را بنویسید..."
                className="max-h-32 min-h-10 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-[13px] text-slate-100 shadow-none placeholder:text-slate-500 focus-visible:ring-0 dark:bg-transparent"
              />
              <button
                type="button"
                onClick={() => void toggleRecording()}
                disabled={transcribing || busy}
                aria-label="ضبط صدا"
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-xl border transition-all disabled:opacity-50",
                  recording
                    ? "border-rose-400/40 bg-rose-500/15 text-rose-300"
                    : "border-white/10 bg-white/5 text-slate-300 hover:text-amber-300",
                )}
              >
                {transcribing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : recording ? (
                  <Square className="size-4" />
                ) : (
                  <Mic className="size-4" />
                )}
              </button>
              <Button
                type="button"
                onClick={() => void handleSend()}
                disabled={busy || !input.trim()}
                aria-label="ارسال پیام"
                className="size-9 shrink-0 rounded-xl bg-amber-400 p-0 text-slate-950 hover:bg-amber-300"
              >
                <Send className="size-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
