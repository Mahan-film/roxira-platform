"use client";

import React, { useState, useRef } from "react";

interface LegalResponse {
  status: string;
  success_probability?: string;
  statutory_basis?: Array<{ title: string; category?: string }>;
  unified_precedents?: Array<{ title: string; subject?: string }>;
  defense_draft?: string;
  voice_url?: string;
}

export default function LegalChatConsole() {
  const activeStreamRef = useRef<MediaStream | null>(null);
  const activeRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [caseText, setCaseText] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<LegalResponse | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [micError, setMicError] = useState("");

  // ارسال متن جهت تدوین استراتژی و لایحه
  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!caseText.trim()) return;

    setLoading(true);
    setResponse(null);

    try {
      const res = await fetch("/api/v1/apps/judge/build-case-strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ case_text: caseText }),
      });
      const data = await res.json();
      setResponse(data);
    } catch (err) {
      setResponse({ status: "ERROR", defense_draft: "خطا در برقراری ارتباط با سرور." });
    } finally {
      setLoading(false);
    }
  };

  // فعال‌سازی ضبط صوت در مرورگر
  const toggleRecording = async () => {
    if (isRecording) {
      if (mediaRecorderRef.current) mediaRecorderRef.current.stop();
      setIsRecording(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            // شبیه‌سازی یا ارسال استریم صوت
            setCaseText((prev) => (prev ? prev + " " : "") + "[شرح پرونده به صورت صوتی ثبت شد]");
          }
        };

        mediaRecorder.start();
        setIsRecording(true);
      } catch (err) {
        console.warn("Microphone access failed:", err);
        setMicError("دسترسی به میکروفون امکان‌پذیر نیست.");
      }
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-6 font-sans" dir="rtl">
      {/* اسکیمای ساختاریافته موتورهای هوش مصنوعی و گوگل */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "LegalService",
            "name": "قاضی هوشمند",
            "url": "https://ghazihoushmand.ir",
            "description": "پلتفرم تحلیل هوشمند پرونده‌های حقوقی و تدوین لایحه دفاعیه با استناد به قوانین معتبر و آرای وحدت رویه دیوان عالی کشور.",
            "areaServed": "IR",
            "knowsAbout": ["حقوق مدنی", "قانون تجارت", "حقوق کیفری", "آیین دادرسی", "آرای وحدت رویه دیوان عالی کشور"],
          }),
        }}
      />

      {/* بخش ورودی مینیمال پرونده */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm">
        <h1 className="text-xl font-bold text-zinc-900 dark:text-white mb-2">
          دستیار هوشمند حقوقی و تحلیل پرونده
        </h1>
        <p className="text-sm text-zinc-500 mb-4">
          شرح پرونده، مدارک یا سوال حقوقی خود را تایپ کنید یا با فشردن دکمه میکروفون به صورت صوتی بیان فرمایید:
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <textarea
            value={caseText}
            onChange={(e) => setCaseText(e.target.value)}
            rows={4}
            className="w-full p-4 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none"
            placeholder="مثال: شرکتی در سال ۱۴۰۳ ورشکسته شده و طلبکار خواستار خسارت تاخیر تادیه است..."
          />

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={toggleRecording}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition ${
                isRecording
                  ? "bg-red-500 text-white animate-pulse"
                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200"
              }`}
            >
              🎤 {isRecording ? "در حال ضبط... (کلیک جهت توقف)" : "مشاوره صوتی"}
            </button>

            <button
              type="submit"
              disabled={loading || !caseText.trim()}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition"
            >
              {loading ? "در حال تحلیل قضایی..." : "تحلیل و تدوین استراتژی ⚡"}
            </button>
          </div>

          {micError && (
            <p className="text-xs text-rose-500">{micError}</p>
          )}
        </form>
      </div>

      {/* خروجی تحلیل و لایحه حقوقی */}
      {response && (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b pb-4 border-zinc-200 dark:border-zinc-800">
            <h2 className="font-bold text-lg text-zinc-900 dark:text-white">
              راهبرد دادرسی و تحلیل ادله
            </h2>
            {response.success_probability && (
              <span className="px-3 py-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 text-xs font-bold rounded-full">
                شانس موفقیت: {response.success_probability}
              </span>
            )}
          </div>

          {/* مستندات قانونی استخراج‌شده */}
          {response.statutory_basis && response.statutory_basis.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-zinc-400 uppercase mb-2">مواد قانونی استنادی:</h3>
              <div className="flex flex-wrap gap-2">
                {response.statutory_basis.map((law, idx) => (
                  <span key={idx} className="px-3 py-1 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-xs rounded-lg">
                    📜 {law.title}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* آرای وحدت رویه */}
          {response.unified_precedents && response.unified_precedents.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-zinc-400 uppercase mb-2">آرای وحدت رویه حاکم:</h3>
              <div className="flex flex-wrap gap-2">
                {response.unified_precedents.map((prec, idx) => (
                  <span key={idx} className="px-3 py-1 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 text-xs rounded-lg">
                    🏛️ {prec.title}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* متن پیش‌نویس لایحه */}
          {response.defense_draft && (
            <div>
              <h3 className="text-xs font-bold text-zinc-400 uppercase mb-2">پیش‌نویس لایحه دفاعیه:</h3>
              <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm whitespace-pre-wrap leading-relaxed text-zinc-800 dark:text-zinc-200">
                {response.defense_draft}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
