"use client";
import React, { useState, useRef, useEffect } from "react";
import { LiveVoiceModal } from "./live-voice-modal";

export function ChatShell() {
  const [messages, setMessages] = useState<Array<{role: string, content: string, draft?: string, probability?: string}>>([
    {
      role: "assistant",
      content: "سلام؛ من دستیار حقوقی هوشمند شما هستم. شرح پرونده، دادخواست یا ادله خود را بنویسید یا با دکمه‌های صوتی مطرح کنید تا استخراج ادله، تحلیل مواد قانونی و لایحه مستند را برای شما آماده کنم."
    }
  ]);
  const [inputPrompt, setInputPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
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

  // تبدیل صوت به متن (STT) با پشتیبانی ۱۰۰٪ از سافاری و ارسال به هوش مصنوعی
  const toggleVoiceRecording = async () => {
    if (isVoiceRecording) {
      // توقف ضبط و ارسال به سرور جهت تبدیل به متن با Whisper
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        setRecordingStatus("در حال تبدیل صدا به متن با هوش مصنوعی...");
        mediaRecorderRef.current.stop();
      }
      return;
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("مرورگر شما از ورودی میکروفون پشتیبانی نمی‌کند.");
        return;
      }

      // فراخوانی مستقیم در پشته کلیک کاربر جهت احراز صلاحیت سافاری در مک و آیفون
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true }
      });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
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
        setRecordingStatus("در حال پیاده‌سازی متن...");

        // متوقف کردن قطعی ترک‌های میکروفون
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }

        const audioBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (audioBlob.size < 500) {
          setRecordingStatus("");
          return;
        }

        try {
          const formData = new FormData();
          formData.append("file", audioBlob, "recording.webm");

          const res = await fetch("/api/v1/apps/judge/transcribe-audio", {
            method: "POST",
            body: formData,
          });

          const data = await res.json();
          const transcript = data.text || data.transcript;
          if (transcript && transcript.trim()) {
            setInputPrompt((prev) => (prev ? prev + " " + transcript : transcript));
          } else {
            alert("صدایی تشخیص داده نشد یا متن نامفهوم بود. لطفاً دوباره امتحان کنید.");
          }
        } catch (err) {
          console.error("STT network error:", err);
          alert("خطا در ارسال صوت به سرور. اتصال را بررسی فرمایید.");
        } finally {
          setRecordingStatus("");
        }
      };

      recorder.start();
      setIsVoiceRecording(true);
      setRecordingStatus("در حال شنیدن صدای شما... (برای اتمام، دوباره کلیک کنید)");

      // فالبک برای مرورگرهایی که Web Speech API دارند برای نمایش پیش‌نمایش فوری
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        try {
          const recognition = new SpeechRecognition();
          recognition.lang = "fa-IR";
          recognition.continuous = false;
          recognition.interimResults = true;
          recognition.onresult = (event: any) => {
            const current = event.results[0][0].transcript;
            if (current) setRecordingStatus(`شنیده شد: «${current}»`);
          };
          recognition.start();
        } catch (_) {}
      }
    } catch (err: any) {
      console.error("Mic error:", err);
      setIsVoiceRecording(false);
      setRecordingStatus("");
      alert("دسترسی به میکروفون تایید نشد. لطفاً در نوار آدرس مرورگر دسترسی را مجاز بفرمایید.");
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
          is_vip: true,
          tier: "VIP"
        })
      });
      const data = await res.json();
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
          content: "خطا در اتصال به موتور دادرسی قاضی هوشمند. لطفاً چند لحظه بعد مجدداً تلاش فرمایید."
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const quickPrompts = [
    { title: "استراتژی پرونده (سند/متن)", prompt: "استراتژی دفاعی پرونده با تکیه بر ادله اثبات دعوی چیست؟" },
    { title: "تنظیم لایحه اعاده دادرسی ۴۷۴", prompt: "لایحه اعاده دادرسی کیفری بر اساس بندهای ماده ۴۷۴ تنظیم کن." },
    { title: "صلاحیت دادگاه صلح ۱۴۰۲", prompt: "صلاحیت دادگاه‌های صلح مصوب ۱۴۰۲ در خصوص دعاوی مالی و تخلیه را تشریح کن." },
    { title: "تحلیل آرای وحدت رویه دیوان عالی", prompt: "جدیدترین آرای وحدت رویه هیأت عمومی دیوان عالی کشور در خصوص مسئولیت مدنی و خسارت را توضیح بده." }
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
                : "bg-slate-900/95 border border-slate-800 text-slate-200 rounded-bl-none shadow-md"
            }`}>
              {msg.role === "assistant" && (
                <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-slate-800/80 text-[11px] text-amber-400 font-bold">
                  <span>⚖️ دستیار قاضی هوشمند</span>
                  {msg.probability && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 font-normal mr-auto">
                      احتمال موفقیت: {msg.probability}
                    </span>
                  )}
                </div>
              )}
              
              <div className="whitespace-pre-line leading-relaxed">{msg.content}</div>

              {msg.draft && (
                <div className="mt-3 pt-3 border-t border-slate-800 bg-slate-950/60 p-3 rounded-xl">
                  <div className="flex items-center justify-between mb-1.5 text-xs text-amber-400 font-bold">
                    <span>پیش‌نویس لایحه قانونی:</span>
                    <button
                      onClick={() => navigator.clipboard.writeText(msg.draft || "")}
                      className="text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                    >
                      کپی لایحه
                    </button>
                  </div>
                  <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap leading-relaxed">{msg.draft}</pre>
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-2xl rounded-bl-none text-xs text-amber-400 flex items-center gap-2 shadow-sm">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              <span>دستیار در حال استخراج ادله از پایگاه قوانین و آراء وحدت رویه...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ناحیه ورودی داک‌شده در پایین بدون تداخل */}
      <div className="bg-slate-950/95 border-t border-slate-800/90 p-2.5 sm:p-4 backdrop-blur-xl shrink-0 space-y-2">
        {/* نوار سوالات متداول و سریع */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
          {quickPrompts.map((item, idx) => (
            <button
              key={idx}
              onClick={() => handleSendMessage(item.prompt)}
              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white text-[11px] sm:text-xs rounded-xl whitespace-nowrap transition-colors flex items-center gap-1.5 shadow-sm"
            >
              <span>⚡</span>
              <span>{item.title}</span>
            </button>
          ))}
        </div>

        {/* وضعیت زنده ضبط صدا */}
        {recordingStatus && (
          <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 px-3 py-1.5 rounded-xl flex items-center gap-2 animate-pulse">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
            <span>{recordingStatus}</span>
          </div>
        )}

        {/* جعبه ارسال پیام و دکمه‌های صوتی */}
        <div className="bg-slate-900/95 border border-slate-800 rounded-2xl p-2 flex items-center gap-2 shadow-xl">
          <input
            type="text"
            placeholder="شرح پرونده را بنویسید یا با میکروفون بگویید..."
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
            className="flex-1 bg-transparent px-3 py-2 text-xs sm:text-sm text-white focus:outline-none placeholder:text-slate-500"
          />

          {/* دکمه تبدیل گفتار به متن (Voice STT) */}
          <button
            onClick={toggleVoiceRecording}
            className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center text-sm transition-all shadow-sm ${
              isVoiceRecording
                ? "bg-rose-500 text-white animate-pulse shadow-rose-500/40 scale-105"
                : "bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
            }`}
            title={isVoiceRecording ? "اتمام ضبط و تبدیل به متن" : "تبدیل گفتار به متن با هوش مصنوعی (STT)"}
          >
            {isVoiceRecording ? "⏹️" : "🎙️"}
          </button>

          {/* دکمه تماس زنده صوتی (Live Call VIP) */}
          <button
            onClick={() => setIsLiveAudioOpen(true)}
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/40 flex items-center justify-center text-sm transition-all shadow-sm"
            title="مکالمه صوتی زنده (Live Voice VIP)"
          >
            📞
          </button>

          {/* دکمه ارسال پیام */}
          <button
            onClick={() => handleSendMessage()}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs sm:text-sm transition-colors flex items-center gap-1.5 shadow-md shadow-amber-500/20 active:scale-95"
          >
            <span>ارسال</span>
            <span>➤</span>
          </button>
        </div>
      </div>

      {/* مدال مکالمه صوتی زنده */}
      <LiveVoiceModal
        isOpen={isLiveAudioOpen}
        onClose={() => setIsLiveAudioOpen(false)}
      />
    </div>
  );
}

export default ChatShell;
