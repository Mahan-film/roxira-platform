import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowRight, CircleHelp, ExternalLink, Scale } from "lucide-react";

import { JsonLd } from "@/components/seo/json-ld";
import { LegalPageShell } from "@/components/legal/legal-page-shell";
import { buildLegalUrl } from "@/lib/seo/canonical";
import { getPublicArticle } from "@/lib/seo/laws-public";
import {
  articleStatusLabel,
  buildArticleJsonLd,
  extractLeadingSentences,
  isRepealed,
  truncateText,
} from "@/lib/seo/laws-schema";

/** متن قانونی کم‌تغییر است؛ رندر مجدد روزانه کافی است. */
// The root layout reads headers() (host-based metadata), so ISR/SSG here failed at runtime with
// DYNAMIC_SERVER_USAGE (HTTP 500, QA 2026-10-21). Render per request; the data is local and cheap.
export const dynamic = "force-dynamic";

/**
 * هیچ مسیری پیش‌ساخته نمی‌شود؛ همهٔ صفحات ماده با ISR و به‌صورت on-demand
 * تولید می‌شوند تا بیلد به فهرست کامل مواد وابسته نباشد.
 */
export function generateStaticParams(): Array<{ law: string; article: string }> {
  return [];
}

interface Props {
  params: Promise<{ law: string; article: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { law: lawSlug, article: articleSlug } = await params;
  const detail = await getPublicArticle(lawSlug, articleSlug);
  if (!detail) {
    return {
      title: "ماده یافت نشد | قاضی هوشمند",
      robots: { index: false, follow: false },
    };
  }

  const canonical = buildLegalUrl(
    `/laws/${encodeURIComponent(detail.law.slug)}/${encodeURIComponent(detail.article.slug)}`,
  );
  const heading = `ماده ${detail.article.label} ${detail.law.name}`;
  return {
    title: `${heading} | قاضی هوشمند`,
    description: truncateText(detail.article.text, 155),
    alternates: { canonical },
    robots: { index: true, follow: true },
  };
}

/** صفحهٔ یک مادهٔ قانونی با متن کامل، منبع، اسکیمای ساختاریافته و FAQ. */
export default async function ArticlePage({ params }: Props) {
  const { law: lawSlug, article: articleSlug } = await params;
  const detail = await getPublicArticle(lawSlug, articleSlug);
  if (!detail) notFound();

  const { law, article } = detail;
  const canonical = buildLegalUrl(
    `/laws/${encodeURIComponent(law.slug)}/${encodeURIComponent(article.slug)}`,
  );
  const lawUrl = buildLegalUrl(`/laws/${encodeURIComponent(law.slug)}`);
  const heading = `ماده ${article.label} ${law.name}`;
  const repealed = isRepealed(article);
  const faqAnswer =
    extractLeadingSentences(article.text, 2) || truncateText(article.text, 300);
  const question = `${heading} چه حکمی دارد و چگونه به پروندهٔ من مربوط است؟`;
  const chatHref = `/chat?q=${encodeURIComponent(question)}`;

  const articleJsonLd = buildArticleJsonLd({
    lawSlug: law.slug,
    lawName: law.name,
    articleSlug: article.slug,
    label: article.label,
    text: article.text,
    approvalDate: article.approval_date,
    amendedOn: article.amended_on,
    repealed,
    canonicalUrl: canonical,
    lawUrl,
  });

  return (
    <LegalPageShell>
      <JsonLd id="article-jsonld" data={articleJsonLd} />

      <nav className="mb-6 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Link href="/" className="hover:text-amber-300">
          خانه
        </Link>
        <span>/</span>
        <Link href="/laws" className="hover:text-amber-300">
          قوانین
        </Link>
        <span>/</span>
        <Link href={lawUrl} className="hover:text-amber-300">
          {law.name}
        </Link>
        <span>/</span>
        <span className="text-amber-300">ماده {article.label}</span>
      </nav>

      <article className="space-y-6">
        <header className="flex flex-col gap-4 border-b border-border pb-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-xl font-black leading-snug tracking-tight sm:text-2xl">
              {heading}
            </h1>
            {repealed ? (
              <span className="rounded-full border border-red-500/40 bg-red-950/50 px-3 py-1 text-xs font-bold text-red-400">
                منسوخ
              </span>
            ) : (
              <span className="rounded-full border border-emerald-500/40 bg-emerald-950/50 px-3 py-1 text-xs font-bold text-emerald-400">
                {articleStatusLabel(article)}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            {article.approval_date ? <span>تاریخ تصویب: {article.approval_date}</span> : null}
            {article.amended_on ? <span>آخرین اصلاح: {article.amended_on}</span> : null}
            {article.source_url ? (
              <a
                href={article.source_url}
                rel="nofollow noopener"
                target="_blank"
                className="inline-flex items-center gap-1 font-semibold text-amber-300 hover:underline"
              >
                <ExternalLink className="size-3.5" />
                متن در منبع رسمی{article.source ? ` (${article.source})` : ""}
              </a>
            ) : null}
          </div>

          {article.needs_review ? (
            <p className="flex items-center gap-2 text-xs text-amber-300">
              <AlertTriangle className="size-3.5 shrink-0" />
              متن در حال بازبینی
            </p>
          ) : null}
        </header>

        <section
          aria-label="متن ماده"
          className="whitespace-pre-wrap rounded-2xl border border-border bg-card/60 p-6 text-sm leading-relaxed text-foreground"
        >
          {article.text}
        </section>

        <section
          aria-label="پرسش متداول"
          className="rounded-2xl border border-border bg-card/40 p-6"
        >
          <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
            <CircleHelp className="size-4 text-amber-300" />
            این ماده درباره چیست؟
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{faqAnswer}</p>
        </section>

        <div className="flex flex-col gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-6">
          <p className="text-sm text-muted-foreground">
            تفسیر این ماده در پروندهٔ شما، استناد در لایحه و ارزیابی امکان موفقیت نیازمند
            تحلیل اختصاصی است.
          </p>
          <Link
            href={chatHref}
            className="inline-flex w-fit items-center gap-2 rounded-xl bg-gradient-to-l from-amber-500 to-orange-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-orange-600/30 transition-transform hover:-translate-y-0.5"
          >
            <Scale className="size-4" />
            این ماده را از قاضی هوشمند بپرسید
          </Link>
        </div>

        <nav className="flex items-center justify-between gap-3 border-t border-border pt-5 text-sm">
          {detail.prev_slug ? (
            <Link
              href={`/laws/${encodeURIComponent(law.slug)}/${encodeURIComponent(detail.prev_slug)}`}
              className="inline-flex items-center gap-1.5 text-amber-300 hover:underline"
            >
              <ArrowRight className="size-4" />
              ماده پیشین
            </Link>
          ) : (
            <span />
          )}
          {detail.next_slug ? (
            <Link
              href={`/laws/${encodeURIComponent(law.slug)}/${encodeURIComponent(detail.next_slug)}`}
              className="inline-flex items-center gap-1.5 text-amber-300 hover:underline"
            >
              ماده پسین
              <ArrowLeft className="size-4" />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </article>
    </LegalPageShell>
  );
}
