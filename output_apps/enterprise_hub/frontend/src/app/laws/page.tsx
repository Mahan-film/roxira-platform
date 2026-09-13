import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, FileText, Gavel } from "lucide-react";

import { JsonLd } from "@/components/seo/json-ld";
import { LegalPageShell } from "@/components/legal/legal-page-shell";
import { listLegalNodes } from "@/lib/api/legal-knowledge-client";
import { buildLegalUrl } from "@/lib/seo/canonical";
import { buildLegalServiceSchema } from "@/lib/seo/legal-schema";

/** فهرست مواد قانونی کم‌تغییر است؛ رندر مجدد روزانه کافی است. */
export const revalidate = 86_400;

export const metadata: Metadata = {
  title: "فهرست مواد قانونی | قاضی هوشمند",
  description:
    "فهرست مواد قانونی معتبر (قانون مدنی، تجارت، آیین دادرسی و ...) در پایگاه دانش حقوقی قاضی هوشمند.",
  alternates: { canonical: buildLegalUrl("/laws") },
  robots: { index: true, follow: true },
};

/** صفحه فهرست مواد قانونی — لینک‌های داخلی قابل خزش برای موتورهای جست‌وجو. */
export default async function LawsIndexPage() {
  const laws = await listLegalNodes("LAW", 300);
  const serviceSchema = {
    "@context": "https://schema.org",
    ...buildLegalServiceSchema(buildLegalUrl("/laws"), {
      node_id: "LAWS_INDEX",
      node_type: "LAW",
      title: "فهرست مواد قانونی",
      category: "قانون",
      content: "فهرست مواد قانونی پایگاه دانش قاضی هوشمند.",
      metadata: {},
      created_at: null,
    }),
  };

  return (
    <LegalPageShell>
      <JsonLd id="laws-index-jsonld" data={serviceSchema} />

      <header className="mb-8 flex flex-col gap-2">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-300">
          <FileText className="size-3.5" />
          پایگاه دانش حقوقی
        </span>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
          فهرست مواد قانونی
        </h1>
        <p className="text-sm text-muted-foreground">
          {laws.length > 0
            ? `${laws.length.toLocaleString("fa-IR")} ماده قانونی معتبر به‌همراه متن کامل و اسکیمای ساختاریافته.`
            : "مواد قانونی معتبر به‌همراه متن کامل و اسکیمای ساختاریافته."}
        </p>
      </header>

      {laws.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card/60 p-6 text-sm text-muted-foreground">
          در حال حاضر فهرست مواد قانونی در دسترس نیست. لطفاً از طریق{" "}
          <Link href="/chat" className="text-amber-300 hover:underline">
            قاضی هوشمند
          </Link>{" "}
          جست‌وجو کنید.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {laws.map((law) => (
            <li key={law.slug}>
              <Link
                href={`/laws/${encodeURIComponent(law.slug)}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-4 py-3 text-sm transition-colors hover:border-amber-400/40 hover:bg-amber-400/5"
              >
                <span className="flex flex-col gap-0.5">
                  <span className="font-semibold text-foreground">{law.title}</span>
                  {law.category ? (
                    <span className="text-xs text-muted-foreground">
                      {law.category}
                    </span>
                  ) : null}
                </span>
                <ChevronLeft className="size-4 shrink-0 text-amber-300" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <aside className="mt-8 flex items-center gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-5 text-sm">
        <Gavel className="size-5 shrink-0 text-amber-300" />
        <span className="text-muted-foreground">
          برای جست‌وجوی معنایی میان مواد قانونی، پرونده خود را در{" "}
          <Link href="/chat" className="font-semibold text-amber-300 hover:underline">
            دستیار حقوقی
          </Link>{" "}
          تحلیل کنید.
        </span>
      </aside>
    </LegalPageShell>
  );
}
