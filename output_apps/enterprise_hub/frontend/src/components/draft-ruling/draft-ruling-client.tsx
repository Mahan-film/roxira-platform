"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Plus,
  Scale,
  Trash2,
} from "lucide-react";

import {
  RULING_LIMITS as L,
  RulingDraftError,
  draftRuling,
  type RulingDraftResponse,
  type RulingEvidenceItem,
} from "@/lib/api/smart-judge-client";
import { ResultView } from "@/components/draft-ruling/result-view";
import { CourtPicker } from "@/components/draft-ruling/court-picker";
import { courtLabel, type RulingCourtType } from "@/lib/court-types";


type ErrKind = null | "vip" | "validation" | "network" | "server";

function Counter({ value, max }: { value: string; max: number }) {
  const over = value.length > max;
  return (
    <span className={`text-sm ${over ? "text-[var(--ap-danger)]" : "ap-muted"}`} dir="ltr" aria-live="off">
      {value.length}/{max}
    </span>
  );
}

export function DraftRulingClient() {
  const [court, setCourt] = useState<RulingCourtType>("civil");
  const [claimant, setClaimant] = useState("");
  const [respondent, setRespondent] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [facts, setFacts] = useState("");
  const [claims, setClaims] = useState("");
  const [evidence, setEvidence] = useState<RulingEvidenceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<ErrKind>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<RulingDraftResponse | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const tooLong =
    claimant.length > L.maxName ||
    respondent.length > L.maxName ||
    jurisdiction.length > L.maxName ||
    facts.length > L.maxFacts ||
    claims.length > L.maxClaims ||
    evidence.some((e) => e.title.length > L.maxEvidenceTitle || e.text.length > L.maxEvidenceText);
  const missing = !claimant.trim() || !respondent.trim() || !facts.trim() || !claims.trim();

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (loading || missing || tooLong) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setErr(null);
    setFieldErrors({});
    try {
      const data = await draftRuling(
        {
          court_type: court,
          claimant: claimant.trim(),
          respondent: respondent.trim(),
          facts,
          claims,
          evidence: evidence.filter((x) => x.title.trim() || x.text.trim()),
          ...(jurisdiction.trim() ? { jurisdiction: jurisdiction.trim() } : {}),
        },
        ctrl.signal,
      );
      setResult(data);
      setTimeout(() => document.getElementById("result")?.focus(), 0);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (error instanceof RulingDraftError) {
        if (error.kind === "vip_required") setErr("vip");
        else if (error.kind === "validation") {
          setErr("validation");
          setFieldErrors(error.fieldErrors);
        } else if (error.kind === "network") setErr("network");
        else setErr("server");
      } else setErr("server");
    } finally {
      setLoading(false);
    }
  }

  const fe = (name: string) => fieldErrors[name];
  const hint = (name: string) =>
    fe(name) ? (
      <p id={`${name}-err`} role="alert" className="mt-1 text-sm text-[var(--ap-danger)]">
        مقدار این فیلد معتبر نیست: {fe(name)}
      </p>
    ) : null;
  const inv = (name: string) => (fe(name) ? { "aria-invalid": true, "aria-describedby": `${name}-err` } : {});

  return (
    <div className="ap-theme min-h-screen" dir="rtl" lang="fa">
      <nav className="ap-nav no-print sticky top-0 z-40 w-full" aria-label="ناوبری اصلی">
        <div className="mx-auto flex h-full max-w-5xl items-center justify-between px-4 text-sm">
          <Link href="/chat" className="inline-flex min-h-11 items-center gap-2 font-semibold">
            <Scale className="size-4" aria-hidden="true" />
            قاضی هوشمند
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/chat" className="inline-flex min-h-11 items-center ap-muted hover:opacity-80">
              گفتگوی حقوقی
            </Link>
            <Link href="/services" className="inline-flex min-h-11 items-center ap-muted hover:opacity-80">
              اشتراک VIP
            </Link>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-5xl px-4">
        <header className="ap-section no-print text-center">
          <h1 className="ap-hero">پیش‌نویس غیررسمی رأی</h1>
          <p className="ap-muted mx-auto mt-5 max-w-2xl">
            شرح پرونده را وارد کنید تا پیش‌نویسی غیرقطعی با استناد به مواد قانونی تأییدشده تهیه شود. این
            خروجی رأی دادگاه نیست و باید توسط قاضی یا وکیل صالح بررسی شود.
          </p>
        </header>

        <form onSubmit={submit} className="no-print pb-12" noValidate aria-busy={loading}>
          <div className="grid gap-4 md:grid-cols-2">
            <CourtPicker court={court} onCourtChange={setCourt} fieldError={fe("court_type")} />

            {(
              [
                ["claimant", "خواهان / شاکی", claimant, setClaimant],
                ["respondent", "خوانده / مشتکی‌عنه", respondent, setRespondent],
              ] as const
            ).map(([id, label, val, set]) => (
              <div key={id} className="ap-card">
                <div className="mb-2 flex items-center justify-between">
                  <label htmlFor={id} className="font-medium">
                    {label} <span aria-hidden="true">*</span>
                  </label>
                  <Counter value={val} max={L.maxName} />
                </div>
                <input
                  id={id}
                  className="ap-input"
                  value={val}
                  maxLength={L.maxName + 50}
                  required
                  aria-required="true"
                  onChange={(e) => set(e.target.value)}
                  {...inv(id)}
                />
                {hint(id)}
              </div>
            ))}

            <div className="ap-card md:col-span-2">
              <div className="mb-2 flex items-center justify-between">
                <label htmlFor="jurisdiction" className="font-medium">
                  حوزه قضایی (اختیاری)
                </label>
                <Counter value={jurisdiction} max={L.maxName} />
              </div>
              <input
                id="jurisdiction"
                className="ap-input"
                value={jurisdiction}
                onChange={(e) => setJurisdiction(e.target.value)}
                {...inv("jurisdiction")}
              />
              {hint("jurisdiction")}
            </div>

            {(
              [
                ["facts", "شرح وقایع", facts, setFacts, L.maxFacts, 8],
                ["claims", "خواسته‌ها و ادعاها", claims, setClaims, L.maxClaims, 5],
              ] as const
            ).map(([id, label, val, set, max, rows]) => (
              <div key={id} className="ap-card md:col-span-2">
                <div className="mb-2 flex items-center justify-between">
                  <label htmlFor={id} className="font-medium">
                    {label} <span aria-hidden="true">*</span>
                  </label>
                  <Counter value={val} max={max} />
                </div>
                <textarea
                  id={id}
                  className="ap-input"
                  rows={rows}
                  value={val}
                  required
                  aria-required="true"
                  onChange={(e) => set(e.target.value)}
                  {...inv(id)}
                />
                {hint(id)}
              </div>
            ))}

            <fieldset className="ap-card md:col-span-2">
              <legend className="mb-3 flex w-full items-center justify-between font-medium">
                <span>ادله و مستندات</span>
                <span className="ap-muted text-sm" dir="ltr">
                  {evidence.length}/{L.maxEvidenceItems}
                </span>
              </legend>
              <ul className="space-y-4">
                {evidence.map((item, i) => (
                  <li key={i} className="rounded-xl p-4" style={{ background: "var(--ap-surface-2)" }}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <label htmlFor={`ev-title-${i}`} className="font-medium">
                        عنوان دلیل
                      </label>
                      <Counter value={item.title} max={L.maxEvidenceTitle} />
                    </div>
                    <input
                      id={`ev-title-${i}`}
                      className="ap-input"
                      style={{ background: "var(--ap-bg)" }}
                      value={item.title}
                      onChange={(e) =>
                        setEvidence(evidence.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
                      }
                      {...inv(`evidence.${i}.title`)}
                    />
                    {hint(`evidence.${i}.title`)}
                    <div className="mb-2 mt-3 flex items-center justify-between gap-2">
                      <label htmlFor={`ev-text-${i}`} className="font-medium">
                        متن یا خلاصه دلیل
                      </label>
                      <Counter value={item.text} max={L.maxEvidenceText} />
                    </div>
                    <textarea
                      id={`ev-text-${i}`}
                      className="ap-input"
                      style={{ background: "var(--ap-bg)" }}
                      rows={3}
                      value={item.text}
                      onChange={(e) =>
                        setEvidence(evidence.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
                      }
                      {...inv(`evidence.${i}.text`)}
                    />
                    {hint(`evidence.${i}.text`)}
                    <button
                      type="button"
                      className="ap-btn ap-btn-ghost mt-3"
                      onClick={() => setEvidence(evidence.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      حذف دلیل
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="ap-btn ap-btn-ghost mt-4"
                disabled={evidence.length >= L.maxEvidenceItems}
                onClick={() => setEvidence([...evidence, { title: "", text: "" }])}
              >
                <Plus className="size-4" aria-hidden="true" />
                افزودن دلیل
              </button>
            </fieldset>
          </div>

          <div className="mt-6 space-y-4" aria-live="polite">
            {err === "vip" && (
              <div role="alert" className="ap-card flex gap-3" style={{ border: "1px solid var(--ap-warn)" }}>
                <AlertTriangle className="mt-1 size-5 shrink-0" style={{ color: "var(--ap-warn)" }} aria-hidden="true" />
                <div>
                  <p className="font-semibold">این امکان ویژه مشترکین VIP است.</p>
                  <p className="ap-muted">
                    برای تهیه پیش‌نویس رأی، اشتراک خود را ارتقا دهید یا با حساب VIP وارد شوید.
                  </p>
                  <Link href="/services" className="ap-btn mt-3">
                    ارتقای اشتراک
                  </Link>
                </div>
              </div>
            )}
            {err === "validation" && (
              <div role="alert" className="ap-card flex gap-3" style={{ border: "1px solid var(--ap-danger)" }}>
                <AlertTriangle className="mt-1 size-5 shrink-0" style={{ color: "var(--ap-danger)" }} aria-hidden="true" />
                <p>اطلاعات واردشده معتبر نیست. فیلدهای علامت‌دار را بررسی و اصلاح کنید.</p>
              </div>
            )}
            {err === "network" && (
              <div role="alert" className="ap-card flex flex-wrap items-center gap-3" style={{ border: "1px solid var(--ap-danger)" }}>
                <AlertTriangle className="size-5 shrink-0" style={{ color: "var(--ap-danger)" }} aria-hidden="true" />
                <p className="flex-1">ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.</p>
                <button type="button" className="ap-btn" onClick={() => submit()}>
                  تلاش مجدد
                </button>
              </div>
            )}
            {err === "server" && (
              <div role="alert" className="ap-card flex flex-wrap items-center gap-3" style={{ border: "1px solid var(--ap-danger)" }}>
                <AlertTriangle className="size-5 shrink-0" style={{ color: "var(--ap-danger)" }} aria-hidden="true" />
                <p className="flex-1">خطایی در سرور رخ داد. چند لحظه بعد دوباره تلاش کنید.</p>
                <button type="button" className="ap-btn" onClick={() => submit()}>
                  تلاش مجدد
                </button>
              </div>
            )}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button type="submit" className="ap-btn" disabled={loading || missing || tooLong}>
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  در حال تهیه پیش‌نویس...
                </>
              ) : (
                <>
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                  تهیه پیش‌نویس
                </>
              )}
            </button>
            {(missing || tooLong) && !loading && (
              <span className="ap-muted text-sm">
                {tooLong ? "طول یکی از فیلدها از حد مجاز بیشتر است." : "فیلدهای ستاره‌دار را تکمیل کنید."}
              </span>
            )}
          </div>
        </form>

        {result && (
          <section id="result" tabIndex={-1} aria-label="نتیجه پیش‌نویس" className="ap-section pt-0 outline-none">
            <ResultView result={result} courtLabel={courtLabel(court)} />
          </section>
        )}
      </main>
    </div>
  );
}
