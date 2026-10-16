import { APP_NAME, APP_URL } from "@/lib/utils";

/** Renders a JSON-LD block. Content is serialized by us from trusted objects only. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  // "<" is escaped so a stray "</script>" in a string cannot break out of the tag.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}

export const organizationLd = () => ({
  "@context": "https://schema.org",
  "@type": "Organization",
  name: APP_NAME,
  url: APP_URL,
  logo: `${APP_URL}/icon.png`,
});

export const softwareApplicationLd = (opts: { description: string; lowPrice?: number }) => ({
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: APP_NAME,
  url: APP_URL,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description: opts.description,
  offers: { "@type": "Offer", price: String(opts.lowPrice ?? 0), priceCurrency: "USD" },
});

export const faqPageLd = (items: { q: string; a: string }[]) => ({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: items.map((i) => ({
    "@type": "Question",
    name: i.q,
    acceptedAnswer: { "@type": "Answer", text: i.a },
  })),
});
