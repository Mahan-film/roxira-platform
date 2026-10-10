"use client";
import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  FileSignature,
  FileText,
  Gavel,
  Info,
  Mic,
  Phone,
  RotateCw,
  Send,
  Square,
} from "lucide-react";
import {
  COMPETENCE_NOTE,
  DISCLAIMER_LINE,
  DRAFT_ACTIONS,
  DRAFT_PAGES,
  STARTER_GROUPS,
  findDraftAction,
  type DraftActionKey,
} from "@/lib/chat-actions";
import { LiveVoiceModal, unlockSafariAudio } from "./live-voice-modal";
import { ChatHttpError, streamChat } from "@/lib/api/chat-stream";
import { LegalStreamingText } from "./legal-streaming-text";
import { useAuth } from "@/components/auth/auth-provider";
import {
  CHAT_TIMEOUT_MS,
  EMPTY_FAILURE,
  JUDGE_TRANSCRIBE_PATH,
  MAX_CHAT_CHARS,
  MAX_RECORDING_MS,
  NETWORK_FAILURE,
  RetryTimeoutError,
  TIMEOUT_FAILURE,
  authHeaders,
  clearPending,
  failureFromResponse,
  fetchWithRetry,
  loadPending,
  newRequestId,
  savePending,
  type ChatFailure,
} from "@/lib/api/judge-chat-client";

type StatutoryItem =
  | string
  | { title?: string; category?: string; article?: string; law?: string; law_name?: string; article_no?: string | number; number?: string | number };

type ChatMessage = {
  role: string;
  content: string;
  draft?: string;
  probability?: string;
  statutory_basis?: StatutoryItem[];
  /** Typewriter animation still running for this (fresh) answer. */
  animating?: boolean;
  /** Error bubble; `retryPrompt` is the user text to resend. */
  isError?: boolean;
  retryPrompt?: string;
  /** Idempotency id of the failed question; a manual retry reuses it. */
  retryRequestId?: string;
};

const ACTION_ICONS: Record<DraftActionKey, typeof FileText> = {
  defense: FileText,
  petition: Gavel,
  complaint: AlertTriangle,
  notice: FileSignature,
};

function statutoryLabel(item: StatutoryItem): string {
  if (typeof item === "string") return item;
  if (item.title) return item.title;
  const law = item.law_name || item.law || "";
  const art = item.article_no ?? item.article ?? item.number;
  const lawArt = [art !== undefined && art !== "" ? `ماده ${art}` : "", law].filter(Boolean).join(" ");
  return lawArt || item.category || "";
}

