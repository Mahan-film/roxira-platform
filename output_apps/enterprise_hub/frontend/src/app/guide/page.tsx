import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown, Phone } from "lucide-react";
import { GhaziHeader } from "@/components/layout/ghazi-header";
import { EnamadFooter } from "@/components/layout/enamad-footer";
import { JsonLd } from "@/components/seo/json-ld";
import {
  EXAMPLE_PROMPTS,
  FAQ_ITEMS,
  GUIDE_SECTIONS,
  SUPPORT_PHONE,
  type GuideSection,
} from "@/lib/guide-content";

const GUIDE_TITLE = "راهنمای استفاده از قاضی هوشمند | گفتگو، صدا، پیش‌نویس و اشتراک";
const GUIDE_DESCRIPTION =
  "راهنمای کامل فارسی قاضی هوشمند: نحوه پرسش حقوقی، ورود با پیامک، ضبط صدا و مکالمه زنده، ابزارهای پیش‌نویس، حریم خصوصی، اشتراک VIP و رفع مشکل.";

export const metadata: Metadata = {
  title: GUIDE_TITLE,
  description: GUIDE_DESCRIPTION,
  alternates: { canonical: "https://ghazihoushmand.ir/guide" },
  openGraph: {
    title: GUIDE_TITLE,
    description: GUIDE_DESCRIPTION,
    url: "https://ghazihoushmand.ir/guide",
    siteName: "قاضی هوشمند",
    locale: "fa_IR",
    type: "article",
  },
};

const CARD = "bg-slate-900/60 border border-slate-800 rounded-2xl";

