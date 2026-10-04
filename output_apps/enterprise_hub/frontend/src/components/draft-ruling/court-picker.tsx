"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Info, Loader2, Sparkles } from "lucide-react";

import {
  DraftApiError,
  RULING_LIMITS as L,
  suggestCourt,
  type CourtSuggestResponse,
} from "@/lib/api/smart-judge-client";
import {
  COURT_TYPE_GROUPS,
  courtLabel,
  isRulingCourtType,
  type RulingCourtType,
} from "@/lib/court-types";

const STAGE_LABEL: Record<string, string> = {
  prosecution: "دادسرا",
  trial: "نخستین",
  appeal: "تجدیدنظر",
  disciplinary: "انتظامی",
  council: "شورا",
};

interface Props {
  court: RulingCourtType;
  onCourtChange: (c: RulingCourtType) => void;
  fieldError?: string;
}

/** گام اول: انتخاب دادگاه، دستی یا با کمک راهنمای قاعده‌محور (غیرقطعی). */
export function CourtPicker({ court, onCourtChange, fieldError }: Props) {
  const [facts, setFacts] = useState("");
  const [claims, setClaims] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<null | "validation" | "network" | "server">(null);
  const [data, setData] = useState<CourtSuggestResponse | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const canAsk = !!facts.trim() && facts.length <= L.maxFacts && claims.length <= L.maxClaims;

  async function ask() {
    if (loading || !canAsk) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setErr(null);
    try {
      setData(await suggestCourt({ facts, ...(claims.trim() ? { claims } : {}) }, ctrl.signal));
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (e instanceof DraftApiError && e.kind === "validation") setErr("validation");
      else if (e instanceof DraftApiError && e.kind === "network") setErr("network");
      else setErr("server");
    } finally {
      setLoading(false);
    }
  }

  const suggestions = (data?.suggestions ?? []).slice(0, 3);

  return (
    <div className="ap-card md:col-span-2" data-testid="court-picker">
      <h2 className="mb-1 text-xl font-semibold">پرونده شما مربوط به کدام دادگاه است؟</h2>
      <p className="ap-muted mb-4 text-sm">
        اگر مطمئن نیستید، شرح کوتاه پرونده را بنویسید تا مرجع احتمالی پیشنهاد شود؛ یا نوع دادگاه را مستقیم انتخاب کنید.
      </p>

      <div className="rounded-xl p-4" style={{ background: "var(--ap-surface-2)" }}>
        <p className="mb-3 font-medium">کمکم کن انتخاب کنم</p>
        <div className="mb-2 flex items-center justify-between">
          <label htmlFor="suggest_facts" className="text-sm">
            شرح وقایع
          </label>
          <span className="ap-muted text-sm" dir="ltr">
            {facts.length}/{L.maxFacts}
          </span>
        </div>
        <textarea
          id="suggest_facts"
          className="ap-input"
          style={{ background: "var(--ap-bg)" }}
          rows={3}
          value={facts}
          onChange={(e) => setFacts(e.target.value)}
        />
        <div className="mb-2 mt-3 flex items-center justify-between">
          <label htmlFor="suggest_claims" className="text-sm">
            خواسته‌ها (اختیاری)
          </label>
          <span className="ap-muted text-sm" dir="ltr">
            {claims.length}/{L.maxClaims}
          </span>
        </div>
        <textarea
          id="suggest_claims"
          className="ap-input"
          style={{ background: "var(--ap-bg)" }}
          rows={2}
          value={claims}
          onChange={(e) => setClaims(e.target.value)}
        />
        <button type="button" className="ap-btn ap-btn-ghost mt-3" onClick={ask} disabled={loading || !canAsk}>
          {loading ? (
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <Sparkles className="size-4" aria-hidden="true" />
          )}
          {loading ? "در حال بررسی..." : "پیشنهاد دادگاه"}
        </button>

        <div aria-live="polite" className="mt-3">
          {err && (
            <p role="alert" className="flex items-center gap-2 text-[var(--ap-danger)]">
              <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
              {err === "validation"
                ? "متن واردشده معتبر نیست؛ طول فیلدها را بررسی کنید."
                : err === "network"
                  ? "ارتباط با سرور برقرار نشد."
                  : "خطایی در سرور رخ داد؛ بعداً دوباره تلاش کنید."}
            </p>
          )}
          {data && (
            <div data-testid="court-suggestions">
              <p
                role="note"
                className="mb-3 flex gap-2 text-sm font-medium"
                style={{ color: "var(--ap-warn)" }}
                data-testid="suggest-guidance-note"
              >
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  فقط راهنمایی است و قطعی نیست؛ حتماً با وکیل یا کارشناس حقوقی تأیید کنید.
                  {data.banner ? ` ${data.banner}` : ""}
                </span>
              </p>
              {suggestions.length === 0 ? (
                <p className="ap-muted">پیشنهادی یافت نشد؛ دادگاه را دستی انتخاب کنید.</p>
              ) : (
                <ul className="grid gap-3 md:grid-cols-3">
                  {suggestions.map((s) => {
                    const selectable = isRulingCourtType(s.court_key);
                    const selected = selectable && court === s.court_key;
                    return (
                      <li key={s.court_key} className="ap-card" style={selected ? { border: "2px solid var(--ap-warn)" } : undefined}>
                        <p className="font-semibold">{s.court_name_fa}</p>
                        <p className="ap-muted text-sm">{STAGE_LABEL[s.stage] ?? s.stage}</p>
                        <p className="mt-2 text-sm">{s.reason_fa}</p>
                        {s.court_key.startsWith("prosecution_") ? (
                          <Link
                            href="/draft-indictment"
                            className="ap-btn ap-btn-ghost mt-3"
                            data-testid={`suggestion-${s.court_key}`}
                          >
                            رفتن به پیش‌نویس کیفرخواست
                          </Link>
                        ) : selectable ? (
                          <button
                            type="button"
                            className="ap-btn ap-btn-ghost mt-3"
                            aria-pressed={selected}
                            data-testid={`suggestion-${s.court_key}`}
                            onClick={() => isRulingCourtType(s.court_key) && onCourtChange(s.court_key)}
                          >
                            {selected ? "انتخاب شد" : "انتخاب این دادگاه"}
                          </button>
                        ) : (
                          <p className="ap-muted mt-3 text-sm" data-testid={`suggestion-${s.court_key}`}>
                            فقط راهنمایی است؛ پیش‌نویس رأی برای این مرجع در دسترس نیست.
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {data.disclaimer && <p className="ap-muted mt-3 text-sm">{data.disclaimer}</p>}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor="court_type" className="mb-2 block font-medium">
          انتخاب دستی نوع دادگاه
        </label>
        <select
          id="court_type"
          className="ap-input"
          value={court}
          onChange={(e) => onCourtChange(e.target.value as RulingCourtType)}
          {...(fieldError ? { "aria-invalid": true, "aria-describedby": "court_type-err" } : {})}
        >
          {COURT_TYPE_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.courts.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <p className="ap-muted mt-1 text-sm">انتخاب فعلی: {courtLabel(court)}</p>
        {fieldError && (
          <p id="court_type-err" role="alert" className="mt-1 text-sm text-[var(--ap-danger)]">
            مقدار این فیلد معتبر نیست: {fieldError}
          </p>
        )}
      </div>
    </div>
  );
}
