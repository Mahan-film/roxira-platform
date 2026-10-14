import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Scale, ScrollText } from "lucide-react";

import { LegalPageShell } from "@/components/legal/legal-page-shell";
import { JsonLd } from "@/components/seo/json-ld";
import { buildLegalUrl } from "@/lib/seo/canonical";
import { buildBreadcrumbList } from "@/lib/seo/laws-schema";
import { listPublicLaws } from "@/lib/seo/laws-public";
import {
  FALLBACK_PUBLIC_LAWS,
  GUIDE_SLUGS,
  articleHref,
  buildLawIndex,
  getGuide,
  resolveLawSlug,
  type LawIndexEntry,
} from "@/lib/guides";
import { GuideContent, type CitationResolver } from "@/lib/guides-markdown";

/** متن قانونی/راهنما کم‌تغییر است؛ رندر مجدد روزانه کافی است. */
export const revalidate = 86_400;

export function generateStaticParams(): Array<{ slug: string }> {
  return GUIDE_SLUGS.map((slug) => ({ slug }));
}

interface Props {
  params: Promise<{ slug: string }>;
}

const DISCLAIMER =
  "این متن اطلاعات عمومی حقوقی است و جایگزین مشاورهٔ تخصصی با وکیل دادگستری در پرونده‌های قضایی نیست.";

async function loadLawIndex(): Promise<LawIndexEntry[]> {
  const laws = await listPublicLaws();
  const merged = laws.length > 0 ? [...laws, ...FALLBACK_PUBLIC_LAWS] : [...FALLBACK_PUBLIC_LAWS];
  return buildLawIndex(merged);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) {
    return { title: "راهنما یافت نشد | قاضی هوشمند", robots: { index: false, follow: false } };
  }

  const canonical = buildLegalUrl(`/guides/${guide.slug}`);
  return {
    title: `${guide.title} | قاضی هوشمند`,
    description: guide.description,
    keywords: guide.keywords,
    alternates: { canonical },
    openGraph: {
      title: guide.title,
      description: guide.description,
      url: canonical,
      siteName: "قاضی هوشمند",
      locale: "fa_IR",
      type: "article",
    },
    robots: { index: true, follow: true },
  };
}

export default async function GuideDetailPage({ params }: Props) {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) notFound();

  const lawIndex = await loadLawIndex();
  const resolveCitation: CitationResolver = (lawName, article) => {
    const lawSlug = resolveLawSlug(lawIndex, lawName);
    return lawSlug ? articleHref(lawSlug, article) : null;
  };

  const canonical = buildLegalUrl(`/guides/${guide.slug}`);
  const chatHref = `/chat?q=${encodeURIComponent(guide.title)}`;
  const faqs =
    guide.faqs.length > 0 ? guide.faqs : [{ q: guide.title, a: guide.description }];

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${canonical}#article`,
        headline: guide.title,
        description: guide.description,
        inLanguage: "fa-IR",
        mainEntityOfPage: canonical,
        url: canonical,
        ...(guide.updated ? { dateModified: guide.updated } : {}),
        ...(guide.keywords.length > 0 ? { keywords: guide.keywords.join(", ") } : {}),
        author: { "@type": "Organization", name: "قاضی هوشمند", url: buildLegalUrl("/") },
        publisher: { "@type": "Organization", name: "قاضی هوشمند", url: buildLegalUrl("/") },
      },
      {
        "@type": "FAQPage",
        "@id": `${canonical}#faq`,
        inLanguage: "fa-IR",
        mainEntity: faqs.map((faq) => ({
          "@type": "Question",
          name: faq.q,
          acceptedAnswer: { "@type": "Answer", text: faq.a },
        })),
      },
      {
        ...buildBreadcrumbList([
          { name: "خانه", url: buildLegalUrl("/") },
          { name: "راهنماهای حقوقی", url: buildLegalUrl("/guides") },
          { name: guide.title, url: canonical },
        ]),
        "@id": `${canonical}#breadcrumb`,
      },
    ],
  };

  const citationRows = guide.citations.map((citation) => {
    const lawSlug = resolveLawSlug(lawIndex, citation.lawName);
    const articles = citation.articles.length > 0 ? citation.articles : [""];
    return {
      lawName: citation.lawName,
      links: articles.map((article) => ({
        article,
        href: lawSlug ? articleHref(lawSlug, article) : null,
      })),
    };
  });

  return (
    <LegalPageShell>
      <JsonLd id="guide-jsonld" data={jsonLd} />

      <nav className="mb-6 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Link href={buildLegalUrl("/")} className="hover:text-amber-300">
          خانه
        </Link>
        <span>/</span>
        <Link href="/guides" className="hover:text-amber-300">
          راهنماهای حقوقی
        </Link>
        <span>/</span>
        <span className="text-amber-300">{guide.title}</span>
      </nav>

      <article className="space-y-6">
        <header className="flex flex-col gap-3 border-b border-border pb-5">
          <h1 className="text-2xl font-black leading-snug tracking-tight sm:text-3xl">{guide.title}</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">{guide.description}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <ScrollText className="size-3.5 text-amber-300" />
              راهنمای حقوقی قاضی هوشمند
            </span>
            {guide.updated ? <span>آخرین به‌روزرسانی: {guide.updated}</span> : null}
          </div>
        </header>

        <GuideContent markdown={guide.markdown} resolveCitation={resolveCitation} />

        {citationRows.length > 0 ? (
          <section
            aria-label="استنادهای قانونی"
            className="space-y-3 rounded-2xl border border-border bg-card/40 p-5"
          >
            <h2 className="text-sm font-bold text-foreground">استنادهای قانونی</h2>
            <ul className="space-y-2 text-xs text-muted-foreground">
              {citationRows.map((row) => (
                <li key={row.lawName} className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-200">{row.lawName}</span>
                  <span className="flex flex-wrap gap-1.5">
                    {row.links.map((link) =>
                      link.href ? (
                        <Link
                          key={`${row.lawName}-${link.article}`}
                          href={link.href}
                          className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-0.5 font-semibold text-amber-300 hover:bg-amber-400/20"
                        >
                          {link.article ? `ماده ${link.article}` : "مشاهدهٔ قانون"}
                        </Link>
                      ) : (
                        <span
                          key={`${row.lawName}-${link.article}`}
                          className="rounded-full border border-border px-2.5 py-0.5"
                        >
                          {link.article ? `ماده ${link.article}` : "قانون"}
                        </span>
                      ),
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="flex flex-col gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-6">
          <p className="text-sm text-muted-foreground">
            وضعیت پروندهٔ شما با این راهنمای عمومی متفاوت است؛ برای تحلیل اختصاصی و پاسخ دقیق، از قاضی
            هوشمند بپرسید.
          </p>
          <Link
            href={chatHref}
            className="inline-flex w-fit items-center gap-2 rounded-xl bg-gradient-to-l from-amber-500 to-orange-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-orange-600/30 transition-transform hover:-translate-y-0.5"
          >
            <Scale className="size-4" />
            این موضوع را از قاضی هوشمند بپرسید
          </Link>
        </div>

        <aside className="flex items-start gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4 text-xs leading-relaxed text-amber-100">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden="true" />
          <span>{DISCLAIMER}</span>
        </aside>
      </article>
    </LegalPageShell>
  );
}