function SectionTable({ table }: { table: NonNullable<GuideSection["table"]> }) {
  return (
    <div className="scroll-fade-x overflow-x-auto rounded-xl border border-slate-800" tabIndex={0} role="region" aria-label="جدول (قابل پیمایش)">
      <table className="w-full min-w-[34rem] text-start text-xs sm:text-sm">
        <thead className="bg-slate-800/60 text-slate-200">
          <tr>
            {table.head.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 text-start font-bold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800 text-slate-300">
          {table.rows.map((row) => (
            <tr key={row[0]}>
              {row.map((cell, i) => (
                <td key={i} className={`px-3 py-2 align-top leading-relaxed ${i === 0 ? "font-semibold text-slate-100" : ""}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ section, index }: { section: GuideSection; index: number }) {
  return (
    <section id={section.id} aria-labelledby={`${section.id}-h`} className={`${CARD} scroll-mt-20 space-y-4 p-5 sm:p-6`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={`${section.id}-h`} className="text-base font-bold text-amber-400 sm:text-lg">
          {(index + 1).toLocaleString("fa-IR")}. {section.title}
        </h2>
        {section.soon && (
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-300">
            به‌زودی
          </span>
        )}
      </div>

      {section.intro && <p className="text-xs leading-7 text-slate-300 sm:text-sm">{section.intro}</p>}

      {section.steps && (
        <ol className="list-decimal space-y-2 ps-5 text-xs leading-7 text-slate-300 marker:font-bold marker:text-amber-400 sm:text-sm">
          {section.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      )}

      {section.table && <SectionTable table={section.table} />}

      {section.bullets && (
        <ul className="list-disc space-y-2 ps-5 text-xs leading-7 text-slate-300 marker:text-slate-500 sm:text-sm">
          {section.bullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}

      {section.id === "good-question" && (
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-slate-100">۵ نمونه پرسش خوب</h3>
          <ol className="space-y-2">
            {EXAMPLE_PROMPTS.map((p, i) => (
              <li key={p} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-xs leading-7 text-slate-300 sm:text-sm">
                <span className="me-2 font-bold text-amber-400">{(i + 1).toLocaleString("fa-IR")}.</span>
                {p}
              </li>
            ))}
          </ol>
          <p className="text-[11px] leading-6 text-slate-500">نام‌ها، مبلغ‌ها و تاریخ‌های بالا فقط نمونه‌اند؛ مورد واقعی خود را جایگزین کنید.</p>
        </div>
      )}

      {section.note && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-7 text-amber-100 sm:text-sm" role="note">
          {section.note}
        </p>
      )}

      {section.links && (
        <div className="flex flex-wrap gap-2">
          {section.links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="inline-flex min-h-11 items-center rounded-xl border border-amber-500/40 px-4 text-xs font-bold text-amber-400 transition-colors hover:bg-amber-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 sm:text-sm"
            >
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

export default function GuidePage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    inLanguage: "fa-IR",
    mainEntity: FAQ_ITEMS.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <div className="dark glass-app-bg flex min-h-screen flex-col font-sans text-foreground" dir="rtl" lang="fa">
      <GhaziHeader />

      <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-8 sm:px-6 sm:py-10">
        <header className="space-y-3 text-center sm:text-start">
          <h1 className="text-2xl font-extrabold text-white sm:text-3xl">راهنمای استفاده از قاضی هوشمند</h1>
          <p className="text-xs leading-7 text-slate-400 sm:text-sm">
            همه امکانات گفتگو را یک‌جا بشناسید: پرسش حقوقی، ورود با پیامک، ضبط صدا، مکالمه زنده، ابزارهای پیش‌نویس، حریم خصوصی و اشتراک.
          </p>
          <Link
            href="/chat"
            className="inline-flex min-h-11 items-center rounded-xl bg-amber-500 px-5 text-xs font-bold text-slate-950 transition-colors hover:bg-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 sm:text-sm"
          >
            شروع گفتگو
          </Link>
        </header>

        <nav aria-label="فهرست مطالب" className={`${CARD} p-5 sm:p-6`}>
          <h2 className="mb-3 text-sm font-bold text-slate-100">فهرست مطالب</h2>
          <ol className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 sm:text-sm">
            {GUIDE_SECTIONS.map((s, i) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="flex min-h-11 items-center gap-2 rounded-lg px-2 text-slate-300 transition-colors hover:text-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                >
                  <span className="text-slate-500">{(i + 1).toLocaleString("fa-IR")}.</span>
                  <span>{s.title}</span>
                </a>
              </li>
            ))}
            <li>
              <a
                href="#faq"
                className="flex min-h-11 items-center gap-2 rounded-lg px-2 text-slate-300 transition-colors hover:text-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              >
                <span className="text-slate-500">{(GUIDE_SECTIONS.length + 1).toLocaleString("fa-IR")}.</span>
                <span>پرسش‌های پرتکرار</span>
              </a>
            </li>
          </ol>
        </nav>

        {GUIDE_SECTIONS.map((s, i) => (
          <Section key={s.id} section={s} index={i} />
        ))}

        <section id="faq" aria-labelledby="faq-h" className={`${CARD} scroll-mt-20 space-y-3 p-5 sm:p-6`}>
          <h2 id="faq-h" className="text-base font-bold text-amber-400 sm:text-lg">
            {(GUIDE_SECTIONS.length + 1).toLocaleString("fa-IR")}. پرسش‌های پرتکرار
          </h2>
          <div className="space-y-2">
            {FAQ_ITEMS.map((f) => (
              <details key={f.q} className="group rounded-xl border border-slate-800 bg-slate-950/40">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-2 text-xs font-semibold text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 sm:text-sm [&::-webkit-details-marker]:hidden">
                  <span>{f.q}</span>
                  <ChevronDown className="size-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" aria-hidden="true" />
                </summary>
                <p className="px-4 pb-4 text-xs leading-7 text-slate-300 sm:text-sm">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <aside className={`${CARD} flex flex-col items-center gap-3 p-5 text-center sm:flex-row sm:justify-between sm:text-start`}>
          <p className="text-xs leading-7 text-slate-300 sm:text-sm">پاسخ پرسش خود را پیدا نکردید؟ پشتیبانی شبانه‌روزی در خدمت شماست.</p>
          <a
            href={`tel:${SUPPORT_PHONE}`}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-amber-500/40 px-4 text-sm font-bold text-amber-400 hover:bg-amber-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          >
            <Phone className="size-4" aria-hidden="true" />
            <span dir="ltr">{SUPPORT_PHONE}</span>
          </a>
        </aside>

        <p className="text-center text-[11px] leading-6 text-slate-500">
          پاسخ‌های سامانه مشاوره حقوقی رسمی نیستند و پیش از اقدام باید توسط وکیل بازبینی شوند.
        </p>
      </main>

      <JsonLd id="guide-faq-jsonld" data={faqSchema} />
      <EnamadFooter />
    </div>
  );
}
