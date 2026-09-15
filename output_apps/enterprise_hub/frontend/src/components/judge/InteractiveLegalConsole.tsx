"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";

interface Message {
  role: "user" | "assistant";
  text: string;
  probability?: string;
  draft?: string;
  laws?: Array<{ title: string; category?: string; summary?: string }>;
  precedents?: Array<{ title: string; subject?: string; summary?: string }>;
}

export default function InteractiveLegalConsole() {

  // تابع خوانش صوتی متن لایحه (Text-to-Speech)
  const speakDraftText = (text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const cleanText = text.replace(/[#*_`]/g, "");
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = "fa-IR";
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  };

  const [mounted, setMounted] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: "سلام؛ به «سامانه تخصصی قاضی هوشمند» خوش آمدید.\nشرح پرونده، سوال حقوقی یا دادخواست خود را بنویسید یا از گزینه‌های سریع زیر استفاده کنید تا استراتژی دفاعی، مواد قانونی و پیش‌نویس لایحه را برایتان آماده کنم.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [activeTab, setActiveTab] = useState<"DRAFT" | "LAWS" | "PRECEDENTS">("DRAFT");
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, loading, mounted]);

  const speakText = (text: string) => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "fa-IR";
      window.speechSynthesis.speak(u);
    }
  };

  const toggleLiveVoice = () => {
    if (typeof window === "undefined") return;

    if (isVoiceActive) {
      if (wsRef.current) wsRef.current.close();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      setIsVoiceActive(false);
    } else {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/v1/apps/judge/live-voice`);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsVoiceActive(true);
        speakText("تماس صوتی زنده برقرار شد. بفرمایید.");
      };

      ws.onmessage = (e) => {
        try {
          const res = JSON.parse(e.data);
          if (res.text) {
            setMessages((prev) => [...prev, { role: "assistant", text: res.text }]);
            speakText(res.text);
          }
        } catch (err) {}
      };

      ws.onclose = () => setIsVoiceActive(false);

      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const reco = new SpeechRecognition();
        reco.lang = "fa-IR";
        reco.continuous = true;
        reco.interimResults = false;
        reco.onresult = (evt: any) => {
          const transcript = evt.results[evt.results.length - 1][0].transcript;
          if (transcript.trim() && ws.readyState === WebSocket.OPEN) {
            setMessages((prev) => [...prev, { role: "user", text: transcript }]);
            ws.send(JSON.stringify({ text: transcript }));
          }
        };
        reco.start();
      }
    }
  };

  const handleSendMessage = async (customPrompt?: string) => {
    const textToSend = (customPrompt || input).trim();
    if (!textToSend || loading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: textToSend }]);
    setLoading(true);

    try {
      const res = await fetch("/api/v1/apps/judge/consult", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: textToSend,
          tier: "VIP",
          phone: "09129367796",
        }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: data.reply || "تحلیل استراتژیک پرونده آماده شد.",
          probability: data.success_probability,
          draft: data.defense_draft,
          laws: data.statutory_basis,
          precedents: data.unified_precedents,
        },
      ]);
      if (data.defense_draft) setActiveTab("DRAFT");
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "پاسخ حقوقی آماده شد." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadDraft = async (draftText: string) => {
    setExportLoading(true);
    try {
      const res = await fetch("/api/v1/apps/judge/export-defense-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          case_title: "لایحه دفاعیه تخصصی",
          draft_text: draftText,
          court_branch: "دادگاه عمومی حقوقی / تجدیدنظر / دیوان عالی",
          phone: "09129367796",
        }),
      });
      const data = await res.json();
      if (data.formatted_text) {
        const blob = new Blob([data.formatted_text], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Official_Defense_Draft_${data.doc_id}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      console.warn("Export defense document failed:", e);
      setExportError("خطا در ایجاد فایل لایحه.");
    } finally {
      setExportLoading(false);
    }
  };

  if (!mounted) {
    return (
      <div className="h-screen w-full bg-[#07090e] flex items-center justify-center text-zinc-400 font-sans" dir="rtl">
        <div className="flex items-center gap-3">
          <span className="w-3 h-3 rounded-full bg-blue-500 animate-ping"></span>
          <span className="text-sm font-bold text-zinc-200">در حال راه‌اندازی سامانه قاضی هوشمند...</span>
        </div>
      </div>
    );
  }

  const latestAssistant = [...messages].reverse().find((m) => m.role === "assistant" && (m.draft || m.laws));

  return (
    <div className="flex flex-col lg:flex-row h-screen w-full bg-[#07090e] text-zinc-100 font-sans overflow-hidden" dir="rtl">
      {/* بخش چت اصلی */}
      <div className="flex-1 flex flex-col h-full border-l border-zinc-800/80 bg-gradient-to-b from-[#0b0f19] to-[#07090e]">
        {/* هدر */}
        <div className="h-16 px-6 border-b border-zinc-800/80 bg-zinc-950/60 backdrop-blur-xl flex items-center justify-between z-10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-600/20 border border-amber-500/40 flex items-center justify-center text-xl shadow-lg">
              ⚖️
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-sm text-white">سامانه قاضی هوشمند</span>
                <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/80 border border-emerald-500/40 text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  متصل به هسته هوش قضایی (۴,۵۹۱ گره)
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">دستیار حقوقی تخصصی و تنظیم خودکار لایحه</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={toggleLiveVoice}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
                isVoiceActive
                  ? "bg-rose-600 text-white animate-pulse"
                  : "bg-zinc-900 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-950/40"
              }`}
            >
              <span>🎙️</span>
              <span>{isVoiceActive ? "قطع مکالمه صوتی" : "مکالمه صوتی زنده"}</span>
            </button>

            <Link
              href="/damages"
              className="hidden sm:inline-flex px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded-xl text-xs font-semibold text-amber-300 transition"
            >
              🧮 محاسبه‌گر ماده ۵۲۲
            </Link>

            <Link
              href="/lawyers"
              className="hidden sm:inline-flex px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 rounded-xl text-xs font-semibold text-blue-300 transition"
            >
              پورتال وکلا
            </Link>
          </div>
        </div>

        {/* پیام‌ها */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {messages.map((m, idx) => (
            <div key={idx} className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}>
              <div
                className={`max-w-[88%] sm:max-w-[80%] rounded-2xl p-4 text-xs sm:text-sm leading-relaxed shadow-lg ${
                  m.role === "user"
                    ? "bg-blue-600 text-white rounded-tr-none"
                    : "bg-zinc-900/90 border border-zinc-800 text-zinc-200 rounded-tl-none backdrop-blur-md"
                }`}
              >
                <div className="whitespace-pre-wrap">{m.text}</div>
                {m.probability && (
                  <div className="mt-3 pt-2.5 border-t border-zinc-800 text-[11px] font-bold text-emerald-400 flex items-center justify-between">
                    <span>📊 شانس موفقیت حقوقی:</span>
                    <span>{m.probability}</span>
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-end">
              <div className="bg-zinc-900 border border-blue-500/30 rounded-2xl px-4 py-3 text-xs text-blue-300 flex items-center gap-2.5 shadow-lg">
                <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping"></span>
                در حال پردازش پرونده با مدل Always-Latest و انطباق با رویه قضایی...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* گزینه‌های سریع */}
        <div className="px-4 py-2 border-t border-zinc-800/40 bg-zinc-950/40 flex gap-2 overflow-x-auto shrink-0">
          {[
            "مطالبه مهریه از طریق دوایر اجرای ثبت",
            "خسارت تاخیر تادیه به نرخ روز (ماده ۵۲۲)",
            "اثبات مالکیت سند عادی و الزام به تنظیم سند",
            "اعاده دادرسی دیوان عالی کشور (ماده ۴۷۴)",
          ].map((prompt, i) => (
            <button
              key={i}
              onClick={() => handleSendMessage(prompt)}
              className="whitespace-nowrap px-3 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-full text-[11px] text-zinc-400 hover:text-white transition"
            >
              ⚡ {prompt}
            </button>
          ))}
        </div>

        {/* کادر ورودی */}
        <div className="p-4 border-t border-zinc-800/80 bg-zinc-950/80 shrink-0">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="flex items-center gap-2 bg-zinc-900 border border-zinc-700/80 rounded-2xl p-1.5 focus-within:border-blue-500 transition"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="شرح پرونده، مفاد قرارداد یا دادخواست خود را بنویسید..."
              className="flex-1 bg-transparent px-3 py-2 text-xs sm:text-sm text-white placeholder-zinc-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-bold rounded-xl text-xs sm:text-sm transition shadow-lg flex items-center gap-1"
            >
              ارسال ⚡
            </button>
          </form>
        </div>
      </div>

      {/* ستون لایحه و مواد قانونی */}
      <div className="w-full lg:w-96 border-t lg:border-t-0 lg:border-r border-zinc-800/80 bg-[#080b12] flex flex-col h-72 lg:h-full shrink-0">
        <div className="flex border-b border-zinc-800/80 bg-zinc-950/40 p-1.5 gap-1 text-[11px] font-bold shrink-0">
          <button
            onClick={() => setActiveTab("DRAFT")}
            className={`flex-1 py-2 rounded-xl transition ${
              activeTab === "DRAFT" ? "bg-blue-600/20 border border-blue-500/40 text-blue-300" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            📝 لایحه تنظیمی
          </button>
          <button
            onClick={() => setActiveTab("LAWS")}
            className={`flex-1 py-2 rounded-xl transition ${
              activeTab === "LAWS" ? "bg-emerald-600/20 border border-emerald-500/40 text-emerald-300" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            📜 مواد قانونی
          </button>
          <button
            onClick={() => setActiveTab("PRECEDENTS")}
            className={`flex-1 py-2 rounded-xl transition ${
              activeTab === "PRECEDENTS" ? "bg-indigo-600/20 border border-indigo-500/40 text-indigo-300" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            🏛️ وحدت رویه
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {activeTab === "DRAFT" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-zinc-300">پیش‌نویس رسمی قضایی:</span>
                {latestAssistant?.draft && (
                  <button
                    onClick={() => handleDownloadDraft(latestAssistant.draft!)}
                    disabled={exportLoading}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-[10px] font-bold transition flex items-center gap-1 shadow"
                  >
                    {exportLoading ? "..." : "📥 دانلود لایحه (.txt)"}
                  </button>
                )}
              </div>

              {exportError && (
                <div className="p-3 bg-rose-950/40 border border-rose-500/40 rounded-xl text-xs text-rose-300">{exportError}</div>
              )}

              {latestAssistant?.draft ? (
                <div className="p-4 bg-zinc-950/90 border border-zinc-800 rounded-2xl text-xs font-mono text-zinc-300 leading-relaxed whitespace-pre-wrap max-h-[calc(100vh-280px)] overflow-y-auto">
                  {latestAssistant.draft}
                </div>
              ) : (
                <div className="text-center py-16 text-zinc-600 text-xs">
                  پس از ارسال شرح پرونده، پیش‌نویس لایحه دفاعیه در این قسمت آماده می‌شود.
                </div>
              )}
            </div>
          )}

          {activeTab === "LAWS" && (
            <div className="space-y-3">
              <span className="text-xs font-bold text-zinc-300">مبانی قانونی استخراج‌شده:</span>
              {latestAssistant?.laws && latestAssistant.laws.length > 0 ? (
                latestAssistant.laws.map((l, i) => (
                  <div key={i} className="p-3 bg-zinc-950/80 border border-emerald-500/20 rounded-xl space-y-1">
                    <div className="text-xs font-bold text-emerald-400">📜 {l.title}</div>
                    {l.summary && <div className="text-[11px] text-zinc-400 leading-relaxed">{l.summary}</div>}
                  </div>
                ))
              ) : (
                <div className="text-center py-16 text-zinc-600 text-xs">مستندات قانونی پس از تحلیل نمایش داده می‌شوند.</div>
              )}
            </div>
          )}

          {activeTab === "PRECEDENTS" && (
            <div className="space-y-3">
              <span className="text-xs font-bold text-zinc-300">آرای وحدت رویه دیوان عالی کشور:</span>
              {latestAssistant?.precedents && latestAssistant.precedents.length > 0 ? (
                latestAssistant.precedents.map((p, i) => (
                  <div key={i} className="p-3 bg-zinc-950/80 border border-indigo-500/20 rounded-xl space-y-1">
                    <div className="text-xs font-bold text-indigo-400">🏛️ {p.title}</div>
                    {p.summary && <div className="text-[11px] text-zinc-400 leading-relaxed">{p.summary}</div>}
                  </div>
                ))
              ) : (
                <div className="text-center py-16 text-zinc-600 text-xs">آرای وحدت رویه مرتبط پس از تحلیل درج می‌شوند.</div>
              )}
            </div>
          )}
        </div>

        <div className="p-3 border-t border-zinc-800/80 bg-zinc-950/80 text-[10px] text-zinc-500 flex items-center justify-between shrink-0">
          <span>پشتیبانی: ۰۹۱۲۹۳۶۷۷۹۶</span>
          <span>© ۱۴۰۵ قاضی هوشمند</span>
        </div>
      </div>
    </div>
  );
}
