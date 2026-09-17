import type { CSSProperties } from "react";

/**
 * Official eNamad (نماد اعتماد الکترونیکی) trust seal.
 *
 * ── ENAMAD COMPLIANCE (do not "improve" this markup) ─────────────────────────
 * eNamad's validation server inspects the request that fetches `logo.aspx` and
 * REJECTS it when the browser sends a *no-referrer* style referrer. Browsers
 * implicitly downgrade `target="_blank"` links to `rel="noopener"` (which is
 * equivalent to `rel="noreferrer"` for referrer purposes), and `next/image`
 * proxies the request through the Next.js optimizer. Both break the seal.
 * Therefore the seal MUST be:
 *
 *   1. plain native `<a>` + `<img>` tags (never `next/image`, never a fetch);
 *   2. WITHOUT any `rel` attribute — no `noopener`, no `noreferrer`;
 *   3. WITHOUT `target="_blank"` (which would imply `rel="noopener"`);
 *   4. carrying the literal lower-case `referrerpolicy="origin"` attribute on
 *      BOTH the `<a>` and the `<img>`.
 *
 * The attribute is applied via the `ENAMAD_REFERRER_ATTRIBUTE` spread below
 * because TypeScript's JSX types only declare the camelCase `referrerPolicy`
 * prop, and React renders that one as `referrerPolicy="origin"` (HTML attribute
 * names are case-insensitive, so it works — but eNamad's own snippet uses the
 * lower-case spelling and we emit it byte-for-byte). React logs a dev-only
 * "Invalid DOM property" notice for the lower-case name; the attribute is still
 * emitted verbatim, and the notice is stripped from production builds. Do NOT
 * "fix" it by adding `rel`/`target` — that is what breaks the seal.
 */

export type EnamadDomain = "ghazi" | "roxira";

export interface EnamadSealCredentials {
  /** Numeric eNamad seal id. */
  readonly id: string;
  /** eNamad validation code paired with the id. */
  readonly code: string;
}

/**
 * Issued seal credentials, keyed by the site that owns the seal:
 *   • `ghazi`  → قاضی هوشمند  (قاضی.آی.آر / ghazi)
 *   • `roxira` → روکسیرا       (roxira.ir)
 */
export const ENAMAD_SEALS: Readonly<Record<EnamadDomain, EnamadSealCredentials>> = {
  ghazi: { id: "7491439", code: "yFeNLueqB3RV5ZK9nT7avRH3IR8jSeYa" },
  roxira: { id: "7480559", code: "y8CR7EIrUfh4ZL897SvEy6SCJPlf5bBp" },
} as const;

export const DEFAULT_ENAMAD_DOMAIN: EnamadDomain = "roxira";

/** Official seal alt text mandated by eNamad. */
export const ENAMAD_ALT = "نماد اعتماد الکترونیکی";

/** eNamad trust-seal origin. */
export const ENAMAD_TRUST_ORIGIN = "https://trustseal.enamad.ir";

/**
 * CRITICAL: lower-case `referrerpolicy="origin"`. Applied to BOTH tags and
 * never paired with `rel`.
 */
export const ENAMAD_REFERRER_ATTRIBUTE = { referrerpolicy: "origin" } as const;

export function enamadCredentials(domain?: EnamadDomain): EnamadSealCredentials {
  return ENAMAD_SEALS[domain as EnamadDomain] ?? ENAMAD_SEALS[DEFAULT_ENAMAD_DOMAIN];
}

/** Trust page the seal links to, e.g. `https://trustseal.enamad.ir/?id=…&Code=…`. */
export function enamadTrustUrl(domain?: EnamadDomain): string {
  const { id, code } = enamadCredentials(domain);
  return `${ENAMAD_TRUST_ORIGIN}/?id=${id}&Code=${code}`;
}

/** Seal image, e.g. `https://trustseal.enamad.ir/logo.aspx?id=…&Code=…`. */
export function enamadLogoUrl(domain?: EnamadDomain): string {
  const { id, code } = enamadCredentials(domain);
  return `${ENAMAD_TRUST_ORIGIN}/logo.aspx?id=${id}&Code=${code}`;
}

/** DOM id eNamad assigns the seal (equals the validation code). */
export function enamadSealId(domain?: EnamadDomain): string {
  return enamadCredentials(domain).code;
}

export interface EnamadBadgeProps {
  /** Which seal to render. Defaults to `roxira`. */
  domain?: EnamadDomain;
  /** Image alt text. Defaults to the eNamad-mandated string. */
  alt?: string;
  /** Extra classes for the anchor (the seal is a plain inline link). */
  className?: string;
  /** Extra inline styles merged over `{ cursor: "pointer" }`. */
  style?: CSSProperties;
  /** Rendered seal width in px. */
  width?: number;
  /** Rendered seal height in px. */
  height?: number;
}

const ANCHOR_CLASSES =
  "inline-block rounded-2xl border border-white/10 bg-white p-2.5 shadow-lg transition-opacity hover:opacity-90";

/**
 * Renders the official eNamad trust seal for `domain`.
 *
 * ```tsx
 * <EnamadBadge domain="ghazi" />
 * <EnamadBadge domain="roxira" />
 * ```
 */
export function EnamadBadge({
  domain = DEFAULT_ENAMAD_DOMAIN,
  alt = ENAMAD_ALT,
  className = "",
  style,
  width = 96,
  height = 96,
}: EnamadBadgeProps) {
  const credentials = enamadCredentials(domain);
  const href = enamadTrustUrl(domain);
  const src = enamadLogoUrl(domain);

  return (
    /* Plain <a>: NO rel, NO target (target would imply rel=noopener). */
    <a
      {...ENAMAD_REFERRER_ATTRIBUTE}
      href={href}
      id={`enamad-${credentials.id}`}
      className={className ? `${ANCHOR_CLASSES} ${className}` : ANCHOR_CLASSES}
      style={{ cursor: "pointer", ...style }}
    >
      {/* Native <img> — never next/image; same referrerpolicy, still no rel. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        {...ENAMAD_REFERRER_ATTRIBUTE}
        src={src}
        alt={alt}
        width={width}
        height={height}
        className="block h-auto w-full select-none"
        style={{ cursor: "pointer", ...style }}
      />
    </a>
  );
}

export default EnamadBadge;
