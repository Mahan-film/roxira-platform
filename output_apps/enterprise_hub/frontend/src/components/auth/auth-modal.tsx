"use client";

import React, { useState } from "react";
import { ShieldCheck, Phone, KeyRound, Loader2, X, CheckCircle2 } from "lucide-react";

import {
  JudgeAuthError,
  isValidIranianMobile,
  normalizeOtpCode,
  normalizePhone,
  sendJudgeOtp,
  verifyJudgeOtp,
} from "@/lib/api/judge-auth-client";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (user: unknown) => void;
}

/**
 * مودال ورود پیامکی قاضی هوشمند (نسخهٔ سبک).
 *
 * تمام فراخوانی‌ها از `judge-auth-client` عبور می‌کنند تا مسیر ارسال کد
 * همواره و به‌صورت قطعی `/api/v1/apps/judge/auth/send-otp` باشد؛ شماره
 * همراه نرمال‌سازی می‌شود و پس از پاسخ موفق، مرحلهٔ رابط به‌طور خودکار به
 * ورودی کد تأیید منتقل می‌گردد.
 */
export function AuthModal({ isOpen, onClose, onSuccess }: AuthModalProps) {
  const [step, setStep] = useState<"PHONE" | "OTP">("PHONE");
  const [phone, setPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");
    setDevCode(null);

    const cleanPhone = normalizePhone(phone);
    if (!isValidIranianMobile(cleanPhone)) {
      setErrorMsg("لطفاً یک شماره همراه معتبر ۱۱ رقمی (مثال: ۰۹۱۲۹۳۶۷۷۹۶) وارد کنید.");
      return;
    }

    setPhone(cleanPhone);
    setLoading(true);
    try {
      const result = await sendJudgeOtp(cleanPhone);

      // پاسخ موفق → انتقال قطعی به حالت ورود کد تأیید
      setStep("OTP");
      setOtpCode("");
      setDevCode(result.devCode);
      setSuccessMsg(
        result.deliveryConfirmed
          ? "کد تأیید ۵ رقمی به شماره همراه شما ارسال شد."
          : "کد تأیید صادر شد. در صورت عدم دریافت پیامک، دوباره تلاش کنید.",
      );
    } catch (err) {
      setErrorMsg(
        err instanceof JudgeAuthError
          ? err.details.join(" | ")
          : "خطا در برقراری ارتباط با سرویس احراز هویت.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    const cleanCode = normalizeOtpCode(otpCode);

    if (cleanCode.length < 4) {
      setErrorMsg("لطفاً کد تأیید دریافتی را کامل وارد فرمایید.");
      return;
    }

    setLoading(true);
    try {
      const session = await verifyJudgeOtp(phone, cleanCode);

      if (typeof window !== "undefined") {
        localStorage.setItem("ghazi_auth_token", session.accessToken);
        localStorage.setItem("ghazi_user_phone", session.user.phone);
      }
      if (onSuccess) onSuccess(session.user);
      onClose();
    } catch (err) {
      setErrorMsg(
        err instanceof JudgeAuthError
          ? err.details.join(" | ")
          : "خطا در اعتبارسنجی کد تأیید.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
      <div className="relative w-full max-w-md rounded-3xl border border-slate-800 bg-[#0F172A] p-6 shadow-2xl">
        <button
          onClick={onClose}
          aria-label="بستن"
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

        {devCode && (
          <p className="mt-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-center font-mono text-sm text-amber-200">
            کد آزمایشی: {devCode}
          </p>
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
                  onChange={(e) => setOtpCode(normalizeOtpCode(e.target.value).slice(0, 5))}
                  className="w-full rounded-2xl border border-slate-700 bg-slate-900/90 px-4 py-3 text-center font-mono text-xl tracking-widest text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  autoFocus
                />
                <KeyRound className="absolute right-4 top-3.5 size-5 text-slate-500" />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || otpCode.length !== 5}
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
                setSuccessMsg("");
                setDevCode(null);
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
