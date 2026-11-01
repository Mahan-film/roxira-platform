/**
 * Company vs contact person on a CRM lead.
 *
 * Imports often put a company name into `fullName` (or both into one cell).
 * Only the unambiguous shape «company - person» is offered as a one-click
 * repair; everything else that looks wrong is flagged for a human to review.
 */

export interface PartyFields {
  fullName: string;
  company: string | null;
}

export type PartyCheck =
  | { status: "ok" }
  | { status: "repairable"; reason: string; fix: { fullName: string; company: string } }
  | { status: "review"; reason: string };

const COMPANY_MARKER =
  /(^|\s)(شرکت|گروه|مؤسسه|موسسه|سازمان|بازرگانی|صنایع|تجارت|co\.?|ltd\.?|inc\.?|llc|gmbh|group)(\s|$)/i;

const SEPARATOR = /\s*(?:[-–—|/،]|\s:\s)\s*/;

export function looksLikeCompany(text: string): boolean {
  return COMPANY_MARKER.test(text.trim());
}

export function checkParty({ fullName, company }: PartyFields): PartyCheck {
  const name = fullName.trim();
  const firm = (company ?? "").trim();

  if (!firm && looksLikeCompany(name)) {
    const parts = name.split(SEPARATOR).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 2) {
      const [a, b] = parts;
      const aCompany = looksLikeCompany(a);
      const bCompany = looksLikeCompany(b);
      if (aCompany !== bCompany) {
        return {
          status: "repairable",
          reason: "نام شرکت و شخص در یک خانه ثبت شده است.",
          fix: aCompany ? { company: a, fullName: b } : { company: b, fullName: a },
        };
      }
    }
    return { status: "review", reason: "نام مشتری شبیه نام شرکت است؛ شخص تماس مشخص نیست." };
  }
  if (firm && firm === name) {
    return { status: "review", reason: "نام شرکت و نام شخص یکسان است." };
  }
  if (firm && !looksLikeCompany(firm) && looksLikeCompany(name)) {
    return { status: "review", reason: "ممکن است نام شرکت و شخص جابه‌جا شده باشد." };
  }
  return { status: "ok" };
}
