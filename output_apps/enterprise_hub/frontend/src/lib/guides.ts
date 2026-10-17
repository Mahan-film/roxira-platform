import fs from "node:fs";
import path from "node:path";

import type { PublicLawSummary } from "@/lib/seo/laws-public";

/**
 * دادهٔ راهنماهای حقوقی منتشرشده روی ghazihoushmand.ir.
 *
 * متن هر راهنما از `frontend/content/guides/<slug>.md` خوانده می‌شود
 * (Server Component + ISR). فرادادهٔ front matter با یک تجزیه‌گر کوچک
 * خوانده می‌شود تا هیچ وابستگی npm افزوده نشود.
 */

export const GUIDE_SLUGS = [
  "vat-ecommerce-online-businesses",
  "appeal-deadline-civil-court",
  "early-lease-termination-rules",
  "bounced-cheque-criminal-civil-steps",
  "mahr-110-coins-imprisonment-rule",
  "traffic-accident-blood-money-third-party-insurance",
  "peace-court-jurisdiction-limits",
  "commercial-lease-eviction-sarghofli",
  "limited-liability-company-registration",
  "consumer-rights-ecommerce-law",
  "mutual-divorce-steps-documents",
  "child-custody-after-age-seven",
  "past-alimony-calculation-tamkin",
  "inheritance-division-children-spouse",
  "mahr-claim-after-spouse-death",
  "dowry-recovery-with-without-list",
  "marriage-annulment-fraud-tadlis",
  "marital-labor-compensation-ojrat",
  "bounced-cheque-criminal-vs-civil",
  "late-payment-damages-cbi-formula",
  "asset-seizure-tamin-khasteh-guide",
  "labor-complaint-insurance-seniority",
  "employee-eidi-sanavat-leave-calculation",
  "unlawful-dismissal-difference-guide",
  "promissory-note-execution-guarantor",
  "bounced-cheque-bad-record-removal",
  "immediate-lease-eviction-two-witnesses",
  "internet-fraud-fata-reporting",
  "breach-of-trust-crime-punishment",
  "company-directors-cheque-debt-liability",
  "work-accident-employer-insurance-liability",
  "customs-dispute-objection-commission",
  "guild-business-licence-sealing",
  "lease-repair-obligation-landlord-tenant",
  "default-judgment-objection-vakhavi",
  "cyber-insult-threat-defamation",
  "legitimate-defense-conditions",
  "company-dissolution-liquidation",
  "installments-insolvency-payment",
  "proof-of-debt-receipt-bank-slip",
  "insurance-claim-compensation-procedure",
  "compel-official-deed-transfer",
  "joint-property-partition-afraz",
  "buyer-rights-hidden-defect",
  "assault-battery-dieh-arsh",
  "transfer-of-anothers-property",
  "retrial-rehearing-request",
  "arbitration-award-annulment",
  "service-promissory-note-return",
  "maternity-leave-working-women",
  "tax-assessment-objection-commission",
] as const;

export type GuideSlug = (typeof GUIDE_SLUGS)[number];

export interface GuideCitation {
  lawName: string;
  articles: string[];
}

export interface GuideFaq {
  q: string;
  a: string;
}

export interface Guide {
  slug: GuideSlug;
  title: string;
  description: string;
  updated: string;
  keywords: string[];
  lawRefs: string[];
  citations: GuideCitation[];
  faqs: GuideFaq[];
  markdown: string;
}

const CONTENT_DIR = path.join(process.cwd(), "content", "guides");

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** تبدیل ارقام فارسی/عربی به لاتین. */
export function toAsciiDigits(input: string): string {
  return input.replace(/[۰-۹٠-٩]/g, (d) => {
    const pi = PERSIAN_DIGITS.indexOf(d);
    if (pi >= 0) return String(pi);
    const ai = ARABIC_DIGITS.indexOf(d);
    if (ai >= 0) return String(ai);
    return d;
  });
}

