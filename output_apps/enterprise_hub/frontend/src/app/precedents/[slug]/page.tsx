import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Gavel, Landmark, Scale } from "lucide-react";

import { JsonLd } from "@/components/seo/json-ld";
import { LegalPageShell } from "@/components/legal/legal-page-shell";
import { GuideContent } from "@/lib/guides-markdown";
import { getPrecedentBySlug } from "@/lib/api/legal-knowledge-client";
import { buildLegalUrl } from "@/lib/seo/canonical";
import { buildBreadcrumbList, extractLeadingSentences, truncateText } from "@/lib/seo/laws-schema";

/**
 * متن آرای وحدت رویه کم‌تغییر است؛ اما ریشهٔ layout بر پایهٔ headers() است و
 * ISR/SSG در زمان اجرا با DYNAMIC_SERVER_USAGE (HTTP 500) شکست می‌خورد؛
 * بنابراین هر درخواست رندر می‌شود و دادهٔ محلی ارزان است.
 */
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const precedent = await getPrecedentBySlug(slug);
  if (!precedent || !precedent.content?.trim()) {
    return {
      title: "رأی وحدت رویه یافت نشد | قاضی هوشمند",
      robots: { index: false, follow: false },
    };
  }
  const canonical = buildLegalUrl(`/precedents/${encodeURIComponent(slug)}`);
  return {
    title: `${precedent.title} | قاضی هوشمند`,
    description: truncateText(
      precedent.content || `متن و استدلال قضایی لازم‌الاتباع «${precedent.title}» هیأت عمومی دیوان عالی کشور.`,
      160,
    ),
    alternates: { canonical },
    robots: { index: true, follow: true },
  };
}

export default async function PrecedentDetailPage({ params }: Props) {
  const { slug } = await params;
  const precedent = await getPrecedentBySlug(slug);
  if (!precedent || !precedent.content?.trim()) notFound();

  const canonical = buildLegalUrl(`/precedents/${encodeURIComponent(slug)}`);
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    ...buildBreadcrumbList([
      { name: "خانه", url: buildLegalUrl("/") },
      { name: "آرای وحدت رویه", url: buildLegalUrl("/precedents") },
      { name: precedent.title, url: canonical },
    ]),
  };
  const faqAnswer =
    extractLeadingSentences(precedent.content, 2) || truncateText(precedent.content, 300);
  const chatHref = `/chat?q=${encodeURIComponent(`استناد به ${precedent.title} در پروندهٔ من`)}`;

  return (
    <LegalPageShell>
      <JsonLd id="precedent-jsonld" data={breadcrumbJsonLd} />

      <nav className="mb-6 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Link href="/" className="hover:text-amber-300">
          خانه
        </Link>
        <span>/</span>
        <Link href="/precedents" className="hover:text-amber-300">
          آرای وحدت رویه
        </Link>
        <span>/</span>
        <span className="text-violet-300">{precedent.title}</span>
      </nav>

      <article className="space-y-6">
        <header className="flex flex-col gap-3 border-b border-border pb-5">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-violet-400/25 bg-violet-400/10 px-3 py-1 text-xs font-semibold text-violet-300">
            <Landmark className="size-3.5" />
            {precedent.category?.trim() || "رأی وحدت رویه"}
          </span>
          <h1 className="text-xl font-black leading-snug tracking-tight sm:text-2xl">
            {precedent.title}
          </h1>
          <p className="text-sm text-muted-foreground">
            لازم‌الاتباع در کلیهٔ محاکم مستند به ماده ۴۷۱ قانون آیین دادرسی کیفری.
          </p>
        </header>

        <section
          aria-label="متن رأی"
          className="rounded-2xl border border-border bg-card/60 p-6"
        >
          <GuideContent markdown={precedent.content} resolveCitation={() => null} />
        </section>

        <section
          aria-label="پرسش متداول"
          className="rounded-2xl border border-border bg-card/40 p-6"
        >
          <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
            <Gavel className="size-4 text-violet-300" />
            این رأی درباره چیست؟
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{faqAnswer}</p>
        </section>

        <div className="flex flex-col gap-3 rounded-2xl border border-violet-400/20 bg-violet-400/5 p-6">
          <p className="text-sm text-muted-foreground">
            ارزیابی امکان استناد به این رأی در پروندهٔ شما و تنظیم لایحه بر پایهٔ آن نیازمند تحلیل
            اختصاصی است.
          </p>
          <Link
            href={chatHref}
            className="inline-flex w-fit items-center gap-2 rounded-xl bg-gradient-to-l from-amber-500 to-orange-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-orange-600/30 transition-transform hover:-translate-y-0.5"
          >
            <Scale className="size-4" />
            این رأی را از قاضی هوشمند بپرسید
          </Link>
        </div>
      </article>
    </LegalPageShell>
  );
}
