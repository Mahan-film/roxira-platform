/**
 * سازنده‌های اسکیمای ساختاریافته و کمک‌تابع‌های متنی صفحات عمومی قوانین.
 *
 * صفحات `laws/[law]` و `laws/[law]/[article]` برای سئو/GEO باید اسکیمای
 * استاندارد schema.org منتشر کنند: `Legislation`، `BreadcrumbList`، `FAQPage`
 * و همچنین هویت برند (`Organization` + `WebSite` با `SearchAction`).
 */

import { LEGAL_SITE_ORIGIN } from "@/lib/seo/canonical";

/** نام و نام‌های جایگزین برند «قاضی هوشمند» در فضای سئو. */
export const BRAND_NAME = "قاضی هوشمند";
export const BRAND_ALTERNATE_NAMES = [
  "Ghazi Houshmand",
  "Smart Judge",
  "قاضی هوشمند روکسیرا",
];

const CHAT_URL = `${LEGAL_SITE_ORIGIN}/chat`;

/** کوتاه‌سازی متن با حفظ کاراکترهای کامل (بدون بریدن وسط کلمه). */
export function truncateText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

/** استخراج چند جملهٔ نخست متن (پیش‌فرض: دو جمله) برای پاسخ کوتاه/FAQ. */
export function extractLeadingSentences(text: string, count = 2): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  const sentences: string[] = [];
  let current = "";
  for (const char of normalized) {
    current += char;
    if (char === "." || char === "!" || char === "؟" || char === "…") {
      const sentence = current.trim();
      if (sentence) sentences.push(sentence);
      current = "";
      if (sentences.length >= count) break;
    }
  }
  if (sentences.length < count && current.trim()) sentences.push(current.trim());

  const result = sentences.slice(0, count).join(" ").trim();
  return result || truncateText(normalized, 300);
}

/** تشخیص منسوخ بودن یک ماده بر پایه پرچم فعال‌بودن و متن وضعیت واقعی. */
export function isRepealed(article: { status: string | null; is_active: boolean }): boolean {
  if (!article.is_active) return true;
  const status = (article.status ?? "").trim().toLowerCase();
  if (!status) return false;
  return ["repealed", "abrogated", "inactive", "منسوخ", "ملغی", "لغو"].some((marker) =>
    status.includes(marker),
  );
}

/** برچسب فارسی وضعیت ماده برای نمایش در فهرست/نشان. */
export function articleStatusLabel(article: { status: string | null; is_active: boolean }): string {
  if (isRepealed(article)) return "منسوخ";
  const status = (article.status ?? "").trim();
  return status || "معتبر";
}

/** ساخت BreadcrumbList استاندارد از فهرست مرتبِ عنوان/نشانی. */
export function buildBreadcrumbList(
  items: Array<{ name: string; url: string }>,
): Record<string, unknown> {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export interface ArticleJsonLdInput {
  lawSlug: string;
  lawName: string;
  articleSlug: string;
  label: string;
  text: string;
  approvalDate: string | null;
  amendedOn: string | null;
  repealed: boolean;
  canonicalUrl: string;
  lawUrl: string;
}

/** گراف JSON-LD یک مادهٔ قانونی: Legislation + BreadcrumbList + FAQPage. */
export function buildArticleJsonLd(input: ArticleJsonLdInput): Record<string, unknown> {
  const heading = `ماده ${input.label} ${input.lawName}`;
  const faqAnswer = extractLeadingSentences(input.text, 2) || truncateText(input.text, 300);

  const legislation: Record<string, unknown> = {
    "@type": "Legislation",
    "@id": `${input.canonicalUrl}#legislation`,
    name: heading,
    legislationIdentifier: `${input.lawSlug}/${input.articleSlug}`,
    legislationJurisdiction: "IR",
    legislationLegalForce: input.repealed ? "NotInForce" : "InForce",
    isPartOf: input.lawUrl,
    inLanguage: "fa",
    url: input.canonicalUrl,
    text: input.text,
  };
  if (input.approvalDate) legislation.legislationDate = input.approvalDate;
  if (input.amendedOn) legislation.dateModified = input.amendedOn;

  const breadcrumb = {
    ...buildBreadcrumbList([
      { name: "خانه", url: `${LEGAL_SITE_ORIGIN}/` },
      { name: "قوانین", url: `${LEGAL_SITE_ORIGIN}/laws` },
      { name: input.lawName, url: input.lawUrl },
      { name: heading, url: input.canonicalUrl },
    ]),
    "@id": `${input.canonicalUrl}#breadcrumb`,
  };

  const faq = {
    "@type": "FAQPage",
    "@id": `${input.canonicalUrl}#faq`,
    mainEntity: [
      {
        "@type": "Question",
        name: "این ماده درباره چیست؟",
        acceptedAnswer: { "@type": "Answer", text: faqAnswer },
      },
    ],
  };

  return {
    "@context": "https://schema.org",
    "@graph": [legislation, breadcrumb, faq],
  };
}

/** هویت برند «قاضی هوشمند» برای دامنه ghazihoushmand.ir. */
export function buildBrandJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${LEGAL_SITE_ORIGIN}/#organization`,
        name: BRAND_NAME,
        alternateName: BRAND_ALTERNATE_NAMES,
        url: `${LEGAL_SITE_ORIGIN}/`,
        logo: `${LEGAL_SITE_ORIGIN}/favicon.ico`,
      },
      {
        "@type": "WebSite",
        "@id": `${LEGAL_SITE_ORIGIN}/#website`,
        url: `${LEGAL_SITE_ORIGIN}/`,
        name: BRAND_NAME,
        alternateName: BRAND_ALTERNATE_NAMES,
        inLanguage: "fa-IR",
        publisher: { "@id": `${LEGAL_SITE_ORIGIN}/#organization` },
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${CHAT_URL}?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
    ],
  };
}
