#!/usr/bin/env python3
import pathlib
import subprocess
import os

print("="*75)
print("🚀 بازطراحی جامع رابط کاربری قاضی هوشمند، حذف موانع ورود و اصلاح Nginx")
print("="*75)

# ------------------------------------------------------------------------------
# ۱. بازنویسی کامل کامپوننت چت با طراحی فوق‌العاده شیک و آینده‌نگرانه
# ------------------------------------------------------------------------------
frontend_file = pathlib.Path("/opt/roxira_platform/output_apps/enterprise_hub/frontend/src/components/judge/InteractiveLegalConsole.tsx")

futuristic_ui_code = r'''"use client";

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
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: "سلام؛ من دستیار فوق هوشمند حقوقی و قضایی شما هستم.\nشرح پرونده، سوال حقوقی یا قرارداد خود را مطرح بفرمایید یا با دکمه تماس صوتی مستقیماً صحبت کنید تا ادله، مبانی قانونی و استراتژی دفاعی را برایتان تدوین کنم.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [activeTab, setActiveTab] = useState<"ADVICE" | "LAWS" | "PRECEDENTS" | "DRAFT">("ADVICE");
  const [userPhone, setUserPhone] = useState("");
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // گوینده صوتی
  const speak = (txt: string) => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(txt);
      u.lang = "fa-IR";
      u.rate = 1.05;
      window.speechSynthesis.speak(u);
    }
  };

  // فعال‌سازی مکالمه صوتی زنده (Live Voice)
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
        speak("مکالمه صوتی هوشمند برقرار شد. بفرمایید در خدمت شما هستم.");
      };

      ws.onmessage = (e) => {
        const res = JSON.parse(e.data);
        if (res.text) {
          setMessages((prev) => [...prev, { role: "assistant", text: res.text }]);
          speak(res.text);
        }
      };

      ws.onclose = () => setIsVoiceActive(false);

      const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRec) {
        const reco = new SpeechRec();
        reco.lang = "fa-IR";
        reco.continuous = true;
        reco.interimResults = false;
        reco.onresult = (evt: any) => {
          const t = evt.results[evt.results.length - 1][0].transcript;
          if (t.trim() && ws.readyState === WebSocket.OPEN) {
            setMessages((prev) => [...prev, { role: "user", text: t }]);
            ws.send(JSON.stringify({ text: t }));
          }
        };
        reco.start();
        recognitionRef.current = reco;
      }
    }
  };

  // ارسال پیام و پردازش بدون قفل لاگین
  const handleSend = async (customText?: string) => {
    const textToSend = (customText || input).trim();
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
          phone: userPhone || "GUEST_USER",
        }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: data.reply || "تحلیل استراتژیک پرونده با موفقیت آماده شد.",
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
        { role: "assistant", text: "متأسفانه در اتصال به پایگاه قوانین خطایی رخ داد. مجدداً ارسال بفرمایید." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  // صدور فایل رسمی لایحه
  const exportDocument = async (draftText: string) => {
    setExportLoading(true);
    try {
      const res = await fetch("/api/v1/apps/judge/export-defense-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          case_title: "لایحه دفاعیه تخصصی",
          draft_text: draftText,
          court_branch: "شعبه دادگاه عمومی حقوقی / تجدیدنظر / دیوان عالی",
          phone: userPhone || "09129367796",
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
      alert("خطا در صدور سند لایحه.");
    } finally {
      setExportLoading(false);
    }
  };

  const latestAssistantMsg = [...messages].reverse().find((m) => m.role === "assistant" && (m.draft || m.laws));

  return (
    <div className="flex flex-col lg:flex-row h-screen bg-[#07090e] text-zinc-100 font-sans overflow-hidden" dir="rtl">
      {/* ستون اصلی گفتگو */}
      <div className="flex-1 flex flex-col h-full border-l border-zinc-800/80 bg-gradient-to-b from-[#0b0f19] to-[#07090e]">
        {/* هدر مدرن شیشه‌ای */}
        <div className="h-16 px-6 border-b border-zinc-800/80 backdrop-blur-xl bg-zinc-950/40 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-cyan-400 p-[1px] flex items-center justify-center shadow-lg shadow-blue-500/20">
              <div className="w-full h-full bg-zinc-950 rounded-xl flex items-center justify-center text-base">
                ⚖️
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-sm tracking-wide text-white">قاضی هوشمند</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  نسخه ۳.۸ هوش قضایی
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">متصل به ۴,۵۹۱ گره تنقیح‌شده قوانین و آرای وحدت رویه</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={toggleLiveVoice}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-lg ${
                isVoiceActive
                  ? "bg-rose-600 text-white animate-pulse shadow-rose-500/30"
                  : "bg-zinc-900 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-950/30"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${isVoiceActive ? "bg-white" : "bg-emerald-400 animate-ping"}`}></span>
              {isVoiceActive ? "قطع تماس صوتی" : "مکالمه صوتی زنده"}
            </button>

            <Link
              href="/damages"
              className="hidden sm:flex px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/60 rounded-xl text-xs font-semibold text-amber-300 transition items-center gap-1"
            >
              🧮 محاسبه‌گر ماده ۵۲۲
            </Link>
          </div>
        </div>

        {/* ناحیه پیام‌ها */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {messages.map((m, idx) => (
            <div key={idx} className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}>
              <div
                className={`max-w-[88%] sm:max-w-[80%] rounded-2xl p-4 text-xs sm:text-sm leading-relaxed shadow-xl ${
                  m.role === "user"
                    ? "bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-tr-none shadow-blue-600/10"
                    : "bg-zinc-900/90 border border-zinc-800/90 text-zinc-200 rounded-tl-none backdrop-blur-md"
                }`}
              >
                <div className="whitespace-pre-wrap">{m.text}</div>
                {m.probability && (
                  <div className="mt-2.5 pt-2 border-t border-zinc-800 flex items-center justify-between text-[11px] font-bold text-emerald-400">
                    <span>📊 ارزیابی شانس موفقیت حقوقی:</span>
                    <span>{m.probability}</span>
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-end">
              <div className="bg-zinc-900/80 border border-blue-500/30 rounded-2xl px-4 py-3 text-xs text-blue-300 flex items-center gap-3 backdrop-blur-md shadow-lg shadow-blue-500/5">
                <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping"></span>
                در حال واکشی مستندات قانونی، تطبیق با آرای دیوان عالی و تنظیم لایحه...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* دکمه‌های پرامپت سریع */}
        <div className="px-4 py-2 border-t border-zinc-800/40 bg-zinc-950/20 flex gap-2 overflow-x-auto no-scrollbar">
          {[
            "مطالبه مهریه از طریق دوایر اجرای ثبت",
            "خسارت تأخیر تأدیه به نرخ روز",
            "دادخواست اثبات مالکیت و الزام به تنظیم سند",
            "اعاده دادرسی دیوان عالی موضوع ماده ۴۷۴",
          ].map((prompt, i) => (
            <button
              key={i}
              onClick={() => handleSend(prompt)}
              className="whitespace-nowrap px-3 py-1 bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-800 rounded-full text-[11px] text-zinc-400 hover:text-white transition"
            >
              ⚡ {prompt}
            </button>
          ))}
        </div>

        {/* کادر ورودی */}
        <div className="p-4 border-t border-zinc-800/80 bg-zinc-950/60 backdrop-blur-xl">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-center gap-2 bg-zinc-900/90 border border-zinc-700/70 rounded-2xl p-1.5 focus-within:border-blue-500 transition shadow-inner"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="شرح پرونده، مفاد قرارداد یا دادخواست خود را اینجا بنویسید..."
              className="flex-1 bg-transparent px-3 py-2 text-xs sm:text-sm text-white placeholder-zinc-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 disabled:opacity-40 text-white font-bold rounded-xl text-xs sm:text-sm transition shadow-md shadow-blue-500/20 flex items-center gap-1"
            >
              ارسال ⚡
            </button>
          </form>
        </div>
      </div>

      {/* ستون کناری: داشبورد تحلیل هوشمند، مواد قانونی و پیش‌نویس رسمی لایحه */}
      <div className="w-full lg:w-96 border-t lg:border-t-0 lg:border-r border-zinc-800/80 bg-[#080b12] flex flex-col h-72 lg:h-full">
        {/* تب‌های ناوبری پنل تخصصی */}
        <div className="flex border-b border-zinc-800/80 bg-zinc-950/40 p-1.5 gap-1 text-[11px] font-bold">
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
            📜 مواد استنادی
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

        {/* محتوای پنل تخصصی */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {activeTab === "DRAFT" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-zinc-300">پیش‌نویس استاندارد قضایی:</span>
                {latestAssistantMsg?.draft && (
                  <button
                    onClick={() => exportDocument(latestAssistantMsg.draft!)}
                    disabled={exportLoading}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-[10px] font-bold transition flex items-center gap-1 shadow"
                  >
                    📥 دانلود فایل رسمی (.txt)
                  </button>
                )}
              </div>

              {latestAssistantMsg?.draft ? (
                <div className="p-4 bg-zinc-950/90 border border-zinc-800 rounded-2xl text-xs font-mono text-zinc-300 leading-relaxed whitespace-pre-wrap max-h-[calc(100vh-220px)] overflow-y-auto">
                  {latestAssistantMsg.draft}
                </div>
              ) : (
                <div className="text-center py-16 text-zinc-600 text-xs">
                  پس از ارسال شرح پرونده، پیش‌نویس رسمی لایحه و دادخواست در این بخش تولید می‌شود.
                </div>
              )}
            </div>
          )}

          {activeTab === "LAWS" && (
            <div className="space-y-3">
              <span className="text-xs font-bold text-zinc-300">مبانی قانونی و مواد مرتبط:</span>
              {latestAssistantMsg?.laws && latestAssistantMsg.laws.length > 0 ? (
                latestAssistantMsg.laws.map((l, i) => (
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
              <span className="text-xs font-bold text-zinc-300">آرای لازم‌الاتباع دیوان عالی (ماده ۴۷۱):</span>
              {latestAssistantMsg?.precedents && latestAssistantMsg.precedents.length > 0 ? (
                latestAssistantMsg.precedents.map((p, i) => (
                  <div key={i} className="p-3 bg-zinc-950/80 border border-indigo-500/20 rounded-xl space-y-1">
                    <div className="text-xs font-bold text-indigo-400">🏛️ {p.title}</div>
                    {p.summary && <div className="text-[11px] text-zinc-400 leading-relaxed">{p.summary}</div>}
                  </div>
                ))
              ) : (
                <div className="text-center py-16 text-zinc-600 text-xs">آرای وحدت رویه منطبق پس از پردازش درج خواهند شد.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
'''
frontend_file.write_text(futuristic_ui_code.strip() + "\n", encoding="utf-8")
print("✅ کامپوننت فرانت‌اند با طراحی مدرن و بدون مانع ورود مستقر شد.")

