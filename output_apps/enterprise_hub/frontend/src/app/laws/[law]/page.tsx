import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, FileText, Landmark } from "lucide-react";

import { JsonLd } from "@/components/seo/json-ld";
import { LegalPageShell } from "@/components/legal/legal-page-shell";
import { buildLegalUrl } from "@/lib/seo/canonical";
import { getPublicLaw } from "@/lib/seo/laws-public";
import {
  articleStatusLabel,
  buildBreadcrumbList,
  isRepealed,
  truncateText,
} from "@/lib/seo/laws-schema";

/** فهرست مواد یک قانون کم‌تغییر است؛ رندر مجدد روزانه کافی است. */
export const revalidate = 86_400;

interface Props {
  params: Promise<{ law: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { law: lawSlug } = await params;
  const law = await getPublicLaw(lawSlug);
  if (!law) {
    return {
      title: "قانون یافت نشد | قاضی هوشمند",
      robots: { index: false, follow: false },
    };
  }
  const canonical = buildLegalUrl(`/laws/${encodeURIComponent(law.slug)}`);
  const description = truncateText(
    `${law.name}${law.law_type ? ` (${law.law_type})` : ""} — فهرست مواد این قانون به‌همراه متن کامل، وضعیت اعتبار و منبع رسمی در پایگاه دانش حقوقی قاضی هوشمند.`,
    160,
  );
  return {
    title: `${law.name} | قاضی هوشمند`,
    description,
    alternates: { canonical },
    robots: { index: true, follow: true },
  };
}

/** صفحه یک قانون — فهرست مواد با لینک به متن کامل هر ماده. */
export default async function LawPage({ params }: Props) {
  const { law: lawSlug } = await params;
  const law = await getPublicLaw(lawSlug);
  if (!law) notFound();

  const canonical = buildLegalUrl(`/laws/${encodeURIComponent(law.slug)}`);
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    ...buildBreadcrumbList([
      { name: "خانه", url: buildLegalUrl("/") },
      { name: "قوانین", url: buildLegalUrl("/laws") },
      { name: law.name, url: canonical },
    ]),
  };

  return (
    <LegalPageShell>
      <JsonLd id="law-jsonld" data={breadcrumbJsonLd} />

      <nav className="mb-6 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Link href="/" className="hover:text-amber-300">
          خانه
        </Link>
        <span>/</span>
        <Link href="/laws" className="hover:text-amber-300">
          قوانین
        </Link>
        <span>/</span>
        <span className="text-amber-300">{law.name}</span>
      </nav>

      <header className="mb-8 flex flex-col gap-3">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-300">
          <Landmark className="size-3.5" />
          {law.law_type?.trim() || "قانون"}
        </span>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{law.name}</h1>
        <p className="text-sm text-muted-foreground">
          {law.articles.length.toLocaleString("fa-IR")} ماده
          {law.approval_date ? ` · تاریخ تصویب: ${law.approval_date}` : ""}
        </p>
        {law.source_url ? (
          <a
            href={law.source_url}
            rel="nofollow noopener"
            target="_blank"
            className="w-fit text-xs font-semibold text-amber-300 hover:underline"
          >
            منبع رسمی{law.source ? `: ${law.source}` : ""}
          </a>
        ) : null}
      </header>

      {law.articles.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card/60 p-6 text-sm text-muted-foreground">
          در حال حاضر فهرست مواد این قانون در دسترس نیست.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {law.articles.map((article) => (
            <li key={article.slug}>
              <Link
                href={`/laws/${encodeURIComponent(law.slug)}/${encodeURIComponent(article.slug)}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-4 py-3 text-sm transition-colors hover:border-amber-400/40 hover:bg-amber-400/5"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-semibold text-foreground">ماده {article.label}</span>
                  {isRepealed(article) ? (
                    <span className="w-fit rounded-full border border-red-500/40 bg-red-950/50 px-2 py-0.5 text-[11px] font-bold text-red-400">
                      {articleStatusLabel(article)}
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
        <FileText className="size-5 shrink-0 text-amber-300" />
        <span className="text-muted-foreground">
          برای تحلیل یک مادهٔ خاص از این قانون در پروندهٔ خود، از{" "}
          <Link href="/chat" className="font-semibold text-amber-300 hover:underline">
            دستیار حقوقی قاضی هوشمند
          </Link>{" "}
          استفاده کنید.
        </span>
      </aside>
    </LegalPageShell>
  );
}
