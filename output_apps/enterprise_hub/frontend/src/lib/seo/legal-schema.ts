/**
 * سازنده‌های اسکیمای ساختاریافته (JSON-LD) برای صفحات داینامیک حقوقی.
 *
 * مطابق الزام سئو، تمام صفحات داینامیک `laws/[slug]` و `precedents/[slug]`
 * باید دو نوع استاندارد schema.org را منتشر کنند:
 *   • `Legislation`  → توصیف ماده قانونی / رأی وحدت رویه و متن آن
 *   • `LegalService` → توصیف سرویس مشاوره و تحلیل حقوقی «قاضی هوشمند»
 *
 * خروجی به‌صورت یک گراف واحد (`@graph`) برگردانده می‌شود تا موتورهای جست‌وجو
 * ارتباط معنایی بین سند حقوقی و سرویس ارائه‌دهنده آن را درک کنند.
 */

import type { LegalNode } from "@/lib/api/legal-knowledge-client";

/** نام برند سرویس حقوقی و شناسه‌های آن در فضای سئو. */
const PROVIDER_NAME = "روکسیرا";
const PROVIDER_URL = "https://roxira.ir";
const SERVICE_NAME = "قاضی هوشمند";
const SERVICE_URL = "https://ghazihoushmand.ir/chat";

/** کوتاه‌سازی متن برای توضیحات متا و فیلد description. */
export function summarize(text: string, maxLength = 160): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

/** استخراج شناسه ماده (در صورت وجود) از فراداده گره. */
function resolveLegislationIdentifier(node: LegalNode): string {
  const metadata = node.metadata ?? {};
  const articleNumber = metadata.article_num ?? metadata.precedent_id;
  if (articleNumber !== undefined && articleNumber !== null) {
    return `${node.node_id} (${String(articleNumber)})`;
  }
  return node.node_id;
}

/** ساخت گره JSON-LD از نوع `Legislation` برای یک ماده یا رأی. */
export function buildLegislationSchema(
  node: LegalNode,
  canonicalUrl: string,
): Record<string, unknown> {
  const isPrecedent = node.node_type === "PRECEDENT";
  const category = node.category ?? (isPrecedent ? "رأی وحدت رویه" : "قانون");

  return {
    "@type": "Legislation",
    "@id": `${canonicalUrl}#legislation`,
    name: node.title,
    headline: node.title,
    description: summarize(node.content),
    legislationIdentifier: resolveLegislationIdentifier(node),
    legislationType: category,
    legislationLegalForce: isPrecedent ? "لازم‌الاتباع" : "معتبر",
    jurisdiction: {
      "@type": "Country",
      name: "Iran",
    },
    inLanguage: "fa-IR",
    text: node.content,
    url: canonicalUrl,
    mainEntityOfPage: canonicalUrl,
    datePublished: node.created_at ?? undefined,
    dateModified: node.created_at ?? undefined,
    isPartOf: {
      "@type": "Legislation",
      name: category,
    },
    publisher: {
      "@type": "Organization",
      name: PROVIDER_NAME,
      url: PROVIDER_URL,
    },
  };
}

/** ساخت گره JSON-LD از نوع `LegalService` (سرویس قاضی هوشمند). */
export function buildLegalServiceSchema(
  canonicalUrl: string,
  node: LegalNode,
): Record<string, unknown> {
  return {
    "@type": "LegalService",
    "@id": `${SERVICE_URL}#legalservice`,
    name: `${SERVICE_NAME} — تحلیل حقوقی مبتنی بر GraphRAG`,
    description:
      "سرویس تحلیل پرونده، استخراج مواد قانونی و ارائه لایحه دفاعیه بر پایه پایگاه دانش حقوقی و گراف استدلال قضایی.",
    serviceType: "مشاوره و تحلیل حقوقی",
    url: SERVICE_URL,
    availableLanguage: ["fa-IR"],
    areaServed: {
      "@type": "Country",
      name: "Iran",
    },
    provider: {
      "@type": "Organization",
      name: PROVIDER_NAME,
      url: PROVIDER_URL,
    },
    mainEntity: {
      "@type": "Legislation",
      "@id": `${canonicalUrl}#legislation`,
      name: node.title,
    },
  };
}

/**
 * ساخت اسکیمای کامل یک صفحه داینامیک حقوقی به‌صورت گراف واحد شامل
 * `Legislation` و `LegalService`.
 */
export function buildLegalNodeSchema(
  node: LegalNode,
  canonicalUrl: string,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@graph": [
      buildLegislationSchema(node, canonicalUrl),
      buildLegalServiceSchema(canonicalUrl, node),
    ],
  };
}