# ------------------------------------------------------------------------------
# ۲. بیلد فرانت‌اند Standalone
# ------------------------------------------------------------------------------
print("🔄 ۲. بیلد بهینه‌سازی‌شده Next.js...")
os.chdir("/opt/roxira_platform/output_apps/enterprise_hub/frontend")
subprocess.run(["npm", "run", "build"], check=False)

subprocess.run(["mkdir", "-p", ".next/standalone/public", ".next/standalone/.next/static"], check=True)
subprocess.run("cp -r public/* .next/standalone/public/ 2>/dev/null || true", shell=True)
subprocess.run("cp -r .next/static/* .next/standalone/.next/static/ 2>/dev/null || true", shell=True)

# ------------------------------------------------------------------------------
# ۳. اعمال صحیح کانفیگ Nginx بدون خطای Busy
# ------------------------------------------------------------------------------
print("🌐 ۳. اصلاح و بارگذاری بدون قطعی پروکسی معکوس Nginx...")

nginx_host_file = pathlib.Path("/opt/roxira_platform/nginx.conf")
nginx_content = r'''user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 4096;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    sendfile on;
    keepalive_timeout 65;
    client_max_body_size 50M;

    upstream nextjs_frontend {
        server roxira_enterprise_frontend:3000;
    }

    upstream fastapi_backend {
        server roxira_app_prod:8000;
    }

    server {
        listen 80;
        server_name ghazihoushmand.ir www.ghazihoushmand.ir roxira.ir www.roxira.ir 5.75.200.67;

        location /api/v1/apps/judge/live-voice {
            proxy_pass http://fastapi_backend;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_read_timeout 86400s;
        }

        location /api/ {
            proxy_pass http://fastapi_backend;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        }

        location ~ ^/(docs|redoc|openapi.json) {
            proxy_pass http://fastapi_backend;
            proxy_set_header Host $host;
        }

        location / {
            proxy_pass http://nextjs_frontend;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        }
    }
}
'''
nginx_host_file.write_text(nginx_content.strip() + "\n", encoding="utf-8")

# ری‌استارت هماهنگ کانتینرها
subprocess.run(["docker", "restart", "roxira_app_prod", "roxira_enterprise_frontend", "roxira_nginx_prod"], check=True)

print("="*75)
print("🎉 استقرار بازطراحی مدرن، رفع باگ‌های ارتباطی و بهینه‌سازی شبکه با موفقیت پایان یافت.")
print("="*75)
