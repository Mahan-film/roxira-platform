"use client";

import React, { useState } from "react";
import Link from "next/link";

const normalizeDigits = (str: string) => {
  const p = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
  const a = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
  let res = str;
  for (let i = 0; i < 10; i++) {
    res = res.replaceAll(p[i], String(i)).replaceAll(a[i], String(i));
  }
  return res.replace(/[^0-9]/g, '');
};

interface PilotOnboardingResponse {
  welcome_message?: string;
}

export default function LawyersPilotPage() {
  const [fullName, setFullName] = useState("");
  const [licenseNo, setLicenseNo] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<PilotOnboardingResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/v1/apps/judge/lawyers/pilot-onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: fullName, license_no: licenseNo, phone }),
      });
      const data = (await res.json()) as PilotOnboardingResponse;
      setStatus(data);
    } catch {
      setError("خطا در ثبت اطلاعات. لطفاً دوباره تلاش کنید.");
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
              وکلای دادگستری که مایل به همکاری با قاضی هوشمند هستند می‌توانند درخواست همکاری ثبت کنند. شماره پروانه از طریق سایت کانون وکلا استعلام می‌شود و در صورت توافق همکاری با شما تماس گرفته می‌شود. استفاده از امکانات VIP برای همه کاربران، از جمله وکلا، از طریق خرید اشتراک انجام می‌شود.
            </p>
          </div>

          {!status ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 bg-rose-950/40 border border-rose-500/40 rounded-xl text-xs text-rose-300">
                  {error}
                </div>
              )}
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
                <label className="block text-xs text-zinc-400 mb-1.5">شماره همراه (جهت تماس):</label>
                <input
                  type="text"
                  required
                  value={phone}
                  onChange={(e) => setPhone(normalizeDigits(e.target.value))}
                  placeholder="0912xxxxxxx"
                  className="w-full p-3 bg-zinc-950 border border-zinc-700 rounded-xl text-sm font-mono text-white focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition shadow-lg flex items-center justify-center gap-2"
              >
                {loading ? "در حال ثبت درخواست..." : "ثبت درخواست همکاری"}
              </button>
            </form>
          ) : (
            <div className="p-6 bg-emerald-950/40 border border-emerald-500/40 rounded-2xl space-y-4">
              <div className="text-emerald-400 font-bold text-base flex items-center gap-2">
                <span>✅</span> {status.welcome_message}
              </div>
              <p className="text-xs text-zinc-300">
                برای استفاده از امکانات VIP می‌توانید از صفحهٔ اشتراک و قیمت‌ها اشتراک تهیه کنید.
              </p>
              <Link
                href="/"
                className="block w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-center rounded-xl text-sm font-bold transition shadow-lg"
              >
                بازگشت به قاضی هوشمند
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
