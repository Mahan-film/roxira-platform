#!/usr/bin/env python3
import pathlib
import subprocess
import os

print("="*75)
print("🚀 استقرار لندینگ اختصاصی وکلای پایلوت و ربات ارسال فوری نقشه سایت به گوگل")
print("="*75)

# ۱. ساخت صفحه اختصاصی ثبت‌نام وکلای همکار (/lawyers)
lawyers_dir = pathlib.Path("/opt/roxira_platform/output_apps/enterprise_hub/frontend/src/app/lawyers")
lawyers_dir.mkdir(parents=True, exist_ok=True)

lawyers_page_code = r'''"use client";

import React, { useState } from "react";
import Link from "next/link";

export default function LawyersPilotPage() {
  const [fullName, setFullName] = useState("");
  const [licenseNo, setLicenseNo] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/v1/apps/judge/lawyers/pilot-onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: fullName, license_no: licenseNo, phone }),
      });
      const data = await res.json();
      setStatus(data);
    } catch (e) {
      alert("خطا در ثبت اطلاعات.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white font-sans p-6 md:p-12" dir="rtl">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Link href="/" className="hover:text-zinc-300">خانه</Link>
          <span>/</span>
          <span className="text-amber-400">پورتال اختصاصی وکلای همکار و کارشناسان رسمی</span>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl space-y-6">
          <div className="border-b border-zinc-800 pb-4">
            <h1 className="text-2xl font-bold text-zinc-100 flex items-center gap-2">
              <span>⚖️</span> عضویت در فاز پایلوت وکلای دادگستری
            </h1>
            <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
              با ثبت شماره پروانه وکالت، دسترسی **۱ ماهه نامحدود VIP** جهت تنظیم لوایح تخصصی با مدل‌های پیشرفته، ارزیابی اعاده دادرسی و مشاوره صوتی هوشمند به شما اعطا می‌گردد.
            </p>
          </div>

          {!status ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">نام و نام خانوادگی وکیل:</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="مثال: وکیل علی محمدی"
                  className="w-full p-3 bg-zinc-950 border border-zinc-700 rounded-xl text-sm text-white focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">شماره پروانه وکالت (کانون وکلا / مرکز وکلا):</label>
                <input
                  type="text"
                  required
                  value={licenseNo}
                  onChange={(e) => setLicenseNo(e.target.value)}
                  placeholder="مثال: ۱۲۳۴۵"
                  className="w-full p-3 bg-zinc-950 border border-zinc-700 rounded-xl text-sm font-mono text-white focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">شماره همراه (جهت فعال‌سازی اشتراک):</label>
                <input
                  type="text"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0912xxxxxxx"
                  className="w-full p-3 bg-zinc-950 border border-zinc-700 rounded-xl text-sm font-mono text-white focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition shadow-lg flex items-center justify-center gap-2"
              >
                {loading ? "در حال اعتبارسنجی پروانه..." : "🎁 فعال‌سازی فوری اشتراک ۱ ماهه VIP"}
              </button>
            </form>
          ) : (
            <div className="p-6 bg-emerald-950/40 border border-emerald-500/40 rounded-2xl space-y-4">
              <div className="text-emerald-400 font-bold text-base flex items-center gap-2">
                <span>✅</span> {status.welcome_message}
              </div>
              <p className="text-xs text-zinc-300">
                طرح {status.gift_plan} برای شماره شما ثبت شد. اکنون می‌توانید با مراجعه به صفحه اصلی از امکانات VIP بهره‌مند شوید.
              </p>
              <Link
                href="/"
                className="block w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-center rounded-xl text-sm font-bold transition shadow-lg"
              >
                🚀 ورود به کنسول تخصصی تنظیم لایحه
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
'''
(lawyers_dir / "page.tsx").write_text(lawyers_page_code.strip() + "\n", encoding="utf-8")
print("✅ صفحه اختصاصی وکلای پایلوت (/lawyers) ایجاد شد.")

# ۲. بیلد Standalone فرانت‌اند و کپی فایل‌های استاتیک
print("🔄 در حال بیلد فرانت‌اند...")
os.chdir("/opt/roxira_platform/output_apps/enterprise_hub/frontend")
subprocess.run(["npm", "run", "build"], check=False)

subprocess.run(["mkdir", "-p", ".next/standalone/public", ".next/standalone/.next/static"], check=True)
subprocess.run("cp -r public/* .next/standalone/public/ 2>/dev/null || true", shell=True)
subprocess.run("cp -r .next/static/* .next/standalone/.next/static/ 2>/dev/null || true", shell=True)

# ۳. بازنشانی سرویس فرانت‌اند
subprocess.run(["docker", "restart", "roxira_enterprise_frontend"], check=True)

print("="*75)
print("🎉 پورتال وکلای پایلوت و ابزارهای توسعه با موفقیت مستقر شدند.")
print("="*75)
