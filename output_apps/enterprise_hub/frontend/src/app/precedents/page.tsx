import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, Gavel, Scale } from "lucide-react";

import { JsonLd } from "@/components/seo/json-ld";
import { LegalPageShell } from "@/components/legal/legal-page-shell";
import { listLegalNodes } from "@/lib/api/legal-knowledge-client";
import { buildLegalUrl } from "@/lib/seo/canonical";
import { buildLegalServiceSchema } from "@/lib/seo/legal-schema";

/** فهرست آرای وحدت رویه کم‌تغییر است؛ رندر مجدد روزانه کافی است. */
export const revalidate = 86_400;

export const metadata: Metadata = {
  title: "فهرست آرای وحدت رویه | قاضی هوشمند",
  description:
    "فهرست آرای وحدت رویه هیأت عمومی دیوان عالی کشور و رویه‌های قضایی لازم‌الاتباع در پایگاه دانش حقوقی قاضی هوشمند.",
  alternates: { canonical: buildLegalUrl("/precedents") },
  robots: { index: true, follow: true },
};

/** صفحه فهرست آرای وحدت رویه — لینک‌های داخلی قابل خزش. */
export default async function PrecedentsIndexPage() {
  const precedents = await listLegalNodes("PRECEDENT", 300);
  const serviceSchema = {
    "@context": "https://schema.org",
    ...buildLegalServiceSchema(buildLegalUrl("/precedents"), {
      node_id: "PRECEDENTS_INDEX",
      node_type: "PRECEDENT",
      title: "فهرست آرای وحدت رویه",
      category: "رأی وحدت رویه",
      content: "فهرست آرای وحدت رویه لازم‌الاتباع پایگاه دانش قاضی هوشمند.",
      metadata: {},
      created_at: null,
    }),
  };

  return (
    <LegalPageShell>
      <JsonLd id="precedents-index-jsonld" data={serviceSchema} />

      <header className="mb-8 flex flex-col gap-2">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-violet-400/25 bg-violet-400/10 px-3 py-1 text-xs font-semibold text-violet-300">
          <Scale className="size-3.5" />
          رویه قضایی لازم‌الاتباع
        </span>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
          فهرست آرای وحدت رویه
        </h1>
        <p className="text-sm text-muted-foreground">
          {precedents.length > 0
            ? `${precedents.length.toLocaleString("fa-IR")} رأی وحدت رویه و رویه قضایی لازم‌الاتباع.`
            : "آرای وحدت رویه و رویه‌های قضایی لازم‌الاتباع."}
        </p>
      </header>

      {precedents.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card/60 p-6 text-sm text-muted-foreground">
          در حال حاضر فهرست آرای وحدت رویه در دسترس نیست. لطفاً از طریق{" "}
          <Link href="/chat" className="text-violet-300 hover:underline">
            قاضی هوشمند
          </Link>{" "}
          جست‌وجو کنید.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {precedents.map((precedent) => (
            <li key={precedent.slug}>
              <Link
                href={`/precedents/${encodeURIComponent(precedent.slug)}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-4 py-3 text-sm transition-colors hover:border-violet-400/40 hover:bg-violet-400/5"
              >
                <span className="flex flex-col gap-0.5">
                  <span className="font-semibold text-foreground">
                    {precedent.title}
                  </span>
                  {precedent.category ? (
                    <span className="text-xs text-muted-foreground">
                      {precedent.category}
                    </span>
                  ) : null}
                </span>
                <ChevronLeft className="size-4 shrink-0 text-violet-300" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <aside className="mt-8 flex items-center gap-3 rounded-2xl border border-violet-400/20 bg-violet-400/5 p-5 text-sm">
        <Gavel className="size-5 shrink-0 text-violet-300" />
        <span className="text-muted-foreground">
          برای ارزیابی امکان استناد به این آرا در پرونده خود، از{" "}
          <Link href="/chat" className="font-semibold text-violet-300 hover:underline">
            دستیار حقوقی
          </Link>{" "}
          استفاده کنید.
        </span>
      </aside>
    </LegalPageShell>
  );
}
