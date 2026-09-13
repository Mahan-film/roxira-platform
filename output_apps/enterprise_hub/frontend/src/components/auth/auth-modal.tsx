"use client";

import React, { useState } from "react";
import { ShieldCheck, Phone, KeyRound, Loader2, X, CheckCircle2 } from "lucide-react";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (user: any) => void;
}

const normalizeDigits = (str: string) => {
  const p = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
  const a = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
  let res = str || "";
  for (let i = 0; i < 10; i++) {
    res = res.replaceAll(p[i], String(i)).replaceAll(a[i], String(i));
  }
  return res.replace(/[^0-9]/g, "");
};

export function AuthModal({ isOpen, onClose, onSuccess }: AuthModalProps) {
  const [step, setStep] = useState<"PHONE" | "OTP">("PHONE");
  const [phone, setPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  if (!isOpen) return null;

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    const cleanPhone = normalizeDigits(phone);
    if (!cleanPhone.startsWith("09") || cleanPhone.length !== 11) {
      setErrorMsg("لطفاً یک شماره همراه معتبر ۱۱ رقمی (مثال: ۰۹۱۲۹۳۶۷۷۹۶) وارد کنید.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/v1/apps/judge/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: cleanPhone }),
      });
      const data = await res.json();

      if (res.ok && (data.status === "success" || data.delivery_confirmed || data.expires_in)) {
        setStep("OTP");
        setSuccessMsg("کد تأیید ۵ رقمی به شماره همراه شما ارسال شد.");
      } else {
        setErrorMsg(data.message || "خطا در برقراری ارتباط با سرویس پیامک.");
      }
    } catch (err) {
      setErrorMsg("خطا در ارسال درخواست به سرور. لطفاً اتصال اینترنت را بررسی فرمایید.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    const cleanCode = normalizeDigits(otpCode);

    if (cleanCode.length < 4) {
      setErrorMsg("لطفاً کد تأیید دریافتی را کامل وارد فرمایید.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/v1/apps/judge/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalizeDigits(phone), code: cleanCode }),
      });
      const data = await res.json();

      if (res.ok && data.status === "success") {
        if (typeof window !== "undefined") {
          localStorage.setItem("ghazi_auth_token", data.token);
          localStorage.setItem("ghazi_user_phone", data.user?.phone || normalizeDigits(phone));
        }
        if (onSuccess) onSuccess(data.user);
        onClose();
      } else {
        setErrorMsg(data.message || "کد تأیید وارد شده نادرست یا منقضی شده است.");
      }
    } catch (err) {
      setErrorMsg("خطا در اعتبارسنجی کد تأیید.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
      <div className="relative w-full max-w-md rounded-3xl border border-slate-800 bg-[#0F172A] p-6 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute left-4 top-4 rounded-xl p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <X className="size-5" />
        </button>

        <div className="flex flex-col items-center text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/20">
            <ShieldCheck className="size-7" />
          </div>
          <h3 className="mt-3 text-lg font-bold text-white">ورود به سامانه قاضی هوشمند</h3>
          <p className="mt-1 text-xs text-slate-400">
            {step === "PHONE"
              ? "جهت استفاده از خدمات تحلیلی و تنظیم لوایح، شماره همراه خود را وارد نمایید."
              : `کد پیامک‌شده به شماره ${phone} را وارد کنید.`}
          </p>
        </div>

        {errorMsg && (
          <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3 text-center text-xs text-rose-300">
            {errorMsg}
          </div>
        )}

        {successMsg && (
          <div className="mt-4 flex items-center justify-center gap-1.5 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-center text-xs text-emerald-300">
            <CheckCircle2 className="size-4" />
            <span>{successMsg}</span>
          </div>
        )}

        {step === "PHONE" ? (
          <form onSubmit={handleSendOtp} className="mt-5 space-y-4">
            <div>
              <label className="mb-1.5 block text-right text-xs text-slate-300">شماره همراه</label>
              <div className="relative">
                <input
                  type="tel"
                  dir="ltr"
                  placeholder="09129367796"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-2xl border border-slate-700 bg-slate-900/90 px-4 py-3 text-center font-mono text-base text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  autoFocus
                />
                <Phone className="absolute right-4 top-3.5 size-5 text-slate-500" />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 py-3.5 text-sm font-bold text-white shadow-lg transition hover:bg-indigo-500 disabled:opacity-50"
            >
              {loading ? <Loader2 className="size-5 animate-spin" /> : "دریافت کد تأیید"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="mt-5 space-y-4">
            <div>
              <label className="mb-1.5 block text-right text-xs text-slate-300">کد تأیید ۵ رقمی</label>
              <div className="relative">
                <input
                  type="text"
                  dir="ltr"
                  maxLength={5}
                  placeholder="• • • • •"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  className="w-full rounded-2xl border border-slate-700 bg-slate-900/90 px-4 py-3 text-center font-mono text-xl tracking-widest text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  autoFocus
                />
                <KeyRound className="absolute right-4 top-3.5 size-5 text-slate-500" />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3.5 text-sm font-bold text-white shadow-lg transition hover:bg-emerald-500 disabled:opacity-50"
            >
              {loading ? <Loader2 className="size-5 animate-spin" /> : "تأیید و ورود به سامانه"}
            </button>

            <button
              type="button"
              onClick={() => {
                setStep("PHONE");
                setOtpCode("");
                setErrorMsg("");
              }}
              className="w-full text-center text-xs text-slate-400 hover:text-white"
            >
              ویرایش شماره همراه
            </button>
          </form>
        )}

        <div className="mt-5 border-t border-slate-800/80 pt-3 text-center text-[10px] text-slate-500">
          احراز هویت امن با پیامک یکبارمصرف
        </div>
      </div>
    </div>
  );
}
