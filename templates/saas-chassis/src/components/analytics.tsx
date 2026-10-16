import Script from "next/script";

/** Umami tracker. Renders nothing unless both env vars are set. */
export function Analytics() {
  const base = process.env.NEXT_PUBLIC_UMAMI_URL;
  const id = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
  if (!base || !id) return null;
  return <Script defer src={`${base.replace(/\/$/, "")}/script.js`} data-website-id={id} strategy="afterInteractive" />;
}
