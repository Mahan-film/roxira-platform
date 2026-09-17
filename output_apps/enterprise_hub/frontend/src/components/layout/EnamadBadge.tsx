"use client";

import { useState } from "react";

const DEFAULT_TRUST_URL = "https://trustseal.enamad.ir";
const DEFAULT_LOGO_URL =
  "https://trustseal.enamad.ir/logo.aspx?id=7480559&Code=y8CR7ElrUfh4ZL897SvEy6SCJPlf5bBp";

export interface EnamadBadgeProps {
  /** eNamad trust page the seal links to. */
  trustUrl?: string;
  /** Seal image URL (id + Code) issued by eNamad. */
  logoUrl?: string;
  /** DOM id expected by the eNamad seal script (defaults to the code). */
  sealId?: string;
  alt?: string;
  className?: string;
}

/** Open the official eNamad trust page in an interactive popup window. */
export function openTrustSeal(trustUrl: string = DEFAULT_TRUST_URL): void {
  if (typeof window === "undefined") return;
  window.open(trustUrl, "_blank", "width=700,height=700,scrollbars=yes,resizable=yes");
}

/**
 * Official eNamad (نماد اعتماد الکترونیکی) trust seal.
 *
 * Uses a plain ``<img crossOrigin="anonymous">`` (never ``next/image``) so the
 * seal is not blocked by Next.js image-domain rules, and sets
 * ``referrerPolicy="origin"`` on both the anchor and the image because eNamad's
 * validation server requires an origin referrer.
 */
export function EnamadBadge({
  trustUrl = DEFAULT_TRUST_URL,
  logoUrl = DEFAULT_LOGO_URL,
  sealId = "y8CR7ElrUfh4ZL897SvEy6SCJPlf5bBp",
  alt = "نماد اعتماد الکترونیکی",
  className = "",
}: EnamadBadgeProps) {
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <div className={className}>
      <div className="inline-block rounded-2xl border border-white/10 bg-white p-2.5 shadow-lg">
        <a
          href={trustUrl}
          referrerPolicy="origin"
          target="_blank"
          rel="noopener"
          aria-label={alt}
          onClick={(event) => {
            event.preventDefault();
            openTrustSeal(trustUrl);
          }}
        >
          {imageFailed ? (
            <span className="flex size-24 items-center justify-center rounded-lg bg-emerald-500/10 text-2xl font-bold text-emerald-500">
              ✓
            </span>
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={logoUrl}
              referrerPolicy="origin"
              crossOrigin="anonymous"
              alt={alt}
              id={sealId}
              className="h-auto w-24 cursor-pointer"
              style={{ cursor: "pointer" }}
              onError={() => setImageFailed(true)}
            />
          )}
        </a>
      </div>
    </div>
  );
}

export default EnamadBadge;