export function ChatShell() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "سلام. شرح پرونده یا پرسش حقوقی خود را بنویسید، یا با میکروفون بگویید."
    }
  ]);
  const [inputPrompt, setInputPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string>("");
  const [isVoiceRecording, setIsVoiceRecording] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState("");
  const [isLiveAudioOpen, setIsLiveAudioOpen] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [weakConnection, setWeakConnection] = useState(false);
  const recoveredRef = useRef(false);
  const { getAccessToken, isAuthenticated, openLogin, logout } = useAuth();
  const recordingTimerRef = useRef<number | null>(null);
  const statusClearRef = useRef<number | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  // /chat?draft=defense|petition|complaint|notice (links from the header menu)
  // pre-fill the composer; the user reviews and sends it.
  const searchParams = useSearchParams();
  const draftParam = searchParams.get("draft");
  const [appliedDraft, setAppliedDraft] = useState<string | null>(null);
  if (draftParam !== appliedDraft) {
    setAppliedDraft(draftParam);
    const action = findDraftAction(draftParam);
    if (action) setInputPrompt(action.prompt);
  }

  const showVoiceError = (message: string) => {
    setRecordingStatus(message);
    if (statusClearRef.current) window.clearTimeout(statusClearRef.current);
    statusClearRef.current = window.setTimeout(() => setRecordingStatus(""), 8000);
  };

  // نشست منقضی/نامعتبر: پاک‌سازی سشن و باز کردن مودال ورود
  const handleSessionExpired = () => {
    logout();
    openLogin({
      serviceDomain: "GHAZI",
      title: "ورود مجدد",
      description: "نشست شما منقضی شده است. برای ادامه دوباره وارد شوید.",
    });
  };

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) window.clearTimeout(recordingTimerRef.current);
      if (statusClearRef.current) window.clearTimeout(statusClearRef.current);
    };
  }, []);

  // تبدیل گفتار به متن (STT): ضبط مستقیم صدا و ارسال آن به موتور سرور.
  // هیچ وابستگی‌ای به Web Speech API مرورگر وجود ندارد (سازگار با Safari فارسی).
  const toggleVoiceRecording = async () => {
    if (isVoiceRecording) {
      // توقف ضبط صوت و ارسال فایل به سرور
      if (recordingTimerRef.current) {
        window.clearTimeout(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        setRecordingStatus("در حال پردازش صدا...");
        mediaRecorderRef.current.stop();
      }
      return;
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        // بدون alert مسدودکننده: پیام وضعیت درون‌خطی
        setRecordingStatus("مرورگر شما از ورودی میکروفون پشتیبانی نمی‌کند.");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "";

      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        setIsVoiceRecording(false);
        if (recordingTimerRef.current) {
          window.clearTimeout(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }

        // توقف ترک‌های سخت‌افزاری میکروفون
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }

        // نکتهٔ Safari: آخرین قطعه هنگام stop() در ondataavailable تحویل داده می‌شود
        // (که پیش از onstop اجرا می‌شود)؛ پس تا اینجا همهٔ قطعه‌ها جمع شده‌اند.
        const blobType =
          recorder.mimeType ||
          audioChunksRef.current[0]?.type ||
          "audio/webm";
        const audioBlob = new Blob(audioChunksRef.current, { type: blobType });
        audioChunksRef.current = [];

        if (audioBlob.size === 0) {
          showVoiceError("صدایی ضبط نشد. میکروفون را بررسی کنید و دوباره تلاش کنید.");
          return;
        }

        // صوت ضبط‌شده همیشه مستقیماً به‌صورت multipart/form-data به موتور STT فرستاده می‌شود
        try {
          setRecordingStatus("در حال تبدیل گفتار به متن...");
          const ext = /mp4|m4a|aac/i.test(blobType)
            ? "m4a"
            : /ogg/i.test(blobType)
            ? "ogg"
            : /wav/i.test(blobType)
            ? "wav"
            : "webm";
          const formData = new FormData();
          formData.append("file", audioBlob, `speech.${ext}`);

          const res = await fetchWithRetry(
            JUDGE_TRANSCRIBE_PATH,
            { method: "POST", headers: authHeaders(getAccessToken()), body: formData },
            {
              maxAttempts: 2,
              timeoutMs: CHAT_TIMEOUT_MS,
              retryOnGatewayStatus: false,
              requestId: newRequestId(),
              onRetry: () => setRecordingStatus("اتصال ضعیف است؛ در حال تلاش دوباره…"),
            },
          );

          if (res.status === 401) {
            handleSessionExpired();
            showVoiceError("نشست شما منقضی شده است. لطفاً دوباره وارد شوید.");
            return;
          }
          if (res.status === 429) {
            showVoiceError("تعداد درخواست‌ها بیش از حد مجاز است. چند دقیقه بعد دوباره تلاش کنید.");
            return;
          }
          const data = res.ok ? await res.json().catch(() => null) : null;
          const transcript = String(data?.text || data?.transcript || "").trim();
          if (transcript) {
            setInputPrompt(transcript.slice(0, MAX_CHAT_CHARS));
            setRecordingStatus("");
          } else if (!res.ok) {
            showVoiceError("تبدیل گفتار به متن انجام نشد. لطفاً دوباره تلاش کنید یا پیام را تایپ کنید.");
          } else {
            showVoiceError("گفتار شما تشخیص داده نشد. واضح‌تر و نزدیک‌تر به میکروفون صحبت کنید.");
          }
        } catch (err) {
          console.warn("Transcribe-audio request failed:", err);
          showVoiceError("ارتباط با سرور برقرار نشد. لطفاً دوباره تلاش کنید.");
        }
      };

      // Safari در برابر timeslice مقاوم نیست؛ در صورت خطا بدون بازهٔ زمانی شروع می‌کنیم
      try {
        recorder.start(250);
      } catch {
        recorder.start();
      }
      setIsVoiceRecording(true);
      setRecordingStatus("در حال ضبط... (حداکثر ۲ دقیقه)");
      // سقف زمان ضبط: پس از ۱۲۰ ثانیه به‌طور خودکار متوقف و ارسال می‌شود
      recordingTimerRef.current = window.setTimeout(() => {
        recordingTimerRef.current = null;
        if (recorder.state !== "inactive") {
          setRecordingStatus("حداکثر زمان ضبط به پایان رسید؛ در حال پردازش صدا...");
          recorder.stop();
        }
      }, MAX_RECORDING_MS);
    } catch (err) {
      console.warn("Mic error:", err);
      setIsVoiceRecording(false);
      setRecordingStatus("دسترسی به میکروفون تایید نشد. لطفاً در نوار آدرس مرورگر دسترسی را مجاز بفرمایید.");
    }
  };

  const errorBubble = (failure: ChatFailure, prompt: string, requestId: string): ChatMessage => ({
    role: "assistant",
    content: failure.message,
    isError: true,
    retryPrompt: failure.retryable ? prompt : undefined,
    retryRequestId: failure.retryable ? requestId : undefined,
  });

  // پیشرفت: شمارندهٔ ثانیه‌ها تا زمانی که درخواست در جریان است
  useEffect(() => {
    if (!isLoading) return;
    const started = Date.now();
    const id = window.setInterval(() => setElapsedSec(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => {
      window.clearInterval(id);
      setElapsedSec(0);
      setWeakConnection(false);
    };
  }, [isLoading]);

  const sendChat = async (textToSend: string, baseMsgs: ChatMessage[], requestIdIn?: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    const requestId = requestIdIn ?? newRequestId();
    setMessages(baseMsgs);
    setIsLoading(true);
    savePending(textToSend, requestId);

    const finish = (msg: ChatMessage) => setMessages([...baseMsgs, msg]);

    try {
      // فقط نقش و متن پیام‌های واقعی ارسال می‌شود؛ tier/phone/is_vip را سرور از توکن می‌خواند
      const history = baseMsgs
        .filter((m) => !m.isError)
        .map((m) => ({ role: m.role, content: m.content }));
      let streamed = "";
      const data = await streamChat({
        headers: authHeaders(getAccessToken()),
        payload: {
          messages: history,
          message: textToSend,
          conversation_id: conversationId || undefined,
          request_id: requestId,
        },
        onDelta: (piece) => {
          streamed += piece;
          setWeakConnection(false);
          setIsLoading(false); // first text arrived: hide the spinner, show live text
          setMessages([...baseMsgs, { role: "assistant", content: streamed }]);
        },
        onReset: () => {
          streamed = "";
          setIsLoading(true);
          setMessages(baseMsgs);
        },
        onRetry: () => setWeakConnection(true),
      });
      setWeakConnection(false);

      const reply = typeof (data?.reply ?? data?.response) === "string" ? String(data.reply ?? data.response).trim() : "";
      if (!reply) {
        finish(errorBubble(EMPTY_FAILURE, textToSend, requestId));
        return;
      }
      clearPending();
      if (data.conversation_id && !conversationId) {
        setConversationId(data.conversation_id);
      }
      finish({
        role: "assistant",
        content: reply,
        draft: data.defense_draft,
        probability: data.success_probability,
        statutory_basis: Array.isArray(data.statutory_basis) ? (data.statutory_basis as StatutoryItem[]) : undefined,
        // text already streamed live: no typewriter replay
        animating: !streamed,
      });
    } catch (err) {
      setWeakConnection(false);
      if (err instanceof ChatHttpError) {
        const failure = failureFromResponse(err.status, err.body);
        if (failure.kind === "auth") handleSessionExpired();
        if (!failure.retryable) clearPending();
        finish(errorBubble(failure, textToSend, requestId));
      } else {
        finish(errorBubble(err instanceof RetryTimeoutError ? TIMEOUT_FAILURE : NETWORK_FAILURE, textToSend, requestId));
      }
    } finally {
      busyRef.current = false;
      setIsLoading(false);
    }
  };

  const handleSendMessage = async (customPrompt?: string) => {
    const textToSend = customPrompt || inputPrompt;
    if (!textToSend || !textToSend.trim() || isLoading || busyRef.current) return;
    if (textToSend.length > MAX_CHAT_CHARS) return;

    setInputPrompt("");
    await sendChat(textToSend, [...messages, { role: "user", content: textToSend }]);
  };

  // تلاش مجدد: حباب خطا حذف و همان پرسش بدون تکرار پیام کاربر دوباره ارسال می‌شود
  const handleRetry = async (idx: number) => {
    if (isLoading) return;
    const msg = messages[idx];
    if (!msg?.retryPrompt) return;
    await sendChat(msg.retryPrompt, messages.slice(0, idx), msg.retryRequestId);
  };

  // بازیابی پاسخ پس از بارگذاری مجدد صفحه: همان request_id دوباره ارسال می‌شود
  useEffect(() => {
    if (recoveredRef.current || !isAuthenticated) return;
    recoveredRef.current = true;
    const pending = loadPending();
    if (!pending) return;
    window.setTimeout(() => {
      void sendChat(pending.text, [...messages, { role: "user", content: pending.text }], pending.request_id);
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  const overLimit = inputPrompt.length > MAX_CHAT_CHARS;

  const showExamples = !isLoading && !messages.some((msg) => msg.role === "user");

  return (
    <div className="flex flex-col h-full w-full max-w-[var(--ap-content-max)] mx-auto overflow-hidden">
      {/* ناحیه اسکرول پیام‌ها */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-6 space-y-4">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`ap-bubble ${msg.role === "user" ? "ap-bubble-user" : "ap-bubble-ai"}`}>
              {msg.role === "assistant" && (
                <div className="flex items-center gap-2 mb-2 ap-notice">
                  <span>دستیار</span>
                  {msg.probability && (
                    <span className="ms-auto rounded-full px-2 py-0.5" style={{ background: "var(--ap-surface-2)" }}>
                      احتمال موفقیت: {msg.probability}
                    </span>
                  )}
                </div>
              )}

              {msg.role === "assistant" && !msg.isError ? (
                <LegalStreamingText
                  variant="plain"
                  content={msg.content}
                  isStreaming={Boolean(msg.animating)}
                  onComplete={() =>
                    setMessages((prev) =>
                      prev.map((m, i) => (i === idx && m.animating ? { ...m, animating: false } : m)),
                    )
                  }
                />
              ) : (
                <div
                  className="whitespace-pre-line"
                  role={msg.isError ? "alert" : undefined}
                  style={msg.isError ? { color: "var(--ap-danger)" } : undefined}
                >
                  {msg.content}
                </div>
              )}

              {msg.isError && msg.retryPrompt && (
                <button type="button" onClick={() => void handleRetry(idx)} disabled={isLoading} className="ap-chip mt-2">
                  <RotateCw className="size-4" aria-hidden="true" />
                  <span>تلاش مجدد</span>
                </button>
              )}

              {msg.draft && (
                <div className="mt-3 p-3 rounded-[14px]" style={{ background: "var(--ap-surface-2)" }}>
                  <div className="flex items-center justify-between gap-2 mb-2 text-sm font-semibold" style={{ color: "var(--ap-warn)" }}>
                    <span>پیش‌نویس لایحه قانونی:</span>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(msg.draft || "")}
                      className="ap-chip"
                    >
                      کپی لایحه
                    </button>
                  </div>
                  <pre className="ap-muted text-xs font-mono whitespace-pre-wrap leading-relaxed">{msg.draft}</pre>
                </div>
              )}

              {msg.role === "assistant" && msg.statutory_basis && msg.statutory_basis.length > 0 && (
                <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--ap-line)" }}>
                  <div className="mb-1.5 text-sm font-semibold ap-link">مستندات</div>
                  <ul className="list-disc ps-4 space-y-1 ap-notice">
                    {msg.statutory_basis.map((item, itemIdx) => (
                      <li key={itemIdx}>{statutoryLabel(item)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start" role="status">
            <div className="ap-bubble ap-bubble-ai flex items-center gap-2 text-sm">
              <span className="w-2 h-2 rounded-full animate-ping" style={{ background: "var(--ap-accent)" }} aria-hidden="true" />
              <span>
                {weakConnection
                  ? "اتصال ضعیف است؛ در حال تلاش دوباره…"
                  : elapsedSec >= 8
                  ? `در حال بررسی قوانین و آرا… ${elapsedSec.toLocaleString("fa-IR")} ثانیه`
                  : "در حال تحلیل پرونده..."}
              </span>
            </div>
          </div>
        )}

        {/* پرسش‌های نمونه، گروه‌بندی‌شده، در ناحیه خالی پیام‌ها */}
        {showExamples && (
          <section className="space-y-5 pt-2" aria-label="پرسش‌های نمونه">
            <p className="ap-notice">{COMPETENCE_NOTE}</p>
            {STARTER_GROUPS.map((group) => (
              <div key={group.title}>
                <h2 className="ap-group-title">{group.title}</h2>
                <div className="ap-starter-grid">
                  {group.items.map((item) => (
                    <button
                      key={item.title}
                      type="button"
                      onClick={() => handleSendMessage(item.prompt)}
                      className="ap-starter"
                    >
                      <span className="font-semibold">{item.title}</span>
                      <span className="mt-1 block ap-muted text-xs leading-relaxed line-clamp-2">{item.prompt}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ناحیه ورودی داک‌شده در پایین */}
      <div className="shrink-0 space-y-2 px-4 pb-2 pt-2 sm:space-y-3 sm:px-6 sm:pb-3 sm:pt-3" style={{ borderTop: "1px solid var(--ap-line)" }}>
        {/* اقدامات حقوقی: چت‌محور + پیوند به صفحه‌های اختصاصی */}
        <div className="ap-chip-row scroll-fade-x max-w-full min-w-0 touch-pan-x" role="group" aria-label="اقدامات حقوقی">
          <span className="ap-notice whitespace-nowrap font-semibold">اقدامات حقوقی</span>
          {DRAFT_PAGES.map((page) => (
            <Link key={page.href} href={page.href} className="ap-chip ap-chip-link">
              <FileText className="size-4" aria-hidden="true" />
              <span>{page.label}</span>
            </Link>
          ))}
          {DRAFT_ACTIONS.map((action) => {
            const Icon = ACTION_ICONS[action.key];
            return (
              <button key={action.key} type="button" onClick={() => handleSendMessage(action.prompt)} className="ap-chip">
                <Icon className="size-4 ap-chip-icon" aria-hidden="true" />
                <span>{action.label}</span>
              </button>
            );
          })}
        </div>

        {/* وضعیت زنده ضبط صدا */}
        {recordingStatus && (
          <div className="ap-notice flex items-center gap-2" role="status" aria-live="polite">
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: "var(--ap-danger)" }} aria-hidden="true" />
            <span style={{ color: "var(--ap-text)" }}>{recordingStatus}</span>
          </div>
        )}

        {/* جعبه ارسال پیام و دکمه‌های صوتی */}
        <div className="ap-composer">
          <input
            type="text"
            aria-label="پیام شما"
            placeholder="پیام خود را بنویسید..."
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            aria-invalid={overLimit}
            onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
          />

          {/* دکمه تبدیل گفتار به متن (Voice STT) */}
          <button
            type="button"
            onClick={toggleVoiceRecording}
            className={`ap-iconbtn ${isVoiceRecording ? "animate-pulse" : ""}`}
            data-active={isVoiceRecording}
            aria-label={isVoiceRecording ? "اتمام ضبط" : "تبدیل گفتار به متن"}
            aria-pressed={isVoiceRecording}
            title={isVoiceRecording ? "اتمام ضبط" : "تبدیل گفتار به متن"}
          >
            {isVoiceRecording ? <Square className="size-4" aria-hidden="true" /> : <Mic className="size-5" aria-hidden="true" />}
          </button>

          {/* دکمه تماس صوتی زنده */}
          <button
            type="button"
            onClick={() => {
              // Safari: unlock audio inside the real user gesture, so the whole
              // voice session (every later TTS turn) is allowed to make sound.
              unlockSafariAudio();
              setIsLiveAudioOpen(true);
            }}
            className="ap-iconbtn"
            aria-label="مکالمه صوتی زنده"
            title="مکالمه صوتی زنده"
          >
            <Phone className="size-5" aria-hidden="true" />
          </button>

          {/* دکمه ارسال پیام */}
          <button type="button" onClick={() => handleSendMessage()} disabled={isLoading || overLimit} className="ap-btn">
            <span>ارسال</span>
            <Send className="size-4 -scale-x-100" aria-hidden="true" />
          </button>
        </div>

        {(inputPrompt.length > MAX_CHAT_CHARS * 0.8 || overLimit) && (
          <div
            className="ap-notice text-end"
            style={overLimit ? { color: "var(--ap-danger)" } : undefined}
            role={overLimit ? "alert" : undefined}
          >
            {inputPrompt.length.toLocaleString("fa-IR")} / {MAX_CHAT_CHARS.toLocaleString("fa-IR")}
            {overLimit ? " — پیام طولانی‌تر از حد مجاز است؛ لطفاً کوتاه‌تر کنید." : ""}
          </div>
        )}

        {!isAuthenticated && (
          <p className="ap-notice text-center">
            <button
              type="button"
              className="ap-link underline"
              onClick={() =>
                openLogin({
                  serviceDomain: "GHAZI",
                  title: "ورود به قاضی هوشمند",
                  description: "برای پاسخ‌های کامل‌تر وارد شوید؛ کد تأیید به شمارهٔ همراه شما پیامک می‌شود.",
                })
              }
            >
              برای پاسخ‌های کامل‌تر وارد شوید
            </button>
          </p>
        )}

        {/* سلب مسئولیت حقوقی دائمی، پررنگ زیر جعبهٔ پیام */}
        <p className="ap-disclaimer" role="note">
          <Info className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{DISCLAIMER_LINE}</span>
        </p>
      </div>


      {/* مدال مکالمه صوتی زنده با همگام‌سازی کامل به صفحه چت */}
      <LiveVoiceModal
        isOpen={isLiveAudioOpen}
        onClose={() => setIsLiveAudioOpen(false)}
        conversationId={conversationId}
        onConversationIdChange={(id) => setConversationId(id)}
        onNewMessage={(userText, aiReply, draft, prob) => {
          setMessages((prev) => [
            ...prev,
            { role: "user", content: userText },
            {
              role: "assistant",
              content: aiReply,
              draft: draft,
              probability: prob,
            },
          ]);
        }}
        onTriggerLegalDraft={(_type, _title, prompt) => {
          handleSendMessage(prompt);
        }}
      />
    </div>
  );
}

export default ChatShell;
