import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ExternalLink, Scale } from "lucide-react";

import { JsonLd } from "@/components/seo/json-ld";
import { LegalPageShell } from "@/components/legal/legal-page-shell";
import { buildLegalUrl } from "@/lib/seo/canonical";
import { buildBreadcrumbList, truncateText } from "@/lib/seo/laws-schema";
import { getPublicRegulation } from "@/lib/seo/regulations-public";

/** متن مقررات کم‌تغییر است؛ رندر مجدد روزانه کافی است. */
export const revalidate = 86_400;

/**
 * هیچ مسیری پیش‌ساخته نمی‌شود؛ همهٔ صفحات مقررات با ISR و به‌صورت on-demand
 * تولید می‌شوند تا بیلد به فهرست کامل اسناد وابسته نباشد.
 */
export function generateStaticParams(): Array<{ slug: string }> {
  return [];
}

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const regulation = await getPublicRegulation(slug);
  if (!regulation) {
    return {
      title: "سند یافت نشد | قاضی هوشمند",
      robots: { index: false, follow: false },
    };
  }
  const canonical = buildLegalUrl(`/regulations/${encodeURIComponent(regulation.slug)}`);
  return {
    title: `${regulation.title} | قاضی هوشمند`,
    description: truncateText(regulation.text, 155),
    alternates: { canonical },
    robots: { index: true, follow: true },
  };
}

/** صفحهٔ یک سند مقررات با متن کامل، منبع رسمی و اسکیمای ساختاریافته. */
export default async function RegulationPage({ params }: Props) {
  const { slug } = await params;
  const regulation = await getPublicRegulation(slug);
  if (!regulation) notFound();

  const canonical = buildLegalUrl(`/regulations/${encodeURIComponent(regulation.slug)}`);
  const indexUrl = buildLegalUrl("/regulations");

  const legislation: Record<string, unknown> = {
    "@type": "Legislation",
    "@id": `${canonical}#legislation`,
    name: regulation.title,
    legislationIdentifier: regulation.slug,
    legislationJurisdiction: "IR",
    legislationLegalForce: "InForce",
    isPartOf: indexUrl,
    inLanguage: "fa",
    url: canonical,
    text: regulation.text,
  };
  if (regulation.date) legislation.legislationDate = regulation.date;
  if (regulation.issuer) {
    legislation.publisher = { "@type": "Organization", name: regulation.issuer };
  }
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      legislation,
      {
        ...buildBreadcrumbList([
          { name: "خانه", url: buildLegalUrl("/") },
          { name: "بخشنامه‌ها و مقررات", url: indexUrl },
          { name: regulation.title, url: canonical },
        ]),
        "@id": `${canonical}#breadcrumb`,
      },
    ],
  };

  return (
    <LegalPageShell>
      <JsonLd id="regulation-jsonld" data={jsonLd} />

      <nav className="mb-6 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Link href="/" className="hover:text-amber-300">
          خانه
        </Link>
        <span>/</span>
        <Link href="/regulations" className="hover:text-amber-300">
          بخشنامه‌ها و مقررات
        </Link>
        <span>/</span>
        <span className="text-amber-300">{regulation.title}</span>
      </nav>

      <article className="space-y-6">
        <header className="flex flex-col gap-4 border-b border-border pb-5">
          <h1 className="text-xl font-black leading-snug tracking-tight sm:text-2xl">
            {regulation.title}
          </h1>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            {regulation.issuer ? <span>مرجع: {regulation.issuer}</span> : null}
            {regulation.number ? <span>شماره: {regulation.number}</span> : null}
            {regulation.date ? <span>تاریخ: {regulation.date}</span> : null}
            {regulation.source_url ? (
              <a
                href={regulation.source_url}
                rel="nofollow noopener"
                target="_blank"
                className="inline-flex items-center gap-1 font-semibold text-amber-300 hover:underline"
              >
                <ExternalLink className="size-3.5" />
                منبع رسمی{regulation.source ? ` (${regulation.source})` : ""}
              </a>
            ) : null}
          </div>

          {regulation.needs_review ? (
            <p className="flex items-center gap-2 rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-300">
              <AlertTriangle className="size-3.5 shrink-0" />
              این متن هنوز توسط کارشناس بازبینی نشده است
            </p>
          ) : null}
        </header>

        <section
          aria-label="متن کامل سند"
          className="whitespace-pre-wrap rounded-2xl border border-border bg-card/60 p-6 text-sm leading-relaxed text-foreground"
        >
          {regulation.text}
        </section>

        <div className="flex flex-col gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-6">
          <p className="text-sm text-muted-foreground">
            کاربرد این بخشنامه یا مصوبه در پروندهٔ شما و استناد به آن نیازمند تحلیل
            اختصاصی است.
          </p>
          <Link
            href={`/chat?q=${encodeURIComponent(`${regulation.title} چگونه به پروندهٔ من مربوط است؟`)}`}
            className="inline-flex w-fit items-center gap-2 rounded-xl bg-gradient-to-l from-amber-500 to-orange-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-orange-600/30 transition-transform hover:-translate-y-0.5"
          >
            <Scale className="size-4" />
            این سند را از قاضی هوشمند بپرسید
          </Link>
        </div>
      </article>
    </LegalPageShell>
  );
}
