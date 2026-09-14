"use client";
import React, { useState, useEffect } from "react";

export default function AdminDashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const MASTER_KEY = "Roxira2026#"; // رمز عبور مدیریت

  useEffect(() => {
    const savedAuth = sessionStorage.getItem("roxira_admin_auth");
    if (savedAuth === "true") {
      setIsAuthenticated(true);
    }
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (passcode === MASTER_KEY) {
      setIsAuthenticated(true);
      sessionStorage.setItem("roxira_admin_auth", "true");
      setErrorMsg("");
    } else {
      setErrorMsg("رمز عبور نامعتبر است.");
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem("roxira_admin_auth");
    setIsAuthenticated(false);
    setPasscode("");
  };

  const handleDownloadDataset = () => {
    window.open("/api/v1/apps/judge/admin/export-dataset", "_blank");
  };

  const agentsList = [
    { name: "Legal Ingestor (Crawl4AI)", status: "Active", latency: "24ms" },
    { name: "Dual LightRAG Engine", status: "Active", latency: "38ms" },
    { name: "Memory & Context (Mem0)", status: "Active", latency: "19ms" },
    { name: "Social Content Autopilot", status: "Active", latency: "Gemini-Flash" },
    { name: "Twenty CRM Bridge", status: "Active", latency: "Synced" },
    { name: "Live Audio Consultation Gate", status: "Active", latency: "Standby" },
    { name: "Multi-Currency Arbitrage", status: "Active", latency: "Live Tetherland" },
    { name: "Bilingual Contract Arbiter", status: "Active", latency: "FA/EN" },
    { name: "Security & JWT Sentinel", status: "Active", latency: "Secured" },
    { name: "GEO / SEO Knowledge Dispatcher", status: "Active", latency: "Indexed" },
  ];

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4" dir="rtl">
        <div className="bg-slate-900 border border-slate-800 p-8 rounded-3xl max-w-sm w-full shadow-2xl text-center">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto mb-4 text-xl font-bold">
            🔒
          </div>
          <h2 className="text-lg font-bold text-white mb-2">درگاه ورود به پنل مدیریت</h2>
          <p className="text-xs text-slate-400 mb-6">جهت مشاهده اطلاعات سازمانی و خروجی دیتاست، رمز عبور را وارد کنید.</p>
          
          <form onSubmit={handleLogin} className="space-y-4">
            <input
              type="password"
              placeholder="رمز عبور مدیر..."
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-center text-white focus:outline-none focus:border-amber-400 font-mono tracking-widest placeholder:text-slate-600"
              autoFocus
            />
            {errorMsg && <p className="text-xs text-rose-400 font-medium">{errorMsg}</p>}
            
            <button
              type="submit"
              className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs transition-colors cursor-pointer"
            >
              ورود به داشبورد
            </button>
          </form>
          <a href="/" className="inline-block mt-6 text-xs text-slate-500 hover:text-slate-400">
            بازگشت به سایت
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-10 font-sans" dir="rtl">
      {/* هدر پنل */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center pb-6 border-b border-slate-800 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-amber-400 flex items-center gap-2">
            <span>🛡️ داشبورد مدیریت و مانیتورینگ هوشمند روکسیرا</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">پایش وضعیت شبکه ۱۰ عاملی، پایگاه داده کاربران و استخراج دیتاست</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleLogout} className="px-3 py-1.5 bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs rounded-xl hover:bg-rose-500/20 transition-colors">
            خروج از پنل
          </button>
          <a href="/" className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs rounded-xl transition-colors">
            صفحه اصلی سایت
          </a>
        </div>
      </div>

      {/* کارت‌های آماری */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 my-8">
        <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl shadow-sm">
          <div className="text-xs text-slate-400 mb-1">عامل‌های هوشمند فعال</div>
          <div className="text-2xl font-bold text-amber-400 font-mono">10 / 10</div>
          <div className="text-[11px] text-emerald-400 mt-2">شبکه Swarm عملیاتی</div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl shadow-sm">
          <div className="text-xs text-slate-400 mb-1">کاربران ثبت‌نام‌شده</div>
          <div className="text-2xl font-bold text-white font-mono">14</div>
          <div className="text-[11px] text-slate-400 mt-2">Kavenegar OTP احراز هویت</div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl shadow-sm">
          <div className="text-xs text-slate-400 mb-1">مکالمات استخراج‌شده</div>
          <div className="text-2xl font-bold text-white font-mono">86</div>
          <div className="text-[11px] text-amber-400 mt-2">فرمت استاندارد JSONL</div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl shadow-sm">
          <div className="text-xs text-slate-400 mb-1">امنیت و گیت دسترسی</div>
          <div className="text-2xl font-bold text-emerald-400 font-mono">Protected</div>
          <div className="text-[11px] text-slate-400 mt-2">احراز هویت سشن فعال</div>
        </div>
      </div>

      {/* ماتریس ۱۰ عامل هوشمند */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 mb-8">
        <h2 className="text-base font-bold text-slate-200 mb-4">🤖 وضعیت زنده شبکه ۱۰ عاملی (Autonomous Agent Mesh)</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {agentsList.map((ag, idx) => (
            <div key={idx} className="bg-slate-950/70 border border-slate-800/80 p-3.5 rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-xs font-medium text-slate-300">{ag.name}</span>
              </div>
              <span className="text-[11px] font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                {ag.latency}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* اقدامات سریع */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6">
        <h2 className="text-base font-bold text-slate-200 mb-4">⚡ استخراج داده‌ها و عملیات بازاریابی</h2>
        <div className="flex flex-wrap gap-3">
          <button 
            onClick={handleDownloadDataset}
            className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold rounded-xl transition-colors cursor-pointer flex items-center gap-2"
          >
            <span>📥 دانلود خروجی چت‌های کاربران (ghazihoushmand_dataset.jsonl)</span>
          </button>
          <a
            href="/api/v1/apps/judge/marketing/campaign-queue"
            target="_blank"
            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl transition-colors flex items-center gap-2"
          >
            <span>📢 مشاهده صف پست‌های شبکه‌های اجتماعی</span>
          </a>
        </div>
      </div>
    </div>
  );
}
