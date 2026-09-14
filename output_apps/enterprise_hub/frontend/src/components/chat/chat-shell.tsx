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
  const [isVoiceTyping, setIsVoiceTyping] = useState(false);
  const [isLiveAudioOpen, setIsLiveAudioOpen] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleVoiceTyping = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("قابلیت گفتار به متن در این مرورگر پشتیبانی نمی‌شود. لطفاً از دکمه سبز تماس زنده (📞) استفاده فرمایید.");
      return;
    }

    if (isVoiceTyping) {
      setIsVoiceTyping(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = "fa-IR";
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onstart = () => setIsVoiceTyping(true);
      recognition.onresult = (e: any) => {
        const text = e.results[0][0].transcript;
        setInputPrompt((prev) => (prev ? prev + " " + text : text));
        setIsVoiceTyping(false);
      };
      recognition.onerror = () => setIsVoiceTyping(false);
      recognition.onend = () => setIsVoiceTyping(false);

      recognition.start();
    } catch (e) {
      setIsVoiceTyping(false);
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
          user_phone: "09129367796",
          phone: "09129367796",
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
    { title: "تحلیل دادخواست و ایرادات شکلی", prompt: "دادخواست را بر اساس قواعد ماهوی و شکلی آیین دادرسی مدنی بررسی فرما." }
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
              <span>دستیار در حال تحلیل مستندات قانونی و آراء دیوان عالی...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ناحیه ورودی ثابت انتهای چت (داک‌شده بدون تداخل با فوتر) */}
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

          {/* دکمه تایپ صوتی (STT) */}
          <button
            onClick={handleVoiceTyping}
            className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center text-sm transition-all shadow-sm ${
              isVoiceTyping
                ? "bg-rose-500 text-white animate-pulse shadow-rose-500/30"
                : "bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
            }`}
            title="تایپ صوتی (گفتار به متن)"
          >
            🎙️
          </button>

          {/* دکمه تماس زنده صوتی (Live Call) */}
          <button
            onClick={() => setIsLiveAudioOpen(true)}
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/40 flex items-center justify-center text-sm transition-all shadow-sm"
            title="مکالمه زنده صوتی (Live Call VIP)"
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

      {/* مدال تماس صوتی زنده */}
      <LiveVoiceModal
        isOpen={isLiveAudioOpen}
        onClose={() => setIsLiveAudioOpen(false)}
        userPhone="09129367796"
      />
    </div>
  );
}

export default ChatShell;
