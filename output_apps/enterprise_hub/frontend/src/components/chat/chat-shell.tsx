"use client";
import React, { useState } from "react";
import { LiveVoiceModal } from "./live-voice-modal";

export function ChatShell() {
  const [messages, setMessages] = useState<Array<{role: string, content: string}>>([
    {
      role: "assistant",
      content: "سلام؛ من دستیار حقوقی هوشمند شما هستم. شرح پرونده خود را بنویسید یا با دکمه‌های صوتی مطرح کنید تا لایحه و تحلیل قانونی را آماده کنم."
    }
  ]);
  const [inputPrompt, setInputPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isVoiceTyping, setIsVoiceTyping] = useState(false);
  const [isLiveAudioOpen, setIsLiveAudioOpen] = useState(false);

  const handleVoiceTyping = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("قابلیت گفتار به متن در این مرورگر فعال نیست.");
      return;
    }

    if (isVoiceTyping) {
      setIsVoiceTyping(false);
      return;
    }

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
          user_phone: "09129367796",
          is_vip: true
        })
      });
      const data = await res.json();
      const reply = data.reply || data.response || "تحلیل ادله انجام شد.";
      setMessages([...newMsgs, { role: "assistant", content: reply }]);
    } catch (err) {
      setMessages([...newMsgs, { role: "assistant", content: "خطا در ارتباط با سامانه دادرسی." }]);
    } finally {
      setIsLoading(false);
    }
  };

  const quickPrompts = [
    { title: "استراتژی پرونده (سند/متن)", prompt: "استراتژی دفاعی پرونده با تکیه بر ادله اثبات دعوی چیست؟" },
    { title: "تنظیم لایحه اعاده دادرسی ۴۷۴", prompt: "لایحه اعاده دادرسی بر اساس ماده ۴۷۴ تنظیم کن." },
    { title: "تحلیل دادخواست", prompt: "دادخواست را بر اساس قوانین ماهوی تحلیل فرمایید." }
  ];

  return (
    <div className="flex flex-col flex-1 w-full max-w-4xl mx-auto p-4 sm:p-6 space-y-4 pb-48">
      {messages.map((msg, idx) => (
        <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
          <div className={`max-w-[85%] p-4 rounded-2xl text-xs sm:text-sm leading-relaxed ${
            msg.role === "user"
              ? "bg-amber-500/15 border border-amber-500/40 text-amber-100 rounded-br-none"
              : "bg-slate-900 border border-slate-800 text-slate-200 rounded-bl-none"
          }`}>
            {msg.content}
          </div>
        </div>
      ))}

      {isLoading && (
        <div className="text-xs text-amber-400 flex items-center gap-2 p-2">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
          دستیار در حال تحلیل...
        </div>
      )}

      {/* نوار ثابت پایین با دو دکمه صوتی مجزا */}
      <div className="fixed bottom-12 left-0 right-0 max-w-4xl mx-auto px-4 z-20">
        <div className="flex gap-2 mb-2 overflow-x-auto no-scrollbar py-1">
          {quickPrompts.map((item, idx) => (
            <button
              key={idx}
              onClick={() => handleSendMessage(item.prompt)}
              className="px-3 py-1.5 bg-slate-900/90 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs rounded-xl whitespace-nowrap transition-colors"
            >
              {item.title}
            </button>
          ))}
        </div>

        <div className="bg-slate-900/95 border border-slate-800 rounded-2xl p-2.5 flex items-center gap-2 shadow-2xl backdrop-blur-lg">
          <input
            type="text"
            placeholder="شرح پرونده را بنویسید یا با میکروفون بگویید..."
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
            className="flex-1 bg-transparent px-3 py-2 text-xs sm:text-sm text-white focus:outline-none placeholder:text-slate-500"
          />

          {/* دکمه تایپ صوتی */}
          <button
            onClick={handleVoiceTyping}
            className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm transition-all ${
              isVoiceTyping
                ? "bg-rose-500 text-white animate-pulse"
                : "bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
            }`}
            title="تایپ صوتی (گفتار به متن)"
          >
            🎙️
          </button>

          {/* دکمه تماس زنده صوتی */}
          <button
            onClick={() => setIsLiveAudioOpen(true)}
            className="w-9 h-9 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/40 flex items-center justify-center text-sm transition-all"
            title="تماس صوتی زنده (Live Call)"
          >
            📞
          </button>

          <button
            onClick={() => handleSendMessage()}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs transition-colors flex items-center gap-1.5"
          >
            <span>ارسال</span>
            <span>➤</span>
          </button>
        </div>
      </div>

      <LiveVoiceModal
        isOpen={isLiveAudioOpen}
        onClose={() => setIsLiveAudioOpen(false)}
        userPhone="09129367796"
      />
    </div>
  );
}

export default ChatShell;
