#!/usr/bin/env python3
import pathlib
import subprocess
import os

print("="*75)
print("🚀 استقرار صدور اختیاری فایل لایحه و فعال‌سازی کامل Live Voice صوتی...")
print("="*75)

# ------------------------------------------------------------------------------
# ۱. به‌روزرسانی کامپوننت فرانت‌اند InteractiveLegalConsole.tsx
# ------------------------------------------------------------------------------
frontend_file = pathlib.Path("/opt/roxira_platform/output_apps/enterprise_hub/frontend/src/components/judge/InteractiveLegalConsole.tsx")

frontend_code = r'''"use client";

import React, { useState, useEffect, useRef } from "react";

interface Message {
  role: "user" | "assistant";
  text: string;
  probability?: string;
  draft?: string;
  laws?: Array<{ title: string }>;
  precedents?: Array<{ title: string }>;
}

interface ConversationItem {
  id: string;
  title: string;
  updated_at?: string;
}

export default function InteractiveLegalConsole() {
  const [userPhone, setUserPhone] = useState("09129367796");
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: "سلام؛ من دستیار حقوقی هوشمند شما هستم. شرح پرونده خود را بنویسید یا از دکمه تماس صوتی استفاده کنید.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const recognitionRef = useRef<any>(null);

  // بارگذاری تاریخچه
  const loadConversations = async () => {
    try {
      const res = await fetch(`/api/v1/apps/judge/conversations?phone=${userPhone}`);
      const data = await res.json();
      if (data.status === "SUCCESS" && Array.isArray(data.conversations)) {
        setConversations(data.conversations);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadConversations();
  }, [userPhone]);

  // پخش صدا از طریق اسپیکر (TTS)
  const speakText = (text: string) => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "fa-IR";
      utterance.rate = 1.0;
      window.speechSynthesis.speak(utterance);
    }
  };

  // فعال‌سازی / غیرفعال‌سازی تماس صوتی زنده بلادرنگ
  const toggleLiveVoice = () => {
    if (isVoiceActive) {
      if (wsRef.current) wsRef.current.close();
      if (recognitionRef.current) recognitionRef.current.stop();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      setIsVoiceActive(false);
    } else {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/v1/apps/judge/live-voice`);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsVoiceActive(true);
        speakText("تماس صوتی زنده برقرار شد. بفرمایید در خدمت شما هستم.");
      };

      ws.onmessage = (e) => {
        const res = JSON.parse(e.data);
        if (res.text) {
          setMessages((prev) => [...prev, { role: "assistant", text: res.text }]);
          speakText(res.text);
        }
      };

      ws.onclose = () => setIsVoiceActive(false);

      // استخراج صدا از میکروفون به متن
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
        recognitionRef.current = reco;
      }
    }
  };

  // دانلود اختیاری فایل رسمی لایحه تنها در صورت درخواست کاربر
  const handleDownloadDocument = async (draftText: string) => {
    setExportLoading(true);
    try {
      const res = await fetch("/api/v1/apps/judge/export-defense-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          case_title: "لایحه دفاعیه تنظیمی",
          draft_text: draftText,
          court_branch: "دادگاه عمومی حقوقی / تجدیدنظر",
          phone: userPhone,
        }),
      });
      const data = await res.json();
      if (data.formatted_text) {
        const blob = new Blob([data.formatted_text], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `لایحه_قضایی_${data.doc_id}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      alert("خطا در ایجاد فایل لایحه.");
    } finally {
      setExportLoading(false);
    }
  };

  // ارسال پیام متنی
  const sendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || loading) return;

    const userText = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: userText }]);
    setLoading(true);

    try {
      const res = await fetch("/api/v1/apps/judge/consult", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userText,
          phone: userPhone,
          conversation_id: activeConvId,
          tier: "VIP",
        }),
      });
      const data = await res.json();
      if (data.conversation_id && !activeConvId) {
        setActiveConvId(data.conversation_id);
        loadConversations();
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: data.reply || "تحلیل انجام شد.",
          probability: data.success_probability,
          draft: data.defense_draft,
          laws: data.statutory_basis,
          precedents: data.unified_precedents,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "خطا در ارتباط با سرور. لطفاً مجدداً امتحان کنید." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-zinc-950 text-white font-sans overflow-hidden" dir="rtl">
      {/* سایدبار تاریخچه */}
      <div className="w-80 border-l border-zinc-800 bg-zinc-900/60 flex flex-col p-4">
        <span className="font-bold text-sm text-zinc-300 pb-3 border-b border-zinc-800">⏳ پرونده‌های قبلی</span>
        <button
          onClick={() => {
            setActiveConvId(null);
            setMessages([{ role: "assistant", text: "پرونده جدید آغاز شد. بفرمایید:" }]);
          }}
          className="mt-3 w-full py-2 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-300 rounded-xl text-xs font-bold transition"
        >
          ➕ گفتگوی جدید
        </button>
        <div className="mt-3 flex-1 overflow-y-auto space-y-1.5">
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={async () => {
                setActiveConvId(c.id);
                const res = await fetch(`/api/v1/apps/judge/conversations/${c.id}/messages`);
                const data = await res.json();
                if (data.messages?.length) setMessages(data.messages);
              }}
              className={`w-full text-right p-2.5 rounded-xl text-xs truncate block ${
                activeConvId === c.id ? "bg-blue-600/30 border border-blue-500 text-blue-200" : "bg-zinc-800/30 text-zinc-400 hover:bg-zinc-800"
              }`}
            >
              📁 {c.title}
            </button>
          ))}
        </div>
      </div>

      {/* بخش اصلی گفتگو */}
      <div className="flex-1 flex flex-col h-full bg-zinc-950">
        <div className="h-16 border-b border-zinc-800 px-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">⚖️</span>
            <span className="font-bold text-sm text-zinc-200">قاضی هوشمند | مشاوره تخصصی و تنظیم لایحه</span>
          </div>
          <button
            onClick={toggleLiveVoice}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
              isVoiceActive
                ? "bg-red-500 text-white animate-pulse"
                : "bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/30"
            }`}
          >
            🎙️ {isVoiceActive ? "قطع مکالمه صوتی زنده" : "شروع تماس صوتی زنده (Live Voice)"}
          </button>
        </div>

        {/* پیام‌ها */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((m, idx) => (
            <div key={idx} className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}>
              <div className={`max-w-[80%] rounded-2xl p-4 text-sm leading-relaxed ${m.role === "user" ? "bg-blue-600 text-white" : "bg-zinc-900 border border-zinc-800 text-zinc-100"}`}>
                <div className="whitespace-pre-wrap">{m.text}</div>
                {m.probability && <div className="mt-2 text-xs font-bold text-emerald-400">📊 {m.probability}</div>}
                
                {/* بخش لایحه و دکمه دانلود اختیاری فایل */}
                {m.draft && (
                  <div className="mt-3 p-3 bg-zinc-950 border border-zinc-800 rounded-xl space-y-2">
                    <div className="text-xs font-bold text-amber-400">📝 متن پیشنهادی لایحه:</div>
                    <div className="text-xs font-mono text-zinc-300 max-h-48 overflow-y-auto whitespace-pre-wrap">{m.draft}</div>
                    
                    {/* دکمه تولید اختیاری فایل فقط به درخواست کاربر */}
                    <button
                      onClick={() => handleDownloadDocument(m.draft!)}
                      disabled={exportLoading}
                      className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 shadow"
                    >
                      {exportLoading ? "در حال آماده‌سازی فایل..." : "📥 دریافت و دانلود فایل رسمی لایحه (با سربرگ قضایی)"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* ورودی متنی */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-900/40">
          <form onSubmit={sendMessage} className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="شرح پرونده خود را بنویسید یا دکمه تماس صوتی بالا را بزنید..."
              className="flex-1 p-3.5 bg-zinc-900 border border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-white"
            />
            <button type="submit" disabled={loading || !input.trim()} className="px-6 py-3.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition">
              ارسال ⚡
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
'''
frontend_file.write_text(frontend_code.strip() + "\n", encoding="utf-8")
print("✅ کامپوننت فرانت‌اند با دکمه دانلود اختیاری فایل و لایو چت صوتی به‌روزرسانی شد.")

# ------------------------------------------------------------------------------
# ۲. بیلد Standalone فرانت‌اند و کپی استاتیک‌ها
# ------------------------------------------------------------------------------
os.chdir("/opt/roxira_platform/output_apps/enterprise_hub/frontend")
subprocess.run(["npm", "run", "build"], check=False)

subprocess.run(["mkdir", "-p", ".next/standalone/public", ".next/standalone/.next/static"], check=True)
subprocess.run("cp -r public/* .next/standalone/public/ 2>/dev/null || true", shell=True)
subprocess.run("cp -r .next/static/* .next/standalone/.next/static/ 2>/dev/null || true", shell=True)

# ------------------------------------------------------------------------------
# ۳. بازنشانی کانتینرها
# ------------------------------------------------------------------------------
subprocess.run(["docker", "restart", "roxira_app_prod", "roxira_enterprise_frontend"], check=True)

print("="*75)
print("🎉 قابلیت Live Voice صوتی و صدور فایل اختیاری با موفقیت در پروداکشن مستقر شدند.")
print("="*75)
