"use client";
import React, { useState, useRef, useEffect } from "react";
import {
  AlertTriangle,
  FileSignature,
  FileText,
  Gavel,
  Mic,
  Phone,
  Send,
  Square,
} from "lucide-react";
import { LiveVoiceModal, unlockSafariAudio } from "./live-voice-modal";

export function ChatShell() {
  const activeAudioStreamRef = React.useRef<MediaStream | null>(null);
  const [messages, setMessages] = useState<Array<{role: string, content: string, draft?: string, probability?: string}>>([
    {
      role: "assistant",
      content: "سلام؛ شرح پرونده یا پرسش حقوقی خود را بنویسید یا با میکروفون بگویید."
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
          probability: data.success_probability
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

  const quickPrompts = [
    { title: "استراتژی پرونده", prompt: "استراتژی دفاعی پرونده با تکیه بر ادله اثبات دعوی چیست؟" },
    { title: "لایحه اعاده دادرسی", prompt: "لایحه اعاده دادرسی کیفری بر اساس بندهای ماده ۴۷۴ تنظیم کن." },
    { title: "صلاحیت دادگاه صلح ۱۴۰۲", prompt: "صلاحیت دادگاه‌های صلح مصوب ۱۴۰۲ در خصوص دعاوی مالی و تخلیه را تشریح کن." },
    { title: "آرای وحدت رویه", prompt: "جدیدترین آرای وحدت رویه هیأت عمومی دیوان عالی کشور در خصوص مسئولیت مدنی و خسارت را توضیح بده." }
  ];

  return (
    <div className="flex flex-col h-full w-full max-w-4xl mx-auto overflow-hidden">
      {/* ناحیه اسکرول پیام‌ها */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-4">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[90%] sm:max-w-[80%] p-4 rounded-2xl text-xs sm:text-sm leading-relaxed shadow-sm ${
              msg.role === "user"
                ? "bg-amber-500/15 border border-amber-500/40 text-amber-100 rounded-br-none font-medium"
                : "bg-card border border-border text-card-foreground rounded-bl-none shadow-md"
            }`}>
              {msg.role === "assistant" && (
                <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-border/80 text-[11px] text-muted-foreground font-medium">
                  <span>دستیار</span>
                  {msg.probability && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-normal mr-auto">
                      احتمال موفقیت: {msg.probability}
                    </span>
                  )}
                </div>
              )}

              <div className="whitespace-pre-line leading-relaxed">{msg.content}</div>

              {msg.draft && (
                <div className="mt-3 pt-3 border-t border-border bg-background/60 p-3 rounded-xl">
                  <div className="flex items-center justify-between mb-1.5 text-xs text-amber-400 font-bold">
                    <span>پیش‌نویس لایحه قانونی:</span>
                    <button
                      onClick={() => navigator.clipboard.writeText(msg.draft || "")}
                      className="text-[10px] px-2 py-0.5 rounded bg-muted hover:bg-accent text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      کپی لایحه
                    </button>
                  </div>
                  <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap leading-relaxed">{msg.draft}</pre>
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-card border border-border p-3.5 rounded-2xl rounded-bl-none text-xs text-amber-400 flex items-center gap-2 shadow-sm">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              <span>در حال تحلیل پرونده...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ناحیه ورودی داک‌شده در پایین بدون تداخل */}
      <div className="bg-background/95 border-t border-border/90 p-2.5 sm:p-4 backdrop-blur-xl shrink-0 space-y-2">
        {/* نوار ابزار اقدامات حقوقی پرونده (لایحه، دادخواست، شکواییه، اظهارنامه) */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar scroll-fade-x py-0.5 pb-1 border-b border-border/60">
          <span className="text-[11px] text-muted-foreground font-semibold whitespace-nowrap pl-1">اقدامات حقوقی:</span>
          <button
            onClick={() => handleSendMessage("بر اساس آخرین مکالمه و ادله پرونده، لایحه دفاعیه مستدل با استناد به مواد قانونی مرتبط، رویه قضایی و آرای وحدت رویه تنظیم کن.")}
            className="px-3 py-1 bg-card/90 hover:bg-accent border border-border hover:border-ring/50 text-[11px] text-foreground rounded-xl whitespace-nowrap transition-all flex items-center gap-1.5 shadow-sm active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <FileText className="size-3.5 text-amber-400" />
            <span>صدور لایحه دفاعیه</span>
          </button>
          <button
            onClick={() => handleSendMessage("بر اساس شرح پرونده و مطالبات، دادخواست حقوقی کامل شامل خواسته، دلایل و منضمات و شرح دادخواست تدوین کن.")}
            className="px-3 py-1 bg-card/90 hover:bg-accent border border-border hover:border-ring/50 text-[11px] text-foreground rounded-xl whitespace-nowrap transition-all flex items-center gap-1.5 shadow-sm active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <Gavel className="size-3.5 text-cyan-400" />
            <span>صدور دادخواست حقوقی</span>
          </button>
          <button
            onClick={() => handleSendMessage("با توجه به موضوع پرونده و ادله، شکواییه کیفری رسمی با ذکر عنوان اتهامی، ادله و درخواست تعقیب متهم تدوین کن.")}
            className="px-3 py-1 bg-card/90 hover:bg-accent border border-border hover:border-ring/50 text-[11px] text-foreground rounded-xl whitespace-nowrap transition-all flex items-center gap-1.5 shadow-sm active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <AlertTriangle className="size-3.5 text-rose-400" />
            <span>صدور شکواییه کیفری</span>
          </button>
          <button
            onClick={() => handleSendMessage("یک اظهارنامه رسمی موضوع ماده ۱۵۶ قانون آیین دادرسی مدنی با اخطار و مهلت قانونی برای موضوع پرونده تدوین کن.")}
            className="px-3 py-1 bg-card/90 hover:bg-accent border border-border hover:border-ring/50 text-[11px] text-foreground rounded-xl whitespace-nowrap transition-all flex items-center gap-1.5 shadow-sm active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <FileSignature className="size-3.5 text-emerald-400" />
            <span>صدور اظهارنامه رسمی</span>
          </button>
        </div>

        {/* نوار سوالات متداول و سریع */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar scroll-fade-x py-1">
          {quickPrompts.map((item, idx) => (
            <button
              key={idx}
              onClick={() => handleSendMessage(item.prompt)}
              className="px-3 py-1.5 bg-card hover:bg-accent border border-border text-muted-foreground hover:text-foreground text-[11px] sm:text-xs rounded-xl whitespace-nowrap transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {item.title}
            </button>
          ))}
        </div>

        {/* وضعیت زنده ضبط صدا */}
        {recordingStatus && (
          <div className="text-xs text-foreground bg-card border border-border px-3 py-1.5 rounded-xl flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
            <span>{recordingStatus}</span>
          </div>
        )}

        {/* جعبه ارسال پیام و دکمه‌های صوتی */}
        <div className="bg-card/95 border border-border rounded-2xl p-2 flex items-center gap-2 shadow-xl">
          <input
            type="text"
            placeholder="پیام خود را بنویسید..."
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
            className="flex-1 bg-transparent px-3 py-2 text-xs sm:text-sm text-foreground focus:outline-none placeholder:text-muted-foreground"
          />

          {/* دکمه تبدیل گفتار به متن (Voice STT) */}
          <button
            onClick={toggleVoiceRecording}
            className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center transition-all shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
              isVoiceRecording
                ? "bg-rose-500 text-white animate-pulse shadow-rose-500/40 scale-105"
                : "bg-muted hover:bg-accent text-muted-foreground border border-border"
            }`}
            title={isVoiceRecording ? "اتمام ضبط" : "تبدیل گفتار به متن"}
          >
            {isVoiceRecording ? <Square className="size-4" /> : <Mic className="size-4" />}
          </button>

          {/* دکمه تماس صوتی زنده */}
          <button
            onClick={() => {
              // Safari: unlock audio inside the real user gesture, so the whole
              // voice session (every later TTS turn) is allowed to make sound.
              unlockSafariAudio();
              setIsLiveAudioOpen(true);
            }}
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/40 flex items-center justify-center transition-all shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            title="مکالمه صوتی زنده"
          >
            <Phone className="size-4" />
          </button>

          {/* دکمه ارسال پیام */}
          <button
            onClick={() => handleSendMessage()}
            className="px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold rounded-xl text-xs sm:text-sm transition-all flex items-center gap-1.5 shadow-md shadow-emerald-500/25 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <span>ارسال</span>
            <Send className="size-3.5 -scale-x-100" />
          </button>
        </div>
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
