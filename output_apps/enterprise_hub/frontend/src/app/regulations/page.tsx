import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Landmark, ScrollText } from "lucide-react";

import { JsonLd } from "@/components/seo/json-ld";
import { LegalPageShell } from "@/components/legal/legal-page-shell";
import { buildLegalUrl } from "@/lib/seo/canonical";
import { buildBreadcrumbList } from "@/lib/seo/laws-schema";
import {
  listPublicRegulations,
  type PublicRegulationSummary,
} from "@/lib/seo/regulations-public";

/** فهرست مقررات کم‌تغییر است؛ رندر مجدد روزانه کافی است. */
export const revalidate = 86_400;

export const metadata: Metadata = {
  title: "بخشنامه‌ها و مقررات | قاضی هوشمند",
  description:
    "فهرست بخشنامه‌ها و مقررات رسمی ایران — مصوبات هیئت مقررات‌زدایی و بخشنامه‌های بانک مرکزی — به‌همراه متن کامل و منبع رسمی در پایگاه دانش حقوقی قاضی هوشمند.",
  alternates: { canonical: buildLegalUrl("/regulations") },
  robots: { index: true, follow: true },
};

const PAGE_SIZE = 60;
const OTHER_ISSUER = "سایر";

interface Props {
  searchParams: Promise<{ issuer?: string; page?: string }>;
}

function groupByIssuer(
  items: PublicRegulationSummary[],
): Array<[string, PublicRegulationSummary[]]> {
  const grouped = new Map<string, PublicRegulationSummary[]>();
  for (const item of items) {
    const key = item.issuer?.trim() || OTHER_ISSUER;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(item);
    else grouped.set(key, [item]);
  }
  return Array.from(grouped.entries());
}

function pageHref(issuer: string, page: number): string {
  const params = new URLSearchParams();
  if (issuer) params.set("issuer", issuer);
  if (page > 0) params.set("page", String(page));
  const query = params.toString();
  return query ? `/regulations?${query}` : "/regulations";
}

/** صفحه فهرست بخشنامه‌ها و مقررات — گروه‌بندی‌شده بر پایه مرجع و صفحه‌بندی‌شده. */
export default async function RegulationsIndexPage({ searchParams }: Props) {
  const sp = await searchParams;
  const issuer = (sp.issuer ?? "").trim();
  const page = Math.max(0, Number.parseInt(sp.page ?? "0", 10) || 0);
  const data = await listPublicRegulations(issuer || undefined, page * PAGE_SIZE, PAGE_SIZE);
  const groups = groupByIssuer(data.items);
  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    ...buildBreadcrumbList([
      { name: "خانه", url: buildLegalUrl("/") },
      { name: "بخشنامه‌ها و مقررات", url: buildLegalUrl("/regulations") },
    ]),
  };

  return (
    <LegalPageShell>
      <JsonLd id="regulations-index-jsonld" data={breadcrumbJsonLd} />

      <header className="mb-8 flex flex-col gap-2">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-300">
          <ScrollText className="size-3.5" />
          پایگاه دانش حقوقی
        </span>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
          بخشنامه‌ها و مقررات
        </h1>
        <p className="text-sm text-muted-foreground">
          {data.total > 0
            ? `${data.total.toLocaleString("fa-IR")} بخشنامه و مصوبه به‌همراه متن کامل و منبع رسمی.`
            : "بخشنامه‌ها و مصوبات رسمی به‌همراه متن کامل و منبع رسمی."}
          {issuer ? ` (مرجع: ${issuer})` : ""}
        </p>
        {issuer ? (
          <Link href="/regulations" className="w-fit text-xs font-semibold text-amber-300 hover:underline">
            نمایش همه مراجع
          </Link>
        ) : null}
      </header>

      {data.items.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card/60 p-6 text-sm text-muted-foreground">
          در حال حاضر فهرست بخشنامه‌ها و مقررات در دسترس نیست. لطفاً از طریق{" "}
          <Link href="/chat" className="text-amber-300 hover:underline">
            قاضی هوشمند
          </Link>{" "}
          جست‌وجو کنید.
        </p>
      ) : (
        <div className="space-y-10">
          {groups.map(([groupIssuer, items]) => (
            <section key={groupIssuer}>
              <div className="mb-4 flex items-center justify-between gap-3 border-b border-border pb-2">
                <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
                  <Landmark className="size-4 text-amber-300" />
                  {groupIssuer}
                </h2>
                <span className="text-xs text-muted-foreground">
                  {items.length.toLocaleString("fa-IR")} مورد
                </span>
              </div>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {items.map((item) => (
                  <li key={item.slug}>
                    <Link
                      href={`/regulations/${encodeURIComponent(item.slug)}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-4 py-3 text-sm transition-colors hover:border-amber-400/40 hover:bg-amber-400/5"
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="font-semibold text-foreground">{item.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {item.number ? `شماره ${item.number}` : "بدون شماره"}
                          {item.date ? ` · ${item.date}` : ""}
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

      {totalPages > 1 ? (
        <nav
          aria-label="صفحه‌بندی"
          className="mt-10 flex items-center justify-between gap-3 border-t border-border pt-5 text-sm"
        >
          {page > 0 ? (
            <Link
              href={pageHref(issuer, page - 1)}
              className="inline-flex items-center gap-1.5 text-amber-300 hover:underline"
            >
              <ChevronRight className="size-4" />
              صفحه پیشین
            </Link>
          ) : (
            <span />
          )}
          <span className="text-xs text-muted-foreground" dir="ltr">
            {page + 1} / {totalPages}
          </span>
          {page + 1 < totalPages ? (
            <Link
              href={pageHref(issuer, page + 1)}
              className="inline-flex items-center gap-1.5 text-amber-300 hover:underline"
            >
              صفحه پسین
              <ChevronLeft className="size-4" />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </LegalPageShell>
  );
}
