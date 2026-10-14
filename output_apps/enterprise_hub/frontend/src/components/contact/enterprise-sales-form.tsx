"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Send } from "lucide-react";

type SubmitStatus = "idle" | "submitting" | "success" | "error";

const INQUIRY_ENDPOINT =
  process.env.NEXT_PUBLIC_SALES_INQUIRY_ENDPOINT ?? "/api/v1/enterprise/inquiry";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_RE = /^[0-9+\-\s]{7,20}$/;

interface EnterpriseSalesFormProps {
  source?: string;
  submitLabel?: string;
}

interface FormState {
  name: string;
  company: string;
  phone: string;
  email: string;
  message: string;
}

interface FormErrors {
  name?: string;
  company?: string;
  phone?: string;
  email?: string;
}

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};
  if (form.name.trim().length < 2) errors.name = "نام و نام خانوادگی را وارد کنید.";
  if (form.company.trim().length < 2) errors.company = "نام شرکت را وارد کنید.";
  if (!PHONE_RE.test(form.phone.trim())) errors.phone = "شماره تماس معتبر وارد کنید.";
  if (!EMAIL_RE.test(form.email.trim())) errors.email = "ایمیل سازمانی معتبر وارد کنید.";
  return errors;
}

const EMPTY_FORM: FormState = {
  name: "",
  company: "",
  phone: "",
  email: "",
  message: "",
};

export function EnterpriseSalesForm({ source }: EnterpriseSalesFormProps) {
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
        body: JSON.stringify({
          name: form.name.trim(),
          company: form.company.trim(),
          phone: form.phone.trim(),
          email: form.email.trim(),
          message: form.message.trim(),
          source: source ?? "enterprise-demo",
        }),
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
        <h2 className="mt-4 text-lg font-black text-white">درخواست شما ثبت شد</h2>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          کارشناس رکسایرا در اولین فرصت کاری برای هماهنگی دمو و دسترسی اولیه با شما تماس می‌گیرد.
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
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="name" className="text-xs font-semibold text-slate-300">
            نام و نام خانوادگی
          </label>
          <input
            id="name"
            type="text"
            value={form.name}
            disabled={submitting}
            onChange={(event) => update("name", event.target.value)}
            placeholder="مثال: سارا محمدی"
            className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-indigo-400/60 disabled:opacity-60"
          />
          {errors.name && <p className="mt-1.5 text-[11px] text-rose-400">{errors.name}</p>}
        </div>

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
          <label htmlFor="message" className="text-xs font-semibold text-slate-300">
            توضیحات (اختیاری)
          </label>
          <textarea
            id="message"
            rows={3}
            value={form.message}
            disabled={submitting}
            onChange={(event) => update("message", event.target.value)}
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
            درخواست دمو و دسترسی اولیه
          </>
        )}
      </button>
    </form>
  );
}
