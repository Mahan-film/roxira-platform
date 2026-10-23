"use client";

import Link from "next/link";

/**
 * «بخشنامه‌ها و مقررات» card under an answer: the `regulations` response field
 * (smartjudge regulations_retrieval.public_view, #671). Shown apart from the law citations.
 */
export type RegulationRef = {
  title: string;
  issuer?: string;
  number?: string;
  date?: string;
  docType?: string;
  excerpt?: string;
  /** Public page slug (/regulations/<slug>), when the server sends one. */
  slug?: string;
  /** Original publisher page (http/https only). */
  sourceUrl?: string;
  /** "official" or "unofficial" copy. */
  sourceTier?: string;
};

const MAX_REGULATIONS = 5;

const DOC_TYPE_LABELS: Record<string, string> = {
  board_resolution: "مصوبه",
  circular: "بخشنامه",
};

function text(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const s = String(value).trim();
  return s || undefined;
}

function httpUrl(value: unknown): string | undefined {
  const s = text(value);
  return s && /^https?:\/\//i.test(s) ? s : undefined;
}

/** Defensive parse of the `regulations` response field (unknown shape from the network). */
export function parseRegulations(raw: unknown): RegulationRef[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: RegulationRef[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const title = text(o.title);
    if (!title) continue;
    const slug = text(o.slug);
    out.push({
      title,
      issuer: text(o.issuer),
      number: text(o.number),
      date: text(o.date),
      docType: text(o.doc_type),
      excerpt: text(o.excerpt),
      slug: slug && /^[\w-]+$/.test(slug) ? slug : undefined,
      sourceUrl: httpUrl(o.source_url),
      sourceTier: text(o.source_tier),
    });
    if (out.length >= MAX_REGULATIONS) break;
  }
  return out.length ? out : undefined;
}

export function RegulationCards({ items }: { items: RegulationRef[] }) {
  if (!items.length) return null;
  return (
    <section
      className="mt-3 pt-3"
      style={{ borderTop: "1px solid var(--ap-line)" }}
      aria-label="بخشنامه‌ها و مقررات"
      dir="rtl"
    >
      <div className="mb-1.5 text-sm font-semibold ap-link">بخشنامه‌ها و مقررات</div>
      <ul className="space-y-2">
        {items.map((item, idx) => {
          const kind = item.docType ? DOC_TYPE_LABELS[item.docType] : undefined;
          const meta = [item.issuer, item.number ? `شماره ${item.number}` : "", item.date ? `تاریخ ${item.date}` : ""]
            .filter(Boolean)
            .join("، ");
          return (
            <li
              key={`${item.slug ?? item.title}:${idx}`}
              className="min-w-0 rounded-xl px-3 py-2 text-sm"
              style={{ border: "1px solid var(--ap-line)" }}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                {kind && (
                  <span
                    className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs ap-notice"
                    style={{ border: "1px solid var(--ap-line)" }}
                  >
                    {kind}
                  </span>
                )}
                <span className="min-w-0 break-words font-semibold">{item.title}</span>
              </div>
              {meta && <div className="mt-1 break-words text-xs ap-muted">{meta}</div>}
              {item.excerpt && <p className="mt-1 break-words text-xs leading-6 ap-notice">{item.excerpt}</p>}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                {item.slug ? (
                  <Link href={`/regulations/${item.slug}`} className="ap-link underline-offset-2 hover:underline">
                    مشاهده متن کامل
                  </Link>
                ) : (
                  item.sourceUrl && (
                    <a
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ap-link underline-offset-2 hover:underline"
                    >
                      منبع
                    </a>
                  )
                )}
                {item.sourceTier === "unofficial" && <span className="ap-muted">نسخهٔ غیررسمی؛ پیش از استناد با منبع تطبیق دهید.</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