/** نرمال‌سازی متن فارسی: ي/ك عربی، حذف نیم‌فاصله، یکسان‌سازی فاصله و نشانه‌ها. */
export function normalizeFa(input: string): string {
  return toAsciiDigits(input.replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/\u200c/g, " "))
    .replace(/[()«»،.؛:؟!ـ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LAW_STOPWORDS = new Set([
  "قانون",
  "مصوب",
  "و",
  "در",
  "به",
  "از",
  "با",
  "برای",
  "های",
  "ها",
  "ماده",
  "مواد",
  "اصلاحات",
  "قوانین",
]);

function tokensOf(name: string): string[] {
  return normalizeFa(name)
    .split(" ")
    .filter((token) => token.length >= 2 && !LAW_STOPWORDS.has(token));
}

function setsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((token) => setB.has(token));
}

function intersectionSize(a: string[], b: string[]): number {
  const setB = new Set(b);
  let count = 0;
  for (const token of a) if (setB.has(token)) count += 1;
  return count;
}

/* ------------------------------ front matter ------------------------------ */

interface RawFrontMatter {
  meta: Record<string, string | string[]>;
  body: string;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontMatter(raw: string): RawFrontMatter {
  const normalized = raw.replace(/\r\n?/g, "\n");
  if (!normalized.startsWith("---\n")) return { meta: {}, body: normalized };
  const end = normalized.indexOf("\n---", 4);
  if (end === -1) return { meta: {}, body: normalized };

  const block = normalized.slice(4, end);
  const body = normalized.slice(end + 4).replace(/^\n+/, "");

  const meta: Record<string, string | string[]> = {};
  let currentKey = "";
  let currentList: string[] | null = null;

  for (const line of block.split("\n")) {
    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem && currentList) {
      currentList.push(unquote(listItem[1]));
      continue;
    }
    const kv = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (kv) {
      currentKey = kv[1];
      const value = kv[2].trim();
      if (value === "") {
        currentList = [];
        meta[currentKey] = currentList;
      } else {
        meta[currentKey] = unquote(value);
        currentList = null;
      }
    }
  }

  return { meta, body };
}

function metaString(meta: Record<string, string | string[]>, key: string): string {
  const value = meta[key];
  return typeof value === "string" ? value : "";
}

function metaList(meta: Record<string, string | string[]>, key: string): string[] {
  const value = meta[key];
  return Array.isArray(value) ? value : [];
}

/* -------------------------------- citations ------------------------------- */

/** استخراج نام قانون و شمارهٔ مواد از رشته‌های front matter. */
export function parseLawRefs(lawRefs: string[]): GuideCitation[] {
  const citations: GuideCitation[] = [];
  for (const ref of lawRefs) {
    const split = ref.split(/\s*(?:ماده|مواد)\s*/);
    const lawName = split[0].replace(/[،,]\s*$/, "").trim();
    if (!lawName) continue;
    const afterFirst = ref.slice(ref.indexOf(split[0]) + split[0].length);
    const numbers = afterFirst.match(/[۰-۹0-9]+/g) ?? [];
    const articles = numbers.map((n) => toAsciiDigits(n));
    citations.push({ lawName, articles });
  }
  return citations;
}

/** استخراج پرسش‌های متداول از بخش «پرسش‌های متداول» متن راهنما. */
export function parseFaqs(markdown: string): GuideFaq[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const startIndex = lines.findIndex((line) => line.includes("پرسش‌های متداول"));
  const scope = startIndex === -1 ? lines : lines.slice(startIndex);
  const faqs: GuideFaq[] = [];

  for (let i = 0; i < scope.length; i += 1) {
    const line = scope[i].trim();
    if (!/^\*\*[۰-۹0-9]+\./.test(line)) continue;
    const question = line
      .replace(/^\*\*/, "")
      .replace(/\*\*\s*$/, "")
      .replace(/^[۰-۹0-9]+\.\s*/, "")
      .trim();
    let answer = "";
    for (let j = i + 1; j < scope.length; j += 1) {
      const candidate = scope[j].trim();
      if (!candidate) continue;
      if (candidate.startsWith("**") || candidate.startsWith("#") || /^-{3,}$/.test(candidate)) {
        break;
      }
      answer = candidate;
      break;
    }
    if (question && answer) faqs.push({ q: question, a: answer });
  }

  return faqs;
}

/* ------------------------------ guide loading ----------------------------- */

function buildGuide(slug: GuideSlug, raw: string): Guide {
  const { meta, body } = parseFrontMatter(raw);
  const lawRefs = metaList(meta, "law_refs");
  return {
    slug,
    title: metaString(meta, "title"),
    description: metaString(meta, "description"),
    updated: metaString(meta, "updated"),
    keywords: metaList(meta, "keywords"),
    lawRefs,
    citations: parseLawRefs(lawRefs),
    faqs: parseFaqs(body),
    markdown: body,
  };
}

export function getGuide(slug: string): Guide | null {
  if (!(GUIDE_SLUGS as readonly string[]).includes(slug)) return null;
  try {
    const raw = fs.readFileSync(path.join(CONTENT_DIR, `${slug}.md`), "utf8");
    return buildGuide(slug as GuideSlug, raw);
  } catch {
    return null;
  }
}

export function getAllGuides(): Guide[] {
  return GUIDE_SLUGS.map((slug) => getGuide(slug)).filter((guide): guide is Guide => guide !== null);
}

/* ------------------------------- law linking ------------------------------ */

/**
 * فهرست پایهٔ قوانین عمومی برگرفته از `public/coverage_manifest.json`.
 *
 * این آرایه تنها زمانی به‌کار می‌رود که API `laws-public` در زمان رندر
 * در دسترس نباشد تا استنادها همچنان به صفحات مواد (قوانین با `law_id`
 * مشخص) لینک شوند. قوانین بدون `law_id` (اسلاگ مشتق‌شده) فقط از API
 * حل و لینک می‌شوند.
 */
export const FALLBACK_PUBLIC_LAWS: PublicLawSummary[] = [
  { slug: "ir-5580", name: "قانون مدنی", law_type: "CIVIL", articles_count: 1334, approval_date: null },
  { slug: "ir-news-5324", name: "قانون مجازات اسلامی", law_type: "CRIMINAL", articles_count: 735, approval_date: null },
  { slug: "ir-5584", name: "قانون آیین دادرسی کیفری", law_type: "PROCEDURE", articles_count: 706, approval_date: null },
  { slug: "ir-news-5274", name: "قانون تجارت", law_type: "COMMERCIAL", articles_count: 529, approval_date: null },
  { slug: "ir-news-4862", name: "لایحه اصلاحی قانون تجارت", law_type: "COMMERCIAL", articles_count: 301, approval_date: null },
];

export interface LawIndexEntry {
  slug: string;
  name: string;
  tokens: string[];
}

/** ساخت نمایهٔ قوانین عمومی برای تطبیق نام قانون‌های استنادشده. */
export function buildLawIndex(laws: PublicLawSummary[]): LawIndexEntry[] {
  return laws.map((law) => ({ slug: law.slug, name: law.name, tokens: tokensOf(law.name) }));
}

/**
 * تطبیق نام قانون استنادشده با یک قانون موجود در laws-public.
 * نخست تطابق دقیق، سپس بالاترین هم‌پوشانی واژگانی (آستانه ۰٫۷).
 */
export function resolveLawSlug(index: LawIndexEntry[], lawName: string): string | null {
  const citationTokens = tokensOf(lawName);
  if (citationTokens.length === 0) return null;

  for (const entry of index) {
    if (setsEqual(entry.tokens, citationTokens)) return entry.slug;
  }

  let bestSlug: string | null = null;
  let bestTier = -1;
  let bestShared = 0;
  for (const entry of index) {
    if (entry.tokens.length === 0) continue;
    const shared = intersectionSize(entry.tokens, citationTokens);
    if (shared === 0) continue;
    const denominator = Math.min(entry.tokens.length, citationTokens.length);
    const score = shared / denominator;
    if (score < 0.7) continue;

    const entrySubset = shared === entry.tokens.length && entry.tokens.length <= citationTokens.length;
    const citationSubset = shared === citationTokens.length && citationTokens.length <= entry.tokens.length;
    const tier = entrySubset ? 2 : citationSubset ? 1 : 0;

    if (tier > bestTier || (tier === bestTier && shared > bestShared)) {
      bestTier = tier;
      bestShared = shared;
      bestSlug = entry.slug;
    }
  }
  return bestSlug;
}

/** نشانی صفحهٔ یک ماده (یا خود قانون) در پایگاه عمومی. */
export function articleHref(lawSlug: string, article: string): string {
  const articleSlug = toAsciiDigits(article).replace(/[^0-9]/g, "");
  return articleSlug
    ? `/laws/${encodeURIComponent(lawSlug)}/${encodeURIComponent(articleSlug)}`
    : `/laws/${encodeURIComponent(lawSlug)}`;
}
