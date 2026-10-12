"use client";

/** Page-level source chips under an answer that used uploaded case files («منبع: نام فایل، ص ۳»). */
export type CaseFileRef = { file_id: string; file_name: string; page: number };

const MAX_CHIPS = 12;

/** Defensive parse of the `case_file_refs` response field (unknown shape from the network). */
export function parseCaseFileRefs(raw: unknown): CaseFileRef[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: CaseFileRef[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const page = Number(o.page);
    if (typeof o.file_id !== "string" || !Number.isInteger(page) || page < 1) continue;
    out.push({ file_id: o.file_id, file_name: typeof o.file_name === "string" ? o.file_name : "پرونده", page });
  }
  return out.length ? out : undefined;
}

export function CaseFileRefChips({ refs }: { refs: CaseFileRef[] }) {
  if (!refs.length) return null;
  const fa = new Intl.NumberFormat("fa-IR");
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" aria-label="منابع پرونده">
      {refs.slice(0, MAX_CHIPS).map((r) => (
        <span
          key={`${r.file_id}:${r.page}`}
          className="inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-xs ap-notice"
          style={{ border: "1px solid var(--ap-line)" }}
        >
          <span className="truncate">{`منبع: ${r.file_name}، ص ${fa.format(r.page)}`}</span>
        </span>
      ))}
    </div>
  );
}
