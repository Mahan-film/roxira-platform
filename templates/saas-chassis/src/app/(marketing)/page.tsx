import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { plans } from "@config/plans";
import { buttonClass } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WaitlistForm } from "@/components/waitlist-form";
import { faqPageLd, JsonLd, softwareApplicationLd } from "@/lib/jsonld";
import { cn } from "@/lib/utils";

interface Item {
  title: string;
  body: string;
}
interface Faq {
  q: string;
  a: string;
}

export default async function LandingPage() {
  const t = await getTranslations("landing");
  const features = t.raw("features") as Item[];
  const faq = t.raw("faq") as Faq[];

  return (
    <>
      <section className="mx-auto max-w-4xl px-4 py-24 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">{t("heroTitle")}</h1>
        <p className="mt-6 text-lg text-muted-foreground">{t("heroSubtitle")}</p>
        <div className="mt-8">
          <Link href="/sign-up" className={buttonClass("default", "lg")}>
            {t("cta")}
          </Link>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="mb-8 text-center text-3xl font-bold">{t("featuresTitle")}</h2>
        <div className="grid gap-6 sm:grid-cols-3">
          {features.map((f) => (
            <Card key={f.title}>
              <CardHeader>
                <CardTitle>{f.title}</CardTitle>
                <CardDescription>{f.body}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="mb-8 text-center text-3xl font-bold">{t("pricingTitle")}</h2>
        <div className="grid gap-6 sm:grid-cols-3">
          {plans.map((p) => (
            <Card key={p.id} className={cn(p.highlight && "border-primary")}>
              <CardHeader>
                <CardTitle>{p.name}</CardTitle>
                <CardDescription>{p.tagline}</CardDescription>
                <p className="pt-2 text-3xl font-bold">
                  ${p.priceMonthly}
                  <span className="text-sm font-normal text-muted-foreground">{t("perMonth")}</span>
                </p>
              </CardHeader>
              <CardContent>
                <ul className="mb-6 space-y-1 text-sm">
                  {p.features.map((f) => (
                    <li key={f}>✓ {f}</li>
                  ))}
                </ul>
                <Link href="/sign-up" className={buttonClass(p.highlight ? "default" : "outline")}>
                  {t("choose")}
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-3xl px-4 py-16">
        <h2 className="mb-8 text-center text-3xl font-bold">{t("faqTitle")}</h2>
        <dl className="space-y-6">
          {faq.map((i) => (
            <div key={i.q}>
              <dt className="font-semibold">{i.q}</dt>
              <dd className="mt-1 text-muted-foreground">{i.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="waitlist" className="mx-auto max-w-xl px-4 py-16 text-center">
        <h2 className="text-3xl font-bold">{t("waitlistTitle")}</h2>
        <p className="mt-2 text-muted-foreground">{t("waitlistBody")}</p>
        <div className="mt-6">
          <WaitlistForm />
        </div>
      </section>

      <JsonLd data={softwareApplicationLd({ description: t("heroSubtitle"), lowPrice: 0 })} />
      <JsonLd data={faqPageLd(faq)} />
    </>
  );
}
