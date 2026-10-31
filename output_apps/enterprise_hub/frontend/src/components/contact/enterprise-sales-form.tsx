"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Send } from "lucide-react";

type SubmitStatus = "idle" | "submitting" | "success" | "error";

const INQUIRY_ENDPOINT =
  process.env.NEXT_PUBLIC_SALES_INQUIRY_ENDPOINT ?? "/api/v1/enterprise/inquiry";

const PHONE_RE = /^[0-9+\-\s]{7,20}$/;

const SUBMIT_FAILED = "ارسال درخواست ناموفق بود. دوباره تلاش کنید یا با ۰۹۱۲۹۳۶۷۷۹۶ تماس بگیرید.";

const MODULE_OPTIONS = [
  "حسابداری",
  "صورتحساب و مالیات",
  "انبار",
  "منابع انسانی",
  "CRM",
  "تطبیق بانکی",
];

const INPUT_CLASS =
  "mt-2 w-full rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-indigo-400/60 disabled:opacity-60";

interface EnterpriseSalesFormProps {
  source?: string;
}

interface FormErrors {
  name?: string;
  phone?: string;
}

/** Phones are often typed with a Persian or Arabic keyboard. */
function toLatinDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

export function EnterpriseSalesForm({ source }: EnterpriseSalesFormProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [modules, setModules] = useState<string[]>([]);
  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  const submitting = status === "submitting";

  const toggleModule = (label: string) => {
    setModules((prev) =>
      prev.includes(label) ? prev.filter((item) => item !== label) : [...prev, label],
    );
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    const normalizedPhone = toLatinDigits(phone).trim();
    const nextErrors: FormErrors = {};
    if (name.trim().length < 2) nextErrors.name = "نام خود را وارد کنید.";
    if (!PHONE_RE.test(normalizedPhone)) nextErrors.phone = "شماره تماس معتبر وارد کنید.";
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
          name: name.trim(),
          phone: normalizedPhone,
          message: modules.length > 0 ? `ماژول‌های مورد نظر: ${modules.join("، ")}` : "",
          source: source ?? "contact",
        }),
      });
      const data = (await res.json().catch(() => null)) as { reference?: string } | null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReference(data?.reference ?? `RQ-${Date.now().toString(36).toUpperCase()}`);
      setStatus("success");
    } catch {
      setSubmitError(SUBMIT_FAILED);
      setStatus("error");
    }
  };

  const reset = () => {
    setName("");
    setPhone("");
    setModules([]);
    setErrors({});
    setSubmitError(null);
    setReference(null);
    setStatus("idle");
  };

  if (status === "success" && reference) {
    return (
      <div className="rounded-3xl border border-emerald-400/25 bg-emerald-400/[0.06] p-6 text-center sm:p-8">
        <span className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
          <CheckCircle2 className="size-6" />
        </span>
        <h2 className="mt-4 text-lg font-black text-white">درخواست شما ثبت شد</h2>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          کارشناس روکسیرا در اولین فرصت کاری با شما تماس می‌گیرد.
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
        <div>
          <label htmlFor="name" className="text-xs font-semibold text-slate-300">
            نام
          </label>
          <input
            id="name"
            type="text"
            autoComplete="name"
            value={name}
            disabled={submitting}
            onChange={(event) => setName(event.target.value)}
            className={INPUT_CLASS}
          />
          {errors.name && <p className="mt-1.5 text-[11px] text-rose-400">{errors.name}</p>}
        </div>

        <div>
          <label htmlFor="phone" className="text-xs font-semibold text-slate-300">
            شماره تماس
          </label>
          <input
            id="phone"
            type="tel"
            dir="ltr"
            autoComplete="tel"
            value={phone}
            disabled={submitting}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="0912 000 0000"
            className={`${INPUT_CLASS} font-mono`}
          />
          {errors.phone && <p className="mt-1.5 text-[11px] text-rose-400">{errors.phone}</p>}
        </div>

        <fieldset className="sm:col-span-2">
          <legend className="text-xs font-semibold text-slate-300">
            به کدام ماژول‌ها نیاز دارید؟ (اختیاری)
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {MODULE_OPTIONS.map((label) => {
              const selected = modules.includes(label);
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={selected}
                  disabled={submitting}
                  onClick={() => toggleModule(label)}
                  className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                    selected
                      ? "border-indigo-400/60 bg-indigo-500/20 text-white"
                      : "border-white/10 bg-slate-950/70 text-slate-300 hover:border-white/25"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </fieldset>
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
            درخواست تماس
          </>
        )}
      </button>
    </form>
  );
}
