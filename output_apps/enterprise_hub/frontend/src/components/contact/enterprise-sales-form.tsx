"use client";

import { useState } from "react";
import { Building2, CheckCircle2, Cpu, FileCheck2, Loader2, Send } from "lucide-react";

type TierId = "starter" | "business" | "foundry";
type SubmitStatus = "idle" | "submitting" | "success" | "error";

interface TierOption {
  id: TierId;
  name: string;
  tagline: string;
  icon: typeof FileCheck2;
}

const TIERS: TierOption[] = [
  { id: "starter", name: "Starter", tagline: "انطباق مالیاتی (سامانه مودیان)", icon: FileCheck2 },
  { id: "business", name: "Business", tagline: "ERP و حسابداری یکپارچه", icon: Building2 },
  { id: "foundry", name: "Foundry Developer", tagline: "کارخانه نرم‌افزار خودمختار", icon: Cpu },
];

const INQUIRY_ENDPOINT =
  process.env.NEXT_PUBLIC_SALES_INQUIRY_ENDPOINT ?? "/api/v1/enterprise/inquiry";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_RE = /^[0-9+\-\s]{7,20}$/;

interface FormState {
  company: string;
  phone: string;
  email: string;
  tier: TierId;
  notes: string;
}

interface FormErrors {
  company?: string;
  phone?: string;
  email?: string;
}

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};
  if (form.company.trim().length < 2) errors.company = "نام شرکت را وارد کنید.";
  if (!PHONE_RE.test(form.phone.trim())) errors.phone = "شماره تماس معتبر وارد کنید.";
  if (!EMAIL_RE.test(form.email.trim())) errors.email = "ایمیل سازمانی معتبر وارد کنید.";
  return errors;
}

const EMPTY_FORM: FormState = {
  company: "",
  phone: "",
  email: "",
  tier: "starter",
  notes: "",
};

export function EnterpriseSalesForm() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  const submitting = status === "submitting";

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    const nextErrors = validate(form);
    setErrors(nextErrors);
    setSubmitError(null);
    if (Object.keys(nextErrors).length > 0) {
      setStatus("error");
      return;
    }

    setStatus("submitting");
    try {
      const res = await fetch(INQUIRY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, source: "enterprise-demo" }),
      });
      const data = (await res.json().catch(() => null)) as
        | { reference?: string; error?: string }
        | null;
      if (!res.ok) {
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      setReference(data?.reference ?? `RQ-${Date.now().toString(36).toUpperCase()}`);
      setStatus("success");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "ارسال درخواست ناموفق بود.");
      setStatus("error");
    }
  };

  const reset = () => {
    setForm(EMPTY_FORM);
    setErrors({});
    setSubmitError(null);
    setReference(null);
    setStatus("idle");
  };

  if (status === "success" && reference) {
    return (
      <div className="rounded-3xl border border-emerald-400/25 bg-emerald-400/[0.06] p-8 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
          <CheckCircle2 className="size-6" />
        </span>
        <h2 className="mt-4 text-lg font-black text-white">درخواست دموی سازمانی ثبت شد</h2>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          کارشناس فروش سازمانی رکسایرا در اولین فرصت کاری با شما تماس می‌گیرد.
        </p>
        <p className="mt-4 inline-block rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2 font-mono text-xs text-slate-200">
          کد پیگیری: {reference}
        </p>
        <div className="mt-6">
          <button
            type="button"
            onClick={reset}
            className="rounded-xl border border-white/15 bg-white/5 px-5 py-2.5 text-xs font-bold text-slate-200 transition-colors hover:border-indigo-400/40 hover:text-white"
          >
            ثبت درخواست جدید
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-8"
    >
      <fieldset disabled={submitting}>
        <legend className="text-xs font-bold text-slate-300">طرح مورد نظر</legend>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {TIERS.map((tier) => {
            const Icon = tier.icon;
            const active = form.tier === tier.id;
            return (
              <button
                key={tier.id}
                type="button"
                onClick={() => update("tier", tier.id)}
                aria-pressed={active}
                className={`flex flex-col items-start gap-2 rounded-2xl border p-4 text-right transition-colors disabled:opacity-60 ${
                  active
                    ? "border-indigo-400/50 bg-indigo-500/10"
                    : "border-white/10 bg-slate-950/40 hover:border-white/20"
                }`}
              >
                <span
                  className={`flex size-9 items-center justify-center rounded-xl border ${
                    active
                      ? "border-indigo-400/40 bg-indigo-400/10 text-indigo-300"
                      : "border-white/10 bg-white/5 text-slate-400"
                  }`}
                >
                  <Icon className="size-4" />
                </span>
                <span className={`text-sm font-bold ${active ? "text-white" : "text-slate-200"}`}>
                  {tier.name}
                </span>
                <span className="text-[11px] leading-relaxed text-slate-500">{tier.tagline}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="company" className="text-xs font-semibold text-slate-300">
            نام شرکت
          </label>
          <input
            id="company"
            type="text"
            value={form.company}
            disabled={submitting}
            onChange={(event) => update("company", event.target.value)}
            placeholder="مثال: شرکت داده‌پردازان نوین"
            className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-indigo-400/60 disabled:opacity-60"
          />
          {errors.company && <p className="mt-1.5 text-[11px] text-rose-400">{errors.company}</p>}
        </div>

        <div>
          <label htmlFor="phone" className="text-xs font-semibold text-slate-300">
            شماره تماس
          </label>
          <input
            id="phone"
            type="tel"
            dir="ltr"
            value={form.phone}
            disabled={submitting}
            onChange={(event) => update("phone", event.target.value)}
            placeholder="0912 000 0000"
            className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 font-mono text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-indigo-400/60 disabled:opacity-60"
          />
          {errors.phone && <p className="mt-1.5 text-[11px] text-rose-400">{errors.phone}</p>}
        </div>

        <div>
          <label htmlFor="email" className="text-xs font-semibold text-slate-300">
            ایمیل سازمانی
          </label>
          <input
            id="email"
            type="email"
            dir="ltr"
            value={form.email}
            disabled={submitting}
            onChange={(event) => update("email", event.target.value)}
            placeholder="name@company.com"
            className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 font-mono text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-indigo-400/60 disabled:opacity-60"
          />
          {errors.email && <p className="mt-1.5 text-[11px] text-rose-400">{errors.email}</p>}
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="notes" className="text-xs font-semibold text-slate-300">
            توضیحات (اختیاری)
          </label>
          <textarea
            id="notes"
            rows={3}
            value={form.notes}
            disabled={submitting}
            onChange={(event) => update("notes", event.target.value)}
            placeholder="اندازه سازمان، ماژول‌های مورد نیاز و بازه زمانی مدنظر"
            className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-indigo-400/60 disabled:opacity-60"
          />
        </div>
      </div>

      {status === "error" && submitError && (
        <p className="mt-4 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-[11px] text-rose-200">
          {submitError}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        aria-busy={submitting}
        className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-indigo-500 to-violet-600 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-indigo-600/30 transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
      >
        {submitting ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            در حال ارسال…
          </>
        ) : (
          <>
            <Send className="size-4" />
            درخواست دموی سازمانی
          </>
        )}
      </button>
    </form>
  );
}
