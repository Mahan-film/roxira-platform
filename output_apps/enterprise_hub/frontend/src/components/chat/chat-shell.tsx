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

type StatutoryItem = string | { title?: string; category?: string; article?: string; law?: string };

type ChatMessage = {
  role: string;
  content: string;
  draft?: string;
  probability?: string;
  statutory_basis?: StatutoryItem[];
};

const ACTION_ICONS: Record<DraftActionKey, typeof FileText> = {
  defense: FileText,
  petition: Gavel,
  complaint: AlertTriangle,
  notice: FileSignature,
};

function statutoryLabel(item: StatutoryItem): string {
  if (typeof item === "string") return item;
  return item.title || item.article || item.law || item.category || "";
}

export function ChatShell() {
  const activeAudioStreamRef = React.useRef<MediaStream | null>(null);
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
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

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

  // تبدیل گفتار به متن (STT): ضبط مستقیم صدا و ارسال آن به موتور سرور.
  // هیچ وابستگی‌ای به Web Speech API مرورگر وجود ندارد (سازگار با Safari فارسی).
  const toggleVoiceRecording = async () => {
    if (isVoiceRecording) {
      // توقف ضبط صوت و ارسال فایل به سرور
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
          setRecordingStatus("");
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

          const res = await fetch("/api/v1/apps/judge/transcribe-audio", {
            method: "POST",
            body: formData,
          });

          const data = res.ok ? await res.json().catch(() => null) : null;
          const transcript = (data?.text || data?.transcript || "").trim();
          if (transcript) setInputPrompt(transcript);
        } catch (err) {
          console.warn("Transcribe-audio request failed:", err);
        } finally {
          setRecordingStatus("");
        }
      };

      // Safari در برابر timeslice مقاوم نیست؛ در صورت خطا بدون بازهٔ زمانی شروع می‌کنیم
      try {
        recorder.start(250);
      } catch (_) {
        recorder.start();
      }
      setIsVoiceRecording(true);
      setRecordingStatus("در حال ضبط...");
    } catch (err) {
      console.warn("Mic error:", err);
      setIsVoiceRecording(false);
      setRecordingStatus("دسترسی به میکروفون تایید نشد. لطفاً در نوار آدرس مرورگر دسترسی را مجاز بفرمایید.");
    }
  };

  const handleSendMessage = async (customPrompt?: string) => {
    const textToSend = customPrompt || inputPrompt;
    if (!textToSend || !textToSend.trim() || isLoading) return;

    const newMsgs = [...messages, { role: "user", content: textToSend }];
    setMessages(newMsgs);
    setInputPrompt("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/v1/apps/judge/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMsgs,
          message: textToSend,
          conversation_id: conversationId || undefined,
          is_vip: true,
          tier: "VIP"
        })
      });
      const data = await res.json();
      if (data.conversation_id && !conversationId) {
        setConversationId(data.conversation_id);
      }
      const reply = data.reply || data.response || "تحلیل ادله و بررسی مواد قانونی با موفقیت انجام شد.";
      setMessages([
        ...newMsgs,
        {
          role: "assistant",
          content: reply,
          draft: data.defense_draft,
          probability: data.success_probability,
          statutory_basis: Array.isArray(data.statutory_basis) ? data.statutory_basis : undefined
        }
      ]);
    } catch (err) {
      setMessages([
        ...newMsgs,
        {
          role: "assistant",
          content: "خطا در ارتباط با سرور. لطفاً چند لحظه بعد دوباره تلاش کنید."
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

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

              <div className="whitespace-pre-line">{msg.content}</div>

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
              <span>در حال تحلیل پرونده...</span>
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
      <div className="shrink-0 space-y-3 px-4 pb-3 pt-3 sm:px-6" style={{ borderTop: "1px solid var(--ap-line)" }}>
        {/* اقدامات حقوقی: چت‌محور + پیوند به صفحه‌های اختصاصی */}
        <div className="ap-chip-row scroll-fade-x" role="group" aria-label="اقدامات حقوقی">
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
          <button type="button" onClick={() => handleSendMessage()} className="ap-btn">
            <span>ارسال</span>
            <Send className="size-4 -scale-x-100" aria-hidden="true" />
          </button>
        </div>

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
