/**
 * roxira.ir eNamad seal: the ONE place the id and code live.
 * If the seal shows an error, correct `code` here (copy it with the
 * "کپی لینک لوگو اینماد" button in the eNamad panel; capital I and lowercase l
 * look alike in screenshots).
 */
export const ENAMAD = {
  id: "7480559",
  code: "y8CR7EIrUfh4ZL897SvEy6SCJPIf5bBp",
} as const;

export const ENAMAD_TRUST_ORIGIN = "https://trustseal.enamad.ir";

export function enamadHref(seal: { id: string; code: string } = ENAMAD): string {
  return `${ENAMAD_TRUST_ORIGIN}/?id=${seal.id}&Code=${seal.code}`;
}

export function enamadLogoSrc(seal: { id: string; code: string } = ENAMAD): string {
  return `${ENAMAD_TRUST_ORIGIN}/logo.aspx?id=${seal.id}&Code=${seal.code}`;
}
