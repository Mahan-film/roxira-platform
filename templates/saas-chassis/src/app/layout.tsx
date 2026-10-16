import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { Analytics } from "@/components/analytics";
import { rtlLocales, type Locale } from "@/i18n/config";
import { JsonLd, organizationLd } from "@/lib/jsonld";
import { APP_NAME, APP_URL } from "@/lib/utils";
import "./globals.css";

const description = "Edit this default description in src/app/layout.tsx.";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: { default: APP_NAME, template: `%s | ${APP_NAME}` },
  description,
  openGraph: {
    type: "website",
    siteName: APP_NAME,
    title: APP_NAME,
    description,
    url: APP_URL,
  },
  twitter: { card: "summary_large_image", title: APP_NAME, description },
  alternates: { canonical: "/" },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const dir = rtlLocales.includes(locale as Locale) ? "rtl" : "ltr";
  return (
    <html lang={locale} dir={dir}>
      <body className="min-h-screen antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
        <JsonLd data={organizationLd()} />
        <Analytics />
      </body>
    </html>
  );
}
