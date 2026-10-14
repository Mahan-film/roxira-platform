import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, ChevronLeft } from "lucide-react";

import { LegalPageShell } from "@/components/legal/legal-page-shell";
import { JsonLd } from "@/components/seo/json-ld";
import { buildLegalUrl } from "@/lib/seo/canonical";
import { buildBreadcrumbList } from "@/lib/seo/laws-schema";
import { getAllGuides } from "@/lib/guides";

/** محتوای راهنماها کم‌تغییر است؛ رندر مجدد روزانه کافی است. */
export const revalidate = 86_400;

const TITLE = "راهنماهای حقوقی کاربردی | قاضی هوشمند";
const DESCRIPTION =
  "مجموعه راهنماهای حقوقی فارسی قاضی هوشمند: مهلت‌های قانونی، مالیات، اجاره، چک، مهریه، دیه، دادگاه صلح و ثبت شرکت — مستند به متن مواد قانونی.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: buildLegalUrl("/guides") },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: buildLegalUrl("/guides"),
    siteName: "قاضی هوشمند",
    locale: "fa_IR",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export default function GuidesIndexPage() {
  const guides = getAllGuides();

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    ...buildBreadcrumbList([
      { name: "خانه", url: buildLegalUrl("/") },
      { name: "راهنماهای حقوقی", url: buildLegalUrl("/guides") },
    ]),
  };

  return (
    <LegalPageShell>
      <JsonLd id="guides-index-jsonld" data={breadcrumbJsonLd} />

      <header className="mb-8 flex flex-col gap-2">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-300">
          <BookOpen className="size-3.5" />
          راهنماهای حقوقی
        </span>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">راهنماهای حقوقی کاربردی</h1>
        <p className="text-sm text-muted-foreground">{DESCRIPTION}</p>
      </header>

      {guides.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card/60 p-6 text-sm text-muted-foreground">
          در حال حاضر راهنماها در دسترس نیستند.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {guides.map((guide) => (
            <li key={guide.slug}>
              <Link
                href={`/guides/${encodeURIComponent(guide.slug)}`}
                className="flex h-full flex-col gap-2 rounded-2xl border border-border bg-card/60 p-5 transition-colors hover:border-amber-400/40 hover:bg-amber-400/5"
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="text-sm font-bold text-foreground">{guide.title}</span>
                  <ChevronLeft className="mt-0.5 size-4 shrink-0 text-amber-300" />
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">{guide.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </LegalPageShell>
  );
}
