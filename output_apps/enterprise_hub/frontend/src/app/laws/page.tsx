import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, Gavel, ScrollText } from "lucide-react";

import { JsonLd } from "@/components/seo/json-ld";
import { LegalPageShell } from "@/components/legal/legal-page-shell";
import { buildLegalUrl } from "@/lib/seo/canonical";
import { listPublicLaws, type PublicLawSummary } from "@/lib/seo/laws-public";
import { buildBreadcrumbList } from "@/lib/seo/laws-schema";

/** فهرست قوانین کم‌تغییر است؛ رندر مجدد روزانه کافی است. */
export const revalidate = 86_400;

export const metadata: Metadata = {
  title: "فهرست قوانین | قاضی هوشمند",
  description:
    "فهرست قوانین معتبر جمهوری اسلامی ایران به‌همراه متن کامل مواد قانونی، وضعیت اعتبار و منبع رسمی در پایگاه دانش حقوقی قاضی هوشمند.",
  alternates: { canonical: buildLegalUrl("/laws") },
  robots: { index: true, follow: true },
};

const OTHER_GROUP = "سایر قوانین";

function groupByLawType(laws: PublicLawSummary[]): Array<[string, PublicLawSummary[]]> {
  const grouped = new Map<string, PublicLawSummary[]>();
  for (const law of laws) {
    const key = law.law_type?.trim() || OTHER_GROUP;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(law);
    else grouped.set(key, [law]);
  }
  return Array.from(grouped.entries());
}

/** صفحه فهرست قوانین — لینک‌های داخلی قابل خزش برای موتورهای جست‌وجو. */
export default async function LawsIndexPage() {
  const laws = await listPublicLaws();
  const groups = groupByLawType(laws);

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    ...buildBreadcrumbList([
      { name: "خانه", url: buildLegalUrl("/") },
      { name: "قوانین", url: buildLegalUrl("/laws") },
    ]),
  };

  return (
    <LegalPageShell>
      <JsonLd id="laws-index-jsonld" data={breadcrumbJsonLd} />

      <header className="mb-8 flex flex-col gap-2">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-300">
          <ScrollText className="size-3.5" />
          پایگاه دانش حقوقی
        </span>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">فهرست قوانین</h1>
        <p className="text-sm text-muted-foreground">
          {laws.length > 0
            ? `${laws.length.toLocaleString("fa-IR")} قانون معتبر به‌همراه متن کامل مواد، وضعیت اعتبار و منبع رسمی.`
            : "قوانین معتبر به‌همراه متن کامل مواد، وضعیت اعتبار و منبع رسمی."}
        </p>
      </header>

      {laws.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card/60 p-6 text-sm text-muted-foreground">
          در حال حاضر فهرست قوانین در دسترس نیست. لطفاً از طریق{" "}
          <Link href="/chat" className="text-amber-300 hover:underline">
            قاضی هوشمند
          </Link>{" "}
          جست‌وجو کنید.
        </p>
      ) : (
        <div className="space-y-10">
          {groups.map(([lawType, items]) => (
            <section key={lawType}>
              <div className="mb-4 flex items-center justify-between gap-3 border-b border-border pb-2">
                <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
                  <ScrollText className="size-4 text-amber-300" />
                  {lawType}
                </h2>
                <span className="text-xs text-muted-foreground">
                  {items.length.toLocaleString("fa-IR")} قانون
                </span>
              </div>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {items.map((law) => (
                  <li key={law.slug}>
                    <Link
                      href={`/laws/${encodeURIComponent(law.slug)}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-4 py-3 text-sm transition-colors hover:border-amber-400/40 hover:bg-amber-400/5"
                    >
                      <span className="flex flex-col gap-0.5">
                        <span className="font-semibold text-foreground">{law.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {law.articles_count.toLocaleString("fa-IR")} ماده
                          {law.approval_date ? ` · تصویب ${law.approval_date}` : ""}
                        </span>
                      </span>
                      <ChevronLeft className="size-4 shrink-0 text-amber-300" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <aside className="mt-8 flex items-center gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-5 text-sm">
        <Gavel className="size-5 shrink-0 text-amber-300" />
        <span className="text-muted-foreground">
          برای یافتن مادهٔ مرتبط با پروندهٔ خود و تحلیل آن، از{" "}
          <Link href="/chat" className="font-semibold text-amber-300 hover:underline">
            دستیار حقوقی قاضی هوشمند
          </Link>{" "}
          استفاده کنید.
        </span>
      </aside>
    </LegalPageShell>
  );
}
